/**
 * Extraction des informations d'une facture (PDF ou image).
 *
 * 1. PDF : texte extrait avec `unpdf`, puis heuristiques déterministes (montants, dates, numéro, émetteur, devise,
 *    catégorie suggérée par mots-clés).
 * 2. Si `ANTHROPIC_API_KEY` est défini : extraction assistée par Claude (PDF ou image), sortie JSON structurée,
 *    avec repli silencieux sur les heuristiques en cas d'erreur.
 *
 * Rien n'est jamais enregistré à ce stade : l'utilisateur vérifie et corrige chaque champ avant validation.
 * Les montants sont renvoyés en unités MAJEURES (ex. 1250.5) ; la conversion se fait à la validation.
 */
import { z } from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";

type AnthropicContentBlock = Anthropic.ContentBlockParam;

export type Confidence = "high" | "medium" | "low" | "none";

export interface Field<T> {
  value: T | null;
  confidence: Confidence;
}

export interface ExtractedInvoice {
  number: Field<string>;
  issueDate: Field<string>;
  dueDate: Field<string>;
  currency: Field<string>;
  total: Field<number>;
  subtotal: Field<number>;
  tax: Field<number>;
  /** Émetteur de la facture (le fournisseur pour une dépense). */
  issuer: Field<string>;
  /** Destinataire (le client pour une facture émise). */
  recipient: Field<string>;
  description: Field<string>;
  /** Nom de catégorie de dépense suggéré (parmi les catégories par défaut). */
  category: Field<string>;
}

export interface ExtractionResult {
  method: "ai" | "text" | "none";
  fields: ExtractedInvoice;
  warnings: string[];
  /** Nombre de caractères de texte lus dans le document (0 pour une image ou un PDF scanné). */
  textLength: number;
}

export class ExtractionError extends Error {
  constructor(public code: "unreadable_pdf" | "unsupported", message: string) {
    super(message);
  }
}

const none = <T>(): Field<T> => ({ value: null, confidence: "none" });

export function emptyExtraction(): ExtractedInvoice {
  return {
    number: none(), issueDate: none(), dueDate: none(), currency: none(), total: none(), subtotal: none(), tax: none(),
    issuer: none(), recipient: none(), description: none(), category: none(),
  };
}

/* ───────────────────────── Nombres ───────────────────────── */

/**
 * Lit un montant écrit « à la française » ou « à l'anglaise » : "1 250 000", "1.250,50", "1,250.50", "1250.5".
 * Renvoie des unités majeures, ou null.
 */
export function parseLocaleNumber(raw: string): number | null {
  let s = String(raw).replace(/[\s  '’]/g, "").replace(/[^\d.,-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const count = (s.match(/,/g) ?? []).length;
    const tail = s.length - lastComma - 1;
    s = count > 1 || tail === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot > -1) {
    const count = (s.match(/\./g) ?? []).length;
    const tail = s.length - lastDot - 1;
    if (count > 1 || tail === 3) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Montants présents dans un fragment de texte (hors pourcentages et dates), dans l'ordre d'apparition. */
export function findAmounts(fragment: string): { value: number; index: number; raw: string }[] {
  const re = /(?<![\d.,/])(\d{1,3}(?:[   .,'’]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d/])/g;
  const out: { value: number; index: number; raw: string }[] = [];
  for (const m of fragment.matchAll(re)) {
    const raw = m[1];
    const after = fragment.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3);
    if (/^\s?%/.test(after)) continue; // taux
    const before = fragment.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0);
    if (/[/\-]/.test(before) && /^\d{1,2}$/.test(raw)) continue; // fragment de date
    const value = parseLocaleNumber(raw);
    if (value == null) continue;
    out.push({ value, index: m.index ?? 0, raw });
  }
  return out;
}

/* ───────────────────────── Dates ───────────────────────── */

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1, fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2, mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4, mai: 5, may: 5, juin: 6, june: 6, jun: 6, juillet: 7, juil: 7, july: 7, jul: 7,
  aout: 8, aug: 8, august: 8, septembre: 9, sept: 9, sep: 9, september: 9, octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11, decembre: 12, dec: 12, december: 12,
};

const deaccent = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Toutes les dates reconnues dans le texte (jj/mm/aaaa, aaaa-mm-jj, « 12 mars 2026 »…). */
export function findDates(text: string): { date: string; index: number; end: number }[] {
  const out: { date: string; index: number; end: number }[] = [];
  const flat = deaccent(text);
  for (const m of flat.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const d = iso(+m[1], +m[2], +m[3]);
    if (d) out.push({ date: d, index: m.index!, end: m.index! + m[0].length });
  }
  for (const m of flat.matchAll(/(?<![\d])(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?![\d])/g)) {
    const d = iso(+m[3], +m[2], +m[1]);
    if (d) out.push({ date: d, index: m.index!, end: m.index! + m[0].length });
  }
  for (const m of flat.matchAll(/\b(\d{1,2})(?:er)?\s+([a-z]{3,9})\.?\s+(\d{4})\b/gi)) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) continue;
    const d = iso(+m[3], month, +m[1]);
    if (d) out.push({ date: d, index: m.index!, end: m.index! + m[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

/* ───────────────────────── Heuristiques ───────────────────────── */

function normalizeText(text: string): string {
  return text.replace(/[  ]/g, " ").replace(/\r/g, "").replace(/[ \t]+/g, " ");
}

/** Premier montant trouvé juste après chaque occurrence du mot-clé ; la DERNIÈRE occurrence l'emporte (récapitulatif). */
function amountAfter(text: string, re: RegExp, opts: { window?: number; pick?: "last" | "first" } = {}): { value: number; index: number } | null {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const g = new RegExp(re.source, flags);
  let found: { value: number; index: number } | null = null;
  for (const m of text.matchAll(g)) {
    const start = m.index! + m[0].length;
    const windowText = text.slice(start, start + (opts.window ?? 90));
    const a = findAmounts(windowText)[0];
    if (a && a.value > 0) {
      found = { value: a.value, index: start + a.index };
      if (opts.pick === "first") return found;
    }
  }
  return found;
}

const TOTAL_STRONG = [
  /net\s*(?:à|a)\s*payer/i, /total\s*t\.?\s?t\.?\s?c\.?/i, /montant\s*t\.?\s?t\.?\s?c\.?/i, /total\s*(?:à|a)\s*payer/i,
  /montant\s*(?:total\s*)?(?:à|a)\s*payer/i, /solde\s*(?:à|a)\s*payer/i, /amount\s*due/i, /total\s*due/i, /grand\s*total/i,
  /total\s*amount/i, /montant\s*net/i,
];
const TOTAL_WEAK = [/(?<!sous[-\s]?)\btotal\b(?!\s*(?:h\.?\s?t|hors|tva|vat|des?\s*lignes?|partiel))/i, /\bmontant\b(?!\s*(?:h\.?\s?t|hors|tva|vat))/i];
const SUBTOTAL = [/total\s*h\.?\s?t\.?/i, /montant\s*h\.?\s?t\.?/i, /total\s*hors\s*tax\w*/i, /sous[-\s]?total/i, /\bsubtotal\b/i];
const TAX = [/(?:total|montant)\s*(?:de\s*la\s*)?(?:tva|t\.v\.a\.?)/i, /\btva\b(?!\s*(?:intra|n[°º]|num|:?\s*[A-Z]{2}\d))/i, /\bvat\b(?!\s*(?:n|id|reg))/i];

function detectCurrency(text: string): Field<string> {
  const counts: Record<string, number> = {
    XOF: (text.match(/\bF\s?\.?CFA\b|\bFCFA\b|\bXOF\b|\bfrancs?\s*CFA\b|\bCFA\b/gi) ?? []).length,
    XAF: (text.match(/\bXAF\b/gi) ?? []).length,
    EUR: (text.match(/€|\bEUR\b|\beuros?\b/gi) ?? []).length,
    USD: (text.match(/\$|\bUSD\b|\bdollars?\b/gi) ?? []).length,
  };
  if (counts.XAF > 0) counts.XOF = Math.max(0, counts.XOF - counts.XAF);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === 0) return none();
  const conf: Confidence = ranked[1][1] === 0 ? "high" : ranked[0][1] >= ranked[1][1] * 2 ? "medium" : "low";
  return { value: ranked[0][0], confidence: conf };
}

function detectNumber(text: string): Field<string> {
  const token = "([A-Z0-9][A-Z0-9\\-/_.]*\\d[A-Z0-9\\-/_.]*)";
  const strong = [
    new RegExp(`(?:facture|invoice|devis|pro\\s*-?forma)\\s*(?:n[°ºo]\\.?|num(?:[ée]ro)?\\.?|no\\.?|#)\\s*:?\\s*${token}`, "i"),
    new RegExp(`n[°ºo]\\.?\\s*(?:de\\s*(?:la\\s*)?)?(?:facture|invoice)\\s*:?\\s*${token}`, "i"),
    new RegExp(`(?:invoice|facture)\\s*(?:number|num[ée]ro)\\s*:?\\s*${token}`, "i"),
  ];
  for (const re of strong) {
    const m = text.match(re);
    if (m) return { value: m[1].replace(/[.\-/_]+$/, ""), confidence: "high" };
  }
  const weak = [new RegExp(`(?:facture|invoice)\\s*:?\\s*${token}`, "i"), new RegExp(`(?:r[ée]f[ée]rence|r[ée]f\\.?)\\s*:?\\s*${token}`, "i")];
  for (const re of weak) {
    const m = text.match(re);
    if (m && !/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(m[1])) return { value: m[1].replace(/[.\-/_]+$/, ""), confidence: "low" };
  }
  return none();
}

function dateAfter(text: string, dates: { date: string; index: number }[], re: RegExp, maxDistance = 70): string | null {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of deaccent(text).matchAll(g)) {
    const end = m.index! + m[0].length;
    const d = dates.find((x) => x.index >= end && x.index - end <= maxDistance);
    if (d) return d.date;
  }
  return null;
}

const DUE_KW = /(?:echeance|date\s*limite|a\s*payer\s*(?:avant|le|au\s*plus\s*tard)|payable\s*(?:avant|le|au\s*plus\s*tard|jusqu)|due\s*date|date\s*d.exigibilite|valable\s*jusqu|date\s*de\s*validite)/i;
const ISSUE_KW_STRONG = /(?:date\s*(?:de\s*(?:la\s*)?)?(?:facture|facturation|d.emission|emission)|emise?\s*le|invoice\s*date|date\s*du\s*devis)/i;
const ISSUE_KW_WEAK = /(?:\bdate\b|\bdu\b|\ble\b)\s*:?/i;

const LEGAL_FORM = /\b(SARLU?|SASU?|SA|SNC|SCI|EURL|ETS|[ÉE]tablissements?|Soci[ée]t[ée]|Ltd|LLC|Inc|GIE|Groupe)\b/;
const HEADER_WORDS = /^(facture|invoice|devis|pro\s*forma|date|page|n[°º]|numero|numéro|client|total|tel|tél|email|e-mail|adresse|www\.|http|objet|reference|référence)\b/i;

function detectParties(text: string): { issuer: Field<string>; recipient: Field<string> } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let recipient: Field<string> = none();
  const recRe = /(?:factur[ée]e?\s*(?:à|a)|adress[ée]e?\s*(?:à|a)|destinataire|client|bill\s*to|customer|sold\s*to)\s*:?\s*(.*)$/i;
  let recLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(recRe);
    if (!m) continue;
    const rest = m[1].trim();
    const candidate = rest && !/^\d+$/.test(rest) && !/^(n[°º]|code|id)\b/i.test(rest) ? rest : lines[i + 1] ?? "";
    if (candidate && /[a-z]/i.test(candidate) && candidate.length <= 80) {
      recipient = { value: candidate.replace(/\s{2,}/g, " "), confidence: "medium" };
      recLine = i;
      break;
    }
  }
  let issuer: Field<string> = none();
  const issuerRe = /(?:[ée]metteur|fournisseur|vendeur|prestataire|from|de)\s*:\s*(.+)$/i;
  for (const l of lines) {
    const m = l.match(issuerRe);
    if (m && /[a-z]/i.test(m[1]) && m[1].length <= 80) { issuer = { value: m[1].trim(), confidence: "medium" }; break; }
  }
  if (!issuer.value) {
    const head = lines.slice(0, recLine > 0 ? Math.min(recLine, 12) : 12);
    const legal = head.find((l) => LEGAL_FORM.test(l) && l.length <= 70 && !HEADER_WORDS.test(l));
    if (legal) issuer = { value: legal, confidence: "medium" };
    else {
      const first = head.find((l) => /[a-z]{2}/i.test(l) && l.length >= 2 && l.length <= 60 && !HEADER_WORDS.test(l) && !/@|\d{4,}/.test(l));
      if (first) issuer = { value: first, confidence: "low" };
    }
  }
  return { issuer, recipient };
}

/** Catégories de dépense par défaut ↔ mots-clés. */
const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ["Électricité & eau", /\b(cie|sodeci|senelec|edf|electricit|[ée]lectricit[ée]|eau|kwh|energie|énergie)\b/gi],
  ["Internet & téléphone", /\b(orange|mtn|moov|airtel|free|sfr|bouygues|internet|fibre|t[ée]l[ée]phon\w*|wifi|forfait|data)\b/gi],
  ["Abonnements logiciels", /\b(abonnement|licence|logiciel|saas|subscription|google\s*workspace|microsoft|adobe|notion|slack|zoom|canva|figma|aws|h[ée]bergement|nom\s*de\s*domaine)\b/gi],
  ["Loyer", /\b(loyer|bail|location\s*(?:de\s*)?(?:bureau|local|locaux)|quittance)\b/gi],
  ["Assurances", /\b(assurance|prime\s*d.assurance|police\s*n)\w*/gi],
  ["Frais bancaires", /\b(frais\s*bancaires|agios|commission\s*bancaire|tenue\s*de\s*compte)\b/gi],
  ["Déplacements", /\b(billet|vol|airline|air\s*\w+|taxi|uber|yango|heetch|carburant|essence|gasoil|h[ôo]tel|train|p[ée]age|transport)\b/gi],
  ["Matériel", /\b(ordinateur|laptop|macbook|imprimante|[ée]cran|mat[ée]riel|cam[ée]ra|disque)\b/gi],
  ["Prestataires & sous-traitance", /\b(prestation|sous-traitance|honoraires|freelance|consultant|mission)\b/gi],
  ["Communication & marketing", /\b(publicit[ée]|impression|flyers?|marketing|ads|sponsoris\w*|kak[ée]mono|banni[eè]re|affiches?)\b/gi],
  ["Formation", /\b(formation|s[ée]minaire|cours|atelier|certification)\b/gi],
  ["Repas & réception", /\b(restaurant|repas|traiteur|d[ée]jeuner|d[îi]ner|r[ée]ception|boissons?)\b/gi],
  ["Impôts & taxes", /\b(imp[ôo]ts?|taxes?\s*(?:fonci[eè]re|professionnelle)|dgi|patente|cnps|urssaf|tr[ée]sor\s*public)\b/gi],
  ["Achats professionnels", /\b(fournitures|papeterie|cartouches?|consommables|achat)\b/gi],
];

export function suggestCategory(text: string): Field<string> {
  let best: { name: string; score: number } | null = null;
  for (const [name, re] of CATEGORY_KEYWORDS) {
    const score = (text.match(re) ?? []).length;
    if (score > 0 && (!best || score > best.score)) best = { name, score };
  }
  if (!best) return none();
  return { value: best.name, confidence: best.score >= 3 ? "medium" : "low" };
}

function detectDescription(text: string): Field<string> {
  const m = text.match(/(?:objet|d[ée]signation|description|libell[ée]|concerne)\s*:?\s*([^\n]{3,120})/i);
  if (m) {
    const v = m[1].replace(/\s+(?:qt[ée]|quantit[ée]|prix|montant|pu|total).*$/i, "").trim();
    if (v.length >= 3 && /[a-z]/i.test(v)) return { value: v, confidence: "low" };
  }
  return none();
}

/** Extraction déterministe à partir du texte du document. */
export function extractFromText(input: string): ExtractedInvoice {
  const text = normalizeText(input);
  const out = emptyExtraction();
  if (!text.trim()) return out;

  // Montant total
  let total: { value: number; index: number } | null = null;
  for (const re of TOTAL_STRONG) {
    const r = amountAfter(text, re);
    if (r && (!total || r.index > total.index)) total = r;
  }
  if (total) out.total = { value: total.value, confidence: "high" };
  else {
    const weak = TOTAL_WEAK.map((re) => amountAfter(text, re)).filter(Boolean) as { value: number; index: number }[];
    if (weak.length) out.total = { value: weak.sort((a, b) => b.index - a.index)[0].value, confidence: "medium" };
    else {
      const all = findAmounts(text).filter((a) => !(Number.isInteger(a.value) && a.value >= 1900 && a.value <= 2100 && !/[ .,]/.test(a.raw)));
      if (all.length) out.total = { value: Math.max(...all.map((a) => a.value)), confidence: "low" };
    }
  }
  for (const re of SUBTOTAL) {
    const r = amountAfter(text, re);
    if (r) { out.subtotal = { value: r.value, confidence: "medium" }; break; }
  }
  // « TVA non applicable » / « exonéré » : aucune TVA, et surtout ne pas capter le montant de la ligne suivante.
  if (/\b(?:tva|t\.v\.a\.?|vat)\b[^\n\d]{0,25}(?:non[\s-]+applicable|exon[ée]r|n\/a\b|art(?:icle)?\.?\s*293\s*b)/i.test(text)) {
    out.tax = { value: 0, confidence: "high" };
  } else {
    for (const re of TAX) {
      const r = amountAfter(text, re);
      if (r) { out.tax = { value: r.value, confidence: "medium" }; break; }
    }
  }
  // Cohérence HT + TVA = TTC : renforce (ou affaiblit) la confiance
  if (out.total.value != null && out.subtotal.value != null) {
    const tax = out.tax.value ?? 0;
    if (Math.abs(out.subtotal.value + tax - out.total.value) < 0.011 * Math.max(1, out.total.value / 100)) {
      out.total.confidence = "high";
      out.subtotal.confidence = "high";
      if (out.tax.value != null) out.tax.confidence = "high";
    } else if (out.subtotal.value > out.total.value) {
      out.subtotal.confidence = "low";
    }
  }
  if (out.tax.value != null && out.total.value != null && out.tax.value >= out.total.value) out.tax = { value: out.tax.value, confidence: "low" };

  out.currency = detectCurrency(text);
  out.number = detectNumber(text);

  const dates = findDates(text);
  const due = dateAfter(text, dates, DUE_KW);
  if (due) out.dueDate = { value: due, confidence: "high" };
  const issueStrong = dateAfter(text, dates, ISSUE_KW_STRONG);
  if (issueStrong) out.issueDate = { value: issueStrong, confidence: "high" };
  else {
    const weak = dateAfter(text, dates.filter((d) => d.date !== due), ISSUE_KW_WEAK, 15);
    const first = dates.find((d) => d.date !== due);
    if (weak) out.issueDate = { value: weak, confidence: "medium" };
    else if (first) out.issueDate = { value: first.date, confidence: "low" };
  }
  if (out.issueDate.value && out.dueDate.value && out.dueDate.value < out.issueDate.value) out.dueDate.confidence = "low";
  if (!out.dueDate.value && out.issueDate.value) {
    const m = deaccent(text).match(/(?:a|sous|paiement\s*a)\s*(\d{1,3})\s*jours/i);
    if (m) {
      const d = new Date(out.issueDate.value + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + Number(m[1]));
      out.dueDate = { value: d.toISOString().slice(0, 10), confidence: "low" };
    }
  }

  const parties = detectParties(text);
  out.issuer = parties.issuer;
  out.recipient = parties.recipient;
  out.description = detectDescription(text);
  out.category = suggestCategory(text);
  return out;
}

/* ───────────────────────── Extraction assistée (Claude) ───────────────────────── */

export const AI_MODEL = "claude-sonnet-5-5";

const CATEGORY_NAMES = CATEGORY_KEYWORDS.map(([n]) => n);

function aiSchema() {
  const conf = z.enum(["high", "medium", "low"]);
  return z.object({
    invoice_number: z.string().nullable().describe("Numéro de la facture tel qu'imprimé, sans le libellé « Facture n° »."),
    issue_date: z.string().nullable().describe("Date d'émission au format AAAA-MM-JJ."),
    due_date: z.string().nullable().describe("Date d'échéance au format AAAA-MM-JJ, seulement si elle figure sur le document."),
    currency: z.enum(["XOF", "XAF", "EUR", "USD", "GBP", "CAD", "CHF", "MAD"]).nullable().describe("Code ISO de la devise ; F CFA / FCFA d'Afrique de l'Ouest = XOF."),
    total_amount: z.number().nullable().describe("Montant total TTC à payer, en unités (ex. 1250000 ou 1250.5), sans séparateur."),
    subtotal_amount: z.number().nullable().describe("Total hors taxes, si indiqué."),
    tax_amount: z.number().nullable().describe("Montant total de TVA / taxes, si indiqué."),
    issuer_name: z.string().nullable().describe("Nom de l'entreprise ou de la personne qui ÉMET la facture."),
    recipient_name: z.string().nullable().describe("Nom du client destinataire de la facture."),
    description: z.string().nullable().describe("Objet de la facture en quelques mots (français)."),
    expense_category: z.enum(CATEGORY_NAMES as [string, ...string[]]).nullable().describe("Catégorie de dépense la plus probable, si pertinent."),
    confidence: z.object({
      invoice_number: conf, issue_date: conf, due_date: conf, currency: conf, total_amount: conf, issuer_name: conf, recipient_name: conf,
    }),
  });
}

const isIsoDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Extraction par Claude (document PDF ou image en base64, sortie JSON structurée).
 * Renvoie null si le modèle décline ou si la sortie est inexploitable ; lève en cas d'erreur d'API.
 */
export async function extractWithClaude(buffer: Buffer, mimeType: string, direction: "income" | "expense"): Promise<ExtractedInvoice | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const data = buffer.toString("base64");
  const fileBlock: AnthropicContentBlock = mimeType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data } };
  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(aiSchema()) },
    system: "Tu extrais les informations d'une facture pour un logiciel de gestion français. N'invente rien : laisse un champ à null s'il n'apparaît pas clairement sur le document. Indique ta confiance pour chaque champ.",
    messages: [{
      role: "user",
      content: [
        fileBlock,
        { type: "text", text: direction === "income" ? "Cette facture a été émise par l'utilisateur à l'un de ses clients. Extrais ses informations." : "Cette facture a été reçue d'un fournisseur (dépense de l'utilisateur). Extrais ses informations." },
      ],
    }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const p = response.parsed_output;
  if (!p) return null;
  const f = <T>(value: T | null | undefined, c: "high" | "medium" | "low" = "medium"): Field<T> => (value == null || value === "" ? none() : { value, confidence: c });
  return {
    number: f(p.invoice_number?.trim(), p.confidence.invoice_number),
    issueDate: f(isIsoDate(p.issue_date) ? p.issue_date : null, p.confidence.issue_date),
    dueDate: f(isIsoDate(p.due_date) ? p.due_date : null, p.confidence.due_date),
    currency: f(p.currency, p.confidence.currency),
    total: f(p.total_amount != null && p.total_amount > 0 ? p.total_amount : null, p.confidence.total_amount),
    subtotal: f(p.subtotal_amount),
    tax: f(p.tax_amount),
    issuer: f(p.issuer_name?.trim(), p.confidence.issuer_name),
    recipient: f(p.recipient_name?.trim(), p.confidence.recipient_name),
    description: f(p.description?.trim()),
    category: f(p.expense_category),
  };
}

/* ───────────────────────── Lecture des fichiers ───────────────────────── */

export const IMPORT_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
export const IMPORT_MAX_BYTES = 15 * 1024 * 1024;

export async function pdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Fusion : la valeur assistée l'emporte, les heuristiques complètent les trous. */
function merge(ai: ExtractedInvoice, base: ExtractedInvoice): ExtractedInvoice {
  const out = emptyExtraction();
  for (const k of Object.keys(out) as (keyof ExtractedInvoice)[]) {
    const a = ai[k] as Field<unknown>;
    (out as unknown as Record<string, Field<unknown>>)[k] = a.value != null ? a : (base[k] as Field<unknown>);
  }
  return out;
}

/**
 * Point d'entrée serveur. Lève ExtractionError si le fichier n'est pas exploitable du tout
 * (format non pris en charge, PDF illisible sans extraction assistée disponible).
 */
export async function extractInvoice(buffer: Buffer, mimeType: string, opts: { direction: "income" | "expense" }): Promise<ExtractionResult> {
  if (!IMPORT_MIME.has(mimeType)) throw new ExtractionError("unsupported", "Format non pris en charge : importez un PDF ou une image (PNG, JPEG, WebP).");
  const warnings: string[] = [];
  let text = "";
  let pdfError = false;
  if (mimeType === "application/pdf") {
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") pdfError = true;
    else {
      try {
        text = await pdfText(buffer);
      } catch {
        pdfError = true;
      }
    }
  }
  const base = extractFromText(text);
  const hasKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasKey) {
    try {
      const ai = await extractWithClaude(buffer, mimeType, opts.direction);
      if (ai) return { method: "ai", fields: merge(ai, base), warnings, textLength: text.length };
      warnings.push("L'extraction assistée n'a pas abouti : les valeurs proposées viennent de l'analyse du texte.");
    } catch (e) {
      console.error("[extract] Claude:", e instanceof Error ? e.message : e);
      warnings.push("L'extraction assistée a échoué : les valeurs proposées viennent de l'analyse du texte.");
    }
  }

  if (pdfError) throw new ExtractionError("unreadable_pdf", "Ce PDF est illisible ou protégé. Essayez d'exporter à nouveau le document, ou importez une photo nette.");
  if (mimeType.startsWith("image/")) {
    warnings.push("Lecture automatique des images indisponible (aucune clé d'extraction assistée configurée) : complétez les champs à partir de l'aperçu.");
    return { method: "none", fields: emptyExtraction(), warnings, textLength: 0 };
  }
  if (text.trim().length < 20) {
    warnings.push("Ce PDF ne contient pas de texte lisible (document scanné ?) : complétez les champs à partir de l'aperçu.");
    return { method: "none", fields: base, warnings, textLength: text.length };
  }
  return { method: "text", fields: base, warnings, textLength: text.length };
}
