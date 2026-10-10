import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Download, Plus, Search, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSnapshot } from "@/lib/data";
import { addDays, addMonths, endOfMonth, formatDate, startOfMonth, startOfYear } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { CashMovement } from "@/lib/finance/types";
import { Badge, Card, CardHeader, EmptyState, Input, Notice, PageHeader, Segmented, Select, buttonClass, cx } from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import { FilterForm } from "@/components/expenses/filter-form";
import { Kpi, Pager, filterLabel } from "@/components/expenses/bits";
import { buildHref, paginate } from "@/components/expenses/logic";
import {
  PAGE_SIZE, TX_TYPES, dayLabel, filterMovements, groupByDay, movementCategory, movementNames, movementTypeLabel, netChange, parseTxFilters, txParams,
} from "@/components/transactions/logic";
import { MovementActions } from "@/components/transactions/movement-actions";

export const metadata = { title: "Transactions" };

function KindIcon({ m }: { m: CashMovement }) {
  const transfer = m.kind === "transfer_in" || m.kind === "transfer_out";
  const Icon = transfer ? ArrowLeftRight : m.kind === "income" ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg", transfer ? "bg-surface-3 text-ink-2" : m.kind === "income" ? "bg-good-soft text-good" : "bg-bad-soft text-bad")} aria-hidden>
      <Icon size={15} />
    </div>
  );
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const { data, movements } = await getSnapshot(user.id);
  const today = data.today;
  const cur = data.baseCurrency;
  const f = parseTxFilters(sp, today);
  const names = movementNames(data);
  const params = txParams(f);
  const href = (patch: Record<string, string | undefined | null> = {}) => buildHref("/transactions", params, patch);

  const list = filterMovements(movements, f, names);
  const external = list.filter((m) => !m.internal && m.amountBase != null);
  const inflow = external.filter((m) => m.kind === "income").reduce((a, m) => a + m.amountBase!, 0);
  const outflow = -external.filter((m) => m.kind === "expense").reduce((a, m) => a + m.amountBase!, 0);
  const transfersNet = external.filter((m) => m.kind === "transfer_in" || m.kind === "transfer_out").reduce((a, m) => a + m.amountBase!, 0);
  const net = netChange(list);
  const missing = list.filter((m) => m.amountBase == null).length;
  const internalCount = list.filter((m) => m.internal).length;
  const paged = paginate(list, f.page, PAGE_SIZE);
  const days = groupByDay(paged.items);

  const scopeAccounts = data.accounts.filter((a) => data.scopeCompanyIds.has(a.companyId) && !a.archived);
  const companies = data.companies.filter((c) => data.scopeCompanyIds.has(c.id));
  const activities = data.activities.filter((a) => data.scopeCompanyIds.has(a.companyId) && !a.archived);
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const paymentsById = new Map(data.payments.map((p) => [p.id, p]));
  const transfersById = new Map(data.transfers.map((t) => [t.id, t]));
  const filtered = !!(f.accountId || f.companyId || f.activityId || f.q || f.type !== "all");
  const hasAny = movements.length > 0;

  const lastMonth = addMonths(startOfMonth(today), -1, 1);
  const presets = [
    { label: "Ce mois", from: startOfMonth(today), to: today },
    { label: "Mois dernier", from: lastMonth, to: endOfMonth(lastMonth) },
    { label: "30 derniers jours", from: addDays(today, -29), to: today },
    { label: "Depuis le 1er janvier", from: startOfYear(today), to: today },
  ];

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Quel argent est réellement entré et sorti de mes comptes, et quand ?"
        actions={<>
          {list.length > 0 && <a href={buildHref("/api/export/transactions", params)} download className={buttonClass("secondary")}><Download size={15} /> Exporter (CSV)</a>}
          <QuickButton kind="transfer" className={buttonClass("secondary")}><ArrowLeftRight size={15} /> Transfert</QuickButton>
          <QuickButton kind="income" className={buttonClass("primary")}><Plus size={15} /> Recette</QuickButton>
        </>}
      />

      {!hasAny ? (
        <Card>
          <EmptyState icon={<ArrowLeftRight size={18} />} title="Aucun mouvement pour l'instant"
            description="Les paiements de factures, recettes directes, dépenses payées et transferts entre comptes apparaîtront ici dès qu'ils seront enregistrés."
            action={<>
              <QuickButton kind="income" className={buttonClass("primary", "sm")}><Plus size={14} /> Enregistrer une recette</QuickButton>
              <QuickButton kind="expense" className={buttonClass("secondary", "sm")}><Plus size={14} /> Enregistrer une dépense</QuickButton>
            </>} />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented active={f.type} items={TX_TYPES.map((t) => ({ key: t.key, label: t.label, href: href({ type: t.key === "all" ? null : t.key, page: null }) }))} />
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => {
                const on = p.from === f.from && p.to === f.to;
                return (
                  <Link key={p.label} href={href({ du: p.from, au: p.to, page: null })} scroll={false} aria-current={on ? "true" : undefined}
                    className={cx("rounded-full border px-3 py-1 text-[12.5px] font-medium", on ? "border-ink bg-ink text-bg" : "border-line-2 text-ink-2 hover:text-ink")}>
                    {p.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <FilterForm path="/transactions" className="card flex flex-wrap items-end gap-3 p-4" label="Filtrer les transactions">
            {f.type !== "all" && <input type="hidden" name="type" value={f.type} />}
            <label className="flex flex-col gap-1"><span className={filterLabel}>Du</span><Input type="date" name="du" defaultValue={f.from} /></label>
            <label className="flex flex-col gap-1"><span className={filterLabel}>Au</span><Input type="date" name="au" defaultValue={f.to} /></label>
            {scopeAccounts.length > 1 && (
              <label className="flex min-w-[160px] flex-col gap-1">
                <span className={filterLabel}>Compte</span>
                <Select name="compte" defaultValue={f.accountId}>
                  <option value="">Tous les comptes</option>
                  {scopeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
                </Select>
              </label>
            )}
            {companies.length > 1 && (
              <label className="flex min-w-[150px] flex-col gap-1">
                <span className={filterLabel}>Structure</span>
                <Select name="structure" defaultValue={f.companyId}>
                  <option value="">Toutes</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.kind === "personal" ? "Espace personnel" : c.name}</option>)}
                </Select>
              </label>
            )}
            {activities.length > 0 && (
              <label className="flex min-w-[150px] flex-col gap-1">
                <span className={filterLabel}>Activité</span>
                <Select name="activite" defaultValue={f.activityId}>
                  <option value="">Toutes</option>
                  {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </label>
            )}
            <label className="flex min-w-[180px] flex-1 flex-col gap-1">
              <span className={filterLabel}>Recherche</span>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input name="q" type="search" defaultValue={f.q} placeholder="Libellé, catégorie, compte… puis Entrée" className="pl-8" />
              </div>
            </label>
            {filtered && <Link href={buildHref("/transactions", { du: f.from, au: f.to })} className={buttonClass("ghost", "md")}><X size={14} /> Effacer les filtres</Link>}
          </FilterForm>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Entrées encaissées" value={formatMoney(inflow, cur)} sub="Paiements de factures et recettes" />
            <Kpi label="Sorties payées" value={formatMoney(outflow, cur)} sub="Dépenses et frais" />
            <Kpi label="Transferts hors de la vue" value={formatMoney(transfersNet, cur, { sign: transfersNet !== 0 })} sub="Rémunération, apports… ni revenu ni dépense" />
            <Kpi label="Variation de trésorerie" value={<span className={net > 0 ? "text-good" : net < 0 ? "text-bad" : undefined}>{formatMoney(net, cur, { sign: net !== 0 })}</span>}
              sub={`Du ${formatDate(f.from, "day")} au ${formatDate(f.to)}${net > 0 ? " · hausse" : net < 0 ? " · baisse" : ""}`} />
          </div>

          {(missing > 0 || internalCount > 0) && (
            <div className="space-y-2">
              {missing > 0 && <Notice tone="warn" title="Taux de change manquant">{missing} mouvement{missing > 1 ? "s" : ""} en devise étrangère {missing > 1 ? "ne sont pas comptés" : "n'est pas compté"} dans les totaux. Ajoutez un taux dans les paramètres.</Notice>}
              {internalCount > 0 && <Notice title="Flux internes neutralisés">{internalCount} mouvement{internalCount > 1 ? "s" : ""} entre vos propres comptes ou structures {internalCount > 1 ? "sont affichés" : "est affiché"} mais exclu{internalCount > 1 ? "s" : ""} des totaux : ils ne changent pas votre trésorerie globale.</Notice>}
            </div>
          )}

          <Card className="overflow-hidden">
            <CardHeader title={`${list.length} mouvement${list.length > 1 ? "s" : ""}`} description={`Du ${formatDate(f.from, "long")} au ${formatDate(f.to, "long")} · uniquement l'argent réellement encaissé ou décaissé`} />
            {list.length === 0 ? (
              <EmptyState compact title="Aucun mouvement ne correspond"
                description={filtered ? "Effacez les filtres ou élargissez la période." : "Aucun mouvement sur cette période. Essayez « Mois dernier » ou « Depuis le 1er janvier »."}
                action={filtered ? <Link href={buildHref("/transactions", { du: f.from, au: f.to })} className={buttonClass("secondary", "sm")}>Effacer les filtres</Link> : undefined} />
            ) : (
              <>
                {days.map((d) => {
                  const dayNet = netChange(d.items);
                  return (
                    <section key={d.date} aria-label={dayLabel(d.date, today)}>
                      <div className="flex items-center justify-between gap-3 border-y border-line bg-surface-2 px-5 py-2 text-[12px] font-medium text-ink-3">
                        <span>{dayLabel(d.date, today)}</span>
                        <span className="tabular">{dayNet === 0 ? "—" : formatMoney(dayNet, cur, { sign: true })}</span>
                      </div>
                      <ul className="divide-y divide-line">
                        {d.items.map((m) => {
                          const transfer = m.source === "transfer" ? transfersById.get(m.sourceId) : undefined;
                          const bothSides = transfer ? [transfer.fromAccountId, transfer.toAccountId].every((id) => data.scopeCompanyIds.has(accountsById.get(id)?.companyId ?? "")) : undefined;
                          const invoiceId = m.source === "payment" || m.source === "fee" ? paymentsById.get(m.sourceId)?.invoiceId ?? null : null;
                          const meta = [movementCategory(m, names), names.account(m.accountId), names.activity(m.activityId), companies.length > 1 ? names.company(m.companyId) : null].filter(Boolean);
                          return (
                            <li key={m.id} className={cx("flex items-center gap-3 px-5 py-3", m.internal && "opacity-75")}>
                              <KindIcon m={m} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-[13.5px] font-medium">{m.label}</span>
                                  {m.internal && <Badge>Flux interne · neutralisé</Badge>}
                                </div>
                                <div className="truncate text-[12px] text-ink-3"><span className="text-ink-2">{movementTypeLabel(m)}</span> · {meta.join(" · ")}</div>
                              </div>
                              <div className="text-right">
                                <div className={cx("text-[13.5px] font-medium tabular whitespace-nowrap", m.kind === "income" ? "text-good" : m.kind === "expense" ? "text-ink" : "text-ink-2")}>
                                  {formatMoney(m.amount, m.currency, { sign: true })}
                                </div>
                                {m.currency !== cur && <div className="text-[11.5px] text-ink-3 tabular">{m.amountBase == null ? "taux manquant" : `≈ ${formatMoney(m.amountBase, cur, { sign: true })}`}</div>}
                              </div>
                              <MovementActions item={{ source: m.source, sourceId: m.sourceId, label: m.label, amount: Math.abs(m.amount), currency: m.currency, date: m.date, invoiceId, bothSides }} />
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
                <Pager page={paged.page} pageCount={paged.pageCount} total={paged.total} noun="mouvements" href={(p) => href({ page: p > 1 ? String(p) : null })} />
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
