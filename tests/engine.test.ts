import { describe, expect, it } from "vitest";
import {
  accountBalances, allocate, availableCash, cashMovements, forecast, invoiceState, invoiceStates, periodFlows,
  profitability, receivables, recurringOccurrences, upcomingOutflows,
} from "@/lib/finance/engine";
import { convert } from "@/lib/finance/fx";
import { parseAmount, formatMoney } from "@/lib/money";
import { emptyData, expense, invoice } from "./fixtures";

describe("montants et devises", () => {
  it("lit les saisies françaises", () => {
    expect(parseAmount("1 250,50", "EUR")).toBe(125050);
    expect(parseAmount("300 000", "XOF")).toBe(300000);
    expect(parseAmount("300.000", "XOF")).toBe(300000);
    expect(parseAmount("1,5", "EUR")).toBe(150);
    expect(parseAmount("1.234,56", "EUR")).toBe(123456);
    expect(parseAmount("abc", "EUR")).toBeNull();
  });
  it("formate sans mélanger les devises", () => {
    expect(formatMoney(125050, "EUR")).toContain("€");
    expect(formatMoney(300000, "XOF")).toContain("F CFA");
  });
  it("convertit EUR → XOF à la parité fixe et USD via un taux daté", () => {
    expect(convert(100, "EUR", "XOF", "2026-10-10", []).value).toBe(656); // 1,00 € = 655,957 F
    const rates = [{ date: "2026-09-01", base: "USD", quote: "XOF", rate: 600, source: "manuel" }];
    expect(convert(1000, "USD", "XOF", "2026-10-10", rates).value).toBe(6000);
    // triangulation USD → EUR via XOF
    expect(convert(1000, "USD", "EUR", "2026-10-10", rates).value).toBe(915);
    // pas de taux : on le signale au lieu d'inventer
    expect(convert(1000, "GBP", "XOF", "2026-10-10", []).value).toBeNull();
  });
});

describe("factures et paiements partiels", () => {
  it("recalcule le restant dû et le statut", () => {
    const inv = invoice({ total: 800_000, dueDate: "2026-10-20" });
    const s1 = invoiceState(inv, [{ invoiceId: inv.id, amount: 300_000, fees: 0, date: "2026-10-02" }], "2026-10-10");
    expect(s1.remaining).toBe(500_000);
    expect(s1.status).toBe("partial");
    const s2 = invoiceState(inv, [{ invoiceId: inv.id, amount: 300_000, fees: 0, date: "2026-10-02" }, { invoiceId: inv.id, amount: 500_000, fees: 0, date: "2026-10-09" }], "2026-10-10");
    expect(s2.status).toBe("paid");
    expect(s2.remaining).toBe(0);
  });
  it("marque en retard une facture échue non soldée, même partiellement payée", () => {
    const inv = invoice({ total: 100, dueDate: "2026-10-01" });
    const s = invoiceState(inv, [{ invoiceId: inv.id, amount: 40, fees: 0, date: "2026-09-20" }], "2026-10-10");
    expect(s.status).toBe("overdue");
    expect(s.daysOverdue).toBe(9);
  });
  it("une facture importée en brouillon n'est jamais considérée payée", () => {
    expect(invoiceState(invoice({ status: "draft" }), [], "2026-10-10").status).toBe("draft");
  });
});

describe("trésorerie", () => {
  it("argent disponible = ouverture + encaissements − dépenses payées (pas les dépenses prévues)", () => {
    const inv = invoice({ total: 50_000 });
    const data = emptyData({
      invoices: [inv],
      payments: [{ id: "p1", invoiceId: inv.id, date: "2026-10-03", amount: 50_000, fees: 1_000, accountId: "a1", method: "bank_transfer", reference: null }],
      expenses: [expense({ amount: 20_000 }), expense({ amount: 999_999, status: "planned", paidDate: null, dueDate: "2026-10-30" })],
    });
    const mv = cashMovements(data);
    expect(availableCash(data, mv).total).toBe(100_000 + 50_000 - 1_000 - 20_000);
    const flows = periodFlows(mv, "2026-10-01", "2026-10-10");
    expect(flows.income).toBe(50_000);
    expect(flows.expense).toBe(21_000);
    expect(flows.net).toBe(29_000);
  });

  it("neutralise les transferts internes en vue consolidée mais pas en vue d'une seule structure", () => {
    const base = {
      companies: [
        { id: "c1", name: "Studio", kind: "company", currency: "XOF", color: "#000", paymentTermsDays: 30, archived: false },
        { id: "p", name: "Perso", kind: "personal", currency: "XOF", color: "#000", paymentTermsDays: 30, archived: false },
      ],
      accounts: [
        { id: "a1", companyId: "c1", name: "Banque pro", type: "bank", currency: "XOF", openingBalance: 100_000, openingDate: "2026-01-01", archived: false },
        { id: "a2", companyId: "p", name: "Compte perso", type: "bank", currency: "XOF", openingBalance: 10_000, openingDate: "2026-01-01", archived: false },
      ],
      transfers: [{ id: "t1", fromAccountId: "a1", toAccountId: "a2", date: "2026-10-05", amount: 40_000, toAmount: 40_000, nature: "owner_draw", note: null }],
    };
    const all = emptyData({ ...base, scopeCompanyIds: new Set(["c1", "p"]) });
    const mvAll = cashMovements(all);
    const cash = availableCash(all, mvAll);
    expect(cash.total).toBe(110_000);
    expect(cash.pro).toBe(60_000);
    expect(cash.personal).toBe(50_000);
    const fAll = periodFlows(mvAll, "2026-10-01", "2026-10-10");
    expect(fAll.income).toBe(0);
    expect(fAll.expense).toBe(0);
    expect(fAll.transfersOut).toBe(0);

    const pro = emptyData({ ...base, scopeCompanyIds: new Set(["c1"]) });
    const fPro = periodFlows(cashMovements(pro), "2026-10-01", "2026-10-10");
    expect(fPro.expense).toBe(0); // un prélèvement n'est pas une dépense d'exploitation
    expect(fPro.transfersOut).toBe(40_000);
  });

  it("évite le double comptage d'une facture entre deux structures en consolidé", () => {
    const companies = [
      { id: "c1", name: "A", kind: "company", currency: "XOF", color: "#000", paymentTermsDays: 30, archived: false },
      { id: "c2", name: "B", kind: "company", currency: "XOF", color: "#000", paymentTermsDays: 30, archived: false },
    ];
    const inv = invoice({ companyId: "c1", counterpartCompanyId: "c2", total: 30_000 });
    const data = emptyData({
      companies, scopeCompanyIds: new Set(["c1", "c2"]), invoices: [inv],
      accounts: [
        { id: "a1", companyId: "c1", name: "A", type: "bank", currency: "XOF", openingBalance: 0, openingDate: "2026-01-01", archived: false },
        { id: "a2", companyId: "c2", name: "B", type: "bank", currency: "XOF", openingBalance: 50_000, openingDate: "2026-01-01", archived: false },
      ],
      payments: [{ id: "p", invoiceId: inv.id, date: "2026-10-02", amount: 30_000, fees: 0, accountId: "a1", method: "bank_transfer", reference: null }],
      expenses: [expense({ companyId: "c2", accountId: "a2", amount: 30_000, counterpartCompanyId: "c1", date: "2026-10-02", paidDate: "2026-10-02" })],
    });
    const mv = cashMovements(data);
    const f = periodFlows(mv, "2026-10-01", "2026-10-10");
    expect(f.income).toBe(0);
    expect(f.expense).toBe(0);
    expect(availableCash(data, mv).total).toBe(50_000);
    // vue de la seule structure A : le revenu existe
    const onlyA = emptyData({ ...data, scopeCompanyIds: new Set(["c1"]) });
    expect(periodFlows(cashMovements(onlyA), "2026-10-01", "2026-10-10").income).toBe(30_000);
  });

  it("gère un compte en devise étrangère", () => {
    const data = emptyData({
      accounts: [{ id: "eur", companyId: "c1", name: "Compte EUR", type: "bank", currency: "EUR", openingBalance: 100_00, openingDate: "2026-01-01", archived: false }],
    });
    const b = accountBalances(data, cashMovements(data));
    expect(b[0].balance).toBe(10000);
    expect(b[0].balanceBase).toBe(65596);
  });
});

describe("charges récurrentes et prévisionnel", () => {
  it("génère les échéances mensuelles en respectant les fins de mois", () => {
    expect(recurringOccurrences({ startDate: "2026-01-31", endDate: null, frequency: "monthly" }, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(recurringOccurrences({ startDate: "2025-03-15", endDate: null, frequency: "quarterly" }, "2026-01-01", "2026-12-31")).toEqual(["2026-03-15", "2026-06-15", "2026-09-15", "2026-12-15"]);
  });

  it("un loyer récurrent apparaît dans les mois suivants, sauf l'échéance déjà confirmée", () => {
    const rec = { id: "r1", companyId: "c1", activityId: null, allocationRuleId: null, categoryId: null, label: "Loyer", supplier: null, amount: 300, currency: "XOF", frequency: "monthly", startDate: "2026-09-05", endDate: null, accountId: "a1", remindDaysBefore: 3, active: true };
    const data = emptyData({ recurring: [rec], expenses: [expense({ recurringId: "r1", occurrenceDate: "2026-10-05", amount: 300 })] });
    const up = upcomingOutflows(data, "2026-12-31");
    // septembre n'a pas été confirmé : il reste « à confirmer » (jamais compté comme payé), octobre est confirmé
    expect(up.map((u) => u.originalDate)).toEqual(["2026-09-05", "2026-11-05", "2026-12-05"]);
    expect(up[0].late).toBe(true);
    expect(up[0].date).toBe("2026-10-10");
  });

  it("projette la trésorerie et détecte la date de passage en négatif", () => {
    const rec = { id: "r1", companyId: "c1", activityId: null, allocationRuleId: null, categoryId: null, label: "Loyer", supplier: null, amount: 60_000, currency: "XOF", frequency: "monthly", startDate: "2026-10-15", endDate: null, accountId: "a1", remindDaysBefore: 3, active: true };
    const late = invoice({ total: 40_000, dueDate: "2026-09-01" });
    const data = emptyData({ recurring: [rec], invoices: [late] });
    const prudent = forecast(data, 60, "prudent");
    expect(prudent.start).toBe(100_000);
    expect(prudent.firstNegative).toBe("2026-11-15");
    const optimist = forecast(data, 60, "optimist");
    expect(optimist.firstNegative).toBeNull();
    expect(prudent.hypotheses.length).toBeGreaterThan(3);
  });

  it("une recette datée dans le futur est prévue (prévisionnel), pas encore dans le solde", () => {
    const inc = { id: "i1", companyId: "c1", accountId: "a1", activityId: null, contactId: null, categoryId: null, currency: "XOF", amount: 327_979, date: "2026-11-05", description: "Prestation ACCESS Menu", method: "cash" };
    const data = emptyData({ incomes: [inc] });
    const f = forecast(data, 60, "prudent");
    expect(f.start).toBe(100_000);
    expect(f.events).toContainEqual(expect.objectContaining({ date: "2026-11-05", amount: 327_979, kind: "income", certainty: "estimated" }));
    expect(f.end).toBe(427_979);
    expect(forecast(data, 20, "central").totalIn).toBe(0); // hors horizon
    expect(forecast(emptyData({ incomes: [{ ...inc, date: "2026-10-01" }] }), 60, "central").start).toBe(427_979); // déjà reçue
  });

  it("une opportunité n'est jamais comptée comme revenu certain", () => {
    const data = emptyData({ opportunities: [{ id: "o", contactId: "x", companyId: "c1", activityId: null, title: "Coaching", amount: 500_000, currency: "XOF", probability: 40, stage: "proposal_sent", expectedCloseDate: "2026-10-20" }] });
    expect(forecast(data, 90, "central").totalIn).toBe(0);
    expect(forecast(data, 90, "optimist").totalIn).toBe(200_000);
  });
});

describe("rentabilité — exemple du cahier des charges", () => {
  const activities = [
    { id: "A", companyId: "c1", name: "Formation prise de parole", color: "#1", category: null, monthlyRevenueTarget: null, archived: false },
    { id: "B", companyId: "c1", name: "Direction de création", color: "#2", category: null, monthlyRevenueTarget: null, archived: false },
    { id: "C", companyId: "c1", name: "Coaching individuel", color: "#3", category: null, monthlyRevenueTarget: null, archived: false },
  ];
  const data = emptyData({
    baseCurrency: "EUR",
    accounts: [],
    activities,
    invoices: [
      invoice({ activityId: "A", total: 2000_00, currency: "EUR", issueDate: "2026-09-10" }),
      invoice({ activityId: "B", total: 3500_00, currency: "EUR", issueDate: "2026-09-10" }),
      invoice({ activityId: "C", total: 1500_00, currency: "EUR", issueDate: "2026-09-10" }),
    ],
    expenses: [
      expense({ activityId: "A", costType: "direct", amount: 300_00, currency: "EUR", date: "2026-09-12" }),
      expense({ activityId: "A", costType: "overhead", amount: 200_00, currency: "EUR", date: "2026-09-12" }),
      expense({ activityId: "B", costType: "direct", amount: 1500_00, currency: "EUR", date: "2026-09-12" }),
      expense({ activityId: "B", costType: "overhead", amount: 400_00, currency: "EUR", date: "2026-09-12" }),
      expense({ activityId: "C", costType: "direct", amount: 100_00, currency: "EUR", date: "2026-09-12" }),
      expense({ activityId: "C", costType: "overhead", amount: 100_00, currency: "EUR", date: "2026-09-12" }),
      expense({ label: "Loyer", amount: 50_00, currency: "EUR", date: "2026-09-12" }),
    ],
  });
  const r = profitability(data, "2026-09-01", "2026-09-30");
  const by = Object.fromEntries(r.activities.map((a) => [a.activityId, a]));

  it("calcule marge et taux de marge par activité", () => {
    expect(by.A.margin).toBe(1500_00);
    expect(by.A.marginRate).toBe(75);
    expect(by.B.margin).toBe(1600_00);
    expect(Math.round(by.B.marginRate!)).toBe(46);
    expect(Math.round(by.C.marginRate!)).toBe(87);
  });
  it("distingue l'activité qui rapporte le plus de celle qui marge le mieux", () => {
    const h = Object.fromEntries(r.highlights.map((x) => [x.key, x.activityId]));
    expect(h.revenue).toBe("B");
    expect(h.margin).toBe("C");
  });
  it("laisse non affectée une dépense sans activité ni règle", () => {
    expect(r.unassignedCosts).toBe(50_00);
  });
  it("répartit les frais communs selon la règle, sans répartition arbitraire", () => {
    expect(allocate({ method: "manual", shares: [{ activityId: "A", percent: 60 }, { activityId: "B", percent: 40 }] }, 1000, [{ activityId: "A", invoiced: 0 }, { activityId: "B", invoiced: 0 }])).toEqual([{ activityId: "A", amount: 600 }, { activityId: "B", amount: 400 }]);
    expect(allocate({ method: "revenue", shares: [] }, 1000, [{ activityId: "A", invoiced: 300 }, { activityId: "B", invoiced: 100 }])).toEqual([{ activityId: "A", amount: 750 }, { activityId: "B", amount: 250 }]);
    expect(allocate({ method: "revenue", shares: [] }, 1000, [{ activityId: "A", invoiced: 0 }])).toEqual([]);
  });
});

describe("créances", () => {
  it("sépare non échu et en retard, groupe par client", () => {
    const data = emptyData({
      contacts: [{ id: "k", name: "Client K", type: "client", organization: null }],
      invoices: [invoice({ contactId: "k", dueDate: "2026-09-01" }), invoice({ contactId: "k", dueDate: "2026-09-15" }), invoice({ dueDate: "2026-11-01" })],
    });
    const r = receivables(data, invoiceStates(data));
    expect(r.overdue).toBe(200_000);
    expect(r.notDue).toBe(100_000);
    expect(r.byContact[0].overdueCount).toBe(2);
  });
});
