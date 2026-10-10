/**
 * Recap — modèle de données.
 *
 * Règles transverses :
 * - Tous les montants sont des entiers en unités mineures de LEUR devise (XOF: 0 décimale, EUR/USD: centimes).
 *   La devise d'origine est toujours conservée à côté du montant ; aucune addition ne se fait sans conversion datée.
 * - Chaque ligne appartient à un utilisateur (userId) : c'est la frontière d'isolation des données.
 * - Les "espaces" (companies) incluent les entreprises/structures ET l'espace personnel (kind = 'personal').
 * - L'argent qui bouge réellement (encaissé / décaissé) vient de : payments (sur factures), incomes (recettes
 *   directes), expenses au statut 'paid', transfers. Tout le reste (factures, échéances, récurrences, opportunités)
 *   est de l'attendu ou du prévisionnel.
 */
import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull().$defaultFn(() => new Date().toISOString());

/* ───────────────────────── Identité & paramètres ───────────────────────── */

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable("sessions", {
  id: id(), // hash du jeton (le jeton brut ne vit que dans le cookie)
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: createdAt(),
  userAgent: text("user_agent"),
});

export const settings = sqliteTable("settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  baseCurrency: text("base_currency").notNull().default("XOF"),
  country: text("country").notNull().default("CI"),
  /** solo | multi_activity | multi_company */
  mode: text("mode").notNull().default("solo"),
  personalSpaceEnabled: integer("personal_space_enabled", { mode: "boolean" }).notNull().default(false),
  /** Seuil de trésorerie minimale (unités mineures de baseCurrency) sous lequel on alerte. */
  cashSafetyThreshold: integer("cash_safety_threshold").notNull().default(0),
  /** Taux appliqués aux factures en retard / opportunités pour les scénarios (0-100). */
  scenarioPrudentOverdueRate: integer("scenario_prudent_overdue_rate").notNull().default(0),
  scenarioCentralOverdueRate: integer("scenario_central_overdue_rate").notNull().default(50),
  scenarioOptimistOverdueRate: integer("scenario_optimist_overdue_rate").notNull().default(100),
  onboardedAt: text("onboarded_at"),
});

/* ───────────────────────── Structures ───────────────────────── */

export const companies = sqliteTable("companies", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** company | personal */
  kind: text("kind").notNull().default("company"),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  description: text("description"),
  logoPath: text("logo_path"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  website: text("website"),
  currency: text("currency").notNull().default("XOF"),
  taxId: text("tax_id"),
  billingDetails: text("billing_details"), // coordonnées de paiement affichées sur les factures
  invoicePrefix: text("invoice_prefix").notNull().default("FAC"),
  quotePrefix: text("quote_prefix").notNull().default("DEV"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  color: text("color").notNull().default("#2a78d6"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/** Enseigne : nom commercial sous lequel une activité est exercée. */
export const brands = sqliteTable("brands", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  logoPath: text("logo_path"),
  createdAt: createdAt(),
});

/** Activité : ligne de revenus que l'on souhaite analyser. */
export const activities = sqliteTable("activities", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  color: text("color").notNull().default("#2a78d6"),
  /** Objectif de revenus mensuels (unités mineures de la devise de l'entreprise). */
  monthlyRevenueTarget: integer("monthly_revenue_target"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/* ───────────────────────── Comptes & devises ───────────────────────── */

export const accounts = sqliteTable("accounts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** bank | cash | mobile_money | card | payment */
  type: text("type").notNull().default("bank"),
  institution: text("institution"),
  currency: text("currency").notNull(),
  openingBalance: integer("opening_balance").notNull().default(0),
  openingDate: text("opening_date").notNull(),
  /** manual | bank_sync — prêt pour la synchronisation bancaire (phase 4) */
  source: text("source").notNull().default("manual"),
  externalId: text("external_id"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    /** 1 base = rate quote (en unités majeures) */
    rate: real("rate").notNull(),
    source: text("source").notNull().default("manuel"),
    createdAt: createdAt(),
  },
  (t) => [index("rates_lookup").on(t.userId, t.base, t.quote, t.date)],
);

export const categories = sqliteTable("categories", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** income | expense */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  /** fixed | variable — aide à la pédagogie charges fixes/variables */
  nature: text("nature").notNull().default("variable"),
  icon: text("icon"),
  createdAt: createdAt(),
});

/* ───────────────────────── Commercial ───────────────────────── */

export const contacts = sqliteTable("contacts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** prospect | client | supplier */
  type: text("type").notNull().default("prospect"),
  name: text("name").notNull(),
  organization: text("organization"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  needs: text("needs"),
  notes: text("notes"),
  source: text("source"),
  nextFollowUpAt: text("next_follow_up_at"),
  convertedAt: text("converted_at"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const opportunities = sqliteTable("opportunities", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  amount: integer("amount").notNull().default(0),
  currency: text("currency").notNull(),
  /** 0-100, utilisé uniquement dans le scénario optimiste */
  probability: integer("probability").notNull().default(50),
  /** lead | proposal_sent | negotiation | won | lost */
  stage: text("stage").notNull().default("lead"),
  expectedCloseDate: text("expected_close_date"),
  agreedTerms: text("agreed_terms"),
  notes: text("notes"),
  closedAt: text("closed_at"),
  createdAt: createdAt(),
});

/** Journal de la relation commerciale — alimenté automatiquement par les autres modules. */
export const interactions = sqliteTable("interactions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  /** first_contact | meeting | proposal_sent | contract_sent | contract_signed | quote_sent | invoice_issued |
   *  payment_received | follow_up | opportunity | email_sent | note | converted */
  type: text("type").notNull(),
  date: text("date").notNull(),
  title: text("title").notNull(),
  details: text("details"),
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdAt: createdAt(),
});

/* ───────────────────────── Revenus ───────────────────────── */

/** Factures ET devis (docType). Le statut de paiement est CALCULÉ depuis les paiements, jamais saisi. */
export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    /** invoice | quote */
    docType: text("doc_type").notNull().default("invoice"),
    number: text("number").notNull(),
    title: text("title"),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    currency: text("currency").notNull(),
    /** Total TTC en unités mineures, recalculé depuis les lignes à chaque écriture. */
    total: integer("total").notNull().default(0),
    subtotal: integer("subtotal").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    /** draft | sent | cancelled (+ accepted | declined pour les devis). Payé/partiel/retard sont dérivés. */
    status: text("status").notNull().default("draft"),
    sentAt: text("sent_at"),
    notes: text("notes"),
    /** created | imported */
    source: text("source").notNull().default("created"),
    documentId: text("document_id"),
    /** Facture vers une autre structure de l'utilisateur → flux interne, exclu de la consolidation. */
    counterpartCompanyId: text("counterpart_company_id").references(() => companies.id, { onDelete: "set null" }),
    convertedFromId: text("converted_from_id"),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("invoice_number_unique").on(t.companyId, t.docType, t.number)],
);

export const invoiceLines = sqliteTable("invoice_lines", {
  id: id(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: integer("unit_price").notNull().default(0),
  taxRate: real("tax_rate").notNull().default(0),
});

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
    date: text("date").notNull(),
    /** Montant affecté à la facture, en devise de la facture. */
    amount: integer("amount").notNull(),
    /** bank_transfer | cash | mobile_money | card | check | other */
    method: text("method").notNull().default("bank_transfer"),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
    reference: text("reference"),
    /** Frais prélevés sur l'encaissement (devise de la facture). Net encaissé = amount - fees. */
    fees: integer("fees").notNull().default(0),
    bankTransactionId: text("bank_transaction_id"),
    createdAt: createdAt(),
  },
  (t) => [index("payments_invoice").on(t.invoiceId)],
);

/** Recette directe sans facture (vente comptant, prestation ponctuelle…). */
export const incomes = sqliteTable("incomes", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
  date: text("date").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  description: text("description").notNull(),
  method: text("method").notNull().default("bank_transfer"),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  reference: text("reference"),
  documentId: text("document_id"),
  bankTransactionId: text("bank_transaction_id"),
  createdAt: createdAt(),
});

/* ───────────────────────── Dépenses ───────────────────────── */

/** Règle de répartition des frais communs entre activités. */
export const allocationRules = sqliteTable("allocation_rules", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** manual | revenue */
  method: text("method").notNull().default("manual"),
  /** JSON: [{activityId, percent}] pour la méthode manuelle */
  shares: text("shares").notNull().default("[]"),
  createdAt: createdAt(),
});

export const recurringExpenses = sqliteTable("recurring_expenses", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  allocationRuleId: text("allocation_rule_id").references(() => allocationRules.id, { onDelete: "set null" }),
  categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  supplier: text("supplier"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  /** monthly | quarterly | yearly */
  frequency: text("frequency").notNull().default("monthly"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  method: text("method").notNull().default("bank_transfer"),
  remindDaysBefore: integer("remind_days_before").notNull().default(3),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export const expenses = sqliteTable(
  "expenses",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
    allocationRuleId: text("allocation_rule_id").references(() => allocationRules.id, { onDelete: "set null" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    supplier: text("supplier"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    /** Date de la dépense (engagement / facture fournisseur). */
    date: text("date").notNull(),
    dueDate: text("due_date"),
    /** planned (engagée, à payer) | paid | cancelled */
    status: text("status").notNull().default("paid"),
    paidDate: text("paid_date"),
    method: text("method").notNull().default("bank_transfer"),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** direct = coût direct de l'activité ; overhead = autre dépense affectée / frais commun */
    costType: text("cost_type").notNull().default("overhead"),
    note: text("note"),
    documentId: text("document_id"),
    recurringId: text("recurring_id").references(() => recurringExpenses.id, { onDelete: "set null" }),
    occurrenceDate: text("occurrence_date"),
    counterpartCompanyId: text("counterpart_company_id").references(() => companies.id, { onDelete: "set null" }),
    bankTransactionId: text("bank_transaction_id"),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("expense_occurrence_unique").on(t.recurringId, t.occurrenceDate)],
);

/** Mouvements entre comptes : jamais comptés comme revenus/dépenses en vue consolidée. */
export const transfers = sqliteTable("transfers", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromAccountId: text("from_account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  toAccountId: text("to_account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  date: text("date").notNull(),
  amount: integer("amount").notNull(), // devise du compte source
  toAmount: integer("to_amount").notNull(), // devise du compte destination
  /** internal (même structure) | owner_draw (rémunération / prélèvement) | owner_contribution (apport) |
   *  intercompany (entre deux structures) */
  nature: text("nature").notNull().default("internal"),
  note: text("note"),
  createdAt: createdAt(),
});

/* ───────────────────────── Pilotage ───────────────────────── */

export const goals = sqliteTable("goals", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "cascade" }),
  /** monthly_revenue | expense_cap | min_cash | reserve | margin_rate | overdue_reduction */
  type: text("type").notNull(),
  label: text("label").notNull(),
  /** Montant en unités mineures de baseCurrency, ou pourcentage (margin_rate). */
  target: integer("target").notNull(),
  deadline: text("deadline"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

/** Photo du prévisionnel d'un mois, prise au début du mois, pour comparer prévu / réel. */
export const forecastSnapshots = sqliteTable(
  "forecast_snapshots",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // "all" | companyId
    month: text("month").notNull(), // YYYY-MM
    expectedIncome: integer("expected_income").notNull(),
    expectedExpense: integer("expected_expense").notNull(),
    currency: text("currency").notNull(),
    details: text("details").notNull().default("{}"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("snapshot_unique").on(t.userId, t.scope, t.month)],
);

export const alertDismissals = sqliteTable("alert_dismissals", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  alertKey: text("alert_key").notNull(),
  until: text("until").notNull(),
});

/* ───────────────────────── Documents ───────────────────────── */

export const documents = sqliteTable("documents", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  /** logo | presentation | brochure | proposal | contract | terms | admin | bank_details | template |
   *  invoice | receipt | quote | other */
  type: text("type").notNull().default("other"),
  /** reusable (bibliothèque) | client (transmis / reçu d'un client) | accounting (justificatif) */
  usage: text("usage").notNull().default("reusable"),
  description: text("description"),
  tags: text("tags"),
  currentVersion: integer("current_version").notNull().default(1),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: text("updated_at"),
});

export const documentVersions = sqliteTable(
  "document_versions",
  {
    id: id(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("doc_version_unique").on(t.documentId, t.version)],
);

/* ───────────────────────── Emails ───────────────────────── */

export const senderIdentities = sqliteTable("sender_identities", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  replyTo: text("reply_to"),
  /** L'adresse doit être explicitement autorisée par l'utilisateur pour envoyer. */
  authorized: integer("authorized", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const emailTemplates = sqliteTable("email_templates", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  /** proposal | contract | services | quote | invoice | proposal_follow_up | invoice_reminder | thanks |
   *  first_contact | meeting_follow_up | other */
  purpose: text("purpose").notNull().default("other"),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  /** JSON: ids de documents proposés par défaut */
  defaultDocumentIds: text("default_document_ids").notNull().default("[]"),
  createdAt: createdAt(),
});

export const emails = sqliteTable("emails", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  senderIdentityId: text("sender_identity_id").references(() => senderIdentities.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  templateId: text("template_id"),
  invoiceId: text("invoice_id"),
  fromName: text("from_name"),
  fromEmail: text("from_email"),
  to: text("to_addr").notNull(),
  cc: text("cc"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  /** draft | sending | sent | failed */
  status: text("status").notNull().default("draft"),
  error: text("error"),
  providerMessageId: text("provider_message_id"),
  sentAt: text("sent_at"),
  createdAt: createdAt(),
});

export const emailAttachments = sqliteTable("email_attachments", {
  id: id(),
  emailId: text("email_id").notNull().references(() => emails.id, { onDelete: "cascade" }),
  documentId: text("document_id"),
  /** Version exacte envoyée (immuable). */
  documentVersionId: text("document_version_id"),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
});

/* ───────────────────────── Banque (phase 4 — architecture prête) ───────────────────────── */

export const bankConnections = sqliteTable("bank_connections", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // ex. "csv", agrégateur agréé futur
  institution: text("institution"),
  status: text("status").notNull().default("disconnected"),
  lastSyncAt: text("last_sync_at"),
  createdAt: createdAt(),
});

export const bankTransactions = sqliteTable(
  "bank_transactions",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    date: text("date").notNull(),
    amount: integer("amount").notNull(), // signé : >0 entrée, <0 sortie
    label: text("label").notNull(),
    /** unmatched | matched | ignored */
    status: text("status").notNull().default("unmatched"),
    matchedType: text("matched_type"),
    matchedId: text("matched_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bank_tx_unique").on(t.accountId, t.externalId)],
);

/* ───────────────────────── Traçabilité ───────────────────────── */

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    userId: text("user_id").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(), // create | update | delete | send | login …
    before: text("before"),
    after: text("after"),
    at: text("at").notNull(),
  },
  (t) => [index("audit_entity").on(t.userId, t.entity, t.entityId)],
);
