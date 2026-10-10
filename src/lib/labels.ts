/** Libellés partagés (interface en français). */

export const INTERACTION_TYPES: Record<string, string> = {
  first_contact: "Premier contact",
  meeting: "Rendez-vous",
  proposal_sent: "Proposition envoyée",
  contract_sent: "Contrat transmis",
  contract_signed: "Contrat signé",
  quote_sent: "Devis envoyé",
  invoice_issued: "Facture émise",
  payment_received: "Paiement reçu",
  follow_up: "Relance effectuée",
  opportunity: "Nouvelle opportunité",
  email_sent: "Email envoyé",
  note: "Note",
  converted: "Devenu client",
};

export const OPPORTUNITY_STAGES: Record<string, { label: string; probability: number }> = {
  lead: { label: "Piste", probability: 20 },
  proposal_sent: { label: "Proposition envoyée", probability: 50 },
  negotiation: { label: "Négociation", probability: 70 },
  won: { label: "Gagnée", probability: 100 },
  lost: { label: "Perdue", probability: 0 },
};

export const ACCOUNT_TYPES: Record<string, string> = {
  bank: "Compte bancaire",
  cash: "Caisse (espèces)",
  mobile_money: "Mobile money",
  card: "Carte / compte de paiement",
  payment: "Compte de paiement en ligne",
};

export const FREQUENCIES: Record<string, string> = { monthly: "Mensuelle", quarterly: "Trimestrielle", yearly: "Annuelle" };

export const MODES: Record<string, { label: string; description: string }> = {
  solo: { label: "Indépendant", description: "Une seule activité. Tout est simple, sans configuration superflue." },
  multi_activity: { label: "Multi-activités", description: "Plusieurs métiers sous une même structure, comparés entre eux." },
  multi_company: { label: "Multi-entreprises", description: "Plusieurs structures, consultables séparément ou en vue consolidée." },
};

export const GOAL_TYPES: Record<string, { label: string; unit: "money" | "percent"; hint: string }> = {
  monthly_revenue: { label: "Revenus mensuels à encaisser", unit: "money", hint: "Montant encaissé visé chaque mois." },
  expense_cap: { label: "Plafond de dépenses mensuelles", unit: "money", hint: "Dépenses payées à ne pas dépasser sur le mois." },
  min_cash: { label: "Trésorerie minimale", unit: "money", hint: "Seuil sous lequel votre solde ne devrait jamais descendre (point bas prévu sur 90 jours)." },
  reserve: { label: "Réserve financière", unit: "money", hint: "Montant total disponible que vous souhaitez constituer." },
  margin_rate: { label: "Taux de marge", unit: "percent", hint: "Taux de marge visé, global ou pour une activité (90 derniers jours)." },
  overdue_reduction: { label: "Factures en retard (maximum)", unit: "money", hint: "Montant total en retard à ne pas dépasser." },
};
