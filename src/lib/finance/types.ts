/**
 * Types d'entrée du moteur financier. Le moteur est PUR : il ne lit pas la base, il reçoit un instantané
 * (FinanceData) et produit des résultats déterministes. L'IA n'intervient jamais dans ces calculs.
 */
import type { ISODate } from "../dates";

export interface CompanyRow { id: string; name: string; kind: string; currency: string; color: string; paymentTermsDays: number; archived: boolean }
export interface ActivityRow { id: string; companyId: string; name: string; color: string; category: string | null; monthlyRevenueTarget: number | null; archived: boolean }
export interface AccountRow { id: string; companyId: string; name: string; type: string; currency: string; openingBalance: number; openingDate: ISODate; archived: boolean }
export interface RateRow { date: ISODate; base: string; quote: string; rate: number; source: string }
export interface CategoryRow { id: string; kind: string; name: string; nature: string }
export interface ContactRow { id: string; name: string; type: string; organization: string | null }

export interface InvoiceRow {
  id: string; companyId: string; activityId: string | null; contactId: string | null; docType: string;
  number: string; title: string | null; issueDate: ISODate; dueDate: ISODate; currency: string; total: number;
  status: string; counterpartCompanyId: string | null; opportunityId: string | null;
}
export interface PaymentRow { id: string; invoiceId: string; date: ISODate; amount: number; fees: number; accountId: string | null; method: string; reference: string | null }
export interface IncomeRow { id: string; companyId: string; activityId: string | null; contactId: string | null; categoryId: string | null; date: ISODate; amount: number; currency: string; description: string; accountId: string | null; method: string }
export interface ExpenseRow {
  id: string; companyId: string; activityId: string | null; allocationRuleId: string | null; categoryId: string | null;
  label: string; supplier: string | null; amount: number; currency: string; date: ISODate; dueDate: ISODate | null;
  status: string; paidDate: ISODate | null; accountId: string | null; costType: string; recurringId: string | null;
  occurrenceDate: ISODate | null; counterpartCompanyId: string | null; method: string;
}
export interface RecurringRow {
  id: string; companyId: string; activityId: string | null; allocationRuleId: string | null; categoryId: string | null;
  label: string; supplier: string | null; amount: number; currency: string; frequency: string; startDate: ISODate;
  endDate: ISODate | null; accountId: string | null; remindDaysBefore: number; active: boolean;
}
export interface TransferRow { id: string; fromAccountId: string; toAccountId: string; date: ISODate; amount: number; toAmount: number; nature: string; note: string | null }
export interface OpportunityRow { id: string; contactId: string; companyId: string | null; activityId: string | null; title: string; amount: number; currency: string; probability: number; stage: string; expectedCloseDate: ISODate | null }
export interface AllocationRuleRow { id: string; companyId: string; name: string; method: string; shares: { activityId: string; percent: number }[] }
export interface GoalRow { id: string; companyId: string | null; activityId: string | null; type: string; label: string; target: number; deadline: ISODate | null; active: boolean }

export interface ScenarioSettings { prudentOverdueRate: number; centralOverdueRate: number; optimistOverdueRate: number }

export interface FinanceData {
  today: ISODate;
  baseCurrency: string;
  /** Ensemble des structures visibles dans la portée courante. */
  scopeCompanyIds: Set<string>;
  scopeLabel: string;
  cashSafetyThreshold: number;
  scenarios: ScenarioSettings;
  companies: CompanyRow[]; // TOUTES les structures de l'utilisateur (pour reconnaître les flux internes)
  activities: ActivityRow[];
  accounts: AccountRow[];
  rates: RateRow[];
  categories: CategoryRow[];
  contacts: ContactRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  incomes: IncomeRow[];
  expenses: ExpenseRow[];
  recurring: RecurringRow[];
  transfers: TransferRow[];
  opportunities: OpportunityRow[];
  allocationRules: AllocationRuleRow[];
  goals: GoalRow[];
}

/** Statut affiché d'une facture — dérivé, jamais saisi (sauf brouillon / envoyée / annulée). */
export type InvoiceDisplayStatus = "draft" | "sent" | "pending" | "partial" | "paid" | "overdue" | "cancelled";

export interface InvoiceState {
  invoice: InvoiceRow;
  paid: number;
  fees: number;
  remaining: number;
  status: InvoiceDisplayStatus;
  daysOverdue: number;
  lastPaymentDate: ISODate | null;
}

export type MovementKind = "income" | "expense" | "transfer_in" | "transfer_out";

/** Mouvement d'argent réel (encaissé ou décaissé), déjà converti dans la devise de base. */
export interface CashMovement {
  id: string;
  date: ISODate;
  kind: MovementKind;
  /** Signé dans la devise de base (+ entrée, − sortie). null si aucun taux disponible. */
  amountBase: number | null;
  amount: number; // signé, devise d'origine
  currency: string;
  label: string;
  companyId: string;
  accountId: string | null;
  activityId: string | null;
  categoryId: string | null;
  contactId: string | null;
  source: "payment" | "income" | "expense" | "transfer" | "fee";
  sourceId: string;
  /** Flux entre deux structures de la portée : exclu des revenus/dépenses consolidés. */
  internal: boolean;
  transferNature?: string;
}
