import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getScope, getSnapshot, visibleCompanies } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { DOCUMENT_TYPES } from "@/lib/documents";
import { TEMPLATE_PURPOSES } from "@/lib/setup";
import { isMailerConfigured } from "@/lib/mailer";
import { invoiceState } from "@/lib/finance/engine";
import { EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { Composer, type ComposerData, type ComposerInitial } from "@/components/emails/composer";

export const metadata = { title: "Nouvel email" };

export default async function NewEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // Alias anglais utilisés par le tableau de bord, l'assistant, le menu rapide et la fiche facture.
  sp.facture ??= sp.invoice;
  sp.modele ??= sp.template;
  const user = await requireUser();
  const [scope, snap] = await Promise.all([getScope(user.id), getSnapshot(user.id)]);
  const { data } = snap;
  const companies = visibleCompanies(user.id).filter((c) => c.kind !== "personal");

  if (companies.length === 0) {
    return (
      <>
        <PageHeader title="Nouvel email" />
        <EmptyState title="Aucune structure" description="Créez d'abord votre entreprise : les emails partent au nom d'une structure."
          action={<Link href="/structures" className={buttonClass("primary", "sm")}>Créer une structure</Link>} />
      </>
    );
  }

  const companyIds = companies.map((c) => c.id);
  const identities = db.select().from(schema.senderIdentities).where(eq(schema.senderIdentities.userId, user.id)).all().filter((i) => companyIds.includes(i.companyId));
  const contacts = db.select().from(schema.contacts).where(and(eq(schema.contacts.userId, user.id), eq(schema.contacts.archived, false))).orderBy(asc(schema.contacts.name)).all();
  const activities = data.activities.filter((a) => !a.archived && companyIds.includes(a.companyId));
  const templates = db.select().from(schema.emailTemplates).where(eq(schema.emailTemplates.userId, user.id)).orderBy(asc(schema.emailTemplates.name)).all();
  const documents = db.select().from(schema.documents).where(and(eq(schema.documents.userId, user.id), eq(schema.documents.archived, false))).orderBy(desc(schema.documents.updatedAt), asc(schema.documents.name)).all();
  const versions = documents.length
    ? db.select().from(schema.documentVersions).where(inArray(schema.documentVersions.documentId, documents.map((d) => d.id))).orderBy(desc(schema.documentVersions.version)).all()
    : [];

  // Factures et devis (statut de paiement calculé par le moteur)
  const paymentsByInvoice = new Map<string, typeof data.payments>();
  for (const p of data.payments) paymentsByInvoice.set(p.invoiceId, [...(paymentsByInvoice.get(p.invoiceId) ?? []), p]);
  const invoiceRows = data.invoices
    .filter((i) => companyIds.includes(i.companyId) && i.status !== "cancelled")
    .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))
    .map((i) => {
      const st = i.docType === "invoice" ? invoiceState(i, paymentsByInvoice.get(i.id) ?? [], data.today) : null;
      const remaining = st && st.remaining > 0 && st.remaining < i.total ? formatMoney(st.remaining, i.currency) : null;
      const label = `${i.docType === "quote" ? "Devis" : "Facture"} ${i.number} · ${formatMoney(i.total, i.currency)}${st?.status === "paid" ? " · payée" : st?.status === "overdue" ? " · en retard" : i.status === "draft" ? " · brouillon" : ""}`;
      return { id: i.id, label, docType: i.docType, contactId: i.contactId, companyId: i.companyId, number: i.number, totalLabel: formatMoney(i.total, i.currency), remainingLabel: remaining, dueDateLabel: formatDate(i.dueDate, "long") };
    });

  const composerData: ComposerData = {
    mailerConfigured: isMailerConfigured(),
    companies: companies.map((c) => ({ id: c.id, name: c.name, legalName: c.legalName, phone: c.phone, website: c.website })),
    identities: identities.map((i) => ({ id: i.id, companyId: i.companyId, fromName: i.fromName, fromEmail: i.fromEmail, authorized: i.authorized })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, organization: c.organization, email: c.email, activityId: c.activityId, companyId: c.companyId })),
    activities: activities.map((a) => ({ id: a.id, companyId: a.companyId, name: a.name })),
    templates: templates.map((t) => ({
      id: t.id, purpose: t.purpose, purposeLabel: TEMPLATE_PURPOSES[t.purpose] ?? "Autre", name: t.name, subject: t.subject, body: t.body,
      companyId: t.companyId, activityId: t.activityId, defaultDocumentIds: parseIds(t.defaultDocumentIds),
    })),
    documents: documents.map((d) => ({
      id: d.id, name: d.name, typeLabel: DOCUMENT_TYPES[d.type] ?? "Autre", usage: d.usage, companyId: d.companyId, contactId: d.contactId, currentVersion: d.currentVersion,
      versions: versions.filter((v) => v.documentId === d.id).map((v) => ({ version: v.version, size: v.size, fileName: v.fileName })),
    })),
    invoices: invoiceRows,
  };

  const pickIdentity = (companyId: string) => (identities.find((i) => i.companyId === companyId && i.authorized) ?? identities.find((i) => i.companyId === companyId))?.id ?? "";

  let initial: ComposerInitial;
  const draft = sp.brouillon
    ? db.select().from(schema.emails).where(and(eq(schema.emails.id, sp.brouillon), eq(schema.emails.userId, user.id))).get()
    : undefined;

  if (draft && (draft.status === "draft" || draft.status === "failed")) {
    const atts = db.select().from(schema.emailAttachments).where(eq(schema.emailAttachments.emailId, draft.id)).all();
    const docsSel: Record<string, number> = {};
    for (const a of atts) {
      if (!a.documentId) continue;
      const v = versions.find((x) => x.id === a.documentVersionId);
      if (v && documents.some((d) => d.id === a.documentId)) docsSel[a.documentId] = v.version;
    }
    const companyId = companyIds.includes(draft.companyId) ? draft.companyId : companies[0].id;
    initial = {
      emailId: draft.id, companyId,
      senderIdentityId: draft.senderIdentityId && identities.some((i) => i.id === draft.senderIdentityId) ? draft.senderIdentityId : pickIdentity(companyId),
      contactId: draft.contactId ?? "", activityId: draft.activityId ?? "", templateId: draft.templateId ?? "", invoiceId: draft.invoiceId ?? "",
      to: draft.to, cc: draft.cc ?? "", subject: draft.subject === "(sans objet)" ? "" : draft.subject, body: draft.body, docs: docsSel,
      includeInvoicePdf: atts.some((a) => !a.documentId && a.mimeType === "application/pdf") && !!draft.invoiceId,
      applyTemplate: false,
    };
  } else {
    const contact = contacts.find((c) => c.id === sp.contact);
    const invoice = invoiceRows.find((i) => i.id === sp.facture && (!contact || i.contactId === contact.id));
    const invContact = invoice?.contactId ? contacts.find((c) => c.id === invoice.contactId) : undefined;
    const theContact = contact ?? invContact;
    const companyId = invoice?.companyId
      ?? (theContact?.companyId && companyIds.includes(theContact.companyId) ? theContact.companyId : null)
      ?? (scope.company && companyIds.includes(scope.company.id) ? scope.company.id : companies[0].id);
    // `modele` : identifiant de modèle ou objet (ex. invoice_reminder) — on privilégie le modèle de la structure.
    const byPurpose = templates.filter((t) => t.purpose === sp.modele && (!t.companyId || t.companyId === companyId));
    const template = templates.find((t) => t.id === sp.modele) ?? byPurpose.find((t) => t.companyId === companyId) ?? byPurpose[0];
    const activityId = (theContact?.activityId && activities.some((a) => a.id === theContact.activityId && a.companyId === companyId) ? theContact.activityId : null)
      ?? (template?.activityId && activities.some((a) => a.id === template.activityId && a.companyId === companyId) ? template.activityId : "");
    const docsSel: Record<string, number> = {};
    for (const id of template ? parseIds(template.defaultDocumentIds) : []) {
      const d = documents.find((x) => x.id === id);
      if (d) docsSel[d.id] = d.currentVersion;
    }
    initial = {
      companyId, senderIdentityId: pickIdentity(companyId), contactId: theContact?.id ?? "", activityId, templateId: template?.id ?? "",
      invoiceId: invoice?.id ?? "", to: theContact?.email ?? "", cc: "", subject: "", body: "", docs: docsSel, includeInvoicePdf: !!invoice,
      applyTemplate: !!template,
    };
  }

  const backHref = initial.contactId ? `/clients/${initial.contactId}` : "/emails";
  return (
    <>
      <PageHeader
        eyebrow={<Link href={backHref} className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft size={13} aria-hidden /> {initial.contactId ? "Retour à la fiche" : "Emails"}</Link>}
        title={initial.emailId ? "Reprendre le brouillon" : "Nouvel email"}
        description="Choisissez un modèle, vérifiez le texte et joignez vos documents. Rien ne part sans votre clic sur « Envoyer »."
      />
      <Composer data={composerData} initial={initial} />
    </>
  );
}

function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
