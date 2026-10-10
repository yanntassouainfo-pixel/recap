import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { ChevronRight, Mail, Paperclip, PenLine } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getActivities, visibleCompanies } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { isMailerConfigured } from "@/lib/mailer";
import { TEMPLATE_PURPOSES } from "@/lib/setup";
import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, Table, Tabs, Td, Th, buttonClass } from "@/components/ui";
import { EmailStatusBadge } from "@/components/crm/badges";
import { DeleteTemplateButton, TemplateDialog, type TemplateRefs } from "@/components/emails/email-actions";

export const metadata = { title: "Emails" };

const STATUS_TABS = [
  { key: "tous", label: "Tous" },
  { key: "sent", label: "Envoyés" },
  { key: "draft", label: "Brouillons" },
  { key: "failed", label: "En échec" },
];

export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const view = sp.vue === "modeles" ? "modeles" : STATUS_TABS.some((t) => t.key === sp.statut) ? sp.statut! : "tous";
  const configured = isMailerConfigured();

  const emails = db.select().from(schema.emails).where(eq(schema.emails.userId, user.id)).orderBy(desc(schema.emails.createdAt)).all();
  const contacts = new Map(db.select({ id: schema.contacts.id, name: schema.contacts.name }).from(schema.contacts).where(eq(schema.contacts.userId, user.id)).all().map((c) => [c.id, c.name]));
  const attachCounts = new Map<string, number>();
  for (const a of db.select({ emailId: schema.emailAttachments.emailId }).from(schema.emailAttachments)
    .innerJoin(schema.emails, eq(schema.emails.id, schema.emailAttachments.emailId)).where(eq(schema.emails.userId, user.id)).all()) {
    attachCounts.set(a.emailId, (attachCounts.get(a.emailId) ?? 0) + 1);
  }
  const templates = db.select().from(schema.emailTemplates).where(eq(schema.emailTemplates.userId, user.id)).orderBy(asc(schema.emailTemplates.name)).all();
  const senders = db.select().from(schema.senderIdentities).where(eq(schema.senderIdentities.userId, user.id)).all();
  const counts = {
    tous: emails.length,
    sent: emails.filter((e) => e.status === "sent").length,
    draft: emails.filter((e) => e.status === "draft").length,
    failed: emails.filter((e) => e.status === "failed" || e.status === "sending").length,
  };
  const list = view === "tous" ? emails : emails.filter((e) => (view === "failed" ? e.status === "failed" || e.status === "sending" : e.status === view));

  const companies = visibleCompanies(user.id).filter((c) => c.kind !== "personal");
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const documents = db.select({ id: schema.documents.id, name: schema.documents.name, companyId: schema.documents.companyId, usage: schema.documents.usage, archived: schema.documents.archived })
    .from(schema.documents).where(eq(schema.documents.userId, user.id)).all();
  const docName = new Map(documents.map((d) => [d.id, d.name]));
  const refs: TemplateRefs = {
    purposes: TEMPLATE_PURPOSES,
    companies: companies.map((c) => ({ id: c.id, name: c.name })),
    activities: getActivities(user.id).filter((a) => !a.archived && companyName.has(a.companyId)).map((a) => ({ id: a.id, companyId: a.companyId, name: a.name })),
    documents: documents.filter((d) => !d.archived && d.usage === "reusable").map((d) => ({ id: d.id, name: d.name, companyId: d.companyId })),
  };
  const authorizedCount = senders.filter((s) => s.authorized).length;

  return (
    <>
      <PageHeader
        title="Emails"
        description="Ce que vous avez envoyé à vos clients, ce qui attend en brouillon et ce qui n'est pas parti."
        actions={
          <>
            {view === "modeles" && <TemplateDialog refs={refs} />}
            <ButtonLink href="/emails/nouveau" variant="primary"><PenLine size={15} aria-hidden /> Nouvel email</ButtonLink>
          </>
        }
      />

      {!configured ? (
        <div className="mb-5">
          <Notice tone="warn" title="Envoi d'emails non configuré" action={<Link href="/parametres#emails" className={buttonClass("secondary", "sm")}>Paramètres</Link>}>
            Vous pouvez rédiger et enregistrer vos emails, mais aucun ne sera envoyé tant qu&apos;un serveur d&apos;envoi (SMTP) n&apos;est pas configuré.
          </Notice>
        </div>
      ) : authorizedCount === 0 ? (
        <div className="mb-5">
          <Notice tone="warn" title="Aucune adresse d'expédition autorisée" action={<Link href="/parametres#emails" className={buttonClass("secondary", "sm")}>Autoriser une adresse</Link>}>
            Autorisez au moins une adresse d&apos;expédition pour pouvoir envoyer.
          </Notice>
        </div>
      ) : null}

      <Tabs active={view} items={[
        ...STATUS_TABS.map((t) => ({ key: t.key, label: t.label, href: t.key === "tous" ? "/emails" : `/emails?statut=${t.key}`, count: counts[t.key as keyof typeof counts] })),
        { key: "modeles", label: "Modèles", href: "/emails?vue=modeles", count: templates.length },
      ]} />

      {view === "modeles" ? (
        <Card>
          {templates.length === 0 ? (
            <EmptyState title="Aucun modèle" description="Un modèle vous évite de réécrire les mêmes messages : proposition, envoi de facture, relance…" action={<TemplateDialog refs={refs} />} />
          ) : (
            <ul className="divide-y divide-line">
              {templates.map((t) => {
                const docIds = parseIds(t.defaultDocumentIds).filter((id) => docName.has(id));
                return (
                  <li key={t.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        <Badge tone="neutral">{TEMPLATE_PURPOSES[t.purpose] ?? "Autre"}</Badge>
                        {t.companyId && <span className="text-[12px] text-ink-3">{companyName.get(t.companyId) ?? ""}</span>}
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px] text-ink-2">Objet : {t.subject}</div>
                      <div className="line-clamp-2 text-[12.5px] text-ink-3">{t.body}</div>
                      {docIds.length > 0 && <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-3"><Paperclip size={12} aria-hidden /> {docIds.map((id) => docName.get(id)).join(", ")}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Link href={`/emails/nouveau?modele=${t.id}`} className={buttonClass("secondary", "sm", "h-7 px-2")}><Mail size={13} aria-hidden /> Utiliser</Link>
                      <TemplateDialog template={{ ...t, defaultDocumentIds: docIds }} refs={refs} />
                      <DeleteTemplateButton id={t.id} name={t.name} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          {list.length === 0 ? (
            emails.length === 0 ? (
              <EmptyState icon={<Mail size={20} />} title="Aucun email pour l'instant"
                description="Envoyez une proposition, un devis ou une relance avec vos documents en pièces jointes : tout est consigné sur la fiche du client."
                action={<ButtonLink href="/emails/nouveau" variant="primary" size="sm">Rédiger un email</ButtonLink>} />
            ) : (
              <EmptyState compact title={view === "failed" ? "Aucun envoi en échec" : view === "draft" ? "Aucun brouillon" : "Aucun email envoyé"}
                description={view === "failed" ? "Tous vos emails sont partis ou en brouillon." : undefined} />
            )
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Objet</Th>
                      <Th>Destinataire</Th>
                      <Th>Statut</Th>
                      <Th>Date</Th>
                      <Th><span className="sr-only">Ouvrir</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id} className="group hover:bg-surface-2/60">
                        <Td>
                          <Link href={`/emails/${e.id}`} className="font-medium hover:underline">{e.subject}</Link>
                          <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                            {attachCounts.get(e.id) ? <><Paperclip size={11} aria-hidden /> {attachCounts.get(e.id)} pièce{attachCounts.get(e.id)! > 1 ? "s" : ""} jointe{attachCounts.get(e.id)! > 1 ? "s" : ""}</> : "Sans pièce jointe"}
                            {e.companyId && companyName.get(e.companyId) && companies.length > 1 ? ` · ${companyName.get(e.companyId)}` : ""}
                          </div>
                        </Td>
                        <Td className="text-[12.5px]">
                          {e.contactId && contacts.get(e.contactId) ? <Link href={`/clients/${e.contactId}`} className="font-medium text-ink hover:underline">{contacts.get(e.contactId)}</Link> : null}
                          <div className="text-ink-3">{e.to || "Aucun destinataire"}</div>
                        </Td>
                        <Td>
                          <EmailStatusBadge status={e.status} />
                          {e.status === "failed" && e.error && <div className="mt-1 max-w-[260px] truncate text-[11.5px] text-bad" title={e.error}>{e.error}</div>}
                        </Td>
                        <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{e.sentAt ? `Envoyé le ${formatDate(e.sentAt.slice(0, 10), "day")}` : `Créé le ${formatDate(e.createdAt.slice(0, 10), "day")}`}</Td>
                        <Td align="right"><Link href={`/emails/${e.id}`} className="text-ink-3 group-hover:text-ink" aria-label={`Ouvrir l'email ${e.subject}`}><ChevronRight size={16} /></Link></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {list.map((e) => (
                  <li key={e.id}>
                    <Link href={`/emails/${e.id}`} className="block px-4 py-3">
                      <div className="truncate font-medium">{e.subject}</div>
                      <div className="truncate text-[12px] text-ink-3">{(e.contactId && contacts.get(e.contactId)) || e.to || "Aucun destinataire"}</div>
                      <div className="mt-1 flex items-center gap-2"><EmailStatusBadge status={e.status} /><span className="text-[11.5px] text-ink-3">{formatDate((e.sentAt ?? e.createdAt).slice(0, 10), "day")}</span></div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
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
