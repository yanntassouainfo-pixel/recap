import { eq } from "drizzle-orm";
import type { DB } from "../db";
import * as schema from "../db/schema";
import type { FinanceData } from "./types";

/** Charge toutes les données financières d'un utilisateur (sans dépendance à la requête HTTP). */
export function loadFinanceDataFrom(db: DB, userId: string, scope: { companyIds: Set<string>; label: string }, today: string): FinanceData {
  const u = userId;
  const settings = db.select().from(schema.settings).where(eq(schema.settings.userId, u)).get();
  const parseShares = (s: string) => {
    try { return JSON.parse(s) as { activityId: string; percent: number }[]; } catch { return []; }
  };
  return {
    today,
    baseCurrency: settings?.baseCurrency ?? "XOF",
    scopeCompanyIds: scope.companyIds,
    scopeLabel: scope.label,
    cashSafetyThreshold: settings?.cashSafetyThreshold ?? 0,
    scenarios: {
      prudentOverdueRate: settings?.scenarioPrudentOverdueRate ?? 0,
      centralOverdueRate: settings?.scenarioCentralOverdueRate ?? 50,
      optimistOverdueRate: settings?.scenarioOptimistOverdueRate ?? 100,
    },
    companies: db.select().from(schema.companies).where(eq(schema.companies.userId, u)).all(),
    activities: db.select().from(schema.activities).where(eq(schema.activities.userId, u)).all(),
    accounts: db.select().from(schema.accounts).where(eq(schema.accounts.userId, u)).all(),
    rates: db.select().from(schema.exchangeRates).where(eq(schema.exchangeRates.userId, u)).all(),
    categories: db.select().from(schema.categories).where(eq(schema.categories.userId, u)).all(),
    contacts: db.select().from(schema.contacts).where(eq(schema.contacts.userId, u)).all(),
    invoices: db.select().from(schema.invoices).where(eq(schema.invoices.userId, u)).all(),
    payments: db.select().from(schema.payments).where(eq(schema.payments.userId, u)).all(),
    incomes: db.select().from(schema.incomes).where(eq(schema.incomes.userId, u)).all(),
    expenses: db.select().from(schema.expenses).where(eq(schema.expenses.userId, u)).all(),
    recurring: db.select().from(schema.recurringExpenses).where(eq(schema.recurringExpenses.userId, u)).all(),
    transfers: db.select().from(schema.transfers).where(eq(schema.transfers.userId, u)).all(),
    opportunities: db.select().from(schema.opportunities).where(eq(schema.opportunities.userId, u)).all(),
    allocationRules: db.select().from(schema.allocationRules).where(eq(schema.allocationRules.userId, u)).all().map((r) => ({ ...r, shares: parseShares(r.shares) })),
    goals: db.select().from(schema.goals).where(eq(schema.goals.userId, u)).all(),
  };
}
