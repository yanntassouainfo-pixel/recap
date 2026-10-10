import { describe, expect, it } from "vitest";
import {
  buildHref, buildLookup, expenseStatus, filterExpenses, groupByWeek, monthlyEquivalent, nextOccurrence, paginate, parseExpenseFilters,
  parseHorizon, referenceDate, summarizeExpenses, weekLabel,
} from "@/components/expenses/logic";
import {
  dayLabel, filterMovements, groupByDay, matchesType, movementCategory, movementNames, netChange, parseTxFilters, txParams,
} from "@/components/transactions/logic";
import { expensesCsv, transactionsCsv } from "@/app/api/export/_lib/rows";
import { BOM, csvAmount, csvCell, toCsv } from "@/app/api/export/_lib/csv";
import { cashMovements } from "@/lib/finance/engine";
import type { FinanceData } from "@/lib/finance/types";
import { emptyData, expense } from "./fixtures";

const TODAY = "2026-10-10"; // samedi

describe("dépenses — statuts et dates", () => {
  it("dérive « en retard » de l'échéance, jamais de la saisie", () => {
    expect(expenseStatus({ status: "planned", dueDate: "2026-10-09", date: "2026-10-01" }, TODAY)).toBe("overdue");
    expect(expenseStatus({ status: "planned", dueDate: "2026-10-10", date: "2026-10-01" }, TODAY)).toBe("planned");
    expect(expenseStatus({ status: "planned", dueDate: null, date: "2026-10-01" }, TODAY)).toBe("overdue");
    expect(expenseStatus({ status: "paid", dueDate: "2026-01-01", date: "2026-01-01" }, TODAY)).toBe("paid");
    expect(expenseStatus({ status: "cancelled", dueDate: "2026-01-01", date: "2026-01-01" }, TODAY)).toBe("cancelled");
  });
  it("situe une dépense par sa date de paiement, sinon son échéance", () => {
    expect(referenceDate({ status: "paid", paidDate: "2026-10-03", dueDate: "2026-09-30", date: "2026-09-25" })).toBe("2026-10-03");
    expect(referenceDate({ status: "planned", paidDate: null, dueDate: "2026-11-15", date: "2026-10-01" })).toBe("2026-11-15");
    expect(referenceDate({ status: "cancelled", paidDate: null, dueDate: "2026-11-15", date: "2026-10-01" })).toBe("2026-10-01");
  });
});

describe("dépenses — filtres d'URL", () => {
  it("compare le mois en cours au mois précédent « à date »", () => {
    const f = parseExpenseFilters({}, TODAY);
    expect([f.from, f.to, f.prevFrom, f.prevTo]).toEqual(["2026-10-01", "2026-10-31", "2026-09-01", "2026-09-10"]);
    expect(f.month).toBe("2026-10");
    expect(f.prevLabel).toBe("mois précédent à date");
  });
  it("compare un mois passé au mois entier précédent", () => {
    const f = parseExpenseFilters({ mois: "2026-03" }, TODAY);
    expect([f.from, f.to, f.prevFrom, f.prevTo]).toEqual(["2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28"]);
    expect(f.label).toBe("Mars 2026");
  });
  it("gère une période personnalisée (dates inversées remises dans l'ordre) et une période précédente de même durée", () => {
    const f = parseExpenseFilters({ mois: "personnalise", du: "2026-10-10", au: "2026-10-01" }, TODAY);
    expect(f.custom).toBe(true);
    expect([f.from, f.to]).toEqual(["2026-10-01", "2026-10-10"]);
    expect([f.prevFrom, f.prevTo]).toEqual(["2026-09-21", "2026-09-30"]);
  });
  it("ignore les valeurs invalides", () => {
    const f = parseExpenseFilters({ mois: "n'importe", statut: "bizarre", page: "-3", q: "x".repeat(300) }, TODAY);
    expect(f.month).toBe("2026-10");
    expect(f.status).toBe("all");
    expect(f.page).toBe(1);
    expect(f.q).toHaveLength(100);
    expect(parseExpenseFilters({ statut: "en-retard" }, TODAY).status).toBe("overdue");
  });
  it("construit des liens sans paramètres vides", () => {
    expect(buildHref("/depenses", { mois: "2026-10", q: "" }, { page: "2", statut: null })).toBe("/depenses?mois=2026-10&page=2");
    expect(buildHref("/depenses", {})).toBe("/depenses");
  });
});

describe("dépenses — filtrage et synthèse", () => {
  const data: FinanceData = emptyData({
    companies: [
      { id: "c1", name: "Studio", kind: "company", currency: "XOF", color: "#000", paymentTermsDays: 30, archived: false },
      { id: "c2", name: "Conseil", kind: "company", currency: "XOF", color: "#111", paymentTermsDays: 30, archived: false },
    ],
    scopeCompanyIds: new Set(["c1", "c2"]),
    activities: [{ id: "act", companyId: "c1", name: "Design", color: "#f00", category: null, monthlyRevenueTarget: null, archived: false }],
    categories: [{ id: "loyer", kind: "expense", name: "Loyer", nature: "fixed" }, { id: "mat", kind: "expense", name: "Matériel", nature: "variable" }],
    expenses: [
      expense({ id: "e1", amount: 100_000, categoryId: "loyer", activityId: "act", paidDate: "2026-10-02", date: "2026-10-02" }),
      expense({ id: "e2", amount: 50_000, categoryId: "mat", paidDate: "2026-10-05", supplier: "Électro Plus" }), // non affectée
      expense({ id: "e3", amount: 20_000, status: "planned", paidDate: null, date: "2026-08-20", dueDate: "2026-09-01" }), // en retard, reportée
      expense({ id: "e4", amount: 30_000, status: "planned", paidDate: null, date: "2026-10-01", dueDate: "2026-10-25" }),
      expense({ id: "e5", amount: 99_000, status: "cancelled", paidDate: null }),
      expense({ id: "e6", amount: 70_000, companyId: "c1", counterpartCompanyId: "c2", paidDate: "2026-10-06" }), // flux interne
      expense({ id: "e7", amount: 40_000, paidDate: "2026-09-05", date: "2026-09-05" }), // mois précédent
      expense({ id: "e8", amount: 1_000, companyId: "hors-portee", paidDate: "2026-10-03" }),
    ],
  });
  const lookup = buildLookup(data);

  it("garde les retards visibles sur la période en cours, exclut les annulées, les autres structures et les autres mois", () => {
    const f = parseExpenseFilters({}, TODAY);
    expect(filterExpenses(data.expenses, data, f, lookup).map((e) => e.id).sort()).toEqual(["e1", "e2", "e3", "e4", "e6"]);
  });
  it("ne reporte pas un retard sur un mois entièrement passé", () => {
    const f = parseExpenseFilters({ mois: "2026-09" }, TODAY);
    expect(filterExpenses(data.expenses, data, f, lookup).map((e) => e.id).sort()).toEqual(["e3", "e7"]);
  });
  it("filtre par statut, catégorie, affectation et recherche sans accents", () => {
    const p = (sp: Record<string, string>) => filterExpenses(data.expenses, data, parseExpenseFilters(sp, TODAY), lookup).map((e) => e.id).sort();
    expect(p({ statut: "annulee" })).toEqual(["e5"]);
    expect(p({ statut: "a-payer" })).toEqual(["e3", "e4"]);
    expect(p({ statut: "en-retard" })).toEqual(["e3"]);
    expect(p({ categorie: "loyer" })).toEqual(["e1"]);
    expect(p({ activite: "act" })).toEqual(["e1"]);
    expect(p({ q: "electro" })).toEqual(["e2"]);
    expect(p({ depense: "e7" })).toEqual(["e7"]); // lien direct : ignore la période
  });
  it("sépare payé et reste à payer, neutralise les flux internes et mesure la part des charges fixes", () => {
    const list = filterExpenses(data.expenses, data, parseExpenseFilters({}, TODAY), lookup);
    const s = summarizeExpenses(list, data, lookup);
    expect(s.paid).toBe(150_000);
    expect(s.paidCount).toBe(2);
    expect(s.committed).toBe(50_000);
    expect(s.overdueCount).toBe(1);
    expect(s.overdueAmount).toBe(20_000);
    expect(s.internalCount).toBe(1);
    expect(s.fixedShare).toBeCloseTo(100_000 / 150_000);
    expect(s.byCategory.map((c) => c.name)).toEqual(["Loyer", "Matériel"]);
    // Seule c1 a des activités : e2, e3, e4 sont « non affectées » (payées ou engagées).
    expect(s.unassignedCount).toBe(3);
    expect(s.unassignedAmount).toBe(100_000);
  });
  it("n'additionne pas une devise sans taux", () => {
    const d = { ...data, expenses: [expense({ amount: 10_000, currency: "USD", paidDate: "2026-10-02" })] };
    const s = summarizeExpenses(d.expenses, d, buildLookup(d));
    expect(s.paid).toBe(0);
    expect(s.missingRates).toBe(1);
  });
});

describe("dépenses — échéances et charges récurrentes", () => {
  it("regroupe par semaine du lundi au dimanche, dans l'ordre", () => {
    const items = [{ d: "2026-10-20", v: 5 }, { d: "2026-10-11", v: 1 }, { d: "2026-10-12", v: 2 }, { d: "2026-10-13", v: 3 }];
    const g = groupByWeek(items, (i) => i.d, (i) => i.v, TODAY);
    expect(g.map((x) => [x.weekStart, x.label, x.total])).toEqual([
      ["2026-10-05", "Cette semaine", 1],
      ["2026-10-12", "Semaine prochaine", 5],
      ["2026-10-19", "Semaine du 19 oct. au 25 oct.", 5],
    ]);
    expect(g[1].items.map((i) => i.d)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(weekLabel("2026-10-05", TODAY)).toBe("Cette semaine");
  });
  it("limite l'horizon aux valeurs proposées", () => {
    expect(parseHorizon("60")).toBe(60);
    expect(parseHorizon("45")).toBe(30);
    expect(parseHorizon(undefined)).toBe(30);
  });
  it("calcule l'équivalent mensuel", () => {
    expect(monthlyEquivalent(120_000, "yearly")).toBe(10_000);
    expect(monthlyEquivalent(30_000, "quarterly")).toBe(10_000);
    expect(monthlyEquivalent(10_000, "monthly")).toBe(10_000);
  });
  it("trouve la prochaine échéance, et aucune pour une charge arrêtée", () => {
    const r = { active: true, startDate: "2026-01-31", endDate: null, frequency: "monthly" };
    expect(nextOccurrence(r, TODAY)).toBe("2026-10-31");
    expect(nextOccurrence({ ...r, frequency: "quarterly" }, TODAY)).toBe("2026-10-31");
    expect(nextOccurrence({ ...r, active: false }, TODAY)).toBeNull();
    expect(nextOccurrence({ ...r, endDate: "2026-10-01" }, TODAY)).toBeNull();
  });
  it("pagine sans dépasser la dernière page", () => {
    const p = paginate(Array.from({ length: 120 }, (_, i) => i), 9, 50);
    expect([p.page, p.pageCount, p.items.length, p.items[0]]).toEqual([3, 3, 20, 100]);
  });
});

describe("transactions", () => {
  const data = emptyData({
    companies: [
      { id: "c1", name: "Studio", kind: "company", currency: "XOF", color: "#000", paymentTermsDays: 30, archived: false },
      { id: "p", name: "Perso", kind: "personal", currency: "XOF", color: "#111", paymentTermsDays: 0, archived: false },
    ],
    accounts: [
      { id: "a1", companyId: "c1", name: "Banque pro", type: "bank", currency: "XOF", openingBalance: 0, openingDate: "2026-01-01", archived: false },
      { id: "a2", companyId: "c1", name: "Caisse", type: "cash", currency: "XOF", openingBalance: 0, openingDate: "2026-01-01", archived: false },
      { id: "ap", companyId: "p", name: "Compte perso", type: "bank", currency: "XOF", openingBalance: 0, openingDate: "2026-01-01", archived: false },
    ],
    incomes: [{ id: "i1", companyId: "c1", activityId: null, contactId: null, categoryId: null, date: "2026-10-03", amount: 200_000, currency: "XOF", description: "Vente atelier", accountId: "a1", method: "cash" }],
    expenses: [expense({ id: "x1", amount: 50_000, paidDate: "2026-10-04", label: "Fournitures" })],
    transfers: [
      { id: "t1", fromAccountId: "a1", toAccountId: "a2", date: "2026-10-05", amount: 30_000, toAmount: 30_000, nature: "internal", note: null },
      { id: "t2", fromAccountId: "a1", toAccountId: "ap", date: "2026-10-06", amount: 80_000, toAmount: 80_000, nature: "owner_draw", note: null },
    ],
  });
  const names = movementNames(data);
  const movements = cashMovements(data);

  it("lit les filtres d'URL (période par défaut : début du mois → aujourd'hui)", () => {
    const f = parseTxFilters({ type: "nimporte" }, TODAY);
    expect([f.type, f.from, f.to]).toEqual(["all", "2026-10-01", TODAY]);
    expect(txParams(parseTxFilters({ type: "income", du: "2026-10-09", au: "2026-10-01", compte: "a1" }, TODAY)))
      .toEqual({ du: "2026-10-01", au: "2026-10-09", type: "income", compte: "a1" });
  });
  it("filtre par type et trie du plus récent au plus ancien", () => {
    const all = filterMovements(movements, parseTxFilters({}, TODAY), names);
    expect(all.map((m) => m.date)).toEqual([...all.map((m) => m.date)].sort().reverse());
    expect(filterMovements(movements, parseTxFilters({ type: "transfer" }, TODAY), names)).toHaveLength(3); // t1 aller/retour + t2 sortant
    expect(filterMovements(movements, parseTxFilters({ type: "income" }, TODAY), names).map((m) => m.sourceId)).toEqual(["i1"]);
    expect(matchesType({ kind: "transfer_in" }, "transfer")).toBe(true);
  });
  it("cherche dans le libellé, la catégorie et le compte", () => {
    expect(filterMovements(movements, parseTxFilters({ q: "caisse" }, TODAY), names).map((m) => m.id).sort()).toEqual(["trf-in:t1", "trf-out:t1"]);
    expect(filterMovements(movements, parseTxFilters({ q: "recette directe" }, TODAY), names).map((m) => m.sourceId)).toEqual(["i1"]);
  });
  it("calcule la variation nette : les virements internes sont neutres, la rémunération sort de la vue", () => {
    const all = filterMovements(movements, parseTxFilters({}, TODAY), names);
    expect(netChange(all)).toBe(200_000 - 50_000 - 80_000);
  });
  it("nomme les catégories des mouvements sans catégorie saisie", () => {
    const byId = new Map(movements.map((m) => [m.id, m]));
    expect(movementCategory(byId.get("inc:i1")!, names)).toBe("Recette directe");
    expect(movementCategory(byId.get("trf-out:t2")!, names)).toBe("Rémunération / prélèvement");
    expect(movementCategory(byId.get("exp:x1")!, names)).toBe("Sans catégorie");
  });
  it("regroupe par jour et libelle aujourd'hui", () => {
    const g = groupByDay([{ date: "2026-10-06" }, { date: "2026-10-06" }, { date: "2026-10-04" }]);
    expect(g.map((d) => [d.date, d.items.length])).toEqual([["2026-10-06", 2], ["2026-10-04", 1]]);
    expect(dayLabel(TODAY, TODAY)).toBe("Aujourd'hui · Samedi 10 octobre 2026");
  });
});

describe("export CSV", () => {
  it("formate les montants à la française selon les décimales de la devise", () => {
    expect(csvAmount(123_456, "EUR")).toBe("1234,56");
    expect(csvAmount(-5, "EUR")).toBe("-0,05");
    expect(csvAmount(150_000, "XOF")).toBe("150000");
  });
  it("protège contre l'injection de formules et échappe les séparateurs", () => {
    expect(csvCell("=SOMME(A1)")).toBe("'=SOMME(A1)");
    expect(csvCell("-1500,5")).toBe("-1500,5");
    expect(csvCell('Loyer; "bureau"')).toBe('"Loyer; ""bureau"""');
    expect(csvCell(true)).toBe("oui");
    expect(toCsv(["a", "b"], [[1, null]])).toBe(`${BOM}a;b\r\n1;\r\n`);
  });
  it("exporte les dépenses avec statut lisible et montant en devise de base", () => {
    const data = emptyData({ expenses: [expense({ id: "z", label: "Loyer", amount: 100_000, status: "planned", paidDate: null, dueDate: "2026-10-01" })] });
    const csv = expensesCsv(data.expenses.map((e) => ({ ...e, note: "=cmd", documentId: null })), data, buildLookup(data));
    const [header, row] = csv.slice(1).split("\r\n");
    expect(header).toContain("Montant en devise de base (XOF)");
    expect(row).toContain("En retard de paiement");
    expect(row).toContain("100000");
    expect(row.endsWith("'=cmd")).toBe(true);
  });
  it("exporte les transactions avec le sens du mouvement", () => {
    const data = emptyData({ expenses: [expense({ amount: 2_500, paidDate: "2026-10-02" })] });
    const csv = transactionsCsv(cashMovements(data), movementNames(data), "XOF");
    expect(csv.split("\r\n")[1]).toMatch(/^2026-10-02;Sortie;Dépense;Studio;;Sans catégorie;Banque;-2500;XOF;-2500;non$/);
  });
});
