import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { newId } from "./ids";

export const DEFAULT_EXPENSE_CATEGORIES: [string, "fixed" | "variable"][] = [
  ["Loyer", "fixed"],
  ["Électricité & eau", "fixed"],
  ["Internet & téléphone", "fixed"],
  ["Abonnements logiciels", "fixed"],
  ["Assurances", "fixed"],
  ["Frais bancaires", "fixed"],
  ["Déplacements", "variable"],
  ["Achats professionnels", "variable"],
  ["Matériel", "variable"],
  ["Prestataires & sous-traitance", "variable"],
  ["Communication & marketing", "variable"],
  ["Formation", "variable"],
  ["Repas & réception", "variable"],
  ["Impôts & taxes", "variable"],
  ["Dépenses personnelles", "variable"],
  ["Autres dépenses", "variable"],
];

export const DEFAULT_INCOME_CATEGORIES = ["Prestations de services", "Formations", "Ventes", "Droits & licences", "Rémunération", "Autres revenus"];

export function ensureDefaultCategories(userId: string) {
  const existing = db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.userId, userId)).all();
  if (existing.length) return;
  db.insert(schema.categories).values([
    ...DEFAULT_EXPENSE_CATEGORIES.map(([name, nature]) => ({ id: newId("cat_"), userId, kind: "expense", name, nature })),
    ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ id: newId("cat_"), userId, kind: "income", name, nature: "variable" })),
  ]).run();
}

export const TEMPLATE_PURPOSES: Record<string, string> = {
  proposal: "Envoi d'une proposition commerciale",
  contract: "Envoi d'un contrat",
  services: "Présentation des services",
  quote: "Envoi d'un devis",
  invoice: "Transmission d'une facture",
  proposal_follow_up: "Relance après une proposition",
  invoice_reminder: "Relance pour une facture impayée",
  thanks: "Remerciement après une prestation",
  first_contact: "Prise de contact",
  meeting_follow_up: "Suivi après un rendez-vous",
  other: "Autre",
};

/** Variables disponibles : {{prenom}}, {{nom}}, {{entreprise}}, {{activite}}, {{facture}}, {{montant}}, {{echeance}}, {{signature}} */
export const DEFAULT_TEMPLATES: { purpose: string; name: string; subject: string; body: string }[] = [
  {
    purpose: "proposal", name: "Proposition commerciale", subject: "Votre proposition d'accompagnement — {{entreprise}}",
    body: "Bonjour {{prenom}},\n\nMerci pour notre échange. Comme convenu, vous trouverez ci-joint ma proposition pour {{activite}}, ainsi que les documents utiles pour en prendre connaissance.\n\nJe reste disponible pour en discuter et ajuster le format à vos besoins.\n\nBien cordialement,\n{{signature}}",
  },
  {
    purpose: "contract", name: "Envoi du contrat", subject: "Contrat d'accompagnement — {{entreprise}}",
    body: "Bonjour {{prenom}},\n\nRavi(e) de démarrer cette collaboration. Vous trouverez ci-joint le contrat correspondant à notre accord. Il vous suffit de le retourner signé pour que nous puissions planifier les premières séances.\n\nBien cordialement,\n{{signature}}",
  },
  {
    purpose: "services", name: "Présentation des services", subject: "Présentation — {{entreprise}}",
    body: "Bonjour {{prenom}},\n\nComme promis, je vous adresse la présentation de mes services. Vous y trouverez les formats d'accompagnement, des exemples de réalisations et les modalités pratiques.\n\nAu plaisir d'échanger,\n{{signature}}",
  },
  {
    purpose: "quote", name: "Envoi d'un devis", subject: "Devis {{facture}} — {{entreprise}}",
    body: "Bonjour {{prenom}},\n\nVeuillez trouver ci-joint le devis {{facture}} d'un montant de {{montant}}. Il est valable 30 jours.\n\nBien cordialement,\n{{signature}}",
  },
  {
    purpose: "invoice", name: "Transmission d'une facture", subject: "Facture {{facture}} — {{entreprise}}",
    body: "Bonjour {{prenom}},\n\nVeuillez trouver ci-joint la facture {{facture}} d'un montant de {{montant}}, payable au plus tard le {{echeance}}.\n\nMerci pour votre confiance,\n{{signature}}",
  },
  {
    purpose: "proposal_follow_up", name: "Relance proposition", subject: "Suite à ma proposition",
    body: "Bonjour {{prenom}},\n\nJe me permets de revenir vers vous au sujet de la proposition envoyée récemment. Avez-vous pu en prendre connaissance ? Je peux tout à fait l'adapter si besoin.\n\nBien cordialement,\n{{signature}}",
  },
  {
    purpose: "invoice_reminder", name: "Relance facture impayée", subject: "Rappel — facture {{facture}}",
    body: "Bonjour {{prenom}},\n\nSauf erreur de ma part, la facture {{facture}} d'un montant de {{montant}}, arrivée à échéance le {{echeance}}, reste à régler. Pourriez-vous me confirmer la date de paiement prévue ?\n\nSi le règlement a déjà été effectué, merci de ne pas tenir compte de ce message.\n\nBien cordialement,\n{{signature}}",
  },
  {
    purpose: "thanks", name: "Remerciement", subject: "Merci pour votre confiance",
    body: "Bonjour {{prenom}},\n\nMerci pour cette collaboration. Ce fut un plaisir de vous accompagner. N'hésitez pas à me solliciter pour la suite.\n\nBien cordialement,\n{{signature}}",
  },
  {
    purpose: "first_contact", name: "Prise de contact", subject: "Prise de contact — {{entreprise}}",
    body: "Bonjour {{prenom}},\n\nJe me permets de vous contacter pour vous présenter mon activité. Seriez-vous disponible pour un court échange dans les prochains jours ?\n\nBien cordialement,\n{{signature}}",
  },
  {
    purpose: "meeting_follow_up", name: "Suivi de rendez-vous", subject: "Suite à notre rendez-vous",
    body: "Bonjour {{prenom}},\n\nMerci pour le temps accordé lors de notre rendez-vous. Comme convenu, voici les prochaines étapes :\n\n- \n- \n\nBien cordialement,\n{{signature}}",
  },
];

export function ensureDefaultTemplates(userId: string) {
  const existing = db.select({ id: schema.emailTemplates.id }).from(schema.emailTemplates).where(eq(schema.emailTemplates.userId, userId)).all();
  if (existing.length) return;
  db.insert(schema.emailTemplates).values(DEFAULT_TEMPLATES.map((t) => ({ id: newId("tpl_"), userId, ...t }))).run();
}

export function ensureDefaultRates(userId: string, today: string) {
  const existing = db.select({ id: schema.exchangeRates.id }).from(schema.exchangeRates)
    .where(and(eq(schema.exchangeRates.userId, userId), eq(schema.exchangeRates.base, "USD"))).get();
  if (existing) return;
  // Taux indicatif saisi à la création, à mettre à jour par l'utilisateur (la date et la source sont affichées).
  db.insert(schema.exchangeRates).values({ id: newId("fx_"), userId, date: today, base: "USD", quote: "XOF", rate: 565, source: "Taux indicatif initial — à vérifier" }).run();
}

/** Crée l'espace personnel (désactivé tant que l'utilisateur ne l'active pas). */
export function ensurePersonalSpace(userId: string, currency: string, today: string) {
  const existing = db.select().from(schema.companies).where(and(eq(schema.companies.userId, userId), eq(schema.companies.kind, "personal"))).get();
  if (existing) return existing.id;
  const id = newId("cmp_");
  db.insert(schema.companies).values({ id, userId, kind: "personal", name: "Finances personnelles", currency, color: "#7a6a58", invoicePrefix: "PERSO" }).run();
  db.insert(schema.accounts).values({ id: newId("acc_"), userId, companyId: id, name: "Compte personnel", type: "bank", currency, openingBalance: 0, openingDate: today }).run();
  return id;
}
