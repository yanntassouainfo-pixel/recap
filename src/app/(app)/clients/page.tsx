import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { BellRing, ChevronRight, Mail, Plus, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getScope, getSnapshot, visibleCompanies } from "@/lib/data";
import { formatDate, relativeDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { OPPORTUNITY_STAGES } from "@/lib/labels";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Money, PageHeader, Segmented, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import { ClientFilters } from "@/components/crm/client-filters";
import { TypeBadge } from "@/components/crm/badges";
import { STAGE_ORDER, contactFinances, followUpUrgency, pipelineTotals, type FollowUpUrgency } from "@/components/crm/finance";
import { OpportunityDialog, StageMover, type OppRefs } from "@/components/crm/opportunities";

export const metadata = { title: "Clients & prospects" };

const URGENCY: Record<FollowUpUrgency, { label: string; tone: "bad" | "warn" | "info" }> = {
  late: { label: "En retard", tone: "bad" },
  today: { label: "Aujourd'hui", tone: "warn" },
  soon: { label: "Cette semaine", tone: "info" },
};

function norm(s: string | null | undefined) {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [snap, scope] = await Promise.all([getSnapshot(user.id), getScope(user.id)]);
  const { data } = snap;
  const today = data.today;
  const cur = data.baseCurrency;
  const view = sp.vue === "pipeline" ? "pipeline" : "contacts";

  const all = db.select().from(schema.contacts).where(eq(schema.contacts.userId, user.id)).all();
  const companies = visibleCompanies(user.id);
  const activities = data.activities.filter((a) => !a.archived && companies.some((c) => c.id === a.companyId));
  const activityName = new Map(data.activities.map((a) => [a.id, a.name]));
  const finances = contactFinances(data);

  const lastInteraction = new Map<string, { date: string; title: string }>();
  for (const ix of db.select({ contactId: schema.interactions.contactId, date: schema.interactions.date, title: schema.interactions.title })
    .from(schema.interactions).where(eq(schema.interactions.userId, user.id)).orderBy(desc(schema.interactions.date)).all()) {
    if (!lastInteraction.has(ix.contactId)) lastInteraction.set(ix.contactId, { date: ix.date, title: ix.title });
  }

  const opportunities = db.select().from(schema.opportunities).where(eq(schema.opportunities.userId, user.id)).orderBy(desc(schema.opportunities.createdAt)).all();
  const contactsById = new Map(all.map((c) => [c.id, c]));
  const active = all.filter((c) => !c.archived);
  const oppRefs: OppRefs = {
    contacts: active.filter((c) => c.type !== "supplier").map((c) => ({ id: c.id, name: c.name, organization: c.organization })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    companies: companies.filter((c) => c.kind !== "personal").map((c) => ({ id: c.id, name: c.name, currency: c.currency })),
    activities: activities.map((a) => ({ id: a.id, companyId: a.companyId, name: a.name })),
    baseCurrency: cur,
  };

  // Relances : prospects et clients actifs dont la relance est passée, aujourd'hui ou dans les 7 jours.
  const followUps = active
    .map((c) => ({ c, urgency: followUpUrgency(c.nextFollowUpAt, today) }))
    .filter((x): x is { c: typeof x.c; urgency: FollowUpUrgency } => x.urgency !== null)
    .sort((a, b) => (a.c.nextFollowUpAt! < b.c.nextFollowUpAt! ? -1 : 1));

  // Filtres
  const type = sp.type ?? "actifs";
  const q = norm(sp.q);
  const activityFilter = sp.activite ?? "";
  const typeCounts = {
    actifs: active.filter((c) => c.type !== "supplier").length,
    prospect: active.filter((c) => c.type === "prospect").length,
    client: active.filter((c) => c.type === "client").length,
    supplier: active.filter((c) => c.type === "supplier").length,
    archives: all.filter((c) => c.archived).length,
  };
  const filtered = all
    .filter((c) => {
      if (type === "archives") return c.archived;
      if (c.archived) return false;
      if (type === "actifs") return c.type !== "supplier";
      return c.type === type;
    })
    .filter((c) => !activityFilter || c.activityId === activityFilter)
    .filter((c) => !q || [c.name, c.organization, c.email, c.phone].some((v) => norm(v).includes(q)))
    .sort((a, b) => {
      const fa = finances.get(a.id)?.overdue ?? 0;
      const fb = finances.get(b.id)?.overdue ?? 0;
      if (fa !== fb) return fb - fa;
      return a.name.localeCompare(b.name, "fr");
    });

  const totalRemaining = active.reduce((s, c) => s + (finances.get(c.id)?.remaining ?? 0), 0);
  const totalOverdue = active.reduce((s, c) => s + (finances.get(c.id)?.overdue ?? 0), 0);
  const missingRate = [...finances.values()].some((f) => f.missingRate);
  const openOpps = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const openTotals = pipelineTotals(data, openOpps);
  const pipelineAmount = [...openTotals.values()].reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <PageHeader
        title="Clients & prospects"
        description="Qui relancer aujourd'hui, où en sont vos affaires et combien chaque client vous doit encore."
        actions={
          <>
            <OpportunityDialog refs={oppRefs} />
            <QuickButton kind="contact" className={buttonClass("primary", "md")}><Plus size={15} aria-hidden /> Ajouter un contact</QuickButton>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Prospects" value={String(typeCounts.prospect)} hint="fiches actives" />
        <Stat label="Clients" value={String(typeCounts.client)} hint="fiches actives" />
        <Stat label="Restant dû par vos clients" value={formatMoney(totalRemaining, cur)} hint={totalOverdue > 0 ? `dont ${formatMoney(totalOverdue, cur)} en retard` : "aucun retard"} tone={totalOverdue > 0 ? "bad" : undefined} />
        <Stat label="Affaires en cours" value={formatMoney(pipelineAmount, cur)} hint={`${openOpps.length} opportunité${openOpps.length > 1 ? "s" : ""} ouverte${openOpps.length > 1 ? "s" : ""} · montant non pondéré`} />
      </div>
      {missingRate && (
        <p className="-mt-3 mb-5 text-[12px] text-warn">Certains montants en devise étrangère n&apos;ont pas pu être convertis faute de taux de change : ils ne sont pas inclus dans les totaux.</p>
      )}

      <FollowUpsCard items={followUps} today={today} lastInteraction={lastInteraction} />

      <div className="mb-4 mt-8 flex items-center justify-between gap-3">
        <Segmented active={view} items={[
          { key: "contacts", label: "Contacts", href: "/clients" },
          { key: "pipeline", label: "Pipeline commercial", href: "/clients?vue=pipeline" },
        ]} />
        {scope.company === null && companies.length > 1 && <span className="hidden text-[12px] text-ink-3 md:inline">Fiches communes à toutes vos structures</span>}
      </div>

      {view === "contacts" ? (
        <Card>
          <div className="border-b border-line px-4 py-3">
            <ClientFilters
              types={[
                { key: "actifs", label: "Clients & prospects", count: typeCounts.actifs },
                { key: "prospect", label: "Prospects", count: typeCounts.prospect },
                { key: "client", label: "Clients", count: typeCounts.client },
                { key: "supplier", label: "Fournisseurs", count: typeCounts.supplier },
                { key: "archives", label: "Archivés", count: typeCounts.archives },
              ]}
              activities={activities.map((a) => ({ id: a.id, name: a.name }))}
            />
          </div>
          {filtered.length === 0 ? (
            all.length === 0 ? (
              <EmptyState icon={<Users size={20} />} title="Aucun contact pour l'instant"
                description="Ajoutez vos clients et prospects pour suivre vos échanges, vos relances et ce qu'ils vous doivent."
                action={<QuickButton kind="contact" className={buttonClass("primary", "sm")}><Plus size={14} aria-hidden /> Ajouter un premier contact</QuickButton>} />
            ) : (
              <EmptyState compact title="Aucune fiche ne correspond" description="Modifiez la recherche ou le filtre pour élargir la liste."
                action={<ButtonLink href="/clients" size="sm">Réinitialiser les filtres</ButtonLink>} />
            )
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Contact</Th>
                      <Th>Statut</Th>
                      <Th>Activité</Th>
                      <Th>Dernier échange</Th>
                      <Th>Prochaine relance</Th>
                      <Th align="right">Restant dû</Th>
                      <Th><span className="sr-only">Ouvrir</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const f = finances.get(c.id);
                      const last = lastInteraction.get(c.id);
                      const urgency = followUpUrgency(c.nextFollowUpAt, today);
                      return (
                        <tr key={c.id} className="group hover:bg-surface-2/60">
                          <Td>
                            <Link href={`/clients/${c.id}`} className="font-medium text-ink hover:underline">{c.name}</Link>
                            <div className="text-[12px] text-ink-3">{[c.organization, c.email].filter(Boolean).join(" · ") || "—"}</div>
                          </Td>
                          <Td><TypeBadge type={c.type} archived={c.archived} /></Td>
                          <Td className="text-ink-2">{c.activityId ? activityName.get(c.activityId) ?? "—" : "—"}</Td>
                          <Td className="text-[12.5px] text-ink-2">{last ? <><span className="text-ink-3">{formatDate(last.date, "day")} · </span>{truncate(last.title, 38)}</> : <span className="text-ink-3">—</span>}</Td>
                          <Td className="text-[12.5px]">
                            {c.nextFollowUpAt ? (
                              <span className={cx(urgency === "late" ? "text-bad" : urgency === "today" ? "text-warn" : "text-ink-2")}>
                                {formatDate(c.nextFollowUpAt, "day")}{urgency === "late" ? " · en retard" : urgency === "today" ? " · aujourd'hui" : ""}
                              </span>
                            ) : <span className="text-ink-3">—</span>}
                          </Td>
                          <Td align="right">
                            {f && f.remaining > 0 ? (
                              <div>
                                <Money value={f.remaining} currency={cur} className="font-medium" />
                                {f.overdue > 0 && <div className="text-[11.5px] text-bad">dont {formatMoney(f.overdue, cur)} en retard</div>}
                              </div>
                            ) : <span className="text-ink-3">—</span>}
                          </Td>
                          <Td align="right"><Link href={`/clients/${c.id}`} className="text-ink-3 group-hover:text-ink" aria-label={`Ouvrir la fiche ${c.name}`}><ChevronRight size={16} /></Link></Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {filtered.map((c) => {
                  const f = finances.get(c.id);
                  const urgency = followUpUrgency(c.nextFollowUpAt, today);
                  return (
                    <li key={c.id}>
                      <Link href={`/clients/${c.id}`} className="flex items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2"><span className="truncate font-medium">{c.name}</span><TypeBadge type={c.type} archived={c.archived} /></div>
                          <div className="truncate text-[12px] text-ink-3">{c.organization || c.email || "—"}</div>
                          {c.nextFollowUpAt && <div className={cx("mt-0.5 text-[12px]", urgency === "late" ? "text-bad" : "text-ink-2")}>Relance : {formatDate(c.nextFollowUpAt, "day")}{urgency === "late" ? " (en retard)" : ""}</div>}
                        </div>
                        {f && f.remaining > 0 && (
                          <div className="text-right text-[12.5px]">
                            <Money value={f.remaining} currency={cur} className="font-medium" />
                            <div className={cx("text-[11px]", f.overdue > 0 ? "text-bad" : "text-ink-3")}>{f.overdue > 0 ? "dont retard" : "restant dû"}</div>
                          </div>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      ) : (
        <Pipeline opportunities={opportunities.filter((o) => !contactsById.get(o.contactId)?.archived)} contactsById={contactsById} data={data} refs={oppRefs} today={today} />
      )}
    </>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tracking-[-0.01em] tabular">{value}</div>
      {hint && <div className={cx("text-[12px]", tone === "bad" ? "text-bad" : "text-ink-3")}>{hint}</div>}
    </Card>
  );
}

function FollowUpsCard({ items, today, lastInteraction }: {
  items: { c: typeof schema.contacts.$inferSelect; urgency: FollowUpUrgency }[];
  today: string;
  lastInteraction: Map<string, { date: string; title: string }>;
}) {
  return (
    <Card>
      <CardHeader title="Relances à faire" description="Relances en retard, du jour et des 7 prochains jours."
        action={items.length ? <Badge tone={items.some((i) => i.urgency === "late") ? "bad" : "info"}>{items.length} à traiter</Badge> : undefined} />
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 pb-5 text-[13px] text-ink-3">
          <BellRing size={16} aria-hidden /> Aucune relance prévue cette semaine. Programmez-en une depuis la fiche d&apos;un prospect pour ne pas laisser filer une affaire.
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {items.slice(0, 8).map(({ c, urgency }) => {
            const last = lastInteraction.get(c.id);
            return (
              <li key={c.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <Badge tone={URGENCY[urgency].tone} dot>{URGENCY[urgency].label}</Badge>
                    <span className="text-[12px] text-ink-3">{formatDate(c.nextFollowUpAt, "day")} ({relativeDays(c.nextFollowUpAt!, today)})</span>
                  </div>
                  <div className="truncate text-[12.5px] text-ink-3">{last ? `Dernier échange : ${last.title} (${formatDate(last.date, "day")})` : "Aucun échange enregistré"}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {c.email && (
                    <Link href={`/emails/nouveau?contact=${c.id}&modele=${c.type === "prospect" ? "proposal_follow_up" : "meeting_follow_up"}`} className={buttonClass("secondary", "sm")}>
                      <Mail size={14} aria-hidden /> Écrire
                    </Link>
                  )}
                  <Link href={`/clients/${c.id}`} className={buttonClass("ghost", "sm")}>Ouvrir la fiche</Link>
                </div>
              </li>
            );
          })}
          {items.length > 8 && <li className="px-5 py-2.5 text-[12.5px] text-ink-3">Et {items.length - 8} autre{items.length - 8 > 1 ? "s" : ""} relance{items.length - 8 > 1 ? "s" : ""} — triez la liste ci-dessous par prochaine relance.</li>}
        </ul>
      )}
    </Card>
  );
}

function Pipeline({ opportunities, contactsById, data, refs, today }: {
  opportunities: (typeof schema.opportunities.$inferSelect)[];
  contactsById: Map<string, typeof schema.contacts.$inferSelect>;
  data: Parameters<typeof pipelineTotals>[0];
  refs: OppRefs;
  today: string;
}) {
  const totals = pipelineTotals(data, opportunities);
  const cur = data.baseCurrency;
  if (opportunities.length === 0) {
    return (
      <Card>
        <EmptyState title="Aucune opportunité" description="Une opportunité, c'est une affaire en discussion : un montant estimé, une probabilité, une date de décision. Créez-en une pour suivre votre pipeline."
          action={<OpportunityDialog refs={refs} triggerClassName={buttonClass("primary", "sm")} />} />
      </Card>
    );
  }
  return (
    <>
      <p className="mb-3 text-[12.5px] text-ink-3">
        Les montants sont estimés : ils ne deviennent du facturé qu&apos;une fois la facture émise. Le prévisionnel ne les compte que dans le scénario optimiste, pondérés par leur probabilité.
      </p>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
        {STAGE_ORDER.map((stage) => {
          const items = opportunities.filter((o) => o.stage === stage);
          const t = totals.get(stage);
          return (
            <section key={stage} className="flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl bg-surface-2 p-2.5 lg:w-auto lg:max-w-none" aria-label={OPPORTUNITY_STAGES[stage].label}>
              <header className="px-1.5 pb-2 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">{OPPORTUNITY_STAGES[stage].label}</h3>
                  <span className="rounded-full bg-surface-3 px-1.5 text-[11px] tabular text-ink-3">{items.length}</span>
                </div>
                <div className="text-[12px] text-ink-3 tabular">
                  {t ? formatMoney(t.amount, cur) : formatMoney(0, cur)}
                  {t && stage !== "won" && stage !== "lost" && t.weighted !== t.amount ? ` · pondéré ${formatMoney(t.weighted, cur)}` : ""}
                </div>
              </header>
              <ul className="flex flex-1 flex-col gap-2">
                {items.length === 0 && <li className="rounded-xl border border-dashed border-line-2 px-3 py-4 text-center text-[12px] text-ink-3">Aucune affaire à cette étape</li>}
                {items.map((o) => {
                  const contact = contactsById.get(o.contactId);
                  const late = o.expectedCloseDate && o.expectedCloseDate < today && stage !== "won" && stage !== "lost";
                  return (
                    <li key={o.id} className="card px-3 py-2.5">
                      <div className="text-[13px] font-medium leading-snug">{o.title}</div>
                      {contact && <Link href={`/clients/${contact.id}`} className="text-[12px] text-ink-3 hover:text-ink hover:underline">{contact.name}</Link>}
                      <div className="mt-1.5 flex items-baseline justify-between gap-2">
                        <Money value={o.amount} currency={o.currency} className="text-[13px] font-semibold" />
                        {stage !== "won" && stage !== "lost" && <span className="text-[11.5px] text-ink-3">{o.probability} %</span>}
                      </div>
                      {o.expectedCloseDate && stage !== "won" && stage !== "lost" && (
                        <div className={cx("text-[11.5px]", late ? "text-warn" : "text-ink-3")}>Décision {late ? "attendue depuis le" : "prévue le"} {formatDate(o.expectedCloseDate, "day")}</div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-1 border-t border-line pt-2">
                        <StageMover id={o.id} stage={o.stage} compact />
                        <OpportunityDialog refs={refs} opportunity={{ ...o }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
