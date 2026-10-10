"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { companyOf, formValues, isoDate, optStr, OwnershipError, ownedId, str } from "@/lib/guards";
import { addDays, daysBetween, todayISO } from "@/lib/dates";
import { CURRENCIES, formatMoney, parseAmount } from "@/lib/money";
import { invoiceState } from "@/lib/finance/engine";
import type { ActionState } from "@/lib/action-state";
import { createDocument } from "@/lib/documents";
import { sha256 } from "@/lib/storage";
import { computeTotals, nextNumber, parseLines, sameParty, type RawLine } from "@/lib/invoices";
import { extractInvoice, ExtractionError, IMPORT_MAX_BYTES, IMPORT_MIME, type ExtractionResult } from "@/lib/extract";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type LineRow = typeof schema.invoiceLines.$inferSelect;

function revalidateAll() {
  revalidatePath("/", "layout");
}

function handle(e: unknown, form: FormData): ActionState {
  if (e instanceof OwnershipError) return { error: "Une des références sélectionnées est invalide.", values: formValues(form) };
  console.error(e);
  return { error: "L'enregistrement a échoué. Vos données n'ont pas été modifiées.", values: formValues(form) };
}

function loadInvoice(userId: string, id: string) {
  return db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.userId, userId))).get();
}

function loadLines(invoiceId: string): LineRow[] {
  return db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).orderBy(asc(schema.invoiceLines.position)).all();
}

function paymentsOf(invoiceId: string) {
  return db.select().from(schema.payments).where(eq(schema.payments.invoiceId, invoiceId)).all();
}

const label = (inv: { docType: string }) => (inv.docType === "quote" ? "Devis" : "Facture");

/** Prochain numéro libre pour une structure et un type de document. */
function allocateNumber(companyId: string, docType: "invoice" | "quote", issueDate: string): string {
  const company = companyOf(companyId)!;
  const prefix = docType === "quote" ? company.quotePrefix : company.invoicePrefix;
  const existing = db.select({ number: schema.invoices.number }).from(schema.invoices)
    .where(and(eq(schema.invoices.companyId, companyId), eq(schema.invoices.docType, docType))).all().map((r) => r.number);
  return nextNumber(prefix, issueDate.slice(0, 4), existing);
}

function isUniqueViolation(e: unknown) {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

/** Inscrit l'émission dans l'historique du client (une seule fois par document). */
function logIssued(userId: string, inv: InvoiceRow, date: string) {
  if (!inv.contactId) return;
  const type = inv.docType === "quote" ? "quote_sent" : "invoice_issued";
  const exists = db.select({ id: schema.interactions.id }).from(schema.interactions)
    .where(and(eq(schema.interactions.userId, userId), eq(schema.interactions.refType, "invoice"), eq(schema.interactions.refId, inv.id), eq(schema.interactions.type, type))).get();
  if (exists) return;
  db.insert(schema.interactions).values({
    id: newId("ix_"), userId, contactId: inv.contactId, type, date,
    title: `${label(inv)} ${inv.number} ${inv.docType === "quote" ? "envoyé" : "émise"} — ${formatMoney(inv.total, inv.currency)}`,
    details: inv.title, refType: "invoice", refId: inv.id,
  }).run();
}

/* ───────────────────────── Création / modification ───────────────────────── */

/**
 * Crée ou met à jour une facture / un devis. Les totaux sont TOUJOURS recalculés ici depuis les lignes.
 * `intent` = "draft" (brouillon) ou "send" (marquer comme envoyé).
 */
export async function saveInvoice(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const id = str(form, "id");
    const before = id ? loadInvoice(user.id, id) : undefined;
    if (id && !before) return { error: "Document introuvable." };
    if (before?.status === "cancelled") return { error: "Ce document est annulé : il ne peut plus être modifié." };
    const docType: "invoice" | "quote" = before ? (before.docType as "invoice" | "quote") : str(form, "docType") === "quote" ? "quote" : "invoice";

    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    const errors: Record<string, string[]> = {};
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez la structure qui facture."] }, values: formValues(form) };
    const company = companyOf(companyId)!;
    const currency = str(form, "currency") || company.currency;
    if (!(currency in CURRENCIES)) errors.currency = ["Devise non prise en charge."];

    let raw: RawLine[] = [];
    try {
      const parsed = JSON.parse(str(form, "lines") || "[]");
      if (Array.isArray(parsed)) raw = parsed.slice(0, 200).map((l) => ({ description: String(l?.description ?? ""), quantity: String(l?.quantity ?? ""), unitPrice: String(l?.unitPrice ?? ""), taxRate: String(l?.taxRate ?? "") }));
    } catch {
      errors.lines = ["Lignes illisibles : rechargez la page."];
    }
    const { lines, errors: lineErrors } = parseLines(raw, currency);
    if (lineErrors.length) errors.lines = lineErrors;

    const issueDate = isoDate(form, "issueDate");
    if (!issueDate) errors.issueDate = ["Date d'émission invalide."];
    const dueDate = isoDate(form, "dueDate") ?? (issueDate ? addDays(issueDate, company.paymentTermsDays) : null);
    if (issueDate && dueDate && dueDate < issueDate) errors.dueDate = [docType === "quote" ? "La validité ne peut pas précéder la date d'émission." : "L'échéance ne peut pas précéder la date d'émission."];

    const activityId = ownedId(schema.activities, form.get("activityId"), user.id);
    const brandId = ownedId(schema.brands, form.get("brandId"), user.id);
    const contactId = ownedId(schema.contacts, form.get("contactId"), user.id);
    const opportunityId = ownedId(schema.opportunities, form.get("opportunityId"), user.id);
    const counterpartCompanyId = ownedId(schema.companies, form.get("counterpartCompanyId"), user.id);
    if (counterpartCompanyId && counterpartCompanyId === companyId) errors.counterpartCompanyId = ["Une structure ne peut pas se facturer elle-même."];
    if (!contactId && !counterpartCompanyId) errors.contactId = ["Choisissez le client (ou une de vos structures)."];
    if (activityId) {
      const act = db.select().from(schema.activities).where(eq(schema.activities.id, activityId)).get();
      if (act && act.companyId !== companyId) errors.activityId = ["Cette activité appartient à une autre structure."];
    }
    if (brandId) {
      const br = db.select().from(schema.brands).where(eq(schema.brands.id, brandId)).get();
      if (br && br.companyId !== companyId) errors.brandId = ["Cette enseigne appartient à une autre structure."];
    }

    const totals = computeTotals(lines);
    const plainLines = totals.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate }));
    if (!errors.lines && totals.total <= 0) errors.lines = ["Le total doit être positif."];

    if (before) {
      const pays = paymentsOf(before.id);
      const paid = pays.reduce((a, p) => a + p.amount, 0);
      if (pays.length && currency !== before.currency) errors.currency = [`Des paiements sont déjà enregistrés en ${before.currency} : la devise ne peut plus changer.`];
      if (pays.length && before.companyId !== companyId) errors.companyId = ["Des paiements sont déjà enregistrés : la structure ne peut plus changer."];
      if (totals.total < paid) errors.lines = [`Le total (${formatMoney(totals.total, currency)}) ne peut pas être inférieur au montant déjà encaissé (${formatMoney(paid, before.currency)}).`];
    }
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form), error: "Vérifiez les champs signalés." };

    const intent = str(form, "intent") === "send" ? "send" : "draft";
    const now = new Date().toISOString();
    const common = {
      companyId, activityId, brandId, contactId: counterpartCompanyId ? null : contactId, opportunityId, counterpartCompanyId,
      title: optStr(form, "title"), issueDate: issueDate!, dueDate: dueDate!, currency, notes: optStr(form, "notes"),
      total: totals.total, subtotal: totals.subtotal, taxTotal: totals.taxTotal,
    };
    const lineRows = (invoiceId: string) => totals.lines.map((l, i) => ({ id: newId("il_"), invoiceId, position: i, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate }));

    if (before) {
      const beforeLines = loadLines(before.id);
      // Un brouillon déplacé vers une autre structure ou une autre année reçoit un nouveau numéro.
      let number = before.number;
      if (before.status === "draft" && (before.companyId !== companyId || before.number.split("-").at(-2) !== issueDate!.slice(0, 4))) {
        number = allocateNumber(companyId, docType, issueDate!);
      }
      const status = intent === "send" && before.status === "draft" ? "sent" : before.status;
      const patch = { ...common, number, status, sentAt: status === "sent" && !before.sentAt ? todayISO() : before.sentAt, updatedAt: now };
      db.transaction((tx) => {
        tx.update(schema.invoices).set(patch).where(eq(schema.invoices.id, before.id)).run();
        tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, before.id)).run();
        const rows = lineRows(before.id);
        if (rows.length) tx.insert(schema.invoiceLines).values(rows).run();
      });
      const after = loadInvoice(user.id, before.id)!;
      audit(user.id, "invoice", before.id, "update", { ...before, lines: beforeLines.map(stripLine) }, { ...after, lines: plainLines });
      if (after.status === "sent") logIssued(user.id, after, after.sentAt ?? todayISO());
      revalidateAll();
      return { ok: true, id: before.id, message: `${label(after)} ${after.number} enregistré${docType === "quote" ? "" : "e"}.` };
    }

    const newIdValue = newId("inv_");
    let created: InvoiceRow | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const number = allocateNumber(companyId, docType, issueDate!);
      try {
        db.transaction((tx) => {
          tx.insert(schema.invoices).values({
            id: newIdValue, userId: user.id, docType, number, ...common,
            status: intent === "send" ? "sent" : "draft", sentAt: intent === "send" ? todayISO() : null, source: "created",
            convertedFromId: null,
          }).run();
          const rows = lineRows(newIdValue);
          if (rows.length) tx.insert(schema.invoiceLines).values(rows).run();
        });
        created = loadInvoice(user.id, newIdValue);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    if (!created) return { error: "Impossible d'attribuer un numéro unique. Réessayez.", values: formValues(form) };
    audit(user.id, "invoice", created.id, "create", undefined, { ...created, lines: plainLines });
    if (created.status === "sent") logIssued(user.id, created, created.sentAt ?? todayISO());
    revalidateAll();
    return { ok: true, id: created.id, message: `${label(created)} ${created.number} ${created.status === "sent" ? (docType === "quote" ? "créé et marqué comme envoyé" : "créée et marquée comme envoyée") : docType === "quote" ? "enregistré en brouillon" : "enregistrée en brouillon"}.` };
  } catch (e) {
    return handle(e, form);
  }
}

function stripLine(l: LineRow) {
  return { description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate };
}

/* ───────────────────────── Cycle de vie ───────────────────────── */

export async function markInvoiceSent(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const inv = loadInvoice(user.id, id);
  if (!inv) return { error: "Document introuvable." };
  if (inv.status !== "draft") return { error: "Ce document n'est plus un brouillon." };
  if (inv.total <= 0) return { error: "Ajoutez au moins une ligne avant d'envoyer." };
  const sentAt = todayISO();
  db.update(schema.invoices).set({ status: "sent", sentAt, updatedAt: new Date().toISOString() }).where(eq(schema.invoices.id, id)).run();
  audit(user.id, "invoice", id, "send", { status: inv.status }, { status: "sent", sentAt });
  logIssued(user.id, { ...inv, status: "sent", sentAt }, sentAt);
  revalidateAll();
  return {};
}

/** Annule une facture ou un devis. Jamais de suppression : la facture reste visible, barrée. */
export async function cancelInvoice(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const inv = loadInvoice(user.id, id);
  if (!inv) return { error: "Document introuvable." };
  if (inv.status === "cancelled") return {};
  if (inv.docType === "invoice" && paymentsOf(id).length) {
    return { error: "Cette facture a reçu des paiements : supprimez d'abord les paiements concernés si elle doit être annulée." };
  }
  db.update(schema.invoices).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(schema.invoices.id, id)).run();
  audit(user.id, "invoice", id, "cancel", { status: inv.status }, { status: "cancelled" });
  revalidateAll();
  return {};
}

/** Suppression définitive réservée aux brouillons sans paiement (erreur de saisie). */
export async function deleteDraftInvoice(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const inv = loadInvoice(user.id, id);
  if (!inv) return { error: "Document introuvable." };
  if (inv.status !== "draft") return { error: "Seuls les brouillons peuvent être supprimés. Annulez plutôt ce document." };
  if (paymentsOf(id).length) return { error: "Ce document a des paiements : il ne peut pas être supprimé." };
  const lines = loadLines(id);
  db.transaction((tx) => {
    tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id)).run();
    tx.delete(schema.invoices).where(eq(schema.invoices.id, id)).run();
  });
  audit(user.id, "invoice", id, "delete", { ...inv, lines: lines.map(stripLine) });
  revalidateAll();
  return {};
}

export async function setQuoteStatus(id: string, status: "accepted" | "declined" | "sent"): Promise<{ error?: string }> {
  const user = await requireUser();
  const inv = loadInvoice(user.id, id);
  if (!inv || inv.docType !== "quote") return { error: "Devis introuvable." };
  if (inv.status === "cancelled") return { error: "Ce devis est annulé." };
  if (!["accepted", "declined", "sent"].includes(status)) return { error: "Statut invalide." };
  db.update(schema.invoices).set({ status, sentAt: inv.sentAt ?? todayISO(), updatedAt: new Date().toISOString() }).where(eq(schema.invoices.id, id)).run();
  audit(user.id, "invoice", id, "update", { status: inv.status }, { status });
  if (inv.contactId && status !== "sent") {
    db.insert(schema.interactions).values({
      id: newId("ix_"), userId: user.id, contactId: inv.contactId, type: "note", date: todayISO(),
      title: `Devis ${inv.number} ${status === "accepted" ? "accepté" : "refusé"}`, refType: "invoice", refId: inv.id,
    }).run();
  }
  if (status === "accepted" && inv.opportunityId) {
    const opp = db.select().from(schema.opportunities).where(and(eq(schema.opportunities.id, inv.opportunityId), eq(schema.opportunities.userId, user.id))).get();
    if (opp && !["won", "lost"].includes(opp.stage)) {
      db.update(schema.opportunities).set({ stage: "won", closedAt: todayISO() }).where(eq(schema.opportunities.id, opp.id)).run();
      audit(user.id, "opportunity", opp.id, "update", { stage: opp.stage }, { stage: "won" });
    }
  }
  revalidateAll();
  return {};
}

/** Copie un document (lignes comprises) en nouveau brouillon daté du jour. */
function copyAsDraft(userId: string, src: InvoiceRow, docType: "invoice" | "quote", convertedFromId: string | null): InvoiceRow | null {
  const lines = loadLines(src.id);
  const company = companyOf(src.companyId);
  if (!company) return null;
  const issueDate = todayISO();
  const span = docType === "invoice" && src.docType === "quote" ? company.paymentTermsDays : Math.max(0, daysBetween(src.issueDate, src.dueDate));
  const id = newId("inv_");
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = allocateNumber(src.companyId, docType, issueDate);
    try {
      db.transaction((tx) => {
        tx.insert(schema.invoices).values({
          id, userId, companyId: src.companyId, activityId: src.activityId, brandId: src.brandId, contactId: src.contactId,
          opportunityId: src.opportunityId, docType, number, title: src.title, issueDate, dueDate: addDays(issueDate, span),
          currency: src.currency, total: src.total, subtotal: src.subtotal, taxTotal: src.taxTotal, status: "draft", sentAt: null,
          notes: src.notes, source: "created", documentId: null, counterpartCompanyId: src.counterpartCompanyId, convertedFromId,
        }).run();
        if (lines.length) tx.insert(schema.invoiceLines).values(lines.map((l) => ({ ...l, id: newId("il_"), invoiceId: id }))).run();
      });
      return loadInvoice(userId, id) ?? null;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return null;
}

export async function duplicateInvoice(id: string): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const src = loadInvoice(user.id, id);
  if (!src) return { error: "Document introuvable." };
  const copy = copyAsDraft(user.id, src, src.docType as "invoice" | "quote", null);
  if (!copy) return { error: "La duplication a échoué." };
  audit(user.id, "invoice", copy.id, "create", undefined, { ...copy, duplicatedFrom: src.id });
  revalidateAll();
  return { id: copy.id };
}

export async function convertQuoteToInvoice(id: string): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const quote = loadInvoice(user.id, id);
  if (!quote || quote.docType !== "quote") return { error: "Devis introuvable." };
  if (quote.status === "cancelled" || quote.status === "declined") return { error: "Un devis annulé ou refusé ne peut pas être transformé en facture." };
  const already = db.select({ id: schema.invoices.id, number: schema.invoices.number }).from(schema.invoices)
    .where(and(eq(schema.invoices.userId, user.id), eq(schema.invoices.convertedFromId, quote.id), ne(schema.invoices.status, "cancelled"))).get();
  if (already) return { error: `Ce devis a déjà été transformé en facture (${already.number}).`, id: already.id };
  const inv = copyAsDraft(user.id, quote, "invoice", quote.id);
  if (!inv) return { error: "La transformation a échoué." };
  if (quote.status !== "accepted") db.update(schema.invoices).set({ status: "accepted", updatedAt: new Date().toISOString() }).where(eq(schema.invoices.id, quote.id)).run();
  audit(user.id, "invoice", inv.id, "create", undefined, { ...inv, convertedFrom: quote.number });
  audit(user.id, "invoice", quote.id, "convert", { status: quote.status }, { status: "accepted", invoiceId: inv.id });
  revalidateAll();
  return { id: inv.id };
}

/* ───────────────────────── Importation ───────────────────────── */

export interface ImportAnalysis {
  ok?: boolean;
  error?: string;
  /** Code d'erreur pour adapter l'action de reprise. */
  code?: "too_large" | "unsupported" | "unreadable_pdf" | "empty" | "failed";
  extraction?: ExtractionResult;
  sha256?: string;
  /** Le même fichier a déjà été importé. */
  fileDuplicate?: { documentId: string; name: string } | null;
  suggestions?: { contactId: string | null; categoryId: string | null; companyId: string | null };
}

async function readUpload(form: FormData): Promise<{ file: File; buffer: Buffer; mimeType: string } | { error: string; code: ImportAnalysis["code"] }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez un fichier à importer.", code: "empty" };
  if (file.size > IMPORT_MAX_BYTES) return { error: `Fichier trop volumineux (${Math.round(file.size / 1024 / 1024)} Mo) : 15 Mo maximum. Compressez-le ou importez une photo.`, code: "too_large" };
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const mimeType = IMPORT_MIME.has(file.type) ? file.type : byExt[ext] ?? file.type;
  if (!IMPORT_MIME.has(mimeType)) return { error: "Format non pris en charge : importez un PDF ou une image (PNG, JPEG, WebP).", code: "unsupported" };
  return { file, buffer: Buffer.from(await file.arrayBuffer()), mimeType };
}

function findFileDuplicate(userId: string, hash: string) {
  const row = db.select({ documentId: schema.documents.id, name: schema.documents.name })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.documents.userId, userId), eq(schema.documentVersions.sha256, hash))).get();
  return row ?? null;
}

/** Étape 1 : lit le fichier et propose des valeurs. Rien n'est enregistré. */
export async function analyzeImport(form: FormData): Promise<ImportAnalysis> {
  const user = await requireUser();
  const up = await readUpload(form);
  if ("error" in up) return { error: up.error, code: up.code };
  const direction = str(form, "direction") === "expense" ? "expense" : "income";
  try {
    const extraction = await extractInvoice(up.buffer, up.mimeType, { direction });
    const hash = sha256(up.buffer);
    const party = direction === "income" ? extraction.fields.recipient.value : extraction.fields.issuer.value;
    const contacts = db.select().from(schema.contacts).where(and(eq(schema.contacts.userId, user.id), eq(schema.contacts.archived, false))).all();
    const contact = party ? contacts.find((c) => sameParty(c.name, party) || sameParty(c.organization, party)) : undefined;
    let categoryId: string | null = null;
    const cat = extraction.fields.category.value;
    if (direction === "expense" && cat) {
      const cats = db.select().from(schema.categories).where(and(eq(schema.categories.userId, user.id), eq(schema.categories.kind, "expense"))).all();
      categoryId = cats.find((c) => c.name.toLowerCase() === cat.toLowerCase())?.id ?? null;
    }
    // Pour une facture émise, l'émetteur est l'une de vos structures : on la reconnaît par son nom.
    let companyId: string | null = null;
    if (direction === "income" && extraction.fields.issuer.value) {
      const companies = db.select().from(schema.companies).where(eq(schema.companies.userId, user.id)).all();
      companyId = companies.find((c) => sameParty(c.name, extraction.fields.issuer.value) || sameParty(c.legalName, extraction.fields.issuer.value))?.id ?? null;
    }
    return { ok: true, extraction, sha256: hash, fileDuplicate: findFileDuplicate(user.id, hash), suggestions: { contactId: contact?.id ?? null, categoryId, companyId } };
  } catch (e) {
    if (e instanceof ExtractionError) return { error: e.message, code: e.code };
    console.error("[import]", e);
    return { error: "La lecture du fichier a échoué. Réessayez, ou saisissez les informations manuellement.", code: "failed" };
  }
}

interface DuplicateHit { label: string; href: string }

function findRecordDuplicates(userId: string, o: { direction: "income" | "expense"; amount: number; currency: string; date: string; party: string | null; number: string | null; companyId: string }): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const near = (d: string) => Math.abs(daysBetween(d, o.date)) <= 5;
  if (o.direction === "income") {
    const rows = db.select().from(schema.invoices).where(and(eq(schema.invoices.userId, userId), eq(schema.invoices.docType, "invoice"), ne(schema.invoices.status, "cancelled"))).all();
    const contacts = new Map(db.select().from(schema.contacts).where(eq(schema.contacts.userId, userId)).all().map((c) => [c.id, c]));
    for (const r of rows) {
      const c = r.contactId ? contacts.get(r.contactId) : undefined;
      const sameNumber = !!o.number && r.number.toLowerCase() === o.number.toLowerCase() && r.companyId === o.companyId;
      const sameAmount = r.total === o.amount && r.currency === o.currency && near(r.issueDate) && (!o.party || sameParty(c?.name, o.party) || sameParty(c?.organization, o.party));
      if (sameNumber || sameAmount) hits.push({ label: `Facture ${r.number} — ${formatMoney(r.total, r.currency)} du ${r.issueDate}${sameNumber ? " (même numéro)" : ""}`, href: `/revenus/${r.id}` });
    }
  } else {
    const rows = db.select().from(schema.expenses).where(and(eq(schema.expenses.userId, userId), eq(schema.expenses.amount, o.amount), eq(schema.expenses.currency, o.currency), ne(schema.expenses.status, "cancelled"))).all();
    for (const r of rows) {
      if (near(r.date) && (!o.party || sameParty(r.supplier, o.party) || sameParty(r.label, o.party))) hits.push({ label: `Dépense « ${r.label} » — ${formatMoney(r.amount, r.currency)} du ${r.date}`, href: `/depenses?q=${encodeURIComponent(r.label)}` });
    }
    if (o.number) {
      const byNote = db.select().from(schema.expenses).where(and(eq(schema.expenses.userId, userId), ne(schema.expenses.status, "cancelled"))).all()
        .filter((r) => (r.note ?? "").toLowerCase().includes(o.number!.toLowerCase()) && !rows.some((x) => x.id === r.id));
      for (const r of byNote) hits.push({ label: `Dépense « ${r.label} » (même numéro de facture ${o.number})`, href: `/depenses?q=${encodeURIComponent(r.label)}` });
    }
  }
  return hits.slice(0, 5);
}

/**
 * Étape 2 : validation de l'écran de vérification. Le fichier est renvoyé avec le formulaire, enregistré dans la
 * bibliothèque (usage comptable) et rattaché. Une facture importée n'est JAMAIS considérée comme payée.
 */
export async function confirmImport(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const direction = str(form, "direction") === "expense" ? "expense" : "income";
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez la structure concernée."] }, values: formValues(form) };
    const company = companyOf(companyId)!;
    const currency = str(form, "currency") || company.currency;
    const amount = parseAmount(str(form, "total"), currency);
    const date = isoDate(form, "issueDate");
    const dueDate = isoDate(form, "dueDate");
    const number = optStr(form, "number");
    const party = optStr(form, "party");
    const description = optStr(form, "description");
    const activityId = ownedId(schema.activities, form.get("activityId"), user.id);
    const errors: Record<string, string[]> = {};
    if (!(currency in CURRENCIES)) errors.currency = ["Devise non prise en charge."];
    if (!amount || amount <= 0) errors.total = ["Indiquez le montant total TTC."];
    if (!date) errors.issueDate = ["Indiquez la date de la facture."];
    if (date && dueDate && dueDate < date) errors.dueDate = ["L'échéance ne peut pas précéder la date de la facture."];

    let contactId: string | null = null;
    if (direction === "income") {
      contactId = ownedId(schema.contacts, form.get("contactId"), user.id);
      if (!contactId && !party) errors.party = ["Choisissez le client ou indiquez son nom."];
      if (!number) errors.number = ["Indiquez le numéro de la facture."];
    } else if (!party && !description) errors.party = ["Indiquez le fournisseur ou un libellé."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form), error: "Vérifiez les champs signalés." };

    const up = await readUpload(form);
    if ("error" in up) return { error: `${up.error} Reprenez l'importation.`, values: formValues(form) };
    const hash = sha256(up.buffer);

    if (str(form, "confirmDuplicate") !== "1") {
      const fileDup = findFileDuplicate(user.id, hash);
      const hits = findRecordDuplicates(user.id, { direction, amount: amount!, currency, date: date!, party, number, companyId });
      if (fileDup || hits.length) {
        const parts = [
          ...(fileDup ? [`ce fichier a déjà été importé (« ${fileDup.name} »)`] : []),
          ...hits.map((h) => h.label),
        ];
        return { warning: `Doublon possible : ${parts.join(" ; ")}. Validez à nouveau pour confirmer qu'il s'agit d'un autre document.`, values: { ...formValues(form), confirmDuplicate: "1" } };
      }
    }

    if (direction === "income") {
      if (!contactId && party) {
        contactId = newId("ct_");
        db.insert(schema.contacts).values({ id: contactId, userId: user.id, type: "client", name: party.slice(0, 200), companyId, activityId, source: "Import de facture", convertedAt: todayISO() }).run();
        audit(user.id, "contact", contactId, "create", undefined, { name: party, source: "import" });
      }
      const existing = db.select({ id: schema.invoices.id }).from(schema.invoices)
        .where(and(eq(schema.invoices.companyId, companyId), eq(schema.invoices.docType, "invoice"), eq(schema.invoices.number, number!))).get();
      if (existing) return { fieldErrors: { number: ["Ce numéro existe déjà pour cette structure. Ouvrez la facture existante ou corrigez le numéro."] }, values: formValues(form) };
      const subtotal = parseAmount(str(form, "subtotal"), currency);
      const tax = parseAmount(str(form, "tax"), currency) ?? 0;
      const sub = subtotal != null && subtotal > 0 && subtotal <= amount! ? subtotal : amount! - (tax > 0 && tax < amount! ? tax : 0);
      const taxTotal = amount! - sub;
      const taxRate = sub > 0 && taxTotal > 0 ? Math.round((taxTotal / sub) * 10000) / 100 : 0;
      const clientName = db.select({ name: schema.contacts.name }).from(schema.contacts).where(eq(schema.contacts.id, contactId!)).get()?.name ?? party ?? "client";
      const documentId = createDocument(user.id, { name: `Facture ${number} — ${clientName}`, type: "invoice", usage: "accounting", companyId, activityId, contactId }, { buffer: up.buffer, fileName: up.file.name, mimeType: up.mimeType }, "Importée");
      const id = newId("inv_");
      const status = str(form, "status") === "draft" ? "draft" : "sent";
      const row = {
        id, userId: user.id, companyId, activityId, contactId, docType: "invoice", number: number!, title: description, issueDate: date!,
        dueDate: dueDate ?? addDays(date!, company.paymentTermsDays), currency, total: amount!, subtotal: sub, taxTotal, status,
        sentAt: status === "sent" ? date! : null, notes: null, source: "imported", documentId,
      };
      db.transaction((tx) => {
        tx.insert(schema.invoices).values(row).run();
        tx.insert(schema.invoiceLines).values({ id: newId("il_"), invoiceId: id, position: 0, description: description || `Facture ${number}`, quantity: 1, unitPrice: sub, taxRate }).run();
      });
      audit(user.id, "invoice", id, "create", undefined, { ...row, imported: true, sha256: hash });
      const inv = loadInvoice(user.id, id)!;
      if (status === "sent") logIssued(user.id, inv, date!);
      revalidateAll();
      return { ok: true, id, message: `Facture ${number} importée. Elle est à encaisser : enregistrez les paiements reçus depuis sa fiche.` };
    }

    // Dépense : « à payer » par défaut ; payée uniquement si l'utilisateur l'a explicitement coché.
    const paid = str(form, "alreadyPaid") === "1";
    const accountId = ownedId(schema.accounts, form.get("accountId"), user.id);
    const paidDate = isoDate(form, "paidDate");
    if (paid) {
      const acc = accountId ? db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get() : undefined;
      const e2: Record<string, string[]> = {};
      if (!paidDate) e2.paidDate = ["Indiquez la date du paiement."];
      if (!acc) e2.accountId = ["Choisissez le compte débité."];
      else if (acc.companyId !== companyId) e2.accountId = ["Ce compte appartient à une autre structure."];
      else if (acc.currency !== currency) e2.accountId = [`Le compte est en ${acc.currency}, la facture en ${currency}.`];
      if (Object.keys(e2).length) return { fieldErrors: e2, values: formValues(form) };
    }
    const categoryId = ownedId(schema.categories, form.get("categoryId"), user.id);
    const labelText = (description || (party ? `Facture ${party}` : "Facture fournisseur")).slice(0, 200);
    const documentId = createDocument(user.id, { name: `Justificatif — ${labelText}${party ? ` (${party})` : ""}`, type: "receipt", usage: "accounting", companyId, activityId }, { buffer: up.buffer, fileName: up.file.name, mimeType: up.mimeType }, "Importé");
    const id = newId("exp_");
    const row = {
      id, userId: user.id, companyId, activityId, categoryId, label: labelText, supplier: party, amount: amount!, currency, date: date!,
      dueDate: paid ? null : dueDate ?? date!, status: paid ? "paid" : "planned", paidDate: paid ? paidDate : null,
      accountId: paid ? accountId : null, method: str(form, "method") || "bank_transfer", costType: str(form, "costType") === "direct" && activityId ? "direct" : "overhead",
      note: number ? `Facture n° ${number}` : null, documentId,
    };
    db.insert(schema.expenses).values(row).run();
    audit(user.id, "expense", id, "create", undefined, { ...row, imported: true, sha256: hash });
    revalidateAll();
    return { ok: true, id, message: paid ? `Dépense de ${formatMoney(amount!, currency)} enregistrée comme payée.` : `Facture fournisseur enregistrée « à payer » (${formatMoney(amount!, currency)}).` };
  } catch (e) {
    return handle(e, form);
  }
}

/* ───────────────────────── Lecture (pour les fiches) ───────────────────────── */

/** Restant dû d'une facture (utilisé après une action pour un message précis). */
export async function invoiceRemaining(id: string): Promise<{ remaining: number; currency: string } | null> {
  const user = await requireUser();
  const inv = loadInvoice(user.id, id);
  if (!inv) return null;
  const s = invoiceState(inv, paymentsOf(id), todayISO());
  return { remaining: s.remaining, currency: inv.currency };
}
