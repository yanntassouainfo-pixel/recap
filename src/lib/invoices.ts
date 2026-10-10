/**
 * Factures & devis — logique PURE (aucun accès base) : utilisable côté serveur, côté client et dans les tests.
 * Les montants sont des entiers en unités mineures de la devise de la facture (XOF : 0 décimale, EUR : centimes).
 */
import { decimalsOf, parseAmount } from "./money";

export interface LineInput {
  description: string;
  quantity: number;
  /** Prix unitaire HT en unités mineures. */
  unitPrice: number;
  /** Taux de TVA en pourcentage (0 si non applicable). */
  taxRate: number;
}

export interface ComputedLine extends LineInput {
  /** Montant HT de la ligne (unités mineures, arrondi). */
  amount: number;
}

export interface Totals {
  lines: ComputedLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  /** TVA ventilée par taux (calculée sur la base HT cumulée de chaque taux, arrondie une seule fois). */
  taxes: { rate: number; base: number; amount: number }[];
}

/** Arrondi « commercial » à l'unité mineure (symétrique pour les négatifs). */
function roundMinor(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v) + 1e-9);
}

/** Montant HT d'une ligne : quantité × prix unitaire, arrondi à l'unité mineure de la devise. */
export function lineAmount(quantity: number, unitPrice: number): number {
  return roundMinor(quantity * unitPrice);
}

/**
 * Recalcule les totaux d'une facture. Source de vérité côté serveur ; le même calcul sert à l'aperçu en direct.
 * Comme les montants sont en unités mineures, l'arrondi respecte automatiquement les décimales de la devise
 * (XOF : au franc près, EUR : au centime près).
 */
export function computeTotals(lines: LineInput[]): Totals {
  const computed = lines.map((l) => ({ ...l, amount: lineAmount(l.quantity, l.unitPrice) }));
  const byRate = new Map<number, number>();
  for (const l of computed) {
    const rate = normalizeRate(l.taxRate);
    if (rate === 0) continue;
    byRate.set(rate, (byRate.get(rate) ?? 0) + l.amount);
  }
  const taxes = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, base]) => ({ rate, base, amount: roundMinor((base * rate) / 100) }));
  const subtotal = computed.reduce((a, l) => a + l.amount, 0);
  const taxTotal = taxes.reduce((a, t) => a + t.amount, 0);
  return { lines: computed, subtotal, taxTotal, total: subtotal + taxTotal, taxes };
}

export function normalizeRate(rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate)) return 0;
  return Math.round(rate * 100) / 100;
}

/* ───────────────────────── Saisie des lignes ───────────────────────── */

/** Ligne telle que saisie dans le formulaire (chaînes). */
export interface RawLine {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

export function parseQuantity(s: string): number | null {
  const v = String(s ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseRate(s: string): number | null {
  const v = String(s ?? "").trim().replace(/[\s%]/g, "").replace(",", ".");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedLines {
  lines: LineInput[];
  errors: string[];
}

/** Valide et convertit les lignes saisies (prix en unités majeures → unités mineures de la devise). */
export function parseLines(raw: RawLine[], currency: string): ParsedLines {
  const lines: LineInput[] = [];
  const errors: string[] = [];
  raw.forEach((r, i) => {
    const n = i + 1;
    const empty = !r.description?.trim() && !r.unitPrice?.trim();
    if (empty) return; // ligne vide ignorée
    const description = (r.description ?? "").trim();
    const quantity = parseQuantity(r.quantity || "1");
    const unitPrice = parseAmount(r.unitPrice, currency);
    const taxRate = parseRate(r.taxRate);
    if (!description) errors.push(`Ligne ${n} : ajoutez une description.`);
    if (quantity == null || quantity <= 0) errors.push(`Ligne ${n} : quantité invalide.`);
    if (unitPrice == null) errors.push(`Ligne ${n} : prix unitaire invalide.`);
    if (taxRate == null || taxRate < 0 || taxRate > 100) errors.push(`Ligne ${n} : taux de TVA invalide (entre 0 et 100).`);
    if (description && quantity != null && quantity > 0 && unitPrice != null && taxRate != null && taxRate >= 0 && taxRate <= 100) {
      lines.push({ description: description.slice(0, 500), quantity, unitPrice, taxRate: normalizeRate(taxRate) });
    }
  });
  if (!lines.length && !errors.length) errors.push("Ajoutez au moins une ligne.");
  return { lines, errors };
}

/* ───────────────────────── Numérotation ───────────────────────── */

/**
 * Prochain numéro `{préfixe}-{AAAA}-{NNN}` pour une structure et un type de document, à partir des numéros
 * existants (tous types d'années confondus : seuls ceux de l'année et du préfixe comptent).
 */
export function nextNumber(prefix: string, year: string | number, existing: string[]): string {
  const p = (prefix || "FAC").trim();
  const head = `${p}-${year}-`;
  let max = 0;
  for (const num of existing) {
    if (!num.startsWith(head)) continue;
    const tail = num.slice(head.length);
    if (!/^\d+$/.test(tail)) continue;
    max = Math.max(max, Number(tail));
  }
  return `${head}${String(max + 1).padStart(3, "0")}`;
}

/* ───────────────────────── Statuts ───────────────────────── */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

/** Libellés des devis (masculin), distincts de ceux des factures. */
export const QUOTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  sent: { label: "Envoyé", tone: "info" },
  expired: { label: "Expiré", tone: "warn" },
  accepted: { label: "Accepté", tone: "good" },
  declined: { label: "Refusé", tone: "neutral" },
  cancelled: { label: "Annulé", tone: "neutral" },
};

/** Statut d'un devis : « Expiré » si envoyé et date de validité dépassée. */
export function quoteDisplayStatus(q: { status: string; dueDate: string }, today: string): string {
  if (q.status === "sent" && q.dueDate < today) return "expired";
  return QUOTE_STATUS[q.status] ? q.status : "draft";
}

export const INVOICE_STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Toutes" },
  { key: "open", label: "À encaisser" },
  { key: "overdue", label: "En retard" },
  { key: "partial", label: "Partiellement payées" },
  { key: "paid", label: "Payées" },
  { key: "draft", label: "Brouillons" },
  { key: "cancelled", label: "Annulées" },
];

/** Filtre de statut appliqué au statut dérivé du moteur. `open` = envoyées non soldées. */
export function matchesStatusFilter(filter: string, s: { status: string; paid: number; remaining: number }): boolean {
  switch (filter) {
    case "open": return ["pending", "partial", "overdue", "sent"].includes(s.status) && s.remaining > 0;
    case "overdue": return s.status === "overdue";
    case "partial": return s.paid > 0 && s.remaining > 0 && !["draft", "cancelled"].includes(s.status);
    case "paid": return s.status === "paid";
    case "draft": return s.status === "draft";
    case "cancelled": return s.status === "cancelled";
    default: return true;
  }
}

/* ───────────────────────── Divers ───────────────────────── */

/** Valeur d'un montant mineur pour un champ de saisie (sans séparateur de milliers). */
export function minorToField(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  const s = (minor / 10 ** d).toFixed(d);
  return d ? s.replace(".", ",") : s;
}

export function quantityToField(q: number): string {
  return String(Math.round(q * 1000) / 1000).replace(".", ",");
}

export function rateToField(r: number): string {
  return r ? String(r).replace(".", ",") : "";
}

/** Normalisation pour comparer des noms (fournisseur, client) sans accents ni ponctuation. */
export function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(sarl|sarlu|sas|sasu|sa|ets|eurl|ltd|inc|sci)\b/g, "").replace(/[^a-z0-9]/g, "");
}

/** Deux noms désignent-ils probablement la même entité ? */
export function sameParty(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
}

/** Modes de paiement (copie locale, utilisable dans les composants serveur). */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Virement",
  mobile_money: "Mobile money",
  cash: "Espèces",
  card: "Carte",
  check: "Chèque",
  direct_debit: "Prélèvement",
  other: "Autre",
};
