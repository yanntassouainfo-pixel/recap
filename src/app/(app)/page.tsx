import Link from "next/link";
import { and, eq, gt } from "drizzle-orm";
import { ArrowRight, CalendarClock, CircleDollarSign, Info, Plus, Sparkles, Target, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getScope, getSnapshot } from "@/lib/data";
import {
  addDays, addMonths, daysBetween, endOfMonth, formatDate, relativeDays, resolvePeriod, startOfMonth, type PeriodKey,
} from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import {
  balanceHistory, bucketize, expensesByCategory, forecast, periodFlows, pctChange, profitability, upcomingOutflows,
} from "@/lib/finance/engine";
import { computeAlerts, computeRecommendations, goalsProgress } from "@/lib/finance/insights";
import { BigMoney, Badge, ButtonLink, Card, CardHeader, Delta, EmptyState, InvoiceStatusBadge, Progress, Segmented, cx } from "@/components/ui";
import { AlertList } from "@/components/dashboard/alerts";
import { EvolutionCard } from "@/components/dashboard/evolution";
import { Sparkline } from "@/components/charts";
import { ConfirmOutflowButton } from "@/components/confirm-outflow";
import { QuickButton } from "@/components/quick/provider";
import { TRANSFER_LABELS } from "@/lib/finance/engine";

export const metadata = { title: "Tableau de bord" };

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
  { key: "quarter", label: "Trimestre" },
  { key: "year", label: "Année" },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const scope = await getScope(user.id);
  const snap = await getSnapshot(user.id);
  const { data, movements, cash, receivables } = snap;
  const cur = data.baseCurrency;
  const m = (v: number, o?: Parameters<typeof formatMoney>[2]) => formatMoney(v, cur, o);
  const today = data.today;

  const periodKey = (["week", "month", "quarter", "year", "custom"].includes(sp.periode ?? "") ? sp.periode : "month") as PeriodKey;
  const period = resolvePeriod(periodKey, today, { from: sp.du, to: sp.au });
  const flows = periodFlows(movements, period.from, period.to);
  const prev = periodFlows(movements, period.prevFrom, period.prevTo);

  const eom = endOfMonth(today);
  const horizon = Math.max(1, daysBetween(today, eom));
  const fCentral = forecast(data, horizon, "central", { movements, states: snap.states });
  const fPrudent = forecast(data, horizon, "prudent", { movements, states: snap.states });
  const fOptimist = forecast(data, horizon, "optimist", { movements, states: snap.states });
  const proj60 = forecast(data, 60, "central", { movements, states: snap.states });

  const upcoming = upcomingOutflows(data, addDays(today, 30));
  const upcomingTotal = upcoming.reduce((a, u) => a + u.amountBase, 0);
  const lateOutflows = upcoming.filter((u) => u.late);
  const committed = upcomingOutflows(data, eom).reduce((a, u) => a + u.amountBase, 0);
  const expectedByEom = receivables.items.filter((i) => i.invoice.dueDate <= eom || i.status === "overdue").reduce((a, i) => a + i.remainingBase, 0);

  const dismissed = new Set(db.select().from(schema.alertDismissals).where(and(eq(schema.alertDismissals.userId, user.id), gt(schema.alertDismissals.until, today))).all().map((d) => d.alertKey));
  const alerts = computeAlerts(snap).filter((a) => !dismissed.has(a.key));
  const recs = computeRecommendations(snap);
  const goals = goalsProgress(snap);

  const twelveFrom = addMonths(startOfMonth(today), -11, 1);
  const monthly = bucketize(movements, twelveFrom, today, "month");
  const history = balanceHistory(data, movements, 12).map((h) => ({ date: h.date, balance: h.balance }));
  const projection = proj60.points.filter((_, i) => i % 3 === 0 || i === proj60.points.length - 1).map((p) => ({ date: p.date, balance: p.balance }));
  const categories = expensesByCategory(data, movements, period.from, period.to).slice(0, 6);
  const catTotal = categories.reduce((a, c) => a + c.amount, 0);
  const profit = data.activities.filter((a) => data.scopeCompanyIds.has(a.companyId) && !a.archived).length > 1
    ? profitability(data, addDays(today, -89), today, { states: snap.states, movements }) : null;

  // Priorité du jour : la première alerte critique, sinon la première recommandation actionnable.
  const priority = alerts.find((a) => a.severity === "critical") ?? (recs[0] ? { title: recs[0].title, message: recs[0].body, action: recs[0].action } : alerts[0]);

  const firstName = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
  const periodHref = (k: string) => `/?periode=${k}`;
  const txHref = (type: string) => `/transactions?type=${type}&du=${period.from}&au=${period.to}`;
  const hasData = movements.length > 0 || receivables.items.length > 0 || upcoming.length > 0;

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[13px] text-ink-3">{formatDate(today, "long")} · {scope.label}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.025em]">{hello}, {firstName}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: periodHref(p.key) }))} active={period.key} />
          <form className="hidden items-center gap-1.5 xl:flex" action="/">
            <input type="hidden" name="periode" value="custom" />
            <input type="date" name="du" defaultValue={period.key === "custom" ? period.from : ""} className="field-input h-8 w-[132px] px-2 text-[12.5px]" aria-label="Du" />
            <input type="date" name="au" defaultValue={period.key === "custom" ? period.to : ""} className="field-input h-8 w-[132px] px-2 text-[12.5px]" aria-label="Au" />
            <button className="h-8 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-3">OK</button>
          </form>
        </div>
      </header>

      {!hasData && (
        <Card className="overflow-hidden">
          <EmptyState icon={<Sparkles size={20} />} title="Votre tableau de bord prend vie avec vos premières opérations"
            description="Enregistrez une recette, une dépense ou une facture : tous les indicateurs, prévisions et alertes se mettront à jour automatiquement."
            action={<>
              <QuickButton kind="income" className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-ink px-4 text-[13.5px] font-medium text-bg"><Plus size={15} /> Ajouter un revenu</QuickButton>
              <QuickButton kind="expense" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-2 bg-surface px-4 text-[13.5px] font-medium">Ajouter une dépense</QuickButton>
              <ButtonLink href="/revenus/nouveau">Créer une facture</ButtonLink>
            </>} />
        </Card>
      )}

      {priority && hasData && (
        <div className="flex flex-col gap-3 rounded-2xl bg-ink px-5 py-4 text-bg sm:flex-row sm:items-center">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10"><Target size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-bg/55">Votre priorité aujourd&apos;hui</div>
            <div className="mt-0.5 text-[14.5px] font-medium leading-snug">{priority.title}</div>
            {priority.message && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-bg/70">{priority.message}</div>}
          </div>
          {priority.action && (
            <Link href={priority.action.href} className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-[10px] bg-bg px-4 text-[13px] font-medium text-ink hover:bg-bg/90 sm:self-auto">
              {priority.action.label} <ArrowRight size={14} />
            </Link>
          )}
        </div>
      )}

      {/* Rangée 1 : argent disponible + fin de mois */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2"><Wallet size={16} className="text-ink-3" /> Argent disponible</div>
              <Link href="/structures#comptes" className="text-[12px] text-ink-3 hover:text-ink">{cash.accounts.length} compte{cash.accounts.length > 1 ? "s" : ""}</Link>
            </div>
            <BigMoney value={cash.total} currency={cur} className={cx("mt-3 text-[40px] font-semibold leading-none tracking-[-0.035em] sm:text-[50px]", cash.total < 0 && "text-bad")} />
            <p className="mt-2 text-[12.5px] text-ink-3">Somme des soldes de vos comptes. Ce n&apos;est ni votre bénéfice, ni l&apos;argent qu&apos;on vous doit.</p>
            {cash.personal !== 0 && cash.pro !== 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
                  <div className="text-[11.5px] text-ink-3">Professionnel</div>
                  <div className="text-[15px] font-semibold tabular">{m(cash.pro)}</div>
                </div>
                <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
                  <div className="text-[11.5px] text-ink-3">Personnel</div>
                  <div className="text-[15px] font-semibold tabular">{m(cash.personal)}</div>
                </div>
              </div>
            )}
            <ul className="mt-4 space-y-1.5">
              {cash.accounts.slice(0, 4).map((a) => (
                <li key={a.account.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="truncate text-ink-2">{a.account.name}</span>
                  <span className={cx("tabular", a.balance < 0 ? "text-bad" : "text-ink")}>
                    {formatMoney(a.balance, a.account.currency)}
                    {a.account.currency !== cur && a.balanceBase != null && <span className="ml-1.5 text-ink-3">≈ {m(a.balanceBase)}</span>}
                  </span>
                </li>
              ))}
              {cash.accounts.length > 4 && <li className="text-[12px] text-ink-3">+ {cash.accounts.length - 4} autre{cash.accounts.length > 5 ? "s" : ""}</li>}
            </ul>
            {cash.missingRates.length > 0 && <p className="mt-3 text-[12px] text-warn">Taux de change manquant : {cash.missingRates.join(", ")} exclu{cash.missingRates.length > 1 ? "s" : ""} du total.</p>}
          </div>
        </Card>

        <Card className="lg:col-span-7">
          <div className="grid h-full gap-0 sm:grid-cols-[1fr_1.1fr]">
            <div className="flex flex-col p-5 sm:p-6">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2"><CalendarClock size={16} className="text-ink-3" /> Fin de mois prévue</div>
              <BigMoney value={fCentral.end} currency={cur} className={cx("mt-3 text-[32px] font-semibold leading-none tracking-[-0.03em] sm:text-[36px]", fCentral.end < 0 && "text-bad")} />
              <div className="mt-2 flex items-center gap-2 text-[12.5px]">
                <Delta value={pctChange(fCentral.end, cash.total)} suffix={`d'ici le ${formatDate(eom, "day")}`} />
              </div>
              <dl className="mt-5 space-y-2 text-[13px]">
                <div className="flex justify-between"><dt className="text-ink-3">Scénario prudent</dt><dd className="tabular">{m(fPrudent.end)}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-ink-2">Scénario central</dt><dd className="font-medium tabular">{m(fCentral.end)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-3">Scénario optimiste</dt><dd className="tabular">{m(fOptimist.end)}</dd></div>
              </dl>
              <Link href="/previsionnel" className="mt-auto inline-flex items-center gap-1 pt-4 text-[12.5px] font-medium text-accent hover:underline underline-offset-4">Hypothèses et détail <ArrowRight size={13} /></Link>
            </div>
            <div className="border-t border-line p-5 sm:border-l sm:border-t-0 sm:p-6">
              <div className="text-[12.5px] font-medium text-ink-2">De maintenant à la fin du mois</div>
              <Bridge items={[
                { label: "Disponible aujourd'hui", value: cash.total, kind: "base" },
                { label: "Attendu de vos clients", value: fCentral.totalIn, kind: "in", hint: `${m(expectedByEom)} facturés et exigibles, pondérés selon le scénario central` },
                { label: "Engagé à payer", value: -fCentral.totalOut, kind: "out", hint: `${upcomingOutflows(data, eom).length} échéance(s), dont charges récurrentes` },
                { label: "Reste prévu", value: fCentral.end, kind: "total" },
              ]} currency={cur} />
              <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">Une estimation, pas une certitude : elle repose sur les factures et échéances enregistrées.</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Rangée 2 : indicateurs de la période */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
        <Kpi href={txHref("income")} label="Encaissé" sub={period.label} value={<BigMoney value={flows.income} currency={cur} />} delta={<Delta value={pctChange(flows.income, prev.income)} suffix={`vs ${period.prevLabel}`} />} />
        <Kpi href={txHref("expense")} label="Dépenses payées" sub={period.label} value={<BigMoney value={flows.expense} currency={cur} />} delta={<Delta value={pctChange(flows.expense, prev.expense)} goodWhen="down" suffix={`vs ${period.prevLabel}`} />} />
        <Kpi href={txHref("all")} label="Solde net" sub={flows.net >= 0 ? "Excédent sur la période" : "Déficit sur la période"} value={<BigMoney value={flows.net} currency={cur} sign />}
          tone={flows.net >= 0 ? "good" : "bad"}
          delta={flows.transfersOut > 0 || flows.transfersIn > 0
            ? <span className="text-[12px] text-ink-3">Hors transferts ({m(flows.transfersIn - flows.transfersOut, { sign: true })})</span>
            : <span className="text-[12px] text-ink-3">Encaissé − payé</span>} />
        <Kpi href="/revenus?statut=open" label="À encaisser" sub={`${receivables.items.length} facture${receivables.items.length > 1 ? "s" : ""}`} value={<BigMoney value={receivables.total} currency={cur} />}
          delta={<span className="text-[12px] text-ink-3">{m(receivables.notDue)} à venir · <span className={receivables.overdue > 0 ? "font-medium text-bad" : ""}>{m(receivables.overdue)} en retard</span></span>} />
        <Kpi href="/depenses?vue=a-venir" label="À payer · 30 jours" sub={`${upcoming.length} échéance${upcoming.length > 1 ? "s" : ""}`} value={<BigMoney value={upcomingTotal} currency={cur} />} className="col-span-2 lg:col-span-1"
          delta={<span className="text-[12px] text-ink-3">{lateOutflows.length > 0 ? <span className="font-medium text-warn">{lateOutflows.length} à confirmer</span> : `dont ${m(committed)} d'ici fin de mois`}</span>} />
      </div>

      {/* Rangée 3 : évolution + alertes */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <EvolutionCard flows={monthly} history={history} projection={projection} currency={cur} threshold={data.cashSafetyThreshold || undefined}
            comparison={<>{period.label} : encaissé <strong className="font-medium text-ink">{m(flows.income)}</strong> contre {m(prev.income)} sur la {period.prevLabel}.</>} />
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="À surveiller" description={alerts.length ? `${alerts.length} point${alerts.length > 1 ? "s" : ""} d'attention` : undefined} />
          {alerts.length ? <AlertList alerts={alerts} limit={4} /> : (
            <EmptyState compact icon={<Sparkles size={18} />} title="Rien d'urgent" description="Aucune facture en retard, aucune échéance critique et une trésorerie prévue au-dessus de votre seuil." />
          )}
        </Card>
      </div>

      {/* Rangée 4 : à encaisser / à payer / répartition */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="À encaisser" description="Factures envoyées non soldées" action={<Link href="/revenus?statut=open" className="text-[12.5px] font-medium text-ink-2 hover:text-ink">Tout voir</Link>} />
          {receivables.items.length === 0 ? (
            <EmptyState compact icon={<CircleDollarSign size={18} />} title="Aucune facture en attente" description="Vos clients ne vous doivent rien pour le moment." action={<ButtonLink href="/revenus/nouveau" size="sm">Créer une facture</ButtonLink>} />
          ) : (
            <ul className="divide-y divide-line">
              {receivables.items.slice(0, 5).map((it) => {
                const contact = data.contacts.find((c) => c.id === it.invoice.contactId);
                return (
                  <li key={it.invoice.id}>
                    <Link href={`/revenus/${it.invoice.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{contact?.name ?? it.invoice.title ?? it.invoice.number}</div>
                        <div className="text-[12px] text-ink-3">{it.invoice.number} · {it.status === "overdue" ? `échue ${relativeDays(it.invoice.dueDate, today)}` : `échéance ${relativeDays(it.invoice.dueDate, today)}`}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[13.5px] font-medium tabular">{formatMoney(it.remaining, it.invoice.currency)}</div>
                        <InvoiceStatusBadge status={it.status} paid={it.paid > 0} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Prochaines échéances" description="Dépenses prévues et charges récurrentes" action={<Link href="/depenses?vue=a-venir" className="text-[12.5px] font-medium text-ink-2 hover:text-ink">Tout voir</Link>} />
          {upcoming.length === 0 ? (
            <EmptyState compact icon={<CalendarClock size={18} />} title="Aucune échéance à 30 jours" description="Ajoutez vos charges récurrentes (loyer, abonnements…) pour les anticiper automatiquement."
              action={<QuickButton kind="recurring" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-2 bg-surface px-3 text-[13px] font-medium"><Plus size={14} /> Charge récurrente</QuickButton>} />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.slice(0, 5).map((u) => (
                <li key={u.key} className="flex items-center gap-3 px-5 py-3">
                  <div className={cx("flex w-11 shrink-0 flex-col items-center rounded-lg py-1", u.late ? "bg-warn-soft text-warn" : "bg-surface-3 text-ink-2")}>
                    <span className="text-[15px] font-semibold leading-none tabular">{u.originalDate.slice(8, 10)}</span>
                    <span className="text-[10.5px] leading-tight">{formatDate(u.originalDate, "day").split(" ")[1]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{u.label}</div>
                    <div className="text-[12px] text-ink-3">{u.late ? <span className="text-warn">À confirmer · prévue {relativeDays(u.originalDate, today)}</span> : relativeDays(u.originalDate, today)}{u.kind === "recurring" ? " · récurrente" : ""}</div>
                  </div>
                  <div className="text-[13.5px] font-medium tabular">{formatMoney(u.amount, u.currency)}</div>
                  <ConfirmOutflowButton compact item={{ ...u }} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Où part l'argent" description={`Dépenses payées · ${period.label.toLowerCase()}`} action={<Link href={txHref("expense")} className="text-[12.5px] font-medium text-ink-2 hover:text-ink">Détail</Link>} />
          {categories.length === 0 ? (
            <EmptyState compact title="Aucune dépense sur la période" description="Les dépenses payées apparaîtront ici, par catégorie." />
          ) : (
            <ul className="space-y-3 px-5 pb-5">
              {categories.map((c) => (
                <li key={c.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="truncate text-ink-2">{c.name}</span>
                    <span className="tabular">{m(c.amount)} <span className="text-ink-3">· {formatPercent((c.amount / catTotal) * 100)}</span></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-[var(--series-2)]" style={{ width: `${Math.max(2, (c.amount / categories[0].amount) * 100)}%` }} /></div>
                </li>
              ))}
              {flows.transfersOut > 0 && (
                <li className="border-t border-line pt-3 text-[12px] text-ink-3">
                  Non compté comme dépense : {m(flows.transfersOut)} de transferts sortants ({[...new Set(flows.movements.filter((x) => x.kind === "transfer_out" && !x.internal).map((x) => TRANSFER_LABELS[x.transferNature ?? "internal"]))].join(", ").toLowerCase()}).
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>

      {/* Rangée 5 : objectifs, activités, recommandation */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Objectifs" action={<Link href="/previsionnel#objectifs" className="text-[12.5px] font-medium text-ink-2 hover:text-ink">Gérer</Link>} />
          {goals.length === 0 ? (
            <EmptyState compact icon={<Target size={18} />} title="Aucun objectif" description="Fixez un objectif de revenus, de réserve ou de trésorerie minimale pour suivre votre progression." action={<ButtonLink href="/previsionnel#objectifs" size="sm">Définir un objectif</ButtonLink>} />
          ) : (
            <ul className="space-y-4 px-5 pb-5">
              {goals.slice(0, 4).map((g) => (
                <li key={g.goalId}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium">{g.label}</span>
                    <Badge tone={g.status === "at_risk" ? "warn" : "good"}>{g.status === "reached" ? "Atteint" : g.status === "on_track" ? "En bonne voie" : "À surveiller"}</Badge>
                  </div>
                  <Progress value={g.progress} tone={g.status === "at_risk" ? "warn" : "good"} label={g.label} />
                  <p className="mt-1.5 text-[12px] text-ink-3">{g.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Vos activités" description="Marge estimée · 90 derniers jours" action={<Link href="/rentabilite" className="text-[12.5px] font-medium text-ink-2 hover:text-ink">Analyser</Link>} />
          {!profit || profit.activities.every((a) => a.invoiced === 0) ? (
            <EmptyState compact title="Une seule activité suivie" description="Créez plusieurs activités et associez-leur vos factures pour savoir laquelle crée le plus de valeur." action={<ButtonLink href="/structures" size="sm">Organiser mes activités</ButtonLink>} />
          ) : (
            <ul className="space-y-3 px-5 pb-5">
              {profit.activities.filter((a) => a.invoiced > 0).slice(0, 5).map((a) => (
                <li key={a.activityId} className="flex items-center gap-3">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{a.name}</div>
                    <div className="text-[12px] text-ink-3">{m(a.invoiced, { compact: true })} facturés</div>
                  </div>
                  <div className="w-24">
                    <div className="mb-1 text-right text-[12.5px] font-medium tabular">{formatPercent(a.marginRate)}</div>
                    <div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-[var(--series-3)]" style={{ width: `${Math.max(2, Math.min(100, a.marginRate ?? 0))}%` }} /></div>
                  </div>
                </li>
              ))}
              {profit.highlights.slice(0, 2).map((h) => (
                <li key={h.key} className="text-[12px] text-ink-3"><span className="font-medium text-ink-2">{h.label} :</span> {profit.activities.find((a) => a.activityId === h.activityId)?.name}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHeader title="Conseil de l'assistant" description="Fondé sur vos données, vérifiable" action={<Link href="/assistant" className="text-[12.5px] font-medium text-ink-2 hover:text-ink">Poser une question</Link>} />
          {recs[0] ? (
            <div className="flex flex-1 flex-col px-5 pb-5">
              <div className="text-[13.5px] font-medium leading-snug">{recs[0].title}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{recs[0].body}</p>
              <ul className="mt-3 space-y-1 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12px] text-ink-2">
                {recs[0].facts.slice(0, 3).map((f) => <li key={f} className="flex gap-2"><Info size={12} className="mt-0.5 shrink-0 text-ink-3" />{f}</li>)}
              </ul>
              {recs[0].action && <Link href={recs[0].action.href} className="mt-auto inline-flex items-center gap-1 pt-4 text-[12.5px] font-medium text-accent hover:underline underline-offset-4">{recs[0].action.label} <ArrowRight size={13} /></Link>}
            </div>
          ) : (
            <EmptyState compact title="Pas de recommandation pour l'instant" description="L'assistant analysera vos données dès qu'elles seront suffisantes." />
          )}
          <div className="mt-auto border-t border-line px-5 py-3"><Sparkline values={history.map((h) => h.balance)} height={34} /><div className="mt-1 text-[11.5px] text-ink-3">Solde disponible, 12 mois</div></div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, sub, value, delta, href, tone, className }: { label: string; sub: string; value: React.ReactNode; delta?: React.ReactNode; href: string; tone?: "good" | "bad"; className?: string }) {
  return (
    <Link href={href} className={cx("card group block p-4 transition hover:shadow-pop sm:p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
        <ArrowRight size={14} className="text-ink-3 opacity-0 transition group-hover:opacity-100" aria-hidden />
      </div>
      <div className={cx("mt-2 text-[20px] font-semibold tracking-[-0.02em] sm:text-[22px]", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-3">{sub}</div>
      {delta && <div className="mt-2.5 border-t border-line pt-2.5">{delta}</div>}
    </Link>
  );
}

/** Pont de trésorerie : ce qui reste = disponible + attendu − engagé. */
function Bridge({ items, currency }: { items: { label: string; value: number; kind: "base" | "in" | "out" | "total"; hint?: string }[]; currency: string }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <ul className="mt-4 space-y-3">
      {items.map((i) => (
        <li key={i.label} title={i.hint}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className={i.kind === "total" ? "font-medium text-ink" : "text-ink-2"}>{i.kind === "in" ? "+ " : i.kind === "out" ? "− " : i.kind === "total" ? "= " : ""}{i.label}</span>
            <span className={cx("tabular", i.kind === "total" && "font-semibold", i.kind === "in" && "text-good", i.kind === "out" && "text-bad")}>{formatMoney(Math.abs(i.value), currency)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-3">
            <div className={cx("h-full rounded-full", i.kind === "in" ? "bg-good-mark" : i.kind === "out" ? "bg-bad-mark" : i.kind === "total" ? "bg-ink" : "bg-[var(--series-1)]")} style={{ width: `${Math.max(2, (Math.abs(i.value) / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
