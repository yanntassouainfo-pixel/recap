/**
 * Remplissage des modèles d'emails. Module PUR (aucun accès base) : utilisable côté serveur et dans le composeur.
 *
 * Variables : {{prenom}} {{nom}} {{entreprise}} {{activite}} {{facture}} {{montant}} {{echeance}} {{signature}}
 * Une variable sans valeur reste visible telle quelle dans le texte ({{facture}}) et est signalée : on ne
 * remplace jamais par une valeur inventée.
 */

export const TEMPLATE_VARIABLES: Record<string, string> = {
  prenom: "Prénom du destinataire",
  nom: "Nom complet du destinataire",
  entreprise: "Organisation du destinataire",
  activite: "Activité concernée",
  facture: "Numéro de facture / devis",
  montant: "Montant de la facture / du devis",
  echeance: "Date d'échéance",
  signature: "Signature de l'expéditeur",
};

export type TemplateVars = Partial<Record<string, string | null | undefined>>;

export interface RenderResult {
  text: string;
  /** Variables connues mais sans valeur (laissées telles quelles dans le texte). */
  missing: string[];
  /** Variables inconnues (faute de frappe probable). */
  unknown: string[];
}

const VAR_RE = /\{\{\s*([a-zA-Zéèêàç_]+)\s*\}\}/g;

export function normalizeVarName(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function renderTemplate(source: string, vars: TemplateVars): RenderResult {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = source.replace(VAR_RE, (whole, raw: string) => {
    const key = normalizeVarName(raw);
    if (!(key in TEMPLATE_VARIABLES)) {
      unknown.add(raw);
      return whole;
    }
    const v = vars[key];
    if (v == null || String(v).trim() === "") {
      missing.add(key);
      return whole;
    }
    return String(v);
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

/** Variables encore présentes dans un texte (après édition manuelle, par exemple). */
export function unresolvedVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) out.add(m[1]);
  return [...out];
}

/** "Awa Koné" → prénom "Awa" ; "M. Kouassi" → "M. Kouassi" (pas de découpage hasardeux sur les civilités). */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const name = (fullName ?? "").trim();
  if (!name) return null;
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (/^(m\.|mme|mlle|mr|dr|me|pr)\.?$/i.test(parts[0])) return name;
  return parts[0];
}

export interface VarsInput {
  contact?: { name: string; organization?: string | null } | null;
  activityName?: string | null;
  invoice?: { number: string; amountLabel?: string | null; dueDateLabel?: string | null } | null;
  sender?: { fromName: string; companyName?: string | null; email?: string | null; phone?: string | null; website?: string | null } | null;
}

export function buildSignature(sender: NonNullable<VarsInput["sender"]>): string {
  const lines = [sender.fromName];
  if (sender.companyName && sender.companyName !== sender.fromName) lines.push(sender.companyName);
  const contact = [sender.email, sender.phone].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  if (sender.website) lines.push(sender.website);
  return lines.join("\n");
}

export function buildTemplateVars(input: VarsInput): TemplateVars {
  const c = input.contact;
  return {
    prenom: firstNameOf(c?.name),
    nom: c?.name ?? null,
    entreprise: c ? (c.organization?.trim() || c.name) : null,
    activite: input.activityName ?? null,
    facture: input.invoice?.number ?? null,
    montant: input.invoice?.amountLabel ?? null,
    echeance: input.invoice?.dueDateLabel ?? null,
    signature: input.sender ? buildSignature(input.sender) : null,
  };
}

/* ───────── Adresses ───────── */

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** "a@x.ci, b@y.ci; c@z.ci" → { valid: [...], invalid: [...] } */
export function parseAddressList(input: string | null | undefined): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of (input ?? "").split(/[,;\n]+/)) {
    const s = raw.trim();
    if (!s) continue;
    if (isValidEmail(s)) {
      if (!valid.includes(s.toLowerCase())) valid.push(s.toLowerCase());
    } else invalid.push(s);
  }
  return { valid, invalid };
}

/* ───────── Interaction associée à un modèle ───────── */

/** Type d'événement inscrit dans la fiche du contact après un envoi réussi, selon l'objet du modèle. */
export function interactionTypeForPurpose(purpose: string | null | undefined): string {
  switch (purpose) {
    case "proposal": return "proposal_sent";
    case "contract": return "contract_sent";
    case "quote": return "quote_sent";
    case "proposal_follow_up":
    case "invoice_reminder": return "follow_up";
    default: return "email_sent";
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}
