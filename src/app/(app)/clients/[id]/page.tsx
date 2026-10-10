import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, FileText, Mail, MailWarning, Paperclip, Phone, MapPin, Building2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSnapshot, visibleCompanies } from "@/lib/data";
import { formatDate, relativeDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { INTERACTION_TYPES, OPPORTUNITY_STAGES } from "@/lib/labels";
import { QUOTE_STATUS, quoteDisplayStatus } from "@/lib/invoices";
import { DOCUMENT_TYPES } from "@/lib/documents";
import { Badge, Card, CardHeader, EmptyState, InvoiceStatusBadge, Money, PageHeader, buttonClass, cx } from "@/components/ui";
import { TypeBadge, EmailStatusBadge } from "@/components/crm/badges";
import { contactFinance, followUpUrgency } from "@/components/crm/finance";
import { ArchiveButton, ConvertButton, EditContactDialog, FollowUpControl, InteractionDialog, NotesEditor, type ContactLite, type RefOptions } from "@/components/crm/contact-actions";
import { OpportunityDialog, StageMover, type OppRefs } from "@/components/crm/opportunities";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const c = db.select({ name: schema.contacts.name }).from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, user.id))).get();
  return { title: c ? c.name : "Fiche introuvable" };
}

const IX_TONE: Record<string, "good" | "info" | "warn" | "neutral" | "accent"> = {
  contract_signed: "good", payment_received: "good", converted: "good",
  proposal_sent: "info", quote_sent: "info", contract_sent: "info", invoice_issued: "info", email_sent: "info",
  follow_up: "warn", opportunity: "accent",
};

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const contact = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, user.id))).get();
  if (!contact) notFound();

  const snap = await getSnapshot(user.id);
  const { data } = snap;
  const today = data.today;
  const cur = data.baseCurrency;
  const fin = contactFinance(data, contact.id);
  const companies = visibleCompanies(user.id);
  const activityName = new Map(data.activities.map((a) => [a.id, a.name]));
  const companyName = new Map(data.companies.map((c) => [c.id, c.name]));

  const interactions = db.select().from(schema.interactions)
    .where(and(eq(schema.interactions.userId, user.id), eq(schema.interactions.contactId, contact.id)))
    .orderBy(desc(schema.interactions.date), desc(schema.interactions.createdAt)).all();
  const opportunities = db.select().from(schema.opportunities)
    .where(and(eq(schema.opportunities.userId, user.id), eq(schema.opportunities.contactId, contact.id)))
    .orderBy(desc(schema.opportunities.createdAt)).all();
  const documents = db.select().from(schema.documents)
    .where(and(eq(schema.documents.userId, user.id), eq(schema.documents.contactId, contact.id), eq(schema.documents.archived, false)))
    .orderBy(desc(schema.documents.createdAt)).all();
  const emails = db.select().from(schema.emails)
    .where(and(eq(schema.emails.userId, user.id), eq(schema.emails.contactId, contact.id)))
    .orderBy(desc(schema.emails.createdAt)).all();
  const quotes = data.invoices.filter((i) => i.docType === "quote" && i.contactId === contact.id).sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));

  const brands = db.select().from(schema.brands).where(eq(schema.brands.userId, user.id)).all();
  const refs: RefOptions = {
    companies: companies.filter((c) => c.kind !== "personal").map((c) => ({ id: c.id, name: c.name })),
    brands: brands.map((b) => ({ id: b.id, companyId: b.companyId, name: b.name })),
    activities: data.activities.filter((a) => !a.archived).map((a) => ({ id: a.id, companyId: a.companyId, name: a.name })),
  };
  const oppRefs: OppRefs = {
    contacts: [{ id: contact.id, name: contact.name, organization: contact.organization }],
    companies: companies.filter((c) => c.kind !== "personal").map((c) => ({ id: c.id, name: c.name, currency: c.currency })),
    activities: refs.activities,
    baseCurrency: cur,
  };
  const lite: ContactLite = {
    id: contact.id, type: contact.type, name: contact.name, organization: contact.organization, email: contact.email, phone: contact.phone,
    address: contact.address, companyId: contact.companyId, brandId: contact.brandId, activityId: contact.activityId, needs: contact.needs,
    notes: contact.notes, source: contact.source, nextFollowUpAt: contact.nextFollowUpAt, archived: contact.archived,
  };
  const urgency = followUpUrgency(contact.nextFollowUpAt, today, 3650);
  const openInvoices = fin.states.filter((s) => s.remaining > 0 && s.status !== "draft" && s.status !== "cancelled");
  const composeHref = (extra = "") => `/emails/nouveau?contact=${contact.id}${extra}`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/clients" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft size={13} aria-hidden /> Clients & prospects</Link>}
        title={<span className="flex flex-wrap items-center gap-2.5">{contact.name} <TypeBadge type={contact.type} archived={contact.archived} /></span>}
        description={[contact.organization, contact.activityId ? activityName.get(contact.activityId) : null, contact.source ? `Origine : ${contact.source}` : null].filter(Boolean).join(" · ") || "Fiche de contact"}
        actions={
          <>
            {contact.email ? (
              <Link href={composeHref()} className={buttonClass("primary", "sm")}><Mail size={14} aria-hidden /> Envoyer un email</Link>
            ) : (
              <span className="text-[12px] text-ink-3">Ajoutez une adresse email pour écrire depuis Recap.</span>
            )}
            {contact.type === "prospect" && !contact.archived && <ConvertButton id={contact.id} />}
            <EditContactDialog contact={lite} refs={refs} />
            <ArchiveButton id={contact.id} archived={contact.archived} />
          </>
        }
      />

      {contact.archived && (
        <div className="mb-5 rounded-xl bg-surface-3 px-4 py-3 text-[13px] text-ink-2">Cette fiche est archivée : elle n&apos;apparaît plus dans les listes ni dans les relances. Son historique reste consultable.</div>
      )}

      {contact.type !== "supplier" && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Facturé" value={fin.invoiced} cur={cur} hint={`${fin.invoiceCount} facture${fin.invoiceCount > 1 ? "s" : ""} émise${fin.invoiceCount > 1 ? "s" : ""}`} />
          <Figure label="Encaissé" value={fin.collected} cur={cur} hint={fin.lastPaymentDate ? `dernier paiement le ${formatDate(fin.lastPaymentDate, "day")}` : "aucun paiement reçu"} />
          <Figure label="Restant dû" value={fin.remaining} cur={cur} hint={fin.openCount ? `${fin.openCount} facture${fin.openCount > 1 ? "s" : ""} ouverte${fin.openCount > 1 ? "s" : ""}` : "rien à encaisser"} />
          <Figure label="En retard" value={fin.overdue} cur={cur} tone={fin.overdue > 0 ? "bad" : undefined} hint={fin.overdueCount ? `${fin.overdueCount} facture${fin.overdueCount > 1 ? "s" : ""} échue${fin.overdueCount > 1 ? "s" : ""}` : "aucun retard"} />
        </div>
      )}
      {fin.missingRate && <p className="-mt-3 mb-5 text-[12px] text-warn">Un taux de change manque pour convertir certains montants : ils sont exclus des totaux ci-dessus.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {contact.type !== "supplier" && (
            <Card>
              <CardHeader title="Factures & devis" description="Le statut de paiement est calculé à partir des paiements enregistrés." />
              {fin.states.length === 0 && quotes.length === 0 ? (
                <EmptyState compact icon={<FileText size={18} />} title="Aucune facture ni devis" description="Les factures et devis émis pour ce contact apparaîtront ici avec leur statut de paiement." />
              ) : (
                <ul className="divide-y divide-line border-t border-line">
                  {fin.states.map((s) => (
                    <li key={s.invoice.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/revenus/${s.invoice.id}`} className="font-medium underline-offset-4 hover:underline">Facture {s.invoice.number}</Link>
                          <InvoiceStatusBadge status={s.status} paid={s.paid > 0} />
                        </div>
                        <div className="text-[12px] text-ink-3">
                          {[s.invoice.title, `émise le ${formatDate(s.invoice.issueDate, "day")}`, `échéance ${formatDate(s.invoice.dueDate, "day")}`, companyName.get(s.invoice.companyId)].filter(Boolean).join(" · ")}
                          {s.status === "overdue" && <span className="text-bad"> · {s.daysOverdue} j de retard</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <Money value={s.invoice.total} currency={s.invoice.currency} className="text-[13.5px] font-medium" />
                          {s.remaining > 0 && s.remaining < s.invoice.total && <div className="text-[11.5px] text-ink-3">reste {formatMoney(s.remaining, s.invoice.currency)}</div>}
                        </div>
                        {contact.email && s.remaining > 0 && s.status !== "draft" && s.status !== "cancelled" && (
                          <Link href={composeHref(`&facture=${s.invoice.id}&modele=${s.status === "overdue" ? "invoice_reminder" : "invoice"}`)} className={buttonClass(s.status === "overdue" ? "secondary" : "ghost", "sm")}>
                            {s.status === "overdue" ? <><MailWarning size={14} aria-hidden /> Relancer</> : <><Mail size={14} aria-hidden /> Envoyer</>}
                          </Link>
                        )}
                        {contact.email && s.status === "draft" && (
                          <Link href={composeHref(`&facture=${s.invoice.id}&modele=invoice`)} className={buttonClass("ghost", "sm")}><Mail size={14} aria-hidden /> Envoyer</Link>
                        )}
                      </div>
                    </li>
                  ))}
                  {quotes.map((q) => {
                    const st = quoteDisplayStatus(q, today);
                    const meta = QUOTE_STATUS[st] ?? { label: st, tone: "neutral" as const };
                    return (
                      <li key={q.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><Link href={`/revenus/${q.id}`} className="font-medium underline-offset-4 hover:underline">Devis {q.number}</Link><Badge tone={meta.tone} dot>{meta.label}</Badge></div>
                          <div className="text-[12px] text-ink-3">{[q.title, `émis le ${formatDate(q.issueDate, "day")}`, `valable jusqu'au ${formatDate(q.dueDate, "day")}`].filter(Boolean).join(" · ")}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Money value={q.total} currency={q.currency} className="text-[13.5px] font-medium" />
                          {contact.email && (q.status === "draft" || q.status === "sent") && (
                            <Link href={composeHref(`&facture=${q.id}&modele=quote`)} className={buttonClass("ghost", "sm")}><Mail size={14} aria-hidden /> Envoyer</Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {openInvoices.length > 0 && <div className="border-t border-line px-5 py-2.5 text-[12px] text-ink-3">Pour enregistrer un paiement reçu, utilisez « Enregistrer un paiement » depuis le bouton d&apos;action rapide.</div>}
            </Card>
          )}

          {contact.type !== "supplier" && (
            <Card>
              <CardHeader title="Opportunités" description="Affaires en discussion avec ce contact." action={<OpportunityDialog refs={oppRefs} contactId={contact.id} defaultCompanyId={contact.companyId} />} />
              {opportunities.length === 0 ? (
                <p className="px-5 pb-5 text-[13px] text-ink-3">Aucune opportunité. Créez-en une dès qu&apos;un besoin chiffrable se dessine : elle alimentera votre pipeline.</p>
              ) : (
                <ul className="divide-y divide-line border-t border-line">
                  {opportunities.map((o) => (
                    <li key={o.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{o.title}</div>
                        <div className="text-[12px] text-ink-3">
                          {[o.stage !== "won" && o.stage !== "lost" ? `probabilité ${o.probability} %` : OPPORTUNITY_STAGES[o.stage]?.label,
                            o.expectedCloseDate && o.stage !== "won" && o.stage !== "lost" ? `décision ${formatDate(o.expectedCloseDate, "day")}` : null,
                            o.activityId ? activityName.get(o.activityId) : null].filter(Boolean).join(" · ")}
                        </div>
                        {o.agreedTerms && <div className="mt-0.5 text-[12px] text-ink-2">Conditions : {o.agreedTerms}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Money value={o.amount} currency={o.currency} className="text-[13.5px] font-medium" />
                        <StageMover id={o.id} stage={o.stage} />
                        <OpportunityDialog refs={oppRefs} opportunity={{ ...o }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Historique de la relation" description="Échanges, propositions, contrats, factures et paiements, du plus récent au plus ancien."
              action={<InteractionDialog contactId={contact.id} today={today} />} />
            {interactions.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-3">Aucun événement. Ajoutez votre premier échange pour garder la mémoire de la relation.</p>
            ) : (
              <ol className="relative mx-5 mb-5 border-l border-line pl-5">
                {interactions.map((ix) => (
                  <li key={ix.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-ink-3" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={IX_TONE[ix.type] ?? "neutral"}>{INTERACTION_TYPES[ix.type] ?? ix.type}</Badge>
                      <span className="text-[12px] text-ink-3">{formatDate(ix.date)}</span>
                    </div>
                    <div className="mt-1 text-[13.5px] text-ink">
                      {ix.refType === "email" && ix.refId ? <Link href={`/emails/${ix.refId}`} className="hover:underline">{ix.title}</Link> : ix.title}
                    </div>
                    {ix.details && <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-ink-2">{ix.details}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Coordonnées" />
            <dl className="space-y-2.5 px-5 pb-5 text-[13px]">
              <Row icon={<Mail size={14} />} label="Email">{contact.email ? <a href={`mailto:${contact.email}`} className="break-all hover:underline">{contact.email}</a> : <span className="text-ink-3">Non renseigné</span>}</Row>
              <Row icon={<Phone size={14} />} label="Téléphone">{contact.phone ? <a href={`tel:${contact.phone.replace(/\s+/g, "")}`} className="hover:underline">{contact.phone}</a> : <span className="text-ink-3">Non renseigné</span>}</Row>
              <Row icon={<MapPin size={14} />} label="Adresse">{contact.address ?? <span className="text-ink-3">Non renseignée</span>}</Row>
              {contact.companyId && <Row icon={<Building2 size={14} />} label="Structure">{companyName.get(contact.companyId) ?? "—"}</Row>}
            </dl>
          </Card>

          {!contact.archived && contact.type !== "supplier" && (
            <Card>
              <CardHeader title="Relance" description={contact.nextFollowUpAt
                ? `Prévue le ${formatDate(contact.nextFollowUpAt, "long")} (${relativeDays(contact.nextFollowUpAt, today)}).`
                : "Aucune relance programmée."} />
              <div className="px-5 pb-5">
                {urgency === "late" && <p className="mb-3 text-[12.5px] text-bad">Cette relance est en retard.</p>}
                <FollowUpControl id={contact.id} current={contact.nextFollowUpAt} today={today} />
              </div>
            </Card>
          )}

          {contact.needs && (
            <Card>
              <CardHeader title="Besoins exprimés" />
              <p className="whitespace-pre-wrap px-5 pb-5 text-[13.5px] text-ink-2">{contact.needs}</p>
            </Card>
          )}

          <Card>
            <CardHeader title="Notes internes" description="Visibles uniquement par vous." />
            <div className="px-5 pb-5"><NotesEditor contact={lite} /></div>
          </Card>

          <Card>
            <CardHeader title="Documents" description="Fichiers transmis à ce contact ou reçus de lui." action={<Link href={`/documents?usage=client&contact=${contact.id}`} className={buttonClass("ghost", "sm")}>Gérer</Link>} />
            {documents.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-3">Aucun document rattaché. Les fichiers joints depuis le composeur d&apos;email y sont classés automatiquement.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {documents.slice(0, 8).map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-5 py-2.5 text-[13px]">
                    <Paperclip size={14} className="shrink-0 text-ink-3" aria-hidden />
                    <a href={`/api/documents/${d.id}?inline=1`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate hover:underline">{d.name}</a>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{DOCUMENT_TYPES[d.type] ?? "Autre"}{d.currentVersion > 1 ? ` · v${d.currentVersion}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Emails" action={contact.email ? <Link href={composeHref()} className={buttonClass("ghost", "sm")}>Écrire</Link> : undefined} />
            {emails.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-3">Aucun email envoyé depuis Recap à ce contact.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {emails.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <Link href={`/emails/${e.id}`} className="block px-5 py-2.5 hover:bg-surface-2/60">
                      <div className="truncate text-[13px] font-medium">{e.subject}</div>
                      <div className="mt-0.5 flex items-center gap-2"><EmailStatusBadge status={e.status} /><span className="text-[11.5px] text-ink-3">{formatDate((e.sentAt ?? e.createdAt).slice(0, 10), "day")}</span></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

function Figure({ label, value, cur, hint, tone }: { label: string; value: number; cur: string; hint?: string; tone?: "bad" }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className={cx("mt-1 text-[20px] font-semibold tracking-[-0.01em] tabular", tone === "bad" && value > 0 && "text-bad")}>{formatMoney(value, cur)}</div>
      {hint && <div className="text-[12px] text-ink-3">{hint}</div>}
    </Card>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 text-ink-3" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}
