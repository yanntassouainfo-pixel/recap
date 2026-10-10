import type { FinanceData } from "@/lib/finance/types";

export function emptyData(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    today: "2026-10-10",
    baseCurrency: "XOF",
    scopeCompanyIds: new Set(["c1"]),
    scopeLabel: "Test",
    cashSafetyThreshold: 0,
    scenarios: { prudentOverdueRate: 0, centralOverdueRate: 50, optimistOverdueRate: 100 },
    companies: [{ id: "c1", name: "Studio", kind: "company", currency: "XOF", color: "#000", paymentTermsDays: 30, archived: false }],
    activities: [],
    accounts: [{ id: "a1", companyId: "c1", name: "Banque", type: "bank", currency: "XOF", openingBalance: 100_000, openingDate: "2026-01-01", archived: false }],
    rates: [],
    categories: [],
    contacts: [],
    invoices: [],
    payments: [],
    incomes: [],
    expenses: [],
    recurring: [],
    transfers: [],
    opportunities: [],
    allocationRules: [],
    goals: [],
    ...overrides,
  };
}

let n = 0;
export function invoice(p: Partial<FinanceData["invoices"][number]> = {}): FinanceData["invoices"][number] {
  n++;
  return {
    id: `inv${n}`, companyId: "c1", activityId: null, contactId: null, docType: "invoice", number: `FAC-${n}`, title: null,
    issueDate: "2026-09-01", dueDate: "2026-10-01", currency: "XOF", total: 100_000, status: "sent",
    counterpartCompanyId: null, opportunityId: null, ...p,
  };
}

export function expense(p: Partial<FinanceData["expenses"][number]> = {}): FinanceData["expenses"][number] {
  n++;
  return {
    id: `exp${n}`, companyId: "c1", activityId: null, allocationRuleId: null, categoryId: null, label: "Dépense", supplier: null,
    amount: 10_000, currency: "XOF", date: "2026-10-05", dueDate: null, status: "paid", paidDate: "2026-10-05", accountId: "a1",
    costType: "overhead", recurringId: null, occurrenceDate: null, counterpartCompanyId: null, method: "bank_transfer", ...p,
  };
}
