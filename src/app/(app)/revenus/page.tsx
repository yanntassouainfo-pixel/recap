import Link from "next/link";
import { FilePlus2, FileText, Plus, Receipt, Search, Upload } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getContacts, getScope, getSnapshot, visibleCompanies } from "@/lib/data";
import { formatDate, resolvePeriod, type PeriodKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { periodFlows, toBase } from "@/lib/finance/engine";
import { INVOICE_STATUS_FILTERS, PAYMENT_METHOD_LABELS, QUOTE_STATUS, matchesStatusFilter, quoteDisplayStatus } from "@/lib/invoices";
import {
  Badge, BigMoney, ButtonLink, Card, EmptyState, InvoiceStatusBadge, Money, PageHeader, Segmented, Select, Table, Tabs, Td, Th, buttonClass, cx,
} from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import { DeleteIncomeButton } from "@/components/invoices/buttons";

export const metadata = { title: "Revenus & factures" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const QUOTE_FILTERS = [
  { key: "", label: "Tous" },
  { key: "draft", label: "Brouillons" },
  { key: "sent", label: "Envoyés" },
  { key: "expired", label: "Expirés" },
  { key: "accepted", label: "Acceptés" },
  { key: "declined", label: "Refusés" },
  { key: "cancelled", label: "Annulés" },
];

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "month", label: "Mois" },
  { key: "quarter", label: "Trimestre" },
  { key: "year", label: "Année" },
];

export default async function RevenusPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await getScope(user.id);
  const snapshot = await getSnapshot(user.id);
  const { data } = snapshot;
  const today = data.today;
  const cur = data.baseCurrency;

  const tab = ["factures", "devis", "recettes"].includes(one(sp.onglet)) ? one(sp.onglet) : "factures";
  const statut = one(sp.statut);
  const structure = one(sp.structure);
  const activite = one(sp.activite);
  const client = one(sp.client);
  const q = one(sp.q).trim();
  const periodKey = (PERIODS.some((p) => p.key === one(sp.periode)) ? one(sp.periode) : "month") as PeriodKey;
  const period = resolvePeriod(periodKey, today);

  const companies = visibleCompanies(user.id).filter((c) => scope.companyIds.has(c.id));
  const companiesById = new Map(data.companies.map((c) => [c.id, c]));
  const activitiesById = new Map(data.activities.map((a) => [a.id, a]));
  const contactsById = new Map(data.contacts.map((c) => [c.id, c]));
  const activities = data.activities.filter((a) => scope.companyIds.has(a.companyId) && !a.archived);
  // Colonnes absentes de l'instantané du moteur : lues directement (toujours filtrées par utilisateur).
  const allIncomes = db.select().from(schema.incomes).where(eq(schema.incomes.userId, user.id)).all();
  const importedIds = new Set(db.select({ id: schema.invoices.id }).from(schema.invoices).where(and(eq(schema.invoices.userId, user.id), eq(schema.invoices.source, "imported"))).all().map((r) => r.id));
  const clientOptions = getContacts(user.id).filter((c) => !c.archived && c.type !== "supplier").sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = { onglet: tab, statut, structure, activite, client, q, periode: periodKey === "month" ? "" : periodKey };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v && !(k === "onglet" && v === "factures")) p.set(k, v);
    const s = p.toString();
    return s ? `/revenus?${s}` : "/revenus";
  };

  /* ── Indicateurs (devise de base, flux internes exclus) ── */
  const internal = (counterpartCompanyId: string | null) => !!counterpartCompanyId && data.scopeCompanyIds.has(counterpartCompanyId);
  let invoiced = 0;
  let invoicedCount = 0;
  let missingRate = false;
  for (const s of snapshot.states.values()) {
    const inv = s.invoice;
    if (inv.status === "draft" || inv.status === "cancelled" || internal(inv.counterpartCompanyId)) continue;
    if (inv.issueDate < period.from || inv.issueDate > period.to) continue;
    const c = toBase(data, inv.total, inv.currency, inv.issueDate);
    if (c.missing) missingRate = true;
    invoiced += c.value;
    invoicedCount++;
  }
  const flows = periodFlows(snapshot.movements, period.from, period.to);
  const rec = snapshot.receivables;
  const overdueCount = rec.items.filter((i) => i.status === "overdue").length;

  /* ── Filtres communs ── */
  const needle = q.toLowerCase();
  const matchCommon = (o: { companyId: string; activityId: string | null; contactId: string | null; text: string }) =>
    (!structure || o.companyId === structure) && (!activite || o.activityId === activite) && (!client || o.contactId === client) && (!needle || o.text.toLowerCase().includes(needle));

  const partyName = (inv: { contactId: string | null; counterpartCompanyId: string | null }) =>
    inv.contactId ? contactsById.get(inv.contactId)?.name ?? "Client supprimé" : inv.counterpartCompanyId ? companiesById.get(inv.counterpartCompanyId)?.name ?? "Structure" : "Client non renseigné";

  const invoiceRows = [...snapshot.states.values()]
    .filter((s) => matchCommon({ companyId: s.invoice.companyId, activityId: s.invoice.activityId, contactId: s.invoice.contactId, text: `${s.invoice.number} ${s.invoice.title ?? ""} ${partyName(s.invoice)}` }))
    .filter((s) => matchesStatusFilter(statut, s))
    .sort((a, b) => (a.invoice.issueDate === b.invoice.issueDate ? b.invoice.number.localeCompare(a.invoice.number) : a.invoice.issueDate < b.invoice.issueDate ? 1 : -1));

  const quotes = data.invoices.filter((i) => i.docType === "quote" && scope.companyIds.has(i.companyId));
  const quoteRows = quotes
    .map((qt) => ({ q: qt, status: quoteDisplayStatus(qt, today) }))
    .filter((r) => matchCommon({ companyId: r.q.companyId, activityId: r.q.activityId, contactId: r.q.contactId, text: `${r.q.number} ${r.q.title ?? ""} ${partyName(r.q)}` }))
    .filter((r) => !statut || r.status === statut)
    .sort((a, b) => (a.q.issueDate < b.q.issueDate ? 1 : -1));

  const incomeRows = allIncomes
    .filter((i) => scope.companyIds.has(i.companyId))
    .filter((i) => matchCommon({ companyId: i.companyId, activityId: i.activityId, contactId: i.contactId, text: `${i.description} ${i.reference ?? ""} ${i.contactId ? contactsById.get(i.contactId)?.name ?? "" : ""}` }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const totalInvoices = snapshot.states.size;
  const filtered = !!(statut || structure || activite || client || q);
  const statusFilters = tab === "devis" ? QUOTE_FILTERS : tab === "factures" ? INVOICE_STATUS_FILTERS : [];

  return (
    <>
      <PageHeader
        title="Revenus & factures"
        description="Qui vous doit de l'argent, combien vous avez facturé et ce qui est réellement encaissé."
        actions={
          <>
            <QuickButton kind="income" className={buttonClass("secondary")}><Plus size={15} aria-hidden /> Ajouter une recette</QuickButton>
            <ButtonLink href="/revenus/importer"><Upload size={15} aria-hidden /> Importer</ButtonLink>
            <ButtonLink href="/revenus/nouveau?type=quote"><FileText size={15} aria-hidden /> Créer un devis</ButtonLink>
            <ButtonLink href="/revenus/nouveau" variant="primary"><FilePlus2 size={15} aria-hidden /> Créer une facture</ButtonLink>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-3">{period.label} · du {formatDate(period.from)} au {formatDate(period.to)} · montants en {cur}</p>
        <Segmented items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: href({ periode: p.key === "month" ? "" : p.key }) }))} active={periodKey} />
      </div>
      <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi label="Facturé" sub={`${invoicedCount} facture${invoicedCount > 1 ? "s" : ""} émise${invoicedCount > 1 ? "s" : ""} sur la période`} value={invoiced} cur={cur} />
        <Kpi label="Encaissé" sub="Paiements reçus et recettes directes" value={flows.income} cur={cur} tone="good" />
        <Kpi label="À encaisser, non échu" sub="Factures envoyées, échéance à venir" value={rec.notDue} cur={cur} href={href({ onglet: "", statut: "open" })} />
        <Kpi label="En retard" sub={overdueCount ? `${overdueCount} facture${overdueCount > 1 ? "s" : ""} à relancer` : "Aucun retard"} value={rec.overdue} cur={cur} tone={rec.overdue > 0 ? "bad" : undefined} href={href({ onglet: "", statut: "overdue" })} />
      </div>
      {(missingRate || flows.missingRateCount > 0) && (
        <p className="-mt-5 mb-6 text-[12px] text-warn">Certains montants en devise étrangère n&apos;ont pas de taux de change enregistré : ils sont exclus des totaux.</p>
      )}

      <Tabs
        active={tab}
        items={[
          { key: "factures", label: "Factures", href: href({ onglet: "", statut: "" }), count: totalInvoices },
          { key: "devis", label: "Devis", href: href({ onglet: "devis", statut: "" }), count: quotes.length },
          { key: "recettes", label: "Recettes directes", href: href({ onglet: "recettes", statut: "" }), count: allIncomes.filter((i) => scope.companyIds.has(i.companyId)).length },
        ]}
      />

      <form method="get" action="/revenus" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]">
        {tab !== "factures" && <input type="hidden" name="onglet" value={tab} />}
        {periodKey !== "month" && <input type="hidden" name="periode" value={periodKey} />}
        <label className="relative">
          <span className="sr-only">Rechercher</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input name="q" defaultValue={q} placeholder={tab === "recettes" ? "Rechercher une recette…" : "Numéro, objet, client…"} className="field-input w-full pl-9" />
        </label>
        {statusFilters.length > 0 ? (
          <Select name="statut" defaultValue={statut} aria-label="Statut">
            {statusFilters.map((f) => <option key={f.key} value={f.key}>{f.key ? f.label : "Tous les statuts"}</option>)}
          </Select>
        ) : <span className="hidden lg:block" />}
        {companies.length > 1 ? (
          <Select name="structure" defaultValue={structure} aria-label="Structure">
            <option value="">Toutes les structures</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : <span className="hidden lg:block" />}
        <Select name="activite" defaultValue={activite} aria-label="Activité">
          <option value="">Toutes les activités</option>
          {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select name="client" defaultValue={client} aria-label="Client">
          <option value="">Tous les clients</option>
          {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("secondary")}>Filtrer</button>
          {filtered && <Link href={href({ statut: "", structure: "", activite: "", client: "", q: "" })} className={buttonClass("ghost")}>Effacer</Link>}
        </div>
      </form>

      {tab === "factures" && (
        <Card>
          {invoiceRows.length === 0 ? (
            filtered ? (
              <EmptyState compact icon={<Search size={20} />} title="Aucune facture ne correspond à ces filtres" description="Élargissez la recherche ou effacez les filtres."
                action={<ButtonLink href={href({ statut: "", structure: "", activite: "", client: "", q: "" })}>Effacer les filtres</ButtonLink>} />
            ) : (
              <EmptyState icon={<Receipt size={20} />} title="Aucune facture pour l'instant"
                description="Créez votre première facture : Recap suivra son échéance, ses paiements et vous signalera les retards."
                action={<><ButtonLink href="/revenus/nouveau" variant="primary">Créer une facture</ButtonLink><ButtonLink href="/revenus/importer">Importer une facture existante</ButtonLink></>} />
            )
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead><tr><Th>Facture</Th><Th>Client</Th><Th>Émise le</Th><Th>Échéance</Th><Th align="right">Montant</Th><Th align="right">Restant dû</Th><Th>Statut</Th></tr></thead>
                  <tbody>
                    {invoiceRows.map((s) => {
                      const inv = s.invoice;
                      const act = inv.activityId ? activitiesById.get(inv.activityId) : undefined;
                      return (
                        <tr key={inv.id} className={cx("hover:bg-surface-2", inv.status === "cancelled" && "text-ink-3")}>
                          <Td>
                            <Link href={`/revenus/${inv.id}`} className="font-medium text-ink hover:underline underline-offset-4">{inv.number}</Link>
                            <div className="max-w-[260px] truncate text-[12px] text-ink-3">{[inv.title, act?.name, companies.length > 1 ? companiesById.get(inv.companyId)?.name : null].filter(Boolean).join(" · ") || "—"}</div>
                          </Td>
                          <Td>{partyName(inv)}{internal(inv.counterpartCompanyId) && <Badge className="ml-1.5">Interne</Badge>}</Td>
                          <Td className="whitespace-nowrap">{formatDate(inv.issueDate)}</Td>
                          <Td className="whitespace-nowrap">
                            {formatDate(inv.dueDate)}
                            {s.status === "overdue" && <div className="text-[12px] text-bad">{s.daysOverdue} j de retard</div>}
                          </Td>
                          <Td align="right"><Money value={inv.total} currency={inv.currency} className={inv.status === "cancelled" ? "line-through" : ""} /></Td>
                          <Td align="right">{s.remaining > 0 && !["draft", "cancelled"].includes(s.status) ? <Money value={s.remaining} currency={inv.currency} className="font-medium" /> : <span className="text-ink-3">—</span>}</Td>
                          <Td><InvoiceStatusBadge status={s.status} paid={s.paid > 0} />{importedIds.has(inv.id) && <Badge className="ml-1.5">Importée</Badge>}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {invoiceRows.map((s) => {
                  const inv = s.invoice;
                  return (
                    <li key={inv.id}>
                      <Link href={`/revenus/${inv.id}`} className="flex items-start justify-between gap-3 px-4 py-3.5 hover:bg-surface-2">
                        <div className="min-w-0">
                          <div className="font-medium text-ink">{inv.number}</div>
                          <div className="truncate text-[12.5px] text-ink-2">{partyName(inv)}</div>
                          <div className="mt-1 text-[12px] text-ink-3">Échéance {formatDate(inv.dueDate)}{s.status === "overdue" ? ` · ${s.daysOverdue} j de retard` : ""}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <Money value={s.remaining > 0 && !["draft", "cancelled"].includes(s.status) ? s.remaining : inv.total} currency={inv.currency} className="font-medium" />
                          <InvoiceStatusBadge status={s.status} paid={s.paid > 0} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3">{invoiceRows.length} facture{invoiceRows.length > 1 ? "s" : ""} · montants dans la devise de chaque facture</p>
            </>
          )}
        </Card>
      )}

      {tab === "devis" && (
        <Card>
          {quoteRows.length === 0 ? (
            filtered ? (
              <EmptyState compact icon={<Search size={20} />} title="Aucun devis ne correspond à ces filtres" action={<ButtonLink href={href({ statut: "", structure: "", activite: "", client: "", q: "" })}>Effacer les filtres</ButtonLink>} />
            ) : (
              <EmptyState icon={<FileText size={20} />} title="Aucun devis"
                description="Un devis accepté se transforme en facture en un clic, sans ressaisie."
                action={<ButtonLink href="/revenus/nouveau?type=quote" variant="primary">Créer un devis</ButtonLink>} />
            )
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead><tr><Th>Devis</Th><Th>Client</Th><Th>Émis le</Th><Th>Valable jusqu&apos;au</Th><Th align="right">Montant</Th><Th>Statut</Th></tr></thead>
                  <tbody>
                    {quoteRows.map(({ q: qt, status }) => (
                      <tr key={qt.id} className="hover:bg-surface-2">
                        <Td>
                          <Link href={`/revenus/${qt.id}`} className="font-medium text-ink hover:underline underline-offset-4">{qt.number}</Link>
                          <div className="max-w-[260px] truncate text-[12px] text-ink-3">{qt.title ?? "—"}</div>
                        </Td>
                        <Td>{partyName(qt)}</Td>
                        <Td className="whitespace-nowrap">{formatDate(qt.issueDate)}</Td>
                        <Td className="whitespace-nowrap">{formatDate(qt.dueDate)}</Td>
                        <Td align="right"><Money value={qt.total} currency={qt.currency} /></Td>
                        <Td><Badge tone={QUOTE_STATUS[status].tone} dot>{QUOTE_STATUS[status].label}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {quoteRows.map(({ q: qt, status }) => (
                  <li key={qt.id}>
                    <Link href={`/revenus/${qt.id}`} className="flex items-start justify-between gap-3 px-4 py-3.5 hover:bg-surface-2">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{qt.number}</div>
                        <div className="truncate text-[12.5px] text-ink-2">{partyName(qt)}</div>
                        <div className="mt-1 text-[12px] text-ink-3">Valable jusqu&apos;au {formatDate(qt.dueDate)}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Money value={qt.total} currency={qt.currency} className="font-medium" />
                        <Badge tone={QUOTE_STATUS[status].tone} dot>{QUOTE_STATUS[status].label}</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {tab === "recettes" && (
        <Card>
          {incomeRows.length === 0 ? (
            <EmptyState icon={<Plus size={20} />} title={filtered ? "Aucune recette ne correspond à ces filtres" : "Aucune recette directe"}
              description="Une vente comptant ou une prestation payée sans facture s'enregistre ici : elle compte immédiatement dans vos encaissements."
              action={<QuickButton kind="income" className={buttonClass("primary")}>Ajouter une recette</QuickButton>} />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead><tr><Th>Date</Th><Th>Description</Th><Th>Client</Th><Th>Activité</Th><Th>Mode</Th><Th align="right">Montant</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                  <tbody>
                    {incomeRows.map((i) => (
                      <tr key={i.id} className="hover:bg-surface-2">
                        <Td className="whitespace-nowrap">{formatDate(i.date)}</Td>
                        <Td><span className="text-ink">{i.description}</span>{i.reference && <div className="text-[12px] text-ink-3">Réf. {i.reference}</div>}</Td>
                        <Td>{i.contactId ? contactsById.get(i.contactId)?.name ?? "—" : <span className="text-ink-3">—</span>}</Td>
                        <Td>{i.activityId ? activitiesById.get(i.activityId)?.name ?? "—" : <span className="text-ink-3">Non affectée</span>}</Td>
                        <Td>{PAYMENT_METHOD_LABELS[i.method] ?? i.method}</Td>
                        <Td align="right"><Money value={i.amount} currency={i.currency} className="font-medium" /></Td>
                        <Td align="right"><DeleteIncomeButton id={i.id} label={i.description} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {incomeRows.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{i.description}</div>
                      <div className="text-[12px] text-ink-3">{formatDate(i.date)} · {PAYMENT_METHOD_LABELS[i.method] ?? i.method}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Money value={i.amount} currency={i.currency} className="font-medium" />
                      <DeleteIncomeButton id={i.id} label={i.description} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3">{incomeRows.length} recette{incomeRows.length > 1 ? "s" : ""} · total {formatMoney(incomeRows.reduce((a, i) => a + toBase(data, i.amount, i.currency, i.date).value, 0), cur)}</p>
            </>
          )}
        </Card>
      )}
    </>
  );
}

function Kpi({ label, sub, value, cur, tone, href }: { label: string; sub: string; value: number; cur: string; tone?: "good" | "bad"; href?: string }) {
  const body = (
    <>
      <div className="text-[12.5px] font-medium text-ink-2">{label}</div>
      <BigMoney value={value} currency={cur} className={cx("mt-2 text-[22px] font-semibold leading-none tracking-[-0.02em] sm:text-[24px]", tone === "bad" && "text-bad", tone === "good" && "text-good")} />
      <div className="mt-2 text-[12px] text-ink-3">{sub}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:bg-surface-2 sm:p-5">{body}</Link>
  ) : (
    <div className="card p-4 sm:p-5">{body}</div>
  );
}
