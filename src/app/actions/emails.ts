"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { formValues, OwnershipError, ownedId, str } from "@/lib/guards";
import type { ActionState } from "@/lib/action-state";
import { createDocument } from "@/lib/documents";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, guessMime, saveFile } from "@/lib/storage";
import { deliverEmail, isMailerConfigured, MAX_EMAIL_ATTACHMENTS_BYTES } from "@/lib/mailer";
import { parseAddressList } from "@/lib/templating";
import { renderInvoiceAttachment } from "@/components/emails/invoice-attachment";
import { TEMPLATE_PURPOSES } from "@/lib/setup";

type AttachmentRow = typeof schema.emailAttachments.$inferInsert;

function revalidateEmail(contactId: string | null, emailId?: string) {
  revalidatePath("/emails");
  if (emailId) revalidatePath(`/emails/${emailId}`);
  if (contactId) revalidatePath(`/clients/${contactId}`);
  revalidatePath("/documents");
}

/**
 * Enregistre l'email (brouillon) puis, si demandé et possible, l'envoie.
 * Les pièces jointes sont figées à la version EXACTE choisie (documentVersionId + chemin de stockage).
 */
export async function submitEmail(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const intent = str(form, "intent") === "send" ? "send" : "draft";
  const values = formValues(form);
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez la structure expéditrice."] }, values };
    const senderIdentityId = ownedId(schema.senderIdentities, form.get("senderIdentityId"), user.id);
    const identity = senderIdentityId ? db.select().from(schema.senderIdentities).where(eq(schema.senderIdentities.id, senderIdentityId)).get() : undefined;
    if (identity && identity.companyId !== companyId) return { fieldErrors: { senderIdentityId: ["Cette adresse appartient à une autre structure."] }, values };
    const contactId = ownedId(schema.contacts, form.get("contactId"), user.id);
    const activityId = ownedId(schema.activities, form.get("activityId"), user.id);
    const templateId = ownedId(schema.emailTemplates, form.get("templateId"), user.id);
    const invoiceId = ownedId(schema.invoices, form.get("invoiceId"), user.id);

    const to = parseAddressList(str(form, "to"));
    const cc = parseAddressList(str(form, "cc"));
    const subject = str(form, "subject");
    const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim();
    const errors: Record<string, string[]> = {};
    if (to.invalid.length) errors.to = [`Adresse invalide : ${to.invalid.join(", ")}`];
    if (cc.invalid.length) errors.cc = [`Adresse invalide : ${cc.invalid.join(", ")}`];
    if (intent === "send") {
      if (!identity) errors.senderIdentityId = ["Choisissez une adresse d'expédition."];
      else if (!identity.authorized) errors.senderIdentityId = ["Cette adresse n'est pas autorisée à envoyer. Autorisez-la dans Paramètres → Emails."];
      if (!to.valid.length) errors.to = errors.to ?? ["Indiquez au moins un destinataire."];
      if (!subject) errors.subject = ["L'objet est vide."];
      if (!body) errors.body = ["Le message est vide."];
    }
    if (Object.keys(errors).length) return { fieldErrors: errors, values };

    // Brouillon existant à mettre à jour ?
    const existingId = str(form, "emailId");
    const existing = existingId
      ? db.select().from(schema.emails).where(and(eq(schema.emails.id, existingId), eq(schema.emails.userId, user.id))).get()
      : undefined;
    if (existing && existing.status !== "draft" && existing.status !== "failed") return { error: "Cet email a déjà été envoyé ; il ne peut plus être modifié.", values };

    // Pièces jointes de la bibliothèque : "documentId:version"
    const attachments: Omit<AttachmentRow, "id" | "emailId">[] = [];
    for (const raw of form.getAll("doc")) {
      const [docId, vRaw] = String(raw).split(":");
      const doc = db.select().from(schema.documents).where(and(eq(schema.documents.id, docId), eq(schema.documents.userId, user.id))).get();
      if (!doc) return { error: "Un des documents sélectionnés est introuvable.", values };
      const version = Number(vRaw) || doc.currentVersion;
      const v = db.select().from(schema.documentVersions).where(and(eq(schema.documentVersions.documentId, doc.id), eq(schema.documentVersions.version, version))).get();
      if (!v) return { error: `La version ${version} de « ${doc.name} » est introuvable.`, values };
      attachments.push({ documentId: doc.id, documentVersionId: v.id, fileName: v.fileName, storagePath: v.storagePath, mimeType: v.mimeType, size: v.size });
    }

    // Fichiers de l'ordinateur → bibliothèque (usage client, rattachés au contact), version 1
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    for (const f of files) {
      if (f.size > MAX_UPLOAD_BYTES) return { error: `« ${f.name} » dépasse 15 Mo.`, values };
      const mime = f.type || guessMime(f.name);
      if (!ALLOWED_MIME.has(mime)) return { error: `« ${f.name} » : format non pris en charge.`, values };
    }
    const preTotal = attachments.reduce((a, x) => a + x.size, 0) + files.reduce((a, f) => a + f.size, 0);
    if (preTotal > MAX_EMAIL_ATTACHMENTS_BYTES) return { error: "Les pièces jointes dépassent 20 Mo au total. Retirez un ou plusieurs fichiers.", values };
    for (const f of files) {
      const docId = createDocument(user.id, {
        name: f.name.replace(/\.[^.]+$/, ""), type: "other", usage: "client", companyId, activityId, contactId,
        description: `Joint à l'email « ${subject || "sans objet"} »`,
      }, { buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name, mimeType: f.type || guessMime(f.name) }, "Ajouté depuis le composeur d'email");
      const v = db.select().from(schema.documentVersions).where(and(eq(schema.documentVersions.documentId, docId), eq(schema.documentVersions.version, 1))).get()!;
      attachments.push({ documentId: docId, documentVersionId: v.id, fileName: v.fileName, storagePath: v.storagePath, mimeType: v.mimeType, size: v.size });
      audit(user.id, "document", docId, "create", undefined, { fileName: f.name, via: "email" });
    }

    // Facture / devis PDF généré
    if (invoiceId && str(form, "includeInvoicePdf") === "1") {
      const pdf = await renderInvoiceAttachment(user.id, invoiceId);
      if (!pdf) return { error: "Impossible de générer le PDF de la facture.", values };
      const stored = saveFile(user.id, pdf.buffer, pdf.fileName);
      attachments.push({ documentId: null, documentVersionId: null, fileName: pdf.fileName, storagePath: stored.storagePath, mimeType: "application/pdf", size: stored.size });
    }

    const total = attachments.reduce((a, x) => a + x.size, 0);
    if (total > MAX_EMAIL_ATTACHMENTS_BYTES) return { error: "Les pièces jointes dépassent 20 Mo au total. Retirez un ou plusieurs fichiers.", values };

    const row = {
      companyId, senderIdentityId, contactId, activityId, templateId, invoiceId,
      fromName: identity?.fromName ?? null, fromEmail: identity?.fromEmail ?? null,
      to: to.valid.join(", "), cc: cc.valid.length ? cc.valid.join(", ") : null, subject: subject || "(sans objet)", body,
      status: "draft", error: null,
    };
    const emailId = existing?.id ?? newId("eml_");
    db.transaction((tx) => {
      if (existing) {
        tx.update(schema.emails).set(row).where(eq(schema.emails.id, emailId)).run();
        tx.delete(schema.emailAttachments).where(eq(schema.emailAttachments.emailId, emailId)).run();
      } else {
        tx.insert(schema.emails).values({ id: emailId, userId: user.id, ...row }).run();
      }
      for (const a of attachments) tx.insert(schema.emailAttachments).values({ id: newId("att_"), emailId, ...a }).run();
    });
    audit(user.id, "email", emailId, existing ? "update" : "create", existing ? { subject: existing.subject, to: existing.to } : undefined, { ...row, attachments: attachments.map((a) => a.fileName) });

    if (intent === "draft") {
      revalidateEmail(contactId, emailId);
      return { ok: true, id: emailId, message: "Brouillon enregistré. Il n'a pas été envoyé." };
    }
    if (!isMailerConfigured()) {
      revalidateEmail(contactId, emailId);
      return { ok: true, id: emailId, warning: "L'envoi n'est pas configuré : l'email est conservé en brouillon, rien n'a été envoyé." };
    }
    const result = await deliverEmail(user.id, emailId);
    revalidateEmail(contactId, emailId);
    if (invoiceId) revalidatePath("/", "layout");
    if (result.status === "sent") return { ok: true, id: emailId, message: `Email envoyé à ${row.to} (confirmé par le serveur d'envoi).` };
    if (result.status === "draft") return { ok: true, id: emailId, warning: result.error };
    return { id: emailId, error: `L'email n'a pas été envoyé. ${result.error ?? ""}`.trim(), values };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Une des références sélectionnées est invalide.", values };
    console.error(e);
    return { error: "L'enregistrement de l'email a échoué.", values };
  }
}

/** Renvoie un email en échec (ou envoie un brouillon) avec ses pièces jointes figées. */
export async function resendEmail(id: string): Promise<ActionState> {
  const user = await requireUser();
  const email = db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.userId, user.id))).get();
  if (!email) return { error: "Email introuvable." };
  if (email.status === "sent") return { ok: true, message: "Cet email a déjà été envoyé." };
  if (email.status === "sending") return { error: "Un envoi est déjà en cours pour cet email." };
  if (!isMailerConfigured()) return { error: "L'envoi n'est pas configuré (serveur SMTP absent) : l'email reste en brouillon." };
  if (!email.to) return { error: "Aucun destinataire : reprenez le brouillon pour en ajouter un." };
  const result = await deliverEmail(user.id, id);
  revalidateEmail(email.contactId, id);
  if (email.invoiceId) revalidatePath("/", "layout");
  if (result.status === "sent") return { ok: true, message: "Email envoyé (confirmé par le serveur d'envoi)." };
  return { error: `Nouvel échec : ${result.error ?? "erreur inconnue"}` };
}

/** Supprime un brouillon jamais envoyé (les emails envoyés ou en échec restent dans l'historique). */
export async function discardDraft(id: string): Promise<ActionState> {
  const user = await requireUser();
  const email = db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.userId, user.id))).get();
  if (!email || email.status !== "draft") return { error: "Seuls les brouillons peuvent être supprimés." };
  db.delete(schema.emails).where(eq(schema.emails.id, id)).run();
  audit(user.id, "email", id, "delete", { subject: email.subject, to: email.to });
  revalidateEmail(email.contactId);
  return { ok: true, message: "Brouillon supprimé." };
}


/* ───────────────────────── Modèles ───────────────────────── */

/** Crée ou modifie un modèle d'email (objet, texte avec variables, documents proposés par défaut). */
export async function saveTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const values = formValues(form);
  try {
    const name = str(form, "name");
    const subject = str(form, "subject");
    const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim();
    const errors: Record<string, string[]> = {};
    if (!name) errors.name = ["Donnez un nom au modèle."];
    if (!subject) errors.subject = ["L'objet est requis."];
    if (!body) errors.body = ["Le message est requis."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values };
    const purpose = Object.keys(TEMPLATE_PURPOSES).includes(str(form, "purpose")) ? str(form, "purpose") : "other";
    const docIds: string[] = [];
    for (const raw of form.getAll("defaultDoc")) {
      const id = ownedId(schema.documents, raw, user.id);
      if (id && !docIds.includes(id)) docIds.push(id);
    }
    const row = {
      name, subject, body, purpose,
      companyId: ownedId(schema.companies, form.get("companyId"), user.id),
      activityId: ownedId(schema.activities, form.get("activityId"), user.id),
      defaultDocumentIds: JSON.stringify(docIds),
    };
    const id = str(form, "id");
    if (id) {
      const before = db.select().from(schema.emailTemplates).where(and(eq(schema.emailTemplates.id, id), eq(schema.emailTemplates.userId, user.id))).get();
      if (!before) return { error: "Modèle introuvable." };
      db.update(schema.emailTemplates).set(row).where(eq(schema.emailTemplates.id, id)).run();
      audit(user.id, "email_template", id, "update", before, row);
    } else {
      const nid = newId("tpl_");
      db.insert(schema.emailTemplates).values({ id: nid, userId: user.id, ...row }).run();
      audit(user.id, "email_template", nid, "create", undefined, row);
    }
    revalidatePath("/emails");
    return { ok: true, message: id ? "Modèle mis à jour." : "Modèle créé." };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Une des références sélectionnées est invalide.", values };
    console.error(e);
    return { error: "L'enregistrement du modèle a échoué.", values };
  }
}

/** Supprime un modèle. Les emails déjà rédigés avec ce modèle ne sont pas modifiés. */
export async function deleteTemplate(id: string): Promise<ActionState> {
  const user = await requireUser();
  const t = db.select().from(schema.emailTemplates).where(and(eq(schema.emailTemplates.id, id), eq(schema.emailTemplates.userId, user.id))).get();
  if (!t) return { error: "Modèle introuvable." };
  db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.id, id)).run();
  audit(user.id, "email_template", id, "delete", t);
  revalidatePath("/emails");
  return { ok: true, message: `Modèle « ${t.name} » supprimé.` };
}
