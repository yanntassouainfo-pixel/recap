import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, Download, Eye, FileText, PenLine } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { isMailerConfigured } from "@/lib/mailer";
import { formatBytes } from "@/lib/templating";
import { Card, CardHeader, Notice, PageHeader, buttonClass } from "@/components/ui";
import { EmailStatusBadge } from "@/components/crm/badges";
import { DiscardDraftButton, ResendButton } from "@/components/emails/email-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const e = db.select({ subject: schema.emails.subject }).from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.userId, user.id))).get();
  return { title: e ? e.subject : "Email introuvable" };
}

const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"]);

function dateTime(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const email = db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.userId, user.id))).get();
  if (!email) notFound();

  const attachments = db.select().from(schema.emailAttachments).where(eq(schema.emailAttachments.emailId, email.id)).all();
  const versions = new Map(
    attachments.filter((a) => a.documentVersionId).map((a) => {
      const v = db.select({ version: schema.documentVersions.version }).from(schema.documentVersions).where(eq(schema.documentVersions.id, a.documentVersionId!)).get();
      return [a.id, v?.version ?? null] as const;
    }),
  );
  const docNames = new Map(
    attachments.filter((a) => a.documentId).map((a) => {
      const d = db.select({ name: schema.documents.name, currentVersion: schema.documents.currentVersion }).from(schema.documents)
        .where(and(eq(schema.documents.id, a.documentId!), eq(schema.documents.userId, user.id))).get();
      return [a.id, d] as const;
    }),
  );
  const contact = email.contactId
    ? db.select().from(schema.contacts).where(and(eq(schema.contacts.id, email.contactId), eq(schema.contacts.userId, user.id))).get()
    : undefined;
  const company = db.select({ name: schema.companies.name }).from(schema.companies).where(and(eq(schema.companies.id, email.companyId), eq(schema.companies.userId, user.id))).get();
  const template = email.templateId
    ? db.select({ name: schema.emailTemplates.name }).from(schema.emailTemplates).where(and(eq(schema.emailTemplates.id, email.templateId), eq(schema.emailTemplates.userId, user.id))).get()
    : undefined;
  const invoice = email.invoiceId
    ? db.select({ number: schema.invoices.number, docType: schema.invoices.docType }).from(schema.invoices).where(and(eq(schema.invoices.id, email.invoiceId), eq(schema.invoices.userId, user.id))).get()
    : undefined;
  const configured = isMailerConfigured();
  const total = attachments.reduce((s, a) => s + a.size, 0);
  const editable = email.status === "draft" || email.status === "failed";

  return (
    <>
      <PageHeader
        eyebrow={<Link href={contact ? `/clients/${contact.id}` : "/emails"} className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft size={13} aria-hidden /> {contact ? contact.name : "Emails"}</Link>}
        title={email.subject}
        description={<span className="flex flex-wrap items-center gap-2"><EmailStatusBadge status={email.status} />
          {email.sentAt ? `Envoyé le ${dateTime(email.sentAt)}` : `Créé le ${dateTime(email.createdAt)}`}</span>}
        actions={
          <>
            {email.status === "failed" && configured && <ResendButton id={email.id} />}
            {email.status === "draft" && configured && <ResendButton id={email.id} label="Envoyer maintenant" />}
            {editable && <Link href={`/emails/nouveau?brouillon=${email.id}`} className={buttonClass("secondary", "sm")}><PenLine size={14} aria-hidden /> {email.status === "failed" ? "Corriger" : "Modifier"}</Link>}
            {email.status === "draft" && <DiscardDraftButton id={email.id} redirectTo={contact ? `/clients/${contact.id}` : "/emails"} />}
          </>
        }
      />

      <div className="mb-5 space-y-3">
        {email.status === "failed" && (
          <Notice tone="bad" title="Cet email n'a pas été envoyé">
            {email.error ?? "Le serveur d'envoi n'a pas confirmé l'envoi."} {configured ? "Corrigez si besoin, puis renvoyez-le : les mêmes pièces jointes (versions figées) seront utilisées." : "L'envoi n'est plus configuré sur le serveur."}
          </Notice>
        )}
        {email.status === "draft" && (
          <Notice tone="info" title="Brouillon — non envoyé">
            {configured ? "Ce message n'est pas encore parti. Relisez-le puis envoyez-le." : <>L&apos;envoi d&apos;emails n&apos;est pas configuré : ce message reste en brouillon. <Link href="/parametres#emails" className="underline">Voir les paramètres</Link></>}
          </Notice>
        )}
        {email.status === "sending" && (
          <Notice tone="warn" title="Envoi en cours ou interrompu">
            Aucune confirmation du serveur d&apos;envoi n&apos;a encore été reçue : l&apos;email n&apos;est pas considéré comme envoyé.
          </Notice>
        )}
        {email.status === "sent" && (
          <Notice tone="good" title="Envoi confirmé par le serveur">
            Identifiant du message : <span className="break-all font-mono text-[12px]">{email.providerMessageId}</span>
          </Notice>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <dl className="grid gap-2 border-b border-line px-5 py-4 text-[13px] sm:grid-cols-[90px_1fr]">
            <dt className="text-ink-3">De</dt>
            <dd>{email.fromEmail ? `${email.fromName ?? ""} <${email.fromEmail}>` : <span className="text-ink-3">Adresse d&apos;expédition non choisie</span>}</dd>
            <dt className="text-ink-3">À</dt>
            <dd className="break-all">{email.to || <span className="text-ink-3">Aucun destinataire</span>}</dd>
            {email.cc && <><dt className="text-ink-3">Cc</dt><dd className="break-all">{email.cc}</dd></>}
            <dt className="text-ink-3">Objet</dt>
            <dd className="font-medium">{email.subject}</dd>
          </dl>
          <div className="whitespace-pre-wrap px-5 py-5 text-[14px] leading-relaxed text-ink">{email.body || <span className="text-ink-3">Message vide</span>}</div>
        </Card>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Pièces jointes" description={attachments.length ? `${attachments.length} fichier${attachments.length > 1 ? "s" : ""} · ${formatBytes(total)} · version exacte ${email.status === "sent" ? "envoyée" : "retenue"}` : undefined} />
            {attachments.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-3">Aucune pièce jointe.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {attachments.map((a) => {
                  const v = versions.get(a.id);
                  const doc = docNames.get(a.id);
                  return (
                    <li key={a.id} className="px-5 py-2.5">
                      <div className="flex items-start gap-2 text-[13px]">
                        <FileText size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{a.fileName}</div>
                          <div className="text-[11.5px] text-ink-3">
                            {formatBytes(a.size)}
                            {doc ? ` · ${doc.name}${v ? `, version ${v}` : ""}` : a.documentId ? " · document supprimé" : " · généré"}
                            {doc && v && doc.currentVersion > v ? ` (actuelle : v${doc.currentVersion})` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="ml-5 mt-1 flex gap-1">
                        {PREVIEWABLE.has(a.mimeType) && <a href={`/api/documents/pieces-jointes/${a.id}?inline=1`} target="_blank" rel="noopener" className={buttonClass("ghost", "sm", "h-7 px-2")}><Eye size={13} aria-hidden /> Voir</a>}
                        <a href={`/api/documents/pieces-jointes/${a.id}`} className={buttonClass("ghost", "sm", "h-7 px-2")}><Download size={13} aria-hidden /> Télécharger</a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Contexte" />
            <dl className="space-y-2 px-5 pb-5 text-[13px]">
              <Item label="Structure">{company?.name ?? "—"}</Item>
              <Item label="Contact">{contact ? <Link href={`/clients/${contact.id}`} className="hover:underline">{contact.name}</Link> : "—"}</Item>
              <Item label="Modèle">{template?.name ?? "Message libre"}</Item>
              {invoice && <Item label={invoice.docType === "quote" ? "Devis" : "Facture"}>{invoice.number}</Item>}
              {email.sentAt && <Item label="Envoyé le">{formatDate(email.sentAt.slice(0, 10), "long")}</Item>}
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}
