"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { accountOf, companyOf, formValues, isoDate, money, optStr, OwnershipError, ownedId, str } from "@/lib/guards";
import { addDays, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { invoiceState } from "@/lib/finance/engine";
import type { ActionState } from "@/lib/action-state";
import { createDocument } from "@/lib/documents";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, guessMime } from "@/lib/storage";

function revalidateFinance() {
  revalidatePath("/", "layout");
}

function handle(e: unknown, form: FormData): ActionState {
  if (e instanceof OwnershipError) return { error: "Une des références sélectionnées est invalide.", values: formValues(form) };
  console.error(e);
  return { error: "L'enregistrement a échoué. Vos données n'ont pas été modifiées.", values: formValues(form) };
}

/** Pièce jointe facultative (justificatif) → document de la bibliothèque, usage comptable. */
async function attachReceipt(userId: string, form: FormData, meta: { name: string; companyId: string; activityId: string | null; type: string }) {
  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Fichier trop volumineux (15 Mo maximum).");
  const mimeType = file.type || guessMime(file.name);
  if (!ALLOWED_MIME.has(mimeType)) throw new Error("Format de fichier non pris en charge.");
  return createDocument(userId, { name: meta.name, type: meta.type, usage: "accounting", companyId: meta.companyId, activityId: meta.activityId }, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType });
}

/* ───────────────────────── Recettes directes ───────────────────────── */

export async function createIncome(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez une structure."] }, values: formValues(form) };
    const accountId = ownedId(schema.accounts, form.get("accountId"), user.id);
    const account = accountOf(accountId);
    const currency = account?.currency ?? str(form, "currency") ?? companyOf(companyId)!.currency;
    const amount = money(form, "amount", currency);
    const date = isoDate(form, "date");
    const description = str(form, "description");
    const errors: Record<string, string[]> = {};
    if (!amount || amount <= 0) errors.amount = ["Indiquez un montant positif."];
    if (!date) errors.date = ["Date invalide."];
    if (!description) errors.description = ["Décrivez la recette en quelques mots."];
    if (account && account.companyId !== companyId) errors.accountId = ["Ce compte appartient à une autre structure."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };
    const id = newId("inc_");
    const activityId = ownedId(schema.activities, form.get("activityId"), user.id);
    const contactId = ownedId(schema.contacts, form.get("contactId"), user.id);
    const documentId = await attachReceipt(user.id, form, { name: `Justificatif — ${description}`, companyId, activityId, type: "receipt" });
    const row = {
      id, userId: user.id, companyId, accountId, currency, amount: amount!, date: date!, description,
      activityId, contactId, categoryId: ownedId(schema.categories, form.get("categoryId"), user.id),
      method: str(form, "method") || "bank_transfer", reference: optStr(form, "reference"), documentId,
    };
    db.insert(schema.incomes).values(row).run();
    if (contactId) db.insert(schema.interactions).values({ id: newId("ix_"), userId: user.id, contactId, type: "payment_received", date: date!, title: `Recette enregistrée — ${formatMoney(amount!, currency)}`, refType: "income", refId: id }).run();
    audit(user.id, "income", id, "create", undefined, row);
    revalidateFinance();
    return { ok: true, id, message: `Recette de ${formatMoney(amount!, currency)} enregistrée.` };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Fichier") || e instanceof Error && e.message.startsWith("Format")) return { error: e.message, values: formValues(form) };
    return handle(e, form);
  }
}

export async function deleteIncome(id: string) {
  const user = await requireUser();
  const row = db.select().from(schema.incomes).where(and(eq(schema.incomes.id, id), eq(schema.incomes.userId, user.id))).get();
  if (!row) return;
  db.delete(schema.incomes).where(eq(schema.incomes.id, id)).run();
  audit(user.id, "income", id, "delete", row);
  revalidateFinance();
}

/* ───────────────────────── Dépenses ───────────────────────── */

function findDuplicateExpense(userId: string, amount: number, currency: string, date: string, supplier: string | null, label: string, excludeId?: string) {
  const candidates = db.select().from(schema.expenses).where(and(eq(schema.expenses.userId, userId), eq(schema.expenses.amount, amount), eq(schema.expenses.currency, currency), ne(schema.expenses.status, "cancelled"))).all();
  const norm = (s: string | null) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  return candidates.find((c) => c.id !== excludeId && Math.abs(Date.parse(c.date) - Date.parse(date)) <= 3 * 86400000 && (norm(c.supplier) === norm(supplier) || norm(c.label) === norm(label)));
}

export async function createExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez une structure."] }, values: formValues(form) };
    const accountId = ownedId(schema.accounts, form.get("accountId"), user.id);
    const account = accountOf(accountId);
    const currency = account?.currency ?? (str(form, "currency") || companyOf(companyId)!.currency);
    const amount = money(form, "amount", currency);
    const date = isoDate(form, "date");
    const label = str(form, "label");
    const supplier = optStr(form, "supplier");
    const status = str(form, "status") === "planned" ? "planned" : "paid";
    const dueDate = isoDate(form, "dueDate");
    const recurring = str(form, "frequency");
    const errors: Record<string, string[]> = {};
    if (!amount || amount <= 0) errors.amount = ["Indiquez un montant positif."];
    if (!date) errors.date = ["Date invalide."];
    if (!label) errors.label = ["Donnez un libellé à la dépense."];
    if (status === "planned" && !dueDate && !recurring) errors.dueDate = ["Indiquez l'échéance de paiement."];
    if (account && account.companyId !== companyId) errors.accountId = ["Ce compte appartient à une autre structure."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };

    if (str(form, "confirmDuplicate") !== "1") {
      const dup = findDuplicateExpense(user.id, amount!, currency, date!, supplier, label);
      if (dup) {
        return {
          warning: `Doublon possible : « ${dup.label} » de ${formatMoney(dup.amount, dup.currency)} existe déjà le ${dup.date}. Enregistrez à nouveau pour confirmer qu'il s'agit d'une autre dépense.`,
          values: { ...formValues(form), confirmDuplicate: "1" },
        };
      }
    }

    const activityId = ownedId(schema.activities, form.get("activityId"), user.id);
    const allocationRuleId = activityId ? null : ownedId(schema.allocationRules, form.get("allocationRuleId"), user.id);
    const categoryId = ownedId(schema.categories, form.get("categoryId"), user.id);
    const costType = str(form, "costType") === "direct" && activityId ? "direct" : "overhead";
    const documentId = await attachReceipt(user.id, form, { name: `Justificatif — ${label}${supplier ? ` (${supplier})` : ""}`, companyId, activityId, type: "receipt" });
    const method = str(form, "method") || "bank_transfer";
    const counterpartCompanyId = ownedId(schema.companies, form.get("counterpartCompanyId"), user.id);

    let recurringId: string | null = null;
    if (["monthly", "quarterly", "yearly"].includes(recurring)) {
      recurringId = newId("rec_");
      db.insert(schema.recurringExpenses).values({
        id: recurringId, userId: user.id, companyId, activityId, allocationRuleId, categoryId, label, supplier, amount: amount!, currency,
        frequency: recurring, startDate: status === "planned" ? dueDate ?? date! : date!, endDate: isoDate(form, "endDate"), accountId, method,
        remindDaysBefore: Number(str(form, "remindDaysBefore") || 3),
      }).run();
      audit(user.id, "recurring_expense", recurringId, "create");
    }

    const id = newId("exp_");
    const firstOccurrence = recurringId ? (status === "planned" ? dueDate ?? date! : date!) : null;
    const row = {
      id, userId: user.id, companyId, activityId, allocationRuleId, categoryId, label, supplier, amount: amount!, currency, date: date!,
      dueDate: status === "planned" ? dueDate ?? date! : dueDate, status, paidDate: status === "paid" ? isoDate(form, "paidDate") ?? date! : null,
      method, accountId, costType, note: optStr(form, "note"), documentId, recurringId, occurrenceDate: firstOccurrence, counterpartCompanyId,
    };
    // Une récurrence future n'a pas besoin d'occurrence « prévue » en base : le moteur la projette.
    if (!(recurringId && status === "planned")) db.insert(schema.expenses).values(row).run();
    audit(user.id, "expense", id, "create", undefined, row);
    revalidateFinance();
    const msg = recurringId
      ? `Charge récurrente créée : ${formatMoney(amount!, currency)} ${recurring === "monthly" ? "par mois" : recurring === "quarterly" ? "par trimestre" : "par an"}. Elle apparaît dans vos prévisions.`
      : status === "planned" ? `Dépense prévue de ${formatMoney(amount!, currency)} enregistrée — elle n'est pas comptée comme payée.` : `Dépense de ${formatMoney(amount!, currency)} enregistrée.`;
    return { ok: true, id, message: msg };
  } catch (e) {
    if (e instanceof Error && (e.message.startsWith("Fichier") || e.message.startsWith("Format"))) return { error: e.message, values: formValues(form) };
    return handle(e, form);
  }
}

export async function updateExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "id");
  const before = db.select().from(schema.expenses).where(and(eq(schema.expenses.id, id), eq(schema.expenses.userId, user.id))).get();
  if (!before) return { error: "Dépense introuvable." };
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id) ?? before.companyId;
    const accountId = ownedId(schema.accounts, form.get("accountId"), user.id);
    const account = accountOf(accountId);
    const currency = account?.currency ?? before.currency;
    const amount = money(form, "amount", currency);
    const date = isoDate(form, "date");
    const label = str(form, "label");
    const status = ["paid", "planned", "cancelled"].includes(str(form, "status")) ? str(form, "status") : before.status;
    const errors: Record<string, string[]> = {};
    if (!amount || amount <= 0) errors.amount = ["Indiquez un montant positif."];
    if (!date) errors.date = ["Date invalide."];
    if (!label) errors.label = ["Libellé requis."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };
    const activityId = ownedId(schema.activities, form.get("activityId"), user.id);
    const after = {
      companyId, accountId, currency, amount: amount!, date: date!, label, supplier: optStr(form, "supplier"), status,
      dueDate: isoDate(form, "dueDate"), paidDate: status === "paid" ? isoDate(form, "paidDate") ?? before.paidDate ?? date! : null,
      activityId, allocationRuleId: activityId ? null : ownedId(schema.allocationRules, form.get("allocationRuleId"), user.id),
      categoryId: ownedId(schema.categories, form.get("categoryId"), user.id), costType: str(form, "costType") === "direct" && activityId ? "direct" : "overhead",
      method: str(form, "method") || before.method, note: optStr(form, "note"), updatedAt: new Date().toISOString(),
    };
    db.update(schema.expenses).set(after).where(eq(schema.expenses.id, id)).run();
    audit(user.id, "expense", id, "update", before, after);
    revalidateFinance();
    return { ok: true, id, message: "Dépense mise à jour." };
  } catch (e) {
    return handle(e, form);
  }
}

/** Marque une dépense prévue comme payée (avec date et compte réels). */
export async function markExpensePaid(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "id");
  const before = db.select().from(schema.expenses).where(and(eq(schema.expenses.id, id), eq(schema.expenses.userId, user.id))).get();
  if (!before) return { error: "Dépense introuvable." };
  if (before.status === "paid") return { error: "Cette dépense est déjà marquée comme payée." };
  try {
    const accountId = ownedId(schema.accounts, form.get("accountId"), user.id) ?? before.accountId;
    const paidDate = isoDate(form, "paidDate") ?? todayISO();
    const amount = money(form, "amount", before.currency) ?? before.amount;
    db.update(schema.expenses).set({ status: "paid", paidDate, accountId, amount, updatedAt: new Date().toISOString() }).where(eq(schema.expenses.id, id)).run();
    audit(user.id, "expense", id, "mark_paid", before, { paidDate, accountId, amount });
    revalidateFinance();
    return { ok: true, message: `Paiement de ${formatMoney(amount, before.currency)} confirmé.` };
  } catch (e) {
    return handle(e, form);
  }
}

/** Confirme (ou ignore) une échéance de charge récurrente. Contrainte d'unicité : impossible de la payer deux fois. */
export async function confirmOccurrence(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const recurringId = str(form, "recurringId");
  const occurrenceDate = isoDate(form, "occurrenceDate");
  const rec = db.select().from(schema.recurringExpenses).where(and(eq(schema.recurringExpenses.id, recurringId), eq(schema.recurringExpenses.userId, user.id))).get();
  if (!rec || !occurrenceDate) return { error: "Échéance introuvable." };
  const existing = db.select().from(schema.expenses).where(and(eq(schema.expenses.recurringId, rec.id), eq(schema.expenses.occurrenceDate, occurrenceDate))).get();
  if (existing) return { error: existing.status === "cancelled" ? "Cette échéance a déjà été ignorée." : "Cette échéance a déjà été confirmée — aucun double paiement enregistré." };
  try {
    const skip = str(form, "decision") === "skip";
    const accountId = ownedId(schema.accounts, form.get("accountId"), user.id) ?? rec.accountId;
    const account = accountOf(accountId);
    const currency = account?.currency ?? rec.currency;
    const amount = money(form, "amount", currency) ?? rec.amount;
    const paidDate = isoDate(form, "paidDate") ?? todayISO();
    const id = newId("exp_");
    db.insert(schema.expenses).values({
      id, userId: user.id, companyId: rec.companyId, activityId: rec.activityId, allocationRuleId: rec.allocationRuleId, categoryId: rec.categoryId,
      label: rec.label, supplier: rec.supplier, amount, currency, date: occurrenceDate, dueDate: occurrenceDate,
      status: skip ? "cancelled" : "paid", paidDate: skip ? null : paidDate, accountId, method: rec.method,
      costType: rec.activityId ? "direct" : "overhead", recurringId: rec.id, occurrenceDate, note: skip ? optStr(form, "note") ?? "Échéance ignorée" : null,
    }).run();
    audit(user.id, "expense", id, skip ? "skip_occurrence" : "confirm_occurrence", undefined, { recurringId, occurrenceDate, amount });
    revalidateFinance();
    return { ok: true, message: skip ? `Échéance du ${occurrenceDate} ignorée.` : `${rec.label} : paiement de ${formatMoney(amount, currency)} confirmé.` };
  } catch (e) {
    return handle(e, form);
  }
}

export async function toggleRecurring(id: string, active: boolean) {
  const user = await requireUser();
  const before = db.select().from(schema.recurringExpenses).where(and(eq(schema.recurringExpenses.id, id), eq(schema.recurringExpenses.userId, user.id))).get();
  if (!before) return;
  db.update(schema.recurringExpenses).set({ active, endDate: active ? null : todayISO() }).where(eq(schema.recurringExpenses.id, id)).run();
  audit(user.id, "recurring_expense", id, active ? "resume" : "stop", before);
  revalidateFinance();
}

export async function updateRecurring(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "id");
  const before = db.select().from(schema.recurringExpenses).where(and(eq(schema.recurringExpenses.id, id), eq(schema.recurringExpenses.userId, user.id))).get();
  if (!before) return { error: "Charge introuvable." };
  try {
    const amount = money(form, "amount", before.currency);
    if (!amount || amount <= 0) return { fieldErrors: { amount: ["Montant invalide."] }, values: formValues(form) };
    const after = {
      label: str(form, "label") || before.label, supplier: optStr(form, "supplier"), amount,
      frequency: ["monthly", "quarterly", "yearly"].includes(str(form, "frequency")) ? str(form, "frequency") : before.frequency,
      endDate: isoDate(form, "endDate"), remindDaysBefore: Number(str(form, "remindDaysBefore") || before.remindDaysBefore),
      activityId: ownedId(schema.activities, form.get("activityId"), user.id),
      allocationRuleId: ownedId(schema.allocationRules, form.get("allocationRuleId"), user.id),
      categoryId: ownedId(schema.categories, form.get("categoryId"), user.id),
    };
    db.update(schema.recurringExpenses).set(after).where(eq(schema.recurringExpenses.id, id)).run();
    audit(user.id, "recurring_expense", id, "update", before, after);
    revalidateFinance();
    return { ok: true, message: "Charge récurrente mise à jour. Les prévisions en tiennent compte." };
  } catch (e) {
    return handle(e, form);
  }
}

/** Suppression « douce » : une dépense payée est annulée (tracée), jamais effacée silencieusement. */
export async function cancelExpense(id: string) {
  const user = await requireUser();
  const before = db.select().from(schema.expenses).where(and(eq(schema.expenses.id, id), eq(schema.expenses.userId, user.id))).get();
  if (!before) return;
  db.update(schema.expenses).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(schema.expenses.id, id)).run();
  audit(user.id, "expense", id, "cancel", before);
  revalidateFinance();
}

/* ───────────────────────── Paiements de factures ───────────────────────── */

export async function recordPayment(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const invoiceId = str(form, "invoiceId");
  const inv = db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.userId, user.id))).get();
  if (!inv) return { fieldErrors: { invoiceId: ["Choisissez une facture."] }, values: formValues(form) };
  if (inv.docType !== "invoice") return { error: "Un devis ne peut pas recevoir de paiement : transformez-le d'abord en facture." };
  if (inv.status === "cancelled") return { error: "Cette facture est annulée." };
  try {
    const amount = money(form, "amount", inv.currency);
    const fees = money(form, "fees", inv.currency) ?? 0;
    const date = isoDate(form, "date");
    const accountId = ownedId(schema.accounts, form.get("accountId"), user.id);
    const account = accountOf(accountId);
    const existing = db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id)).all();
    const state = invoiceState(inv, existing, todayISO());
    const errors: Record<string, string[]> = {};
    if (!amount || amount <= 0) errors.amount = ["Indiquez le montant reçu."];
    else if (amount > state.remaining) errors.amount = [`Le montant dépasse le restant dû (${formatMoney(state.remaining, inv.currency)}). Vérifiez qu'il ne s'agit pas d'un double paiement.`];
    if (!date) errors.date = ["Date invalide."];
    if (fees < 0 || (amount && fees >= amount)) errors.fees = ["Frais invalides."];
    if (account && account.companyId !== inv.companyId) errors.accountId = ["Ce compte appartient à une autre structure que la facture."];
    if (account && account.currency !== inv.currency) errors.accountId = [`Le compte est en ${account.currency}, la facture en ${inv.currency}. Choisissez un compte dans la devise de la facture.`];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };
    const reference = optStr(form, "reference");
    if (str(form, "confirmDuplicate") !== "1") {
      const dup = existing.find((p) => p.amount === amount && (p.date === date || (reference && p.reference === reference)));
      if (dup) return { warning: `Un paiement identique (${formatMoney(dup.amount, inv.currency)} le ${dup.date}) existe déjà. Validez à nouveau pour confirmer.`, values: { ...formValues(form), confirmDuplicate: "1" } };
    }
    const id = newId("pay_");
    const row = { id, userId: user.id, invoiceId: inv.id, date: date!, amount: amount!, fees, accountId, method: str(form, "method") || "bank_transfer", reference };
    db.transaction((tx) => {
      tx.insert(schema.payments).values(row).run();
      if (inv.status === "draft") tx.update(schema.invoices).set({ status: "sent", sentAt: inv.sentAt ?? date }).where(eq(schema.invoices.id, inv.id)).run();
      if (inv.contactId) tx.insert(schema.interactions).values({ id: newId("ix_"), userId: user.id, contactId: inv.contactId, type: "payment_received", date: date!, title: `Paiement reçu — ${inv.number} (${formatMoney(amount!, inv.currency)})`, refType: "invoice", refId: inv.id }).run();
    });
    audit(user.id, "payment", id, "create", undefined, row);
    const remaining = state.remaining - amount!;
    revalidateFinance();
    return { ok: true, id, message: remaining > 0 ? `Paiement enregistré. Reste dû : ${formatMoney(remaining, inv.currency)}.` : `Facture ${inv.number} soldée.` };
  } catch (e) {
    return handle(e, form);
  }
}

export async function deletePayment(id: string) {
  const user = await requireUser();
  const row = db.select().from(schema.payments).where(and(eq(schema.payments.id, id), eq(schema.payments.userId, user.id))).get();
  if (!row) return;
  db.delete(schema.payments).where(eq(schema.payments.id, id)).run();
  audit(user.id, "payment", id, "delete", row);
  revalidateFinance();
}

/* ───────────────────────── Transferts ───────────────────────── */

export async function createTransfer(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const fromId = ownedId(schema.accounts, form.get("fromAccountId"), user.id);
    const toId = ownedId(schema.accounts, form.get("toAccountId"), user.id);
    const from = accountOf(fromId);
    const to = accountOf(toId);
    if (!from || !to || from.id === to.id) return { fieldErrors: { toAccountId: ["Choisissez deux comptes différents."] }, values: formValues(form) };
    const amount = money(form, "amount", from.currency);
    const toAmount = from.currency === to.currency ? amount : money(form, "toAmount", to.currency);
    const date = isoDate(form, "date");
    if (!amount || amount <= 0) return { fieldErrors: { amount: ["Montant invalide."] }, values: formValues(form) };
    if (!toAmount || toAmount <= 0) return { fieldErrors: { toAmount: [`Indiquez le montant reçu en ${to.currency}.`] }, values: formValues(form) };
    if (!date) return { fieldErrors: { date: ["Date invalide."] }, values: formValues(form) };
    const fromCo = companyOf(from.companyId)!;
    const toCo = companyOf(to.companyId)!;
    let nature = str(form, "nature");
    if (from.companyId === to.companyId) nature = "internal";
    else if (!["owner_draw", "owner_contribution", "intercompany"].includes(nature)) nature = fromCo.kind !== "personal" && toCo.kind === "personal" ? "owner_draw" : fromCo.kind === "personal" ? "owner_contribution" : "intercompany";
    const id = newId("trf_");
    const row = { id, userId: user.id, fromAccountId: from.id, toAccountId: to.id, date, amount, toAmount, nature, note: optStr(form, "note") };
    db.insert(schema.transfers).values(row).run();
    audit(user.id, "transfer", id, "create", undefined, row);
    revalidateFinance();
    return { ok: true, id, message: "Transfert enregistré. Il n'est compté ni comme revenu ni comme dépense en vue consolidée." };
  } catch (e) {
    return handle(e, form);
  }
}

export async function deleteTransfer(id: string) {
  const user = await requireUser();
  const row = db.select().from(schema.transfers).where(and(eq(schema.transfers.id, id), eq(schema.transfers.userId, user.id))).get();
  if (!row) return;
  db.delete(schema.transfers).where(eq(schema.transfers.id, id)).run();
  audit(user.id, "transfer", id, "delete", row);
  revalidateFinance();
}

/* ───────────────────────── Alertes ───────────────────────── */

export async function dismissAlert(key: string, days = 7) {
  const user = await requireUser();
  db.insert(schema.alertDismissals).values({ id: newId("ad_"), userId: user.id, alertKey: key, until: addDays(todayISO(), days) }).run();
  revalidatePath("/");
}
