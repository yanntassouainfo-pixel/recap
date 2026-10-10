/**
 * Envoi des emails (SMTP via Nodemailer).
 *
 * Règle absolue : un email n'est marqué « envoyé » QUE si le transport a confirmé techniquement l'envoi en
 * renvoyant un identifiant de message. Sinon il passe « en échec » avec l'erreur. Sans configuration SMTP,
 * rien n'est envoyé : l'email reste un brouillon.
 *
 * Pas d'import "server-only" ici : le module est testé directement (transport injectable).
 */
import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { newId } from "./ids";
import { audit } from "./audit";
import { readFile } from "./storage";
import { todayISO } from "./dates";
import { interactionTypeForPurpose } from "./templating";

export const MAX_EMAIL_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

export interface OutgoingMessage {
  from: string;
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}

export interface MailTransport {
  sendMail(message: OutgoingMessage): Promise<{ messageId?: string | null } | null | undefined>;
}

let injected: MailTransport | null = null;
let smtpTransport: MailTransport | null = null;

/** Tests : remplace le transport réel (null pour revenir à SMTP). */
export function setTransportForTests(t: MailTransport | null) {
  injected = t;
}

export function smtpSettings() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1" : port === 465,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS || undefined,
  };
}

/** L'envoi est-il techniquement possible ? */
export function isMailerConfigured(): boolean {
  return !!injected || !!smtpSettings();
}

function transport(): MailTransport | null {
  if (injected) return injected;
  const s = smtpSettings();
  if (!s) return null;
  if (!smtpTransport) {
    const t = nodemailer.createTransport({
      host: s.host, port: s.port, secure: s.secure,
      auth: s.user ? { user: s.user, pass: s.pass ?? "" } : undefined,
    });
    smtpTransport = { sendMail: (m) => t.sendMail(m) as Promise<{ messageId?: string }> };
  }
  return smtpTransport;
}

function formatFrom(name: string | null, email: string): string {
  if (!name) return email;
  return `"${name.replace(/["\\\r\n]/g, "")}" <${email}>`;
}

export interface DeliveryResult {
  status: "sent" | "failed" | "draft";
  error?: string;
  messageId?: string;
}

/**
 * Envoie un email déjà enregistré (statut brouillon ou échec) avec ses pièces jointes figées.
 * Met à jour le statut : sending → sent (si messageId) | failed.
 */
export async function deliverEmail(userId: string, emailId: string): Promise<DeliveryResult> {
  const email = db.select().from(schema.emails).where(and(eq(schema.emails.id, emailId), eq(schema.emails.userId, userId))).get();
  if (!email) return { status: "failed", error: "Email introuvable." };
  if (email.status === "sent") return { status: "sent", messageId: email.providerMessageId ?? undefined };

  const t = transport();
  if (!t) {
    db.update(schema.emails).set({ status: "draft", error: null }).where(eq(schema.emails.id, emailId)).run();
    return { status: "draft", error: "L'envoi d'emails n'est pas configuré : l'email est conservé en brouillon." };
  }

  const fail = (error: string): DeliveryResult => {
    db.update(schema.emails).set({ status: "failed", error }).where(eq(schema.emails.id, emailId)).run();
    audit(userId, "email", emailId, "send_failed", undefined, { error });
    return { status: "failed", error };
  };

  // Identité d'expédition : doit appartenir à l'utilisateur ET être autorisée.
  const identity = email.senderIdentityId
    ? db.select().from(schema.senderIdentities).where(and(eq(schema.senderIdentities.id, email.senderIdentityId), eq(schema.senderIdentities.userId, userId))).get()
    : undefined;
  if (!identity) return fail("Aucune adresse d'expédition valide n'est associée à cet email.");
  if (!identity.authorized) return fail("L'adresse d'expédition n'est pas autorisée. Autorisez-la dans Paramètres → Emails.");

  const rows = db.select().from(schema.emailAttachments).where(eq(schema.emailAttachments.emailId, emailId)).all();
  const attachments: OutgoingMessage["attachments"] = [];
  let total = 0;
  for (const a of rows) {
    const buf = readFile(userId, a.storagePath);
    if (!buf) return fail(`Pièce jointe introuvable : ${a.fileName}. Retirez-la ou remplacez-la avant de renvoyer.`);
    total += buf.length;
    attachments.push({ filename: a.fileName, content: buf, contentType: a.mimeType });
  }
  if (total > MAX_EMAIL_ATTACHMENTS_BYTES) return fail("Les pièces jointes dépassent 20 Mo au total.");

  db.update(schema.emails).set({ status: "sending", error: null, fromName: identity.fromName, fromEmail: identity.fromEmail }).where(eq(schema.emails.id, emailId)).run();

  let messageId: string | null = null;
  try {
    const res = await t.sendMail({
      from: formatFrom(identity.fromName, identity.fromEmail),
      to: email.to,
      cc: email.cc || undefined,
      replyTo: identity.replyTo || undefined,
      subject: email.subject,
      text: email.body,
      attachments,
    });
    messageId = res?.messageId ? String(res.messageId) : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Le serveur d'envoi a refusé le message : ${msg}`);
  }
  if (!messageId) return fail("Le serveur d'envoi n'a pas confirmé l'envoi (aucun identifiant de message reçu). L'email n'est pas considéré comme envoyé.");

  const sentAt = new Date().toISOString();
  db.update(schema.emails).set({ status: "sent", providerMessageId: messageId, sentAt, error: null }).where(eq(schema.emails.id, emailId)).run();
  afterSent(userId, { ...email, status: "sent", sentAt, providerMessageId: messageId }, rows.length);
  return { status: "sent", messageId };
}

/** Conséquences d'un envoi confirmé : historique du contact, statut de facture, journal. */
function afterSent(userId: string, email: typeof schema.emails.$inferSelect, attachmentCount: number) {
  const template = email.templateId
    ? db.select().from(schema.emailTemplates).where(and(eq(schema.emailTemplates.id, email.templateId), eq(schema.emailTemplates.userId, userId))).get()
    : undefined;
  const invoice = email.invoiceId
    ? db.select().from(schema.invoices).where(and(eq(schema.invoices.id, email.invoiceId), eq(schema.invoices.userId, userId))).get()
    : undefined;

  let type = interactionTypeForPurpose(template?.purpose);
  if (type === "email_sent" && invoice?.docType === "quote") type = "quote_sent";

  if (email.contactId) {
    const pj = attachmentCount ? ` · ${attachmentCount} pièce${attachmentCount > 1 ? "s" : ""} jointe${attachmentCount > 1 ? "s" : ""}` : "";
    db.insert(schema.interactions).values({
      id: newId("ix_"), userId, contactId: email.contactId, type, date: todayISO(),
      title: `Email envoyé : ${email.subject}`, details: `À ${email.to}${email.cc ? ` (cc ${email.cc})` : ""}${pj}`,
      refType: "email", refId: email.id,
    }).run();
  }

  if (invoice && invoice.status === "draft") {
    db.update(schema.invoices).set({ status: "sent", sentAt: todayISO(), updatedAt: new Date().toISOString() }).where(eq(schema.invoices.id, invoice.id)).run();
    audit(userId, "invoice", invoice.id, "update", { status: "draft" }, { status: "sent", via: "email", emailId: email.id });
  }

  audit(userId, "email", email.id, "send", undefined, {
    to: email.to, cc: email.cc, subject: email.subject, providerMessageId: email.providerMessageId, sentAt: email.sentAt, attachments: attachmentCount,
  });
}
