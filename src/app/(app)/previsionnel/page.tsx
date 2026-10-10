import type { ReactNode } from "react";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { CalendarRange, Calculator, ClipboardCheck, Info, LineChart as LineIcon, Target } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getScope, getSnapshot } from "@/lib/data";
import { formatDate, formatMonth } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { GOAL_TYPES } from "@/lib/labels";
import { forecast, varianceForMonth, SCENARIO_LABELS, type ForecastResult, type Scenario } from "@/lib/finance/engine";
import { goalsProgress } from "@/lib/finance/insights";
import {
  HORIZONS, eventNature, gapPercent, groupEventsByWeek, horizonLabel, mergeScenarioSeries, parseHorizon, parseScenario,
  parseSnapshotDetails, SCENARIOS,
} from "@/lib/planning";
import { Badge, Card, CardHeader, EmptyState, Money, Notice, PageHeader, Progress, Segmented, Table, Td, Th, cx } from "@/components/ui";
import { Legend, ScenarioChart } from "@/components/charts";
import { ScenarioSettingsForm } from "@/components/forecast/scenario-settings";
import { AbsorbSimulator } from "@/components/forecast/simulator";
import { PlanActualChart, type PlanActualRow } from "@/components/forecast/plan-actual-chart";
import { GoalActions, GoalDialog, type ActivityOption, type GoalData } from "@/components/forecast/goals";

export const metadata = { title: "Prévisionnel" };

const SCENARIO_COLORS: Record<Scenario, string> = { prudent: "var(--series-2)", central: "var(--series-1)", optimist: "var(--series-3)" };

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const scope = await getScope(user.id);
  const snap = await getSnapshot(user.id);
  const { data, movements, states, cash } = snap;
  const cur = data.baseCurrency;
  const m = (v: number) => formatMoney(v, cur);
  const today = data.today;
  const threshold = data.cashSafetyThreshold;

  const horizon = parseHorizon(sp.horizon);
  const scenario = parseScenario(sp.scenario);
  const ctx = { movements, states };
  const f: Record<Scenario, ForecastResult> = {
    prudent: forecast(data, horizon, "prudent", ctx),
    central: forecast(data, horizon, "central", ctx),
    optimist: forecast(data, horizon, "optimist", ctx),
  };
  const series = mergeScenarioSeries(f.prudent, f.central, f.optimist);
  // Trajectoires sur 12 mois pour le simulateur (calcul local, côté navigateur).
  const simCentral = horizon === 365 ? f.central : forecast(data, 365, "central", ctx);
  const simPrudent = horizon === 365 ? f.prudent : forecast(data, 365, "prudent", ctx);
  const pts = (r: ForecastResult) => r.points.map((p) => ({ date: p.date, balance: p.balance }));

  const weeks = groupEventsByWeek(f[scenario].events, f[scenario].start, today);
  const href = (o: { horizon?: number; scenario?: Scenario }, hash = "") => {
    const p = new URLSearchParams();
    const h = o.horizon ?? horizon;
    const s = o.scenario ?? scenario;
    if (h !== 90) p.set("horizon", String(h));
    if (s !== "central") p.set("scenario", s);
    const qs = p.toString();
    return `/previsionnel${qs ? `?${qs}` : ""}${hash}`;
  };

  /* Prévu / réel */
  const currentMonth = today.slice(0, 7);
  const snapshots = db.select().from(schema.forecastSnapshots)
    .where(and(eq(schema.forecastSnapshots.userId, user.id), eq(schema.forecastSnapshots.scope, scope.key))).all()
    .filter((s) => s.month < currentMonth)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, 6);
  const currentPhoto = db.select({ id: schema.forecastSnapshots.id }).from(schema.forecastSnapshots)
    .where(and(eq(schema.forecastSnapshots.userId, user.id), eq(schema.forecastSnapshots.scope, scope.key), eq(schema.forecastSnapshots.month, currentMonth))).get();
  const variances = snapshots.map((s) => {
    const details = parseSnapshotDetails(s.details);
    const sameCurrency = s.currency === cur;
    const v = sameCurrency
      ? varianceForMonth(data, { month: s.month, expectedIncome: s.expectedIncome, expectedExpense: s.expectedExpense, details: { incomes: details.incomes, outflows: details.outflows } }, movements)
      : null;
    return { snapshot: s, reconstructed: details.reconstructed, v, currency: s.currency };
  });
  const chartRows: PlanActualRow[] = variances.filter((x) => x.v).map((x) => ({
    month: x.snapshot.month, plannedIncome: x.v!.plannedIncome, actualIncome: x.v!.actualIncome, plannedExpense: x.v!.plannedExpense, actualExpense: x.v!.actualExpense,
  })).reverse();

  /* Objectifs */
  const progress = new Map(goalsProgress(snap).map((g) => [g.goalId, g]));
  const goalRows = db.select().from(schema.goals).where(eq(schema.goals.userId, user.id)).all()
    .sort((a, b) => (a.active === b.active ? a.createdAt.localeCompare(b.createdAt) : a.active ? -1 : 1));
  const companiesById = new Map(data.companies.map((c) => [c.id, c]));
  const activityOptions: ActivityOption[] = data.activities
    .filter((a) => !a.archived && data.scopeCompanyIds.has(a.companyId))
    .map((a) => ({ id: a.id, name: a.name, companyName: companiesById.get(a.companyId)?.name ?? "" }));
  const activitiesById = new Map(data.activities.map((a) => [a.id, a]));

  const c = f.central;
  const noAccounts = !cash.hasAccounts;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={scope.label}
        title="Prévisionnel"
        description="Quelle sera votre situation dans les semaines et mois à venir ? Trois scénarios, calculés selon les factures, échéances et opportunités renseignées."
        actions={<Segmented items={HORIZONS.map((h) => ({ key: String(h), label: horizonLabel(h), href: href({ horizon: h }) }))} active={String(horizon)} />}
      />

      {noAccounts && (
        <Notice tone="info" title="Aucun compte renseigné" action={<Link href="/structures#comptes" className="text-[12.5px] font-medium text-accent hover:underline">Ajouter un compte</Link>}>
          Sans compte (banque, caisse, mobile money), le prévisionnel part de zéro : seuls les mouvements attendus sont projetés.
        </Notice>
      )}

      {c.firstNegative ? (
        <Notice tone="bad" title={`Votre trésorerie pourrait devenir négative le ${formatDate(c.firstNegative, "long")}`}>
          Dans le scénario central, selon les données renseignées. Point bas : {m(c.min.balance)} le {formatDate(c.min.date)}.
          Le simulateur et la liste des événements ci-dessous aident à identifier ce qui peut être relancé ou décalé.
        </Notice>
      ) : f.prudent.firstNegative ? (
        <Notice tone="warn" title={`Vigilance : en scénario prudent, le solde pourrait passer sous zéro le ${formatDate(f.prudent.firstNegative, "long")}`}>
          Le scénario central reste positif ({m(c.min.balance)} au plus bas), mais un retard de paiement de vos clients suffirait à creuser la trésorerie.
        </Notice>
      ) : c.firstBelowThreshold ? (
        <Notice tone="warn" title={`Le solde pourrait passer sous votre seuil de sécurité le ${formatDate(c.firstBelowThreshold, "long")}`}>
          Scénario central : point bas de {m(c.min.balance)} le {formatDate(c.min.date)}, pour un seuil de {m(threshold)}.
        </Notice>
      ) : null}

      {/* Graphique + chiffres clés */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader title={`Solde prévisionnel sur ${horizonLabel(horizon)}`} description="Projection jour par jour selon les données renseignées — une estimation, pas une certitude." />
          <div className="px-3 pb-4 sm:px-5">
            <div className="mb-3 px-2 sm:px-0">
              <Legend items={[
                { label: "Optimiste", color: SCENARIO_COLORS.optimist },
                { label: "Central", color: SCENARIO_COLORS.central },
                { label: "Prudent", color: SCENARIO_COLORS.prudent },
                ...(threshold > 0 ? [{ label: `Seuil de sécurité (${m(threshold)})`, color: "var(--warn-mark)" }] : []),
                { label: "Zéro", color: "var(--bad-mark)" },
              ]} />
            </div>
            <ScenarioChart series={series} currency={cur} threshold={threshold > 0 ? threshold : undefined} height={300} />
          </div>
        </Card>

        <Card className="lg:col-span-4">
          <div className="p-5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2"><LineIcon size={16} className="text-ink-3" /> En résumé (scénario central)</div>
            <dl className="mt-4 space-y-3 text-[13px]">
              <Row label="Solde de départ" hint="Soldes actuels de vos comptes"><span className="font-medium tabular">{m(c.start)}</span></Row>
              <Row label={`Solde au ${formatDate(addHorizonEnd(c), "day")}`}><Money value={c.end} currency={cur} className={cx("font-semibold", c.end < 0 && "text-bad")} /></Row>
              <Row label="Point bas"><span className={cx("font-medium tabular", c.min.balance < 0 ? "text-bad" : threshold > 0 && c.min.balance < threshold ? "text-warn" : "")}>{m(c.min.balance)}</span><span className="block text-[11.5px] text-ink-3">le {formatDate(c.min.date)}</span></Row>
              <Row label="Entrées prévues"><span className="tabular text-good">+{m(c.totalIn)}</span></Row>
              <Row label="Sorties prévues"><span className="tabular">−{m(c.totalOut)}</span></Row>
              <Row label="Sous zéro">{c.firstNegative ? <span className="font-medium text-bad">dès le {formatDate(c.firstNegative)}</span> : <span className="text-ink-3">non, sur la période</span>}</Row>
              {threshold > 0 && <Row label="Sous le seuil">{c.firstBelowThreshold ? <span className="font-medium text-warn">dès le {formatDate(c.firstBelowThreshold)}</span> : <span className="text-ink-3">non, sur la période</span>}</Row>}
            </dl>
            <p className="mt-4 text-[11.5px] leading-relaxed text-ink-3">Ces chiffres pourraient évoluer à chaque facture, paiement ou dépense enregistré.</p>
          </div>
        </Card>
      </div>

      {/* Comparaison des scénarios */}
      <Card>
        <CardHeader title="Les trois scénarios côte à côte" description={`Horizon : ${horizonLabel(horizon)}, jusqu'au ${formatDate(addHorizonEnd(c), "long")}.`} />
        <div className="hidden md:block">
          <Table>
            <thead>
              <tr>
                <Th>Scénario</Th>
                <Th align="right">Solde fin d&apos;horizon</Th>
                <Th align="right">Point bas</Th>
                <Th>Sous zéro</Th>
                {threshold > 0 && <Th>Sous le seuil</Th>}
                <Th align="right">Entrées prévues</Th>
                <Th align="right">Sorties prévues</Th>
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map((s) => (
                <tr key={s} className={s === "central" ? "bg-surface-2/60" : undefined}>
                  <Td><span className="inline-flex items-center gap-2 font-medium"><span className="h-0.5 w-4 rounded" style={{ background: SCENARIO_COLORS[s] }} aria-hidden />{SCENARIO_LABELS[s]}</span></Td>
                  <Td align="right"><Money value={f[s].end} currency={cur} className={cx("font-medium", f[s].end < 0 && "text-bad")} /></Td>
                  <Td align="right"><Money value={f[s].min.balance} currency={cur} className={f[s].min.balance < 0 ? "text-bad" : undefined} /><span className="block text-[11.5px] text-ink-3">{formatDate(f[s].min.date)}</span></Td>
                  <Td>{f[s].firstNegative ? <Badge tone="bad" dot>{formatDate(f[s].firstNegative)}</Badge> : <span className="text-[12.5px] text-ink-3">Non</span>}</Td>
                  {threshold > 0 && <Td>{f[s].firstBelowThreshold ? <Badge tone="warn" dot>{formatDate(f[s].firstBelowThreshold)}</Badge> : <span className="text-[12.5px] text-ink-3">Non</span>}</Td>}
                  <Td align="right"><span className="tabular text-good">+{m(f[s].totalIn)}</span></Td>
                  <Td align="right"><span className="tabular">−{m(f[s].totalOut)}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <ul className="divide-y divide-line md:hidden">
          {SCENARIOS.map((s) => (
            <li key={s} className="px-5 py-3.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[13.5px] font-medium"><span className="h-0.5 w-4 rounded" style={{ background: SCENARIO_COLORS[s] }} aria-hidden />{SCENARIO_LABELS[s]}</span>
                <Money value={f[s].end} currency={cur} className={cx("font-semibold", f[s].end < 0 && "text-bad")} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                <dt className="text-ink-3">Point bas</dt><dd className="text-right tabular">{m(f[s].min.balance)} · {formatDate(f[s].min.date, "day")}</dd>
                <dt className="text-ink-3">Sous zéro</dt><dd className={cx("text-right", f[s].firstNegative && "font-medium text-bad")}>{f[s].firstNegative ? formatDate(f[s].firstNegative) : "Non"}</dd>
                {threshold > 0 && <><dt className="text-ink-3">Sous le seuil</dt><dd className={cx("text-right", f[s].firstBelowThreshold && "font-medium text-warn")}>{f[s].firstBelowThreshold ? formatDate(f[s].firstBelowThreshold) : "Non"}</dd></>}
                <dt className="text-ink-3">Entrées / sorties</dt><dd className="text-right tabular">+{m(f[s].totalIn)} / −{m(f[s].totalOut)}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      {/* Hypothèses */}
      <Card id="hypotheses" className="scroll-mt-24">
        <CardHeader title="Hypothèses de calcul" description="Ce que chaque scénario suppose. Rien n'est inventé : seules les données renseignées sont projetées." />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-3">
          {SCENARIOS.map((s) => (
            <div key={s} className="rounded-xl bg-surface-2 px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><span className="h-0.5 w-4 rounded" style={{ background: SCENARIO_COLORS[s] }} aria-hidden />{SCENARIO_LABELS[s]}</div>
              <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
                {f[s].hypotheses.map((h) => <li key={h} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />{h}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-5 py-5">
          <ScenarioSettingsForm prudent={data.scenarios.prudentOverdueRate} central={data.scenarios.centralOverdueRate} optimist={data.scenarios.optimistOverdueRate} threshold={threshold} currency={cur} />
        </div>
      </Card>

      {/* Simulateur */}
      <Card id="simulateur" className="scroll-mt-24">
        <CardHeader title={<span className="inline-flex items-center gap-2"><Calculator size={16} className="text-ink-3" /> Puis-je absorber une dépense supplémentaire ?</span>}
          description="Testez l'effet d'une dépense ponctuelle sur votre point bas de trésorerie, dans les scénarios central et prudent." />
        <div className="px-5 pb-5">
          <AbsorbSimulator central={pts(simCentral)} prudent={pts(simPrudent)} today={today} threshold={threshold} currency={cur} />
        </div>
      </Card>

      {/* Événements prévus */}
      <Card id="evenements" className="scroll-mt-24">
        <CardHeader title={<span className="inline-flex items-center gap-2"><CalendarRange size={16} className="text-ink-3" /> Événements prévus, semaine par semaine</span>}
          description={`Scénario ${SCENARIO_LABELS[scenario].toLowerCase()} · ${f[scenario].events.length} mouvement${f[scenario].events.length > 1 ? "s" : ""} attendu${f[scenario].events.length > 1 ? "s" : ""} sur ${horizonLabel(horizon)}`}
          action={<Segmented items={SCENARIOS.map((s) => ({ key: s, label: SCENARIO_LABELS[s], href: href({ scenario: s }, "#evenements") }))} active={scenario} />} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line bg-surface-2/50 px-5 py-2.5 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5"><Badge tone="info">Contractuel</Badge> facture émise ou échéance connue</span>
          <span className="inline-flex items-center gap-1.5"><Badge tone="warn">Estimé</Badge> facture en retard pondérée, accord signé non facturé</span>
          <span className="inline-flex items-center gap-1.5"><Badge tone="neutral">Hypothétique</Badge> opportunité non confirmée, pondérée par sa probabilité</span>
          <span className="inline-flex items-center gap-1.5"><Info size={13} aria-hidden /> Les montants déjà encaissés n&apos;apparaissent pas : seuls les restants dus sont projetés.</span>
        </div>
        {weeks.length === 0 ? (
          <EmptyState compact icon={<CalendarRange size={18} />} title="Aucun mouvement prévu sur cette période"
            description="Créez des factures avec une échéance, enregistrez vos dépenses à venir et vos charges récurrentes : elles seront projetées ici automatiquement."
            action={<Link href="/revenus/nouveau" className="text-[13px] font-medium text-accent hover:underline">Créer une facture</Link>} />
        ) : (
          <div className="divide-y divide-line">
            {weeks.map((w) => (
              <section key={w.weekStart} aria-label={`Semaine du ${formatDate(w.weekStart)}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-surface-2/40 px-5 py-2.5">
                  <div className="text-[12.5px] font-semibold text-ink">Semaine du {formatDate(w.weekStart, "day")} au {formatDate(w.weekEnd, "day")}</div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
                    {w.inflow > 0 && <span>Entrées <span className="tabular text-good">+{m(w.inflow)}</span></span>}
                    {w.outflow > 0 && <span>Sorties <span className="tabular text-ink-2">−{m(w.outflow)}</span></span>}
                    <span>Solde projeté après la semaine : <span className={cx("font-semibold tabular", w.endBalance < 0 ? "text-bad" : threshold > 0 && w.endBalance < threshold ? "text-warn" : "text-ink")}>{m(w.endBalance)}</span>
                      {w.endBalance < 0 ? <span className="ml-1 text-bad">(négatif)</span> : threshold > 0 && w.endBalance < threshold ? <span className="ml-1 text-warn">(sous le seuil)</span> : null}</span>
                  </div>
                </div>
                <ul className="divide-y divide-line/70">
                  {w.events.map((e, i) => {
                    const n = eventNature(e);
                    const isInvoice = (e.kind === "invoice" || e.kind === "overdue_invoice") && e.ref;
                    const label = isInvoice ? <Link href={`/revenus/${e.ref}`} className="hover:underline underline-offset-4">{e.label}</Link> : e.label;
                    return (
                      <li key={`${e.ref ?? e.label}-${i}`} className={cx("flex flex-col gap-1.5 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-4", e.certainty === "hypothetical" && "opacity-80")}>
                        <span className="w-20 shrink-0 text-[12.5px] text-ink-3 tabular">{formatDate(e.date < today ? today : e.date, "day")}</span>
                        <span className={cx("min-w-0 flex-1 text-[13.5px]", e.certainty === "hypothetical" && "italic")}>{label}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={n.tone}>{n.label}</Badge>
                          <Badge tone={e.certainty === "contractual" ? "info" : e.certainty === "estimated" ? "warn" : "neutral"}>{n.certainty}</Badge>
                        </span>
                        <Money value={e.amount} currency={cur} sign tone="auto" className="w-32 shrink-0 text-[13.5px] font-medium sm:text-right" />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      {/* Prévu / réel */}
      <Card id="prevu-reel" className="scroll-mt-24">
        <CardHeader title={<span className="inline-flex items-center gap-2"><ClipboardCheck size={16} className="text-ink-3" /> Prévu ou réel : ce qui s&apos;est vraiment passé</span>}
          description="Chaque début de mois, Recap photographie ce qui était attendu (factures à échéance, dépenses et charges prévues) pour le comparer à ce qui a été encaissé et payé." />
        {variances.length === 0 ? (
          <EmptyState compact icon={<ClipboardCheck size={18} />} title="Pas encore de mois à comparer pour cette vue"
            description={currentPhoto
              ? `La photo de ${formatMonth(currentMonth, true)} est prise : la comparaison prévu / réel apparaîtra dès le mois prochain.`
              : "La photo du mois en cours sera prise lors de votre prochaine consultation du tableau de bord. La comparaison apparaîtra le mois suivant."} />
        ) : (
          <div className="grid gap-5 px-5 pb-5">
            {chartRows.length > 1 && <PlanActualChart rows={chartRows} currency={cur} />}
            <div className="grid gap-3">
              {variances.map(({ snapshot: s, reconstructed, v, currency }) => (
                <details key={s.id} className="group rounded-xl border border-line" open={s === variances[0].snapshot}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold capitalize">{formatMonth(s.month, true)}</span>
                      {reconstructed && <Badge tone="neutral">Photo reconstituée</Badge>}
                    </span>
                    {v ? (
                      <span className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
                        <span>Revenus : <GapText actual={v.actualIncome} planned={v.plannedIncome} currency={cur} goodWhen="up" /></span>
                        <span>Dépenses : <GapText actual={v.actualExpense} planned={v.plannedExpense} currency={cur} goodWhen="down" /></span>
                      </span>
                    ) : <span className="text-[12.5px] text-warn">Photo en {currency}, différente de votre devise de référence : comparaison impossible.</span>}
                  </summary>
                  {v && (
                    <div className="border-t border-line px-4 py-4">
                      {reconstructed && <p className="mb-3 text-[12px] text-ink-3">Cette photo n&apos;a pas été prise en début de mois : elle a été reconstituée à partir des échéances connues. Elle peut différer de ce que vous aviez réellement prévu.</p>}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Compare title="Revenus" plannedLabel="Prévus (factures à échéance)" actualLabel="Encaissés" planned={v.plannedIncome} actual={v.actualIncome} gap={v.incomeGap} currency={cur} goodWhen="up" />
                        <Compare title="Dépenses" plannedLabel="Prévues (échéances et récurrences)" actualLabel="Payées" planned={v.plannedExpense} actual={v.actualExpense} gap={v.expenseGap} currency={cur} goodWhen="down" />
                      </div>
                      {v.explanations.length > 0 ? (
                        <div className="mt-4">
                          <div className="mb-2 text-[12.5px] font-medium text-ink-2">Ce qui explique l&apos;écart</div>
                          <ul className="divide-y divide-line rounded-xl bg-surface-2/60">
                            {v.explanations.map((x, i) => (
                              <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[12.5px]">
                                <span className="flex min-w-0 items-center gap-2">
                                  <Badge tone={EXPLANATION[x.kind].tone}>{EXPLANATION[x.kind].label}</Badge>
                                  <span className="truncate text-ink-2">{x.label}</span>
                                </span>
                                <Money value={x.amount} currency={cur} sign className="shrink-0 text-ink" />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : <p className="mt-4 text-[12.5px] text-ink-3">Aucun écart notable à expliquer : ce mois s&apos;est déroulé comme prévu.</p>}
                    </div>
                  )}
                </details>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Objectifs */}
      <Card id="objectifs" className="scroll-mt-24">
        <CardHeader title={<span className="inline-flex items-center gap-2"><Target size={16} className="text-ink-3" /> Objectifs</span>}
          description={`Suivis automatiquement à partir de vos opérations, dans la vue « ${scope.label} ». Montants en ${cur}.`}
          action={<GoalDialog activities={activityOptions} currency={cur} />} />
        {goalRows.length === 0 ? (
          <EmptyState compact icon={<Target size={18} />} title="Aucun objectif pour l'instant"
            description="Fixez par exemple un objectif de revenus mensuels, une trésorerie minimale ou un plafond de dépenses : Recap vous dira où vous en êtes, chiffres à l'appui." />
        ) : (
          <ul className="divide-y divide-line">
            {goalRows.map((g) => {
              const p = progress.get(g.id);
              const def = GOAL_TYPES[g.type];
              const fmt = (v: number) => (def?.unit === "percent" ? formatPercent(v) : m(v));
              const act = g.activityId ? activitiesById.get(g.activityId) : null;
              const outOfScope = g.active && !p;
              const goal: GoalData = { id: g.id, type: g.type, label: g.label, target: g.target, deadline: g.deadline, activityId: g.activityId, active: g.active };
              return (
                <li key={g.id} className={cx("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start", !g.active && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium">{g.label}</span>
                      {!g.active ? <Badge tone="neutral">Désactivé</Badge>
                        : outOfScope ? <Badge tone="neutral">Hors de la vue actuelle</Badge>
                        : p ? <Badge tone={p.status === "at_risk" ? "warn" : "good"} dot>{p.status === "reached" ? "Atteint" : p.status === "on_track" ? (p.lowerIsBetter ? "Respecté" : "En bonne voie") : "À surveiller"}</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {def?.label ?? g.type} · cible {fmt(g.target)}{act ? ` · ${act.name}` : ""}{g.deadline ? ` · échéance ${formatDate(g.deadline)}` : ""}
                    </div>
                    {p && g.active && (
                      <div className="mt-2.5 max-w-xl">
                        <div className="mb-1 flex justify-between text-[12px]"><span className="text-ink-2">Actuel : <span className="font-medium tabular text-ink">{fmt(p.current)}</span></span><span className="tabular text-ink-3">{Math.round(p.progress * 100)} %</span></div>
                        <Progress value={p.progress} tone={p.status === "at_risk" ? "warn" : "good"} label={g.label} />
                        <p className="mt-1.5 text-[12.5px] text-ink-2">{p.message}</p>
                      </div>
                    )}
                    {outOfScope && <p className="mt-1.5 text-[12px] text-ink-3">Cet objectif concerne une structure qui n&apos;est pas incluse dans la vue sélectionnée.</p>}
                  </div>
                  <GoalActions goal={goal} activities={activityOptions} currency={cur} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function addHorizonEnd(f: ForecastResult) {
  return f.points.at(-1)?.date ?? "";
}

const EXPLANATION: Record<string, { label: string; tone: "bad" | "warn" | "good" | "info" | "neutral" }> = {
  late_payment: { label: "Non encaissée", tone: "bad" },
  partial_payment: { label: "Paiement partiel", tone: "warn" },
  unplanned_income: { label: "Encaissement non prévu", tone: "good" },
  unplanned_expense: { label: "Dépense non prévue", tone: "warn" },
  skipped_expense: { label: "Échéance non payée", tone: "info" },
};

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-ink-3">{label}{hint && <span className="block text-[11.5px]">{hint}</span>}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function GapText({ actual, planned, currency, goodWhen }: { actual: number; planned: number; currency: string; goodWhen: "up" | "down" }) {
  const gap = actual - planned;
  const pct = gapPercent(actual, planned);
  const good = gap === 0 ? null : (gap > 0) === (goodWhen === "up");
  return (
    <span className={cx("tabular", good === true && "text-good", good === false && "text-bad")}>
      {formatMoney(gap, currency, { sign: true })}{pct != null ? ` (${pct > 0 ? "+" : ""}${formatPercent(pct)})` : ""}
    </span>
  );
}

function Compare({ title, plannedLabel, actualLabel, planned, actual, gap, currency, goodWhen }: { title: string; plannedLabel: string; actualLabel: string; planned: number; actual: number; gap: number; currency: string; goodWhen: "up" | "down" }) {
  const m = (v: number) => formatMoney(v, currency);
  const pct = gapPercent(actual, planned);
  const good = gap === 0 ? null : (gap > 0) === (goodWhen === "up");
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-3">
      <div className="text-[12px] font-medium text-ink-3">{title}</div>
      <dl className="mt-2 space-y-1 text-[13px]">
        <div className="flex justify-between gap-3"><dt className="text-ink-3">{plannedLabel}</dt><dd className="tabular">{m(planned)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-2">{actualLabel}</dt><dd className="font-medium tabular">{m(actual)}</dd></div>
        <div className="flex justify-between gap-3 border-t border-line pt-1">
          <dt className="text-ink-3">Écart</dt>
          <dd className={cx("font-medium tabular", good === true && "text-good", good === false && "text-bad")}>
            {formatMoney(gap, currency, { sign: true })}{pct != null ? ` · ${pct > 0 ? "+" : ""}${formatPercent(pct)}` : ""}
            {good != null && <span className="ml-1 text-[11.5px] font-normal">({good ? "favorable" : "défavorable"})</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}
