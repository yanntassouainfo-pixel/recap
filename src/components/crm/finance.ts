/**
 * Chiffres financiers par contact (module PUR, testé) : facturé, encaissé, restant dû, en retard.
 *
 * - Toutes les factures du contact sont prises en compte, quelle que soit la structure affichée : la fiche client
 *   doit montrer la relation complète. Les factures internes (vers une autre structure de l'utilisateur) sont exclues.
 * - Facturé : factures émises (ni brouillon, ni annulée), converties à la date d'émission.
 * - Encaissé : paiements reçus sur ces factures (à leur date) + recettes directes rattachées au contact.
 * - Restant dû / en retard : convertis au jour J.
 * - Une conversion impossible (taux manquant) est signalée par `missingRate`, jamais inventée.
 */
import { invoiceState, toBase } from "@/lib/finance/engine";
import type { FinanceData, InvoiceState } from "@/lib/finance/types";

export interface ContactFinance {
  invoiced: number;
  collected: number;
  remaining: number;
  overdue: number;
  overdueCount: number;
  openCount: number;
  invoiceCount: number;
  lastPaymentDate: string | null;
  /** Au moins un montant n'a pas pu être converti dans la devise de base. */
  missingRate: boolean;
  /** Factures du contact (hors brouillons annulés), les plus récentes d'abord. */
  states: InvoiceState[];
}

const empty = (): ContactFinance => ({
  invoiced: 0, collected: 0, remaining: 0, overdue: 0, overdueCount: 0, openCount: 0, invoiceCount: 0,
  lastPaymentDate: null, missingRate: false, states: [],
});

export function contactFinances(data: FinanceData, contactIds?: Iterable<string>): Map<string, ContactFinance> {
  const wanted = contactIds ? new Set(contactIds) : null;
  const out = new Map<string, ContactFinance>();
  const get = (id: string) => {
    let f = out.get(id);
    if (!f) out.set(id, (f = empty()));
    return f;
  };
  const internal = new Set(data.companies.map((c) => c.id));

  const paymentsByInvoice = new Map<string, FinanceData["payments"]>();
  for (const p of data.payments) {
    const list = paymentsByInvoice.get(p.invoiceId) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.invoiceId, list);
  }

  for (const inv of data.invoices) {
    if (inv.docType !== "invoice" || !inv.contactId) continue;
    if (wanted && !wanted.has(inv.contactId)) continue;
    if (inv.counterpartCompanyId && internal.has(inv.counterpartCompanyId)) continue;
    const payments = paymentsByInvoice.get(inv.id) ?? [];
    const st = invoiceState(inv, payments, data.today);
    const f = get(inv.contactId);
    f.states.push(st);
    if (st.status === "draft" || st.status === "cancelled") continue;
    f.invoiceCount++;
    const add = (amount: number, date: string) => {
      const c = toBase(data, amount, inv.currency, date);
      if (c.missing) f.missingRate = true;
      return c.value;
    };
    f.invoiced += add(inv.total, inv.issueDate);
    for (const p of payments) {
      f.collected += add(p.amount, p.date);
      if (!f.lastPaymentDate || p.date > f.lastPaymentDate) f.lastPaymentDate = p.date;
    }
    if (st.remaining > 0) {
      const r = add(st.remaining, data.today);
      f.remaining += r;
      f.openCount++;
      if (st.status === "overdue") {
        f.overdue += r;
        f.overdueCount++;
      }
    }
  }

  for (const inc of data.incomes) {
    if (!inc.contactId || (wanted && !wanted.has(inc.contactId))) continue;
    const f = get(inc.contactId);
    const c = toBase(data, inc.amount, inc.currency, inc.date);
    if (c.missing) f.missingRate = true;
    f.collected += c.value;
    if (!f.lastPaymentDate || inc.date > f.lastPaymentDate) f.lastPaymentDate = inc.date;
  }

  for (const f of out.values()) f.states.sort((a, b) => (a.invoice.issueDate < b.invoice.issueDate ? 1 : -1));
  return out;
}

export function contactFinance(data: FinanceData, contactId: string): ContactFinance {
  return contactFinances(data, [contactId]).get(contactId) ?? empty();
}

/* ───────── Pipeline ───────── */

export const STAGE_ORDER = ["lead", "proposal_sent", "negotiation", "won", "lost"] as const;

export interface StageTotal {
  stage: string;
  count: number;
  /** Montant total (devise de base). */
  amount: number;
  /** Montant pondéré par la probabilité (devise de base). */
  weighted: number;
  missingRate: boolean;
}

/** Totaux par étape du pipeline, convertis dans la devise de base au jour J. */
export function pipelineTotals(data: FinanceData, opportunities: { stage: string; amount: number; currency: string; probability: number }[]): Map<string, StageTotal> {
  const out = new Map<string, StageTotal>();
  for (const o of opportunities) {
    const t = out.get(o.stage) ?? { stage: o.stage, count: 0, amount: 0, weighted: 0, missingRate: false };
    const c = toBase(data, o.amount, o.currency, data.today);
    if (c.missing) t.missingRate = true;
    t.count++;
    t.amount += c.value;
    t.weighted += Math.round((c.value * o.probability) / 100);
    out.set(o.stage, t);
  }
  return out;
}

/* ───────── Relances ───────── */

export type FollowUpUrgency = "late" | "today" | "soon";

/** Classe une date de relance par rapport à aujourd'hui (null si hors fenêtre). */
export function followUpUrgency(date: string | null | undefined, today: string, windowDays = 7): FollowUpUrgency | null {
  if (!date) return null;
  if (date < today) return "late";
  if (date === today) return "today";
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + windowDays);
  return date <= limit.toISOString().slice(0, 10) ? "soon" : null;
}
