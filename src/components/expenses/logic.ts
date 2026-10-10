/**
 * Logique pure du module « Dépenses & charges » (aucun accès à la base) : filtres d'URL, statuts affichés,
 * agrégats de période, regroupement des échéances par semaine, équivalents mensuels des charges récurrentes.
 * Les montants consolidés passent toujours par `toBase` (moteur) : jamais d'addition de devises différentes.
 */
import {
  addDays, addMonths, daysBetween, endOfMonth, formatDate, formatMonth, minDate, startOfMonth, startOfWeek, type ISODate,
} from "@/lib/dates";
import { inScope, recurringOccurrences, toBase } from "@/lib/finance/engine";
import type { ExpenseRow, FinanceData, RecurringRow } from "@/lib/finance/types";

/* ───────────────────────── Statuts ───────────────────────── */

export type ExpenseStatusKey = "paid" | "planned" | "overdue" | "cancelled";

export const EXPENSE_STATUS: Record<ExpenseStatusKey, { label: string; tone: "good" | "info" | "bad" | "neutral" }> = {
  paid: { label: "Payée", tone: "good" },
  planned: { label: "À payer", tone: "info" },
  overdue: { label: "En retard de paiement", tone: "bad" },
  cancelled: { label: "Annulée", tone: "neutral" },
};

/** Statut affiché : « en retard » est dérivé de l'échéance, jamais saisi. */
export function expenseStatus(e: Pick<ExpenseRow, "status" | "dueDate" | "date">, today: ISODate): ExpenseStatusKey {
  if (e.status === "cancelled") return "cancelled";
  if (e.status === "paid") return "paid";
  return (e.dueDate ?? e.date) < today ? "overdue" : "planned";
}

/** Date qui situe la dépense dans une période : paiement réel, sinon échéance, sinon date de la dépense. */
export function referenceDate(e: Pick<ExpenseRow, "status" | "dueDate" | "date" | "paidDate">): ISODate {
  if (e.status === "paid") return e.paidDate ?? e.date;
  if (e.status === "planned") return e.dueDate ?? e.date;
  return e.date;
}

/** Dépense versée à une autre structure de la portée : flux interne, neutralisé dans les totaux. */
export function isInternalExpense(data: Pick<FinanceData, "scopeCompanyIds">, e: Pick<ExpenseRow, "counterpartCompanyId">): boolean {
  return !!e.counterpartCompanyId && data.scopeCompanyIds.has(e.counterpartCompanyId);
}

/* ───────────────────────── Texte & URL ───────────────────────── */

export function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

export function matchesQuery(q: string, fields: (string | null | undefined)[]): boolean {
  const n = normalize(q);
  if (!n) return true;
  return fields.some((f) => normalize(f).includes(n));
}

/** Construit une URL en conservant les paramètres utiles ; les valeurs vides sont retirées. */
export function buildHref(path: string, params: Record<string, string | undefined | null>, patch: Record<string, string | undefined | null> = {}): string {
  const merged = { ...params, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v != null && v !== "") qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/* ───────────────────────── Filtres de la vue « toutes » ───────────────────────── */

export type ExpenseStatusFilter = "all" | "paid" | "planned" | "overdue" | "cancelled";

/** Valeurs d'URL (françaises) ↔ filtre interne. */
export const STATUS_PARAM: Record<string, ExpenseStatusFilter> = {
  payee: "paid", "a-payer": "planned", "en-retard": "overdue", annulee: "cancelled",
};
export const STATUS_FILTER_LABELS: [string, string][] = [
  ["", "Toutes (hors annulées)"], ["payee", "Payées"], ["a-payer", "À payer"], ["en-retard", "En retard de paiement"], ["annulee", "Annulées"],
];

export interface ExpenseFilters {
  from: ISODate;
  to: ISODate;
  prevFrom: ISODate;
  prevTo: ISODate;
  /** Mois sélectionné (YYYY-MM) ou null si période personnalisée. */
  month: string | null;
  custom: boolean;
  label: string;
  prevLabel: string;
  companyId: string;
  /** "" = toutes | "commun" = frais commun réparti | "aucune" = non affectée | id d'activité */
  activity: string;
  /** "" = toutes | "aucune" = sans catégorie | id */
  categoryId: string;
  status: ExpenseStatusFilter;
  q: string;
  /** Identifiant d'une dépense précise (lien depuis les transactions) : ignore les autres filtres. */
  expenseId: string;
  page: number;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseExpenseFilters(sp: Record<string, string | undefined>, today: ISODate): ExpenseFilters {
  const base = {
    companyId: sp.structure ?? "",
    activity: sp.activite ?? "",
    categoryId: sp.categorie ?? "",
    status: STATUS_PARAM[sp.statut ?? ""] ?? "all",
    q: (sp.q ?? "").trim().slice(0, 100),
    expenseId: sp.depense ?? "",
    page: Math.max(1, Math.floor(Number(sp.page) || 1)),
  } satisfies Partial<ExpenseFilters>;

  const wantsCustom = sp.mois === "personnalise" || (!sp.mois && (!!sp.du || !!sp.au));
  if (wantsCustom) {
    let from = sp.du && ISO.test(sp.du) ? sp.du : startOfMonth(today);
    let to = sp.au && ISO.test(sp.au) ? sp.au : today;
    if (to < from) [from, to] = [to, from];
    const len = daysBetween(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -len);
    return { ...base, from, to, prevFrom, prevTo, month: null, custom: true, label: `Du ${formatDate(from)} au ${formatDate(to)}`, prevLabel: "période précédente" };
  }

  const month = sp.mois && MONTH.test(sp.mois) ? sp.mois : today.slice(0, 7);
  const from = `${month}-01`;
  const to = endOfMonth(from);
  const prevFrom = addMonths(from, -1);
  const isCurrent = month === today.slice(0, 7);
  // Mois en cours : on compare « à date » (même nombre de jours écoulés) pour rester équitable.
  const prevTo = isCurrent ? minDate(addDays(prevFrom, daysBetween(from, today)), addDays(from, -1)) : endOfMonth(prevFrom);
  return {
    ...base, from, to, prevFrom, prevTo, month, custom: false,
    label: capitalize(formatMonth(month, true)),
    prevLabel: isCurrent ? "mois précédent à date" : formatMonth(prevFrom.slice(0, 7), true),
  };
}

/** Les 12 derniers mois (le plus récent d'abord) pour le sélecteur. */
export function recentMonths(today: ISODate, count = 12): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const key = addMonths(startOfMonth(today), -i, 1).slice(0, 7);
    out.push({ key, label: capitalize(formatMonth(key, true)) });
  }
  return out;
}

export interface Lookup {
  category: (id: string | null) => { name: string; nature: string } | null;
  activity: (id: string | null) => { name: string; color: string } | null;
  rule: (id: string | null) => string | null;
  account: (id: string | null) => { name: string; currency: string } | null;
  company: (id: string | null) => { name: string; kind: string } | null;
}

export function buildLookup(data: FinanceData): Lookup {
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const acts = new Map(data.activities.map((a) => [a.id, a]));
  const rules = new Map(data.allocationRules.map((r) => [r.id, r.name]));
  const accs = new Map(data.accounts.map((a) => [a.id, a]));
  const cos = new Map(data.companies.map((c) => [c.id, c]));
  return {
    category: (id) => (id ? cats.get(id) ?? null : null),
    activity: (id) => (id ? acts.get(id) ?? null : null),
    rule: (id) => (id ? rules.get(id) ?? null : null),
    account: (id) => (id ? accs.get(id) ?? null : null),
    company: (id) => (id ? cos.get(id) ?? null : null),
  };
}

/** Affectation lisible : activité, frais commun réparti, ou non affectée. */
export function assignmentOf(e: Pick<ExpenseRow, "activityId" | "allocationRuleId" | "companyId">, lookup: Lookup): { kind: "activity" | "common" | "none" | "personal"; label: string; color?: string; detail?: string } {
  if (lookup.company(e.companyId)?.kind === "personal") return { kind: "personal", label: "Espace personnel" };
  const act = lookup.activity(e.activityId);
  if (act) return { kind: "activity", label: act.name, color: act.color };
  if (e.allocationRuleId) return { kind: "common", label: "Frais commun", detail: lookup.rule(e.allocationRuleId) ?? undefined };
  return { kind: "none", label: "Non affectée" };
}

/**
 * Filtre les dépenses de la portée. Une dépense à payer dont l'échéance est dépassée reste visible sur toute
 * période qui inclut aujourd'hui : elle est toujours due.
 */
export function filterExpenses<T extends ExpenseRow>(rows: T[], data: FinanceData, f: ExpenseFilters, lookup: Lookup, range: { from: ISODate; to: ISODate } = f): T[] {
  const today = data.today;
  const out = rows.filter((e) => {
    if (!inScope(data, e.companyId)) return false;
    if (f.expenseId) return e.id === f.expenseId;
    if (f.companyId && e.companyId !== f.companyId) return false;
    if (f.activity === "commun" ? !(!e.activityId && e.allocationRuleId) : f.activity === "aucune" ? !!(e.activityId || e.allocationRuleId) : f.activity && e.activityId !== f.activity) return false;
    if (f.categoryId === "aucune" ? !!e.categoryId : f.categoryId && e.categoryId !== f.categoryId) return false;
    const st = expenseStatus(e, today);
    if (f.status === "all" && st === "cancelled") return false;
    if (f.status === "paid" && st !== "paid") return false;
    if (f.status === "planned" && st !== "planned" && st !== "overdue") return false;
    if (f.status === "overdue" && st !== "overdue") return false;
    if (f.status === "cancelled" && st !== "cancelled") return false;
    const ref = referenceDate(e);
    const inPeriod = ref >= range.from && ref <= range.to;
    const carried = st === "overdue" && ref < range.from && range.to >= today;
    if (!inPeriod && !carried) return false;
    if (f.q && !matchesQuery(f.q, [e.label, e.supplier, lookup.category(e.categoryId)?.name])) return false;
    return true;
  });
  return out.sort((a, b) => {
    const ra = referenceDate(a), rb = referenceDate(b);
    return ra === rb ? b.amount - a.amount : ra < rb ? 1 : -1;
  });
}

export interface ExpenseSummary {
  /** Payé sur la période (devise de base, flux internes exclus). */
  paid: number;
  paidCount: number;
  /** Engagé, reste à payer (dépenses « à payer » visibles, devise de base). */
  committed: number;
  committedCount: number;
  overdueCount: number;
  overdueAmount: number;
  fixedAmount: number;
  /** Part des charges fixes dans le payé (0-1), null si rien de payé. */
  fixedShare: number | null;
  unassignedAmount: number;
  unassignedCount: number;
  byCategory: { id: string; name: string; amount: number; fixed: boolean }[];
  missingRates: number;
  internalCount: number;
}

export function summarizeExpenses(rows: ExpenseRow[], data: FinanceData, lookup: Lookup): ExpenseSummary {
  const today = data.today;
  const companiesWithActivities = new Set(data.activities.filter((a) => !a.archived).map((a) => a.companyId));
  const s: ExpenseSummary = {
    paid: 0, paidCount: 0, committed: 0, committedCount: 0, overdueCount: 0, overdueAmount: 0, fixedAmount: 0, fixedShare: null,
    unassignedAmount: 0, unassignedCount: 0, byCategory: [], missingRates: 0, internalCount: 0,
  };
  const cats = new Map<string, ExpenseSummary["byCategory"][number]>();
  for (const e of rows) {
    const st = expenseStatus(e, today);
    if (st === "cancelled") continue;
    if (isInternalExpense(data, e)) { s.internalCount++; continue; }
    const conv = toBase(data, e.amount, e.currency, referenceDate(e));
    if (conv.missing) { s.missingRates++; continue; }
    const v = conv.value;
    if (st === "paid") {
      s.paid += v;
      s.paidCount++;
      const cat = lookup.category(e.categoryId);
      if (cat?.nature === "fixed") s.fixedAmount += v;
      const key = e.categoryId && cat ? e.categoryId : "aucune";
      const row = cats.get(key) ?? { id: key, name: cat?.name ?? "Sans catégorie", amount: 0, fixed: cat?.nature === "fixed" };
      row.amount += v;
      cats.set(key, row);
    } else {
      s.committed += v;
      s.committedCount++;
      if (st === "overdue") { s.overdueCount++; s.overdueAmount += v; }
    }
    if (!e.activityId && !e.allocationRuleId && companiesWithActivities.has(e.companyId)) {
      s.unassignedAmount += v;
      s.unassignedCount++;
    }
  }
  s.fixedShare = s.paid > 0 ? s.fixedAmount / s.paid : null;
  s.byCategory = [...cats.values()].sort((a, b) => b.amount - a.amount);
  return s;
}

/* ───────────────────────── Échéances à venir ───────────────────────── */

export const HORIZONS = [30, 60, 90] as const;
export function parseHorizon(v: string | undefined): number {
  const n = Number(v);
  return (HORIZONS as readonly number[]).includes(n) ? n : 30;
}

export interface WeekGroup<T> {
  weekStart: ISODate;
  weekEnd: ISODate;
  label: string;
  items: T[];
  total: number;
}

export function weekLabel(weekStart: ISODate, today: ISODate): string {
  const current = startOfWeek(today);
  if (weekStart === current) return "Cette semaine";
  if (weekStart === addDays(current, 7)) return "Semaine prochaine";
  return `Semaine du ${formatDate(weekStart, "day")} au ${formatDate(addDays(weekStart, 6), "day")}`;
}

/** Regroupe des éléments datés par semaine (lundi → dimanche), semaines triées, total par semaine. */
export function groupByWeek<T>(items: T[], getDate: (t: T) => ISODate, getAmount: (t: T) => number, today: ISODate): WeekGroup<T>[] {
  const map = new Map<ISODate, WeekGroup<T>>();
  for (const it of items) {
    const ws = startOfWeek(getDate(it));
    let g = map.get(ws);
    if (!g) {
      g = { weekStart: ws, weekEnd: addDays(ws, 6), label: weekLabel(ws, today), items: [], total: 0 };
      map.set(ws, g);
    }
    g.items.push(it);
    g.total += getAmount(it);
  }
  const groups = [...map.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  for (const g of groups) g.items.sort((a, b) => (getDate(a) < getDate(b) ? -1 : getDate(a) > getDate(b) ? 1 : 0));
  return groups;
}

/* ───────────────────────── Charges récurrentes ───────────────────────── */

export const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };
export const FREQ_SHORT: Record<string, string> = { monthly: "par mois", quarterly: "par trimestre", yearly: "par an" };

/** Équivalent mensuel d'une charge (unités mineures de sa devise). */
export function monthlyEquivalent(amount: number, frequency: string): number {
  return Math.round(amount / (FREQ_MONTHS[frequency] ?? 1));
}

export function isStopped(r: Pick<RecurringRow, "active" | "endDate">, today: ISODate): boolean {
  return !r.active || (!!r.endDate && r.endDate < today);
}

/** Prochaine échéance à partir d'aujourd'hui (null si la charge est arrêtée ou terminée). */
export function nextOccurrence(r: Pick<RecurringRow, "active" | "startDate" | "endDate" | "frequency">, today: ISODate): ISODate | null {
  if (isStopped(r, today)) return null;
  return recurringOccurrences(r, today, addMonths(today, 13))[0] ?? null;
}

/* ───────────────────────── Pagination ───────────────────────── */

export function paginate<T>(list: T[], page: number, size: number): { items: T[]; page: number; pageCount: number; total: number } {
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: list.slice((p - 1) * size, p * size), page: p, pageCount, total: list.length };
}
