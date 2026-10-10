/**
 * Moteur financier déterministe.
 *
 * Vocabulaire (affiché tel quel dans l'interface) :
 * - Encaissé : argent réellement reçu (paiements de factures + recettes directes).
 * - Payé : argent réellement sorti (dépenses au statut payé + frais sur encaissements).
 * - Facturé : montant des factures émises (pas forcément encaissé).
 * - Restant dû : facturé − encaissé, par facture.
 * - Engagé : dépenses enregistrées mais pas encore payées.
 * - Prévisionnel : projection fondée sur des hypothèses explicites.
 * - Argent disponible : somme des soldes des comptes (solde d'ouverture + mouvements).
 */
import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth, monthKey, type ISODate } from "../dates";
import { convert } from "./fx";
import type {
  AccountRow, CashMovement, ExpenseRow, FinanceData, InvoiceRow, InvoiceState, RecurringRow,
} from "./types";

/* ───────────────────────── Utilitaires ───────────────────────── */

export function inScope(data: FinanceData, companyId: string | null | undefined): boolean {
  return !!companyId && data.scopeCompanyIds.has(companyId);
}

function isInternalCounterpart(data: FinanceData, counterpartCompanyId: string | null): boolean {
  return !!counterpartCompanyId && data.scopeCompanyIds.has(counterpartCompanyId);
}

export interface Conversion { value: number; missing: boolean }

/** Convertit vers la devise de base ; signale l'absence de taux plutôt que d'inventer un montant. */
export function toBase(data: FinanceData, amount: number, currency: string, date: ISODate): Conversion {
  const r = convert(amount, currency, data.baseCurrency, date, data.rates);
  return r.value == null ? { value: 0, missing: true } : { value: r.value, missing: false };
}

function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/* ───────────────────────── Factures ───────────────────────── */

export function invoiceState(invoice: InvoiceRow, payments: { invoiceId: string; amount: number; fees: number; date: ISODate }[], today: ISODate): InvoiceState {
  const own = payments.filter((p) => p.invoiceId === invoice.id);
  const paid = sum(own.map((p) => p.amount));
  const fees = sum(own.map((p) => p.fees));
  const remaining = Math.max(0, invoice.total - paid);
  const lastPaymentDate = own.length ? own.map((p) => p.date).sort().at(-1)! : null;
  let status: InvoiceState["status"];
  if (invoice.status === "cancelled") status = "cancelled";
  else if (invoice.status === "draft") status = "draft";
  else if (remaining === 0 && invoice.total > 0) status = "paid";
  else if (invoice.dueDate < today) status = "overdue";
  else if (paid > 0) status = "partial";
  else status = "pending";
  const daysOverdue = status === "overdue" ? daysBetween(invoice.dueDate, today) : 0;
  return { invoice, paid, fees, remaining, status, daysOverdue, lastPaymentDate };
}

export function invoiceStates(data: FinanceData): Map<string, InvoiceState> {
  const byInvoice = new Map<string, typeof data.payments>();
  for (const p of data.payments) {
    const list = byInvoice.get(p.invoiceId) ?? [];
    list.push(p);
    byInvoice.set(p.invoiceId, list);
  }
  const map = new Map<string, InvoiceState>();
  for (const inv of data.invoices) {
    if (inv.docType !== "invoice" || !inScope(data, inv.companyId)) continue;
    map.set(inv.id, invoiceState(inv, byInvoice.get(inv.id) ?? [], data.today));
  }
  return map;
}

/* ───────────────────────── Mouvements réels ───────────────────────── */

export function cashMovements(data: FinanceData): CashMovement[] {
  const out: CashMovement[] = [];
  const invoicesById = new Map(data.invoices.map((i) => [i.id, i]));
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));

  const push = (m: Omit<CashMovement, "amountBase">) => {
    const c = convert(m.amount, m.currency, data.baseCurrency, m.date, data.rates);
    out.push({ ...m, amountBase: c.value });
  };

  for (const p of data.payments) {
    const inv = invoicesById.get(p.invoiceId);
    if (!inv || !inScope(data, inv.companyId)) continue;
    const internal = isInternalCounterpart(data, inv.counterpartCompanyId);
    push({
      id: `pay:${p.id}`, date: p.date, kind: "income", amount: p.amount, currency: inv.currency,
      label: `Paiement ${inv.number}${inv.title ? ` · ${inv.title}` : ""}`, companyId: inv.companyId, accountId: p.accountId,
      activityId: inv.activityId, categoryId: null, contactId: inv.contactId, source: "payment", sourceId: p.id, internal,
    });
    if (p.fees > 0) {
      push({
        id: `fee:${p.id}`, date: p.date, kind: "expense", amount: -p.fees, currency: inv.currency,
        label: `Frais sur encaissement ${inv.number}`, companyId: inv.companyId, accountId: p.accountId,
        activityId: inv.activityId, categoryId: null, contactId: null, source: "fee", sourceId: p.id, internal: false,
      });
    }
  }

  for (const i of data.incomes) {
    if (!inScope(data, i.companyId)) continue;
    push({
      id: `inc:${i.id}`, date: i.date, kind: "income", amount: i.amount, currency: i.currency, label: i.description,
      companyId: i.companyId, accountId: i.accountId, activityId: i.activityId, categoryId: i.categoryId,
      contactId: i.contactId, source: "income", sourceId: i.id, internal: false,
    });
  }

  for (const e of data.expenses) {
    if (e.status !== "paid" || !inScope(data, e.companyId)) continue;
    push({
      id: `exp:${e.id}`, date: e.paidDate ?? e.date, kind: "expense", amount: -e.amount, currency: e.currency,
      label: e.supplier ? `${e.label} · ${e.supplier}` : e.label, companyId: e.companyId, accountId: e.accountId,
      activityId: e.activityId, categoryId: e.categoryId, contactId: null, source: "expense", sourceId: e.id,
      internal: isInternalCounterpart(data, e.counterpartCompanyId),
    });
  }

  for (const t of data.transfers) {
    const from = accountsById.get(t.fromAccountId);
    const to = accountsById.get(t.toAccountId);
    if (!from || !to) continue;
    const fromIn = inScope(data, from.companyId);
    const toIn = inScope(data, to.companyId);
    const internal = fromIn && toIn;
    const label = TRANSFER_LABELS[t.nature] ?? "Transfert";
    if (fromIn) {
      push({
        id: `trf-out:${t.id}`, date: t.date, kind: "transfer_out", amount: -t.amount, currency: from.currency,
        label: `${label} → ${to.name}`, companyId: from.companyId, accountId: from.id, activityId: null, categoryId: null,
        contactId: null, source: "transfer", sourceId: t.id, internal, transferNature: t.nature,
      });
    }
    if (toIn) {
      push({
        id: `trf-in:${t.id}`, date: t.date, kind: "transfer_in", amount: t.toAmount, currency: to.currency,
        label: `${label} ← ${from.name}`, companyId: to.companyId, accountId: to.id, activityId: null, categoryId: null,
        contactId: null, source: "transfer", sourceId: t.id, internal, transferNature: t.nature,
      });
    }
  }

  out.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
  return out;
}

export const TRANSFER_LABELS: Record<string, string> = {
  internal: "Virement interne",
  owner_draw: "Rémunération / prélèvement",
  owner_contribution: "Apport personnel",
  intercompany: "Flux inter-structures",
};

/* ───────────────────────── Soldes ───────────────────────── */

export interface AccountBalance {
  account: AccountRow;
  balance: number; // devise du compte
  balanceBase: number | null;
  kind: "pro" | "personal";
}

export function accountBalances(data: FinanceData, movements: CashMovement[], asOf: ISODate = data.today): AccountBalance[] {
  const personalIds = new Set(data.companies.filter((c) => c.kind === "personal").map((c) => c.id));
  const result: AccountBalance[] = [];
  for (const account of data.accounts) {
    if (!inScope(data, account.companyId) || account.archived) continue;
    let balance = account.openingBalance;
    for (const m of movements) {
      if (m.accountId !== account.id || m.date < account.openingDate || m.date > asOf) continue;
      if (m.currency === account.currency) balance += m.amount;
      else {
        const c = convert(m.amount, m.currency, account.currency, m.date, data.rates);
        if (c.value != null) balance += c.value;
      }
    }
    const b = convert(balance, account.currency, data.baseCurrency, asOf, data.rates);
    result.push({ account, balance, balanceBase: b.value, kind: personalIds.has(account.companyId) ? "personal" : "pro" });
  }
  return result;
}

export interface AvailableCash {
  total: number;
  pro: number;
  personal: number;
  accounts: AccountBalance[];
  missingRates: string[];
  hasAccounts: boolean;
}

export function availableCash(data: FinanceData, movements: CashMovement[], asOf: ISODate = data.today): AvailableCash {
  const accounts = accountBalances(data, movements, asOf);
  const missingRates = accounts.filter((a) => a.balanceBase == null).map((a) => a.account.name);
  const pro = sum(accounts.filter((a) => a.kind === "pro").map((a) => a.balanceBase ?? 0));
  const personal = sum(accounts.filter((a) => a.kind === "personal").map((a) => a.balanceBase ?? 0));
  return { total: pro + personal, pro, personal, accounts, missingRates, hasAccounts: accounts.length > 0 };
}

/* ───────────────────────── Flux d'une période ───────────────────────── */

export interface PeriodFlows {
  income: number;
  expense: number; // positif
  net: number;
  transfersIn: number;
  transfersOut: number; // positif
  internalExcluded: number; // volume des flux internes neutralisés
  movements: CashMovement[];
  missingRateCount: number;
  unassignedAccountCount: number;
}

export function periodFlows(movements: CashMovement[], from: ISODate, to: ISODate): PeriodFlows {
  let income = 0, expense = 0, transfersIn = 0, transfersOut = 0, internalExcluded = 0, missing = 0, unassigned = 0;
  const list: CashMovement[] = [];
  for (const m of movements) {
    if (m.date < from || m.date > to) continue;
    list.push(m);
    if (m.amountBase == null) { missing++; continue; }
    if (!m.accountId) unassigned++;
    if (m.internal) { internalExcluded += Math.abs(m.amountBase); continue; }
    if (m.kind === "income") income += m.amountBase;
    else if (m.kind === "expense") expense += -m.amountBase;
    else if (m.kind === "transfer_in") transfersIn += m.amountBase;
    else transfersOut += -m.amountBase;
  }
  return { income, expense, net: income - expense, transfersIn, transfersOut, internalExcluded: internalExcluded / 2, movements: list, missingRateCount: missing, unassignedAccountCount: unassigned };
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* ───────────────────────── À encaisser ───────────────────────── */

export interface Receivables {
  notDue: number;
  overdue: number;
  total: number;
  items: (InvoiceState & { remainingBase: number })[];
  byContact: { contactId: string | null; name: string; organization: string | null; overdue: number; total: number; count: number; overdueCount: number }[];
}

export function receivables(data: FinanceData, states: Map<string, InvoiceState>): Receivables {
  const items: Receivables["items"] = [];
  for (const s of states.values()) {
    if (!["pending", "partial", "overdue", "sent"].includes(s.status) || s.remaining <= 0) continue;
    if (isInternalCounterpart(data, s.invoice.counterpartCompanyId)) continue;
    const c = toBase(data, s.remaining, s.invoice.currency, data.today);
    items.push({ ...s, remainingBase: c.value });
  }
  items.sort((a, b) => (a.invoice.dueDate < b.invoice.dueDate ? -1 : 1));
  const contactsById = new Map(data.contacts.map((c) => [c.id, c]));
  const byContactMap = new Map<string, Receivables["byContact"][number]>();
  for (const it of items) {
    const key = it.invoice.contactId ?? "none";
    const row = byContactMap.get(key) ?? { contactId: it.invoice.contactId, name: contactsById.get(it.invoice.contactId ?? "")?.name ?? "Client non renseigné", organization: contactsById.get(it.invoice.contactId ?? "")?.organization ?? null, overdue: 0, total: 0, count: 0, overdueCount: 0 };
    row.total += it.remainingBase;
    row.count++;
    if (it.status === "overdue") { row.overdue += it.remainingBase; row.overdueCount++; }
    byContactMap.set(key, row);
  }
  const notDue = sum(items.filter((i) => i.status !== "overdue").map((i) => i.remainingBase));
  const overdue = sum(items.filter((i) => i.status === "overdue").map((i) => i.remainingBase));
  return { notDue, overdue, total: notDue + overdue, items, byContact: [...byContactMap.values()].sort((a, b) => b.total - a.total) };
}

/* ───────────────────────── Dépenses à venir ───────────────────────── */

const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Dates d'échéance d'une charge récurrente comprises dans [from, to]. */
export function recurringOccurrences(rec: Pick<RecurringRow, "startDate" | "endDate" | "frequency">, from: ISODate, to: ISODate): ISODate[] {
  const step = FREQ_MONTHS[rec.frequency] ?? 1;
  const anchor = Number(rec.startDate.slice(8, 10));
  const dates: ISODate[] = [];
  // saute directement près de "from" pour éviter de boucler sur des années
  let i = 0;
  const monthsToFrom = Math.max(0, (Number(from.slice(0, 4)) - Number(rec.startDate.slice(0, 4))) * 12 + (Number(from.slice(5, 7)) - Number(rec.startDate.slice(5, 7))));
  i = Math.max(0, Math.floor(monthsToFrom / step) - 1);
  for (let guard = 0; guard < 600; guard++, i++) {
    const d = addMonths(rec.startDate, i * step, anchor);
    if (d > to) break;
    if (rec.endDate && d > rec.endDate) break;
    if (d >= from && d >= rec.startDate) dates.push(d);
  }
  return dates;
}

export interface UpcomingOutflow {
  key: string;
  date: ISODate; // date prévue (aujourd'hui si en retard)
  originalDate: ISODate;
  label: string;
  supplier: string | null;
  amount: number;
  currency: string;
  amountBase: number;
  companyId: string;
  kind: "planned" | "recurring";
  late: boolean;
  expenseId?: string;
  recurringId?: string;
  occurrenceDate?: ISODate;
  remindDaysBefore?: number;
}

/** Fenêtre au-delà de laquelle une échéance récurrente non confirmée n'est plus projetée (hypothèse affichée). */
export const UNCONFIRMED_LOOKBACK_DAYS = 45;

export function upcomingOutflows(data: FinanceData, to: ISODate, opts: { includeLate?: boolean } = {}): UpcomingOutflow[] {
  const includeLate = opts.includeLate ?? true;
  const out: UpcomingOutflow[] = [];
  for (const e of data.expenses) {
    if (e.status !== "planned" || !inScope(data, e.companyId) || isInternalCounterpart(data, e.counterpartCompanyId)) continue;
    const due = e.dueDate ?? e.date;
    if (due > to) continue;
    const late = due < data.today;
    if (late && !includeLate) continue;
    out.push({
      key: `exp:${e.id}`, date: late ? data.today : due, originalDate: due, label: e.label, supplier: e.supplier,
      amount: e.amount, currency: e.currency, amountBase: toBase(data, e.amount, e.currency, due).value,
      companyId: e.companyId, kind: "planned", late, expenseId: e.id,
    });
  }
  const realized = new Set(data.expenses.filter((e) => e.recurringId && e.occurrenceDate).map((e) => `${e.recurringId}|${e.occurrenceDate}`));
  const lookbackFrom = addDays(data.today, -UNCONFIRMED_LOOKBACK_DAYS);
  for (const r of data.recurring) {
    if (!r.active || !inScope(data, r.companyId)) continue;
    for (const d of recurringOccurrences(r, includeLate ? lookbackFrom : data.today, to)) {
      if (realized.has(`${r.id}|${d}`)) continue;
      const late = d < data.today;
      out.push({
        key: `rec:${r.id}:${d}`, date: late ? data.today : d, originalDate: d, label: r.label, supplier: r.supplier,
        amount: r.amount, currency: r.currency, amountBase: toBase(data, r.amount, r.currency, d).value,
        companyId: r.companyId, kind: "recurring", late, recurringId: r.id, occurrenceDate: d, remindDaysBefore: r.remindDaysBefore,
      });
    }
  }
  out.sort((a, b) => (a.originalDate < b.originalDate ? -1 : a.originalDate > b.originalDate ? 1 : b.amountBase - a.amountBase));
  return out;
}

/* ───────────────────────── Prévisionnel ───────────────────────── */

export type Scenario = "prudent" | "central" | "optimist";

export const SCENARIO_LABELS: Record<Scenario, string> = { prudent: "Prudent", central: "Central", optimist: "Optimiste" };

/** Délai supplémentaire appliqué aux factures non échues dans le scénario prudent. */
export const PRUDENT_EXTRA_DELAY_DAYS = 15;
/** Délai supposé avant l'encaissement des factures déjà en retard. */
export const OVERDUE_COLLECTION_DELAY_DAYS = 14;
/** Délai entre la signature d'une opportunité et son encaissement. */
export const OPPORTUNITY_PAYMENT_DELAY_DAYS = 30;

export interface ForecastEvent {
  date: ISODate;
  amount: number; // base, signé
  label: string;
  kind: "invoice" | "overdue_invoice" | "opportunity" | "planned" | "recurring";
  certainty: "contractual" | "estimated" | "hypothetical";
  ref?: string;
}

export interface ForecastResult {
  scenario: Scenario;
  start: number;
  points: { date: ISODate; balance: number; inflow: number; outflow: number }[];
  events: ForecastEvent[];
  end: number;
  totalIn: number;
  totalOut: number;
  min: { date: ISODate; balance: number };
  firstNegative: ISODate | null;
  firstBelowThreshold: ISODate | null;
  hypotheses: string[];
}

export function forecast(data: FinanceData, horizonDays: number, scenario: Scenario, ctx?: { movements?: CashMovement[]; states?: Map<string, InvoiceState> }): ForecastResult {
  const movements = ctx?.movements ?? cashMovements(data);
  const states = ctx?.states ?? invoiceStates(data);
  const start = availableCash(data, movements).total;
  const end = addDays(data.today, horizonDays);
  const events: ForecastEvent[] = [];
  const overdueRate = scenario === "prudent" ? data.scenarios.prudentOverdueRate : scenario === "central" ? data.scenarios.centralOverdueRate : data.scenarios.optimistOverdueRate;

  for (const s of receivables(data, states).items) {
    if (s.status === "overdue") {
      if (overdueRate <= 0) continue;
      events.push({
        date: addDays(data.today, scenario === "optimist" ? 7 : OVERDUE_COLLECTION_DELAY_DAYS),
        amount: Math.round((s.remainingBase * overdueRate) / 100),
        label: `Facture en retard ${s.invoice.number}${overdueRate < 100 ? ` (${overdueRate} %)` : ""}`,
        kind: "overdue_invoice", certainty: "estimated", ref: s.invoice.id,
      });
    } else {
      events.push({
        date: scenario === "prudent" ? addDays(s.invoice.dueDate, PRUDENT_EXTRA_DELAY_DAYS) : s.invoice.dueDate,
        amount: s.remainingBase, label: `Facture ${s.invoice.number}`, kind: "invoice", certainty: "contractual", ref: s.invoice.id,
      });
    }
  }

  const invoicedOpps = new Set(data.invoices.filter((i) => i.opportunityId).map((i) => i.opportunityId));
  for (const o of data.opportunities) {
    if (o.companyId && !inScope(data, o.companyId)) continue;
    if (invoicedOpps.has(o.id)) continue;
    const base = toBase(data, o.amount, o.currency, data.today).value;
    const closeDate = o.expectedCloseDate && o.expectedCloseDate > data.today ? o.expectedCloseDate : data.today;
    if (o.stage === "won" && scenario !== "prudent") {
      events.push({ date: addDays(closeDate, OPPORTUNITY_PAYMENT_DELAY_DAYS), amount: base, label: `Accord signé, non facturé : ${o.title}`, kind: "opportunity", certainty: "estimated", ref: o.id });
    } else if ((o.stage === "proposal_sent" || o.stage === "negotiation") && scenario === "optimist") {
      events.push({ date: addDays(closeDate, OPPORTUNITY_PAYMENT_DELAY_DAYS), amount: Math.round((base * o.probability) / 100), label: `Opportunité ${o.title} (${o.probability} %)`, kind: "opportunity", certainty: "hypothetical", ref: o.id });
    }
  }

  for (const u of upcomingOutflows(data, end)) {
    events.push({ date: u.date, amount: -u.amountBase, label: u.supplier ? `${u.label} · ${u.supplier}` : u.label, kind: u.kind, certainty: "contractual", ref: u.key });
  }

  const inHorizon = events.filter((e) => e.date <= end).sort((a, b) => (a.date < b.date ? -1 : 1));
  const byDay = new Map<ISODate, { inflow: number; outflow: number }>();
  for (const e of inHorizon) {
    const d = e.date < data.today ? data.today : e.date;
    const row = byDay.get(d) ?? { inflow: 0, outflow: 0 };
    if (e.amount >= 0) row.inflow += e.amount; else row.outflow += -e.amount;
    byDay.set(d, row);
  }
  const points: ForecastResult["points"] = [];
  let balance = start;
  let min = { date: data.today, balance: start };
  let firstNegative: ISODate | null = null;
  let firstBelowThreshold: ISODate | null = null;
  for (let i = 0; i <= horizonDays; i++) {
    const d = addDays(data.today, i);
    const row = byDay.get(d) ?? { inflow: 0, outflow: 0 };
    balance += row.inflow - row.outflow;
    points.push({ date: d, balance, inflow: row.inflow, outflow: row.outflow });
    if (balance < min.balance) min = { date: d, balance };
    if (balance < 0 && !firstNegative) firstNegative = d;
    if (data.cashSafetyThreshold > 0 && balance < data.cashSafetyThreshold && !firstBelowThreshold) firstBelowThreshold = d;
  }

  const hypotheses = [
    "Point de départ : soldes actuels des comptes renseignés.",
    scenario === "prudent"
      ? `Factures non échues encaissées ${PRUDENT_EXTRA_DELAY_DAYS} jours après leur échéance.`
      : "Factures non échues encaissées à leur date d'échéance.",
    overdueRate > 0
      ? `Factures en retard : ${overdueRate} % du restant dû encaissé d'ici ${scenario === "optimist" ? 7 : OVERDUE_COLLECTION_DELAY_DAYS} jours.`
      : "Factures en retard : aucun encaissement supposé.",
    scenario === "prudent" ? "Opportunités commerciales : non prises en compte." : scenario === "central"
      ? "Opportunités : seules celles marquées « gagnées » et non facturées, encaissées 30 jours après signature."
      : "Opportunités en cours pondérées par leur probabilité, encaissées 30 jours après la date de signature prévue.",
    "Dépenses prévues et charges récurrentes : 100 % à leur échéance.",
    `Charges récurrentes non confirmées depuis moins de ${UNCONFIRMED_LOOKBACK_DAYS} jours : considérées comme restant à payer aujourd'hui.`,
  ];

  return {
    scenario, start, points, events: inHorizon, end: balance,
    totalIn: sum(inHorizon.filter((e) => e.amount > 0).map((e) => e.amount)),
    totalOut: -sum(inHorizon.filter((e) => e.amount < 0).map((e) => e.amount)),
    min, firstNegative, firstBelowThreshold, hypotheses,
  };
}

/* ───────────────────────── Séries temporelles ───────────────────────── */

export type Granularity = "day" | "week" | "month";

export interface SeriesBucket { key: string; from: ISODate; to: ISODate; income: number; expense: number; net: number }

export function bucketize(movements: CashMovement[], from: ISODate, to: ISODate, granularity: Granularity): SeriesBucket[] {
  const buckets: SeriesBucket[] = [];
  let cursor = granularity === "month" ? startOfMonth(from) : from;
  for (let guard = 0; cursor <= to && guard < 800; guard++) {
    const next = granularity === "day" ? addDays(cursor, 1) : granularity === "week" ? addDays(cursor, 7) : addMonths(cursor, 1, 1);
    const bucketTo = addDays(next, -1) > to ? to : addDays(next, -1);
    buckets.push({ key: granularity === "month" ? monthKey(cursor) : cursor, from: cursor, to: bucketTo, income: 0, expense: 0, net: 0 });
    cursor = next;
  }
  for (const m of movements) {
    if (m.internal || m.amountBase == null || m.kind.startsWith("transfer")) continue;
    if (m.date < from || m.date > to) continue;
    const b = buckets.find((x) => m.date >= x.from && m.date <= x.to);
    if (!b) continue;
    if (m.kind === "income") b.income += m.amountBase; else b.expense += -m.amountBase;
  }
  for (const b of buckets) b.net = b.income - b.expense;
  return buckets;
}

/** Solde disponible en fin de chaque mois (historique) — pour la courbe d'évolution. */
export function balanceHistory(data: FinanceData, movements: CashMovement[], months: number): { key: string; date: ISODate; balance: number }[] {
  const out: { key: string; date: ISODate; balance: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(startOfMonth(data.today), -i, 1);
    const asOf = i === 0 ? data.today : endOfMonth(m);
    out.push({ key: monthKey(m), date: asOf, balance: availableCash(data, movements, asOf).total });
  }
  return out;
}

export function expensesByCategory(data: FinanceData, movements: CashMovement[], from: ISODate, to: ISODate) {
  const catById = new Map(data.categories.map((c) => [c.id, c.name]));
  const map = new Map<string, number>();
  for (const m of movements) {
    if (m.kind !== "expense" || m.internal || m.amountBase == null || m.date < from || m.date > to) continue;
    const name = m.source === "fee" ? "Frais bancaires" : catById.get(m.categoryId ?? "") ?? "Sans catégorie";
    map.set(name, (map.get(name) ?? 0) - m.amountBase);
  }
  return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

/* ───────────────────────── Rentabilité par activité ───────────────────────── */

export interface ActivityProfit {
  activityId: string;
  name: string;
  color: string;
  companyId: string;
  invoiced: number;
  collected: number;
  directCosts: number;
  assignedCosts: number;
  sharedCosts: number;
  totalCosts: number;
  margin: number; // facturé − coûts
  marginRate: number | null;
  cashMargin: number; // encaissé − coûts
  previousInvoiced: number;
  growth: number | null;
  clients: number;
  invoiceCount: number;
  averageInvoice: number | null;
  outstanding: number;
  averageDaysToPay: number | null;
}

export interface ProfitabilityReport {
  activities: ActivityProfit[];
  unassignedCosts: number;
  unassignedRevenue: number;
  unassignedItems: { label: string; amount: number; date: ISODate }[];
  sharedDetails: { label: string; rule: string; method: string; amount: number; split: { activityId: string; amount: number }[] }[];
  totals: { invoiced: number; collected: number; costs: number; margin: number };
  highlights: { key: string; label: string; activityId: string | null; value: string }[];
}

export function expenseCostBase(data: FinanceData, e: ExpenseRow) {
  return toBase(data, e.amount, e.currency, e.date).value;
}

export function profitability(data: FinanceData, from: ISODate, to: ISODate, ctx?: { states?: Map<string, InvoiceState>; movements?: CashMovement[] }): ProfitabilityReport {
  const states = ctx?.states ?? invoiceStates(data);
  const movements = ctx?.movements ?? cashMovements(data);
  const span = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -span);
  const acts = data.activities.filter((a) => inScope(data, a.companyId) && !a.archived);
  const rows = new Map<string, ActivityProfit>();
  for (const a of acts) {
    rows.set(a.id, {
      activityId: a.id, name: a.name, color: a.color, companyId: a.companyId, invoiced: 0, collected: 0, directCosts: 0,
      assignedCosts: 0, sharedCosts: 0, totalCosts: 0, margin: 0, marginRate: null, cashMargin: 0, previousInvoiced: 0,
      growth: null, clients: 0, invoiceCount: 0, averageInvoice: null, outstanding: 0, averageDaysToPay: null,
    });
  }
  let unassignedRevenue = 0;
  const clientSets = new Map<string, Set<string>>();
  const payDelays = new Map<string, number[]>();

  for (const s of states.values()) {
    const inv = s.invoice;
    if (s.status === "draft" || s.status === "cancelled" || isInternalCounterpart(data, inv.counterpartCompanyId)) continue;
    const row = inv.activityId ? rows.get(inv.activityId) : undefined;
    const base = toBase(data, inv.total, inv.currency, inv.issueDate).value;
    if (inv.issueDate >= from && inv.issueDate <= to) {
      if (row) {
        row.invoiced += base;
        row.invoiceCount++;
        if (inv.contactId) (clientSets.get(row.activityId) ?? clientSets.set(row.activityId, new Set()).get(row.activityId)!).add(inv.contactId);
      } else unassignedRevenue += base;
    }
    if (row && inv.issueDate >= prevFrom && inv.issueDate <= prevTo) row.previousInvoiced += base;
    if (row && s.remaining > 0) row.outstanding += toBase(data, s.remaining, inv.currency, data.today).value;
    if (row && s.status === "paid" && s.lastPaymentDate && s.lastPaymentDate >= from && s.lastPaymentDate <= to) {
      (payDelays.get(row.activityId) ?? payDelays.set(row.activityId, []).get(row.activityId)!).push(Math.max(0, daysBetween(inv.issueDate, s.lastPaymentDate)));
    }
  }

  for (const m of movements) {
    if (m.kind !== "income" || m.internal || m.amountBase == null || m.date < from || m.date > to) continue;
    const row = m.activityId ? rows.get(m.activityId) : undefined;
    if (row) {
      row.collected += m.amountBase;
      if (m.source === "income") {
        row.invoiced += m.amountBase; // recette directe = facturée et encaissée le même jour
        if (m.contactId) (clientSets.get(row.activityId) ?? clientSets.set(row.activityId, new Set()).get(row.activityId)!).add(m.contactId);
      }
    }
  }
  for (const i of data.incomes) {
    const row = i.activityId ? rows.get(i.activityId) : undefined;
    if (row && i.date >= prevFrom && i.date <= prevTo) row.previousInvoiced += toBase(data, i.amount, i.currency, i.date).value;
  }

  let unassignedCosts = 0;
  const unassignedItems: ProfitabilityReport["unassignedItems"] = [];
  const sharedDetails: ProfitabilityReport["sharedDetails"] = [];
  const rulesById = new Map(data.allocationRules.map((r) => [r.id, r]));

  for (const e of data.expenses) {
    if (e.status === "cancelled" || !inScope(data, e.companyId) || isInternalCounterpart(data, e.counterpartCompanyId)) continue;
    if (e.date < from || e.date > to) continue;
    const base = expenseCostBase(data, e);
    if (e.activityId && rows.has(e.activityId)) {
      const row = rows.get(e.activityId)!;
      if (e.costType === "direct") row.directCosts += base; else row.assignedCosts += base;
      continue;
    }
    const rule = e.allocationRuleId ? rulesById.get(e.allocationRuleId) : undefined;
    if (rule) {
      const split = allocate(rule, base, [...rows.values()].filter((r) => r.companyId === rule.companyId));
      let allocated = 0;
      for (const s of split) {
        const row = rows.get(s.activityId);
        if (!row) continue;
        row.sharedCosts += s.amount;
        allocated += s.amount;
      }
      if (base - allocated !== 0) {
        unassignedCosts += base - allocated;
        unassignedItems.push({ label: `${e.label} (part non répartie)`, amount: base - allocated, date: e.date });
      }
      sharedDetails.push({ label: e.label, rule: rule.name, method: rule.method === "revenue" ? "au prorata du chiffre d'affaires facturé" : "pourcentages définis", amount: base, split });
      continue;
    }
    unassignedCosts += base;
    unassignedItems.push({ label: e.supplier ? `${e.label} · ${e.supplier}` : e.label, amount: base, date: e.date });
  }

  const list = [...rows.values()];
  for (const r of list) {
    r.totalCosts = r.directCosts + r.assignedCosts + r.sharedCosts;
    r.margin = r.invoiced - r.totalCosts;
    r.cashMargin = r.collected - r.totalCosts;
    r.marginRate = r.invoiced > 0 ? (r.margin / r.invoiced) * 100 : null;
    r.growth = pctChange(r.invoiced, r.previousInvoiced);
    r.clients = clientSets.get(r.activityId)?.size ?? 0;
    r.averageInvoice = r.invoiceCount > 0 ? Math.round(r.invoiced / r.invoiceCount) : null;
    const delays = payDelays.get(r.activityId);
    r.averageDaysToPay = delays && delays.length ? Math.round(sum(delays) / delays.length) : null;
  }
  list.sort((a, b) => b.invoiced - a.invoiced);

  const withRevenue = list.filter((r) => r.invoiced > 0);
  const pick = (arr: ActivityProfit[], f: (r: ActivityProfit) => number | null, dir: "max" | "min") => {
    let best: ActivityProfit | null = null;
    for (const r of arr) {
      const v = f(r);
      if (v == null) continue;
      if (!best || (dir === "max" ? v > f(best)! : v < f(best)!)) best = r;
    }
    return best;
  };
  const highlights: ProfitabilityReport["highlights"] = [];
  const top = pick(withRevenue, (r) => r.invoiced, "max");
  if (top) highlights.push({ key: "revenue", label: "Génère le plus de revenus", activityId: top.activityId, value: "invoiced" });
  const margin = pick(withRevenue, (r) => r.marginRate, "max");
  if (margin) highlights.push({ key: "margin", label: "Meilleur taux de marge", activityId: margin.activityId, value: "marginRate" });
  const fast = pick(withRevenue, (r) => r.averageDaysToPay, "min");
  if (fast) highlights.push({ key: "speed", label: "Encaisse le plus vite", activityId: fast.activityId, value: "averageDaysToPay" });
  const lean = pick(withRevenue, (r) => (r.invoiced > 0 ? r.totalCosts / r.invoiced : null), "min");
  if (lean) highlights.push({ key: "lean", label: "Supporte le moins de dépenses", activityId: lean.activityId, value: "costRatio" });
  const growth = pick(withRevenue, (r) => r.growth, "max");
  if (growth && (growth.growth ?? 0) > 0) highlights.push({ key: "growth", label: "Revenus en plus forte progression", activityId: growth.activityId, value: "growth" });
  const heavy = pick(withRevenue, (r) => r.totalCosts, "max");
  if (heavy && heavy.totalCosts > 0) highlights.push({ key: "resources", label: "Mobilise le plus de dépenses", activityId: heavy.activityId, value: "totalCosts" });

  const totals = {
    invoiced: sum(list.map((r) => r.invoiced)) + unassignedRevenue,
    collected: sum(list.map((r) => r.collected)),
    costs: sum(list.map((r) => r.totalCosts)) + unassignedCosts,
    margin: 0,
  };
  totals.margin = totals.invoiced - totals.costs;
  return { activities: list, unassignedCosts, unassignedRevenue, unassignedItems, sharedDetails, totals, highlights };
}

/** Répartit un montant selon une règle. Ce qui ne peut pas être réparti de façon fiable reste non affecté. */
export function allocate(rule: { method: string; shares: { activityId: string; percent: number }[] }, amount: number, activities: { activityId: string; invoiced: number }[]): { activityId: string; amount: number }[] {
  if (rule.method === "revenue") {
    const total = sum(activities.map((a) => Math.max(0, a.invoiced)));
    if (total <= 0) return [];
    const parts = activities.filter((a) => a.invoiced > 0).map((a) => ({ activityId: a.activityId, amount: Math.floor((amount * a.invoiced) / total) }));
    const rest = amount - sum(parts.map((p) => p.amount));
    if (parts.length) parts[0].amount += rest; // arrondi
    return parts;
  }
  const valid = rule.shares.filter((s) => s.percent > 0 && activities.some((a) => a.activityId === s.activityId));
  const totalPct = Math.min(100, sum(valid.map((s) => s.percent)));
  const parts = valid.map((s) => ({ activityId: s.activityId, amount: Math.floor((amount * s.percent) / 100) }));
  if (totalPct === 100 && parts.length) parts[0].amount += amount - sum(parts.map((p) => p.amount));
  return parts;
}

/* ───────────────────────── Objectifs ───────────────────────── */

export interface GoalProgress {
  goalId: string;
  label: string;
  type: string;
  target: number;
  current: number;
  progress: number; // 0..1
  status: "on_track" | "at_risk" | "reached";
  message: string;
  unit: "money" | "percent";
  lowerIsBetter: boolean;
}

/* ───────────────────────── Prévu vs réel ───────────────────────── */

export interface MonthPlan {
  month: string;
  expectedIncome: number;
  expectedExpense: number;
  details: { incomes: { id: string; label: string; amount: number }[]; outflows: { key: string; label: string; amount: number }[] };
}

/**
 * Ce qui était attendu pour un mois donné. Utilisé pour prendre la « photo » du prévisionnel en début de mois
 * (forecast_snapshots) ; pour un mois passé sans photo, le plan est reconstitué à partir des échéances connues.
 */
export function planForMonth(data: FinanceData, month: string, states: Map<string, InvoiceState>): MonthPlan {
  const from = `${month}-01`;
  const to = endOfMonth(from);
  const incomes: MonthPlan["details"]["incomes"] = [];
  for (const s of states.values()) {
    if (s.status === "draft" || s.status === "cancelled" || isInternalCounterpart(data, s.invoice.counterpartCompanyId)) continue;
    if (s.invoice.dueDate < from || s.invoice.dueDate > to) continue;
    // restant dû au début du mois (paiements antérieurs au mois exclus)
    const paidBefore = sum(data.payments.filter((p) => p.invoiceId === s.invoice.id && p.date < from).map((p) => p.amount));
    const remaining = s.invoice.total - paidBefore;
    if (remaining <= 0) continue;
    incomes.push({ id: s.invoice.id, label: `Facture ${s.invoice.number}`, amount: toBase(data, remaining, s.invoice.currency, from).value });
  }
  const outflows: MonthPlan["details"]["outflows"] = [];
  for (const e of data.expenses) {
    // Une dépense ponctuelle est considérée « prévue » si elle avait une date d'échéance (planifiée à l'avance).
    if (!inScope(data, e.companyId) || e.recurringId || e.status === "cancelled" || !e.dueDate) continue;
    const due = e.dueDate;
    if (due < from || due > to) continue;
    outflows.push({ key: `exp:${e.id}`, label: e.label, amount: toBase(data, e.amount, e.currency, due).value });
  }
  for (const r of data.recurring) {
    if (!inScope(data, r.companyId)) continue;
    for (const d of recurringOccurrences(r, from, to)) outflows.push({ key: `rec:${r.id}:${d}`, label: r.label, amount: toBase(data, r.amount, r.currency, d).value });
  }
  return { month, expectedIncome: sum(incomes.map((i) => i.amount)), expectedExpense: sum(outflows.map((o) => o.amount)), details: { incomes, outflows } };
}

export interface VarianceReport {
  month: string;
  plannedIncome: number;
  actualIncome: number;
  plannedExpense: number;
  actualExpense: number;
  incomeGap: number;
  expenseGap: number;
  explanations: { kind: "late_payment" | "unplanned_income" | "unplanned_expense" | "skipped_expense" | "partial_payment"; label: string; amount: number }[];
}

export function varianceForMonth(data: FinanceData, plan: MonthPlan, movements: CashMovement[]): VarianceReport {
  const from = `${plan.month}-01`;
  const to = endOfMonth(from);
  const flows = periodFlows(movements, from, to);
  const explanations: VarianceReport["explanations"] = [];
  const paymentsInMonth = data.payments.filter((p) => p.date >= from && p.date <= to);
  const invoicesById = new Map(data.invoices.map((i) => [i.id, i]));
  for (const inc of plan.details.incomes) {
    const inv = invoicesById.get(inc.id);
    if (!inv) continue;
    const got = toBase(data, sum(paymentsInMonth.filter((p) => p.invoiceId === inc.id).map((p) => p.amount)), inv.currency, to).value;
    if (got === 0) explanations.push({ kind: "late_payment", label: `${inc.label} attendue, non encaissée sur le mois`, amount: -inc.amount });
    else if (got < inc.amount) explanations.push({ kind: "partial_payment", label: `${inc.label} encaissée partiellement`, amount: got - inc.amount });
  }
  const plannedIds = new Set(plan.details.incomes.map((i) => i.id));
  const unplannedIncome = flows.movements.filter((m) => m.kind === "income" && !m.internal && m.amountBase != null && !(m.source === "payment" && plannedIds.has(data.payments.find((p) => p.id === m.sourceId)?.invoiceId ?? "")));
  for (const m of unplannedIncome.sort((a, b) => b.amountBase! - a.amountBase!).slice(0, 5)) {
    explanations.push({ kind: "unplanned_income", label: `Encaissement non prévu : ${m.label}`, amount: m.amountBase! });
  }
  const plannedKeys = new Set(plan.details.outflows.map((o) => o.key));
  const realizedRecurring = new Set<string>();
  for (const m of flows.movements) {
    if (m.kind !== "expense" || m.internal || m.amountBase == null) continue;
    const e = m.source === "expense" ? data.expenses.find((x) => x.id === m.sourceId) : undefined;
    const key = e?.recurringId ? `rec:${e.recurringId}:${e.occurrenceDate}` : e ? `exp:${e.id}` : m.id;
    if (e?.recurringId) realizedRecurring.add(key);
    if (!plannedKeys.has(key)) explanations.push({ kind: "unplanned_expense", label: `Dépense non prévue : ${m.label}`, amount: m.amountBase });
  }
  for (const o of plan.details.outflows) {
    if (o.key.startsWith("rec:") && !realizedRecurring.has(o.key)) {
      const [, rid, occ] = o.key.split(":");
      const confirmed = data.expenses.some((e) => e.recurringId === rid && e.occurrenceDate === occ && e.status === "paid");
      if (!confirmed) explanations.push({ kind: "skipped_expense", label: `${o.label} prévue, non payée sur le mois`, amount: o.amount });
    }
  }
  explanations.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return {
    month: plan.month, plannedIncome: plan.expectedIncome, actualIncome: flows.income, plannedExpense: plan.expectedExpense,
    actualExpense: flows.expense, incomeGap: flows.income - plan.expectedIncome, expenseGap: flows.expense - plan.expectedExpense,
    explanations: explanations.slice(0, 10),
  };
}
