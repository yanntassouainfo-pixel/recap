import type { ReactNode } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowRight, BarChart3, BookOpen, Layers, Lightbulb, PieChart, Unlink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getScope, getSnapshot } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { profitability, type ActivityProfit } from "@/lib/finance/engine";
import {
  PROFIT_PERIODS, buildReadingText, highlightValue, marginOf, parseMarginBase, resolveProfitPeriod, type MarginBase,
} from "@/lib/planning";
import { Badge, ButtonLink, Card, CardHeader, Delta, EmptyState, Money, PageHeader, Segmented, Table, Td, Th, cx } from "@/components/ui";
import { ActivityBars, Legend } from "@/components/charts";
import { AllocationRuleDialog, DeleteRuleButton, type CompanyOption, type RuleData } from "@/components/profitability/rule-dialog";

export const metadata = { title: "Rentabilité" };

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const scope = await getScope(user.id);
  const snap = await getSnapshot(user.id);
  const { data, movements, states } = snap;
  const cur = data.baseCurrency;
  const m = (v: number) => formatMoney(v, cur);
  const today = data.today;

  const period = resolveProfitPeriod(sp.periode, today, { from: sp.du, to: sp.au });
  const base = parseMarginBase(sp.base);
  const report = profitability(data, period.from, period.to, { states, movements });
  const href = (o: { periode?: string; base?: MarginBase }, hash = "") => {
    const p = new URLSearchParams();
    const k = o.periode ?? period.key;
    if (k !== "90j") p.set("periode", k);
    if (k === "perso" && o.periode === undefined) { p.set("du", period.from); p.set("au", period.to); }
    const b = o.base ?? base;
    if (b !== "facture") p.set("base", b);
    const qs = p.toString();
    return `/rentabilite${qs ? `?${qs}` : ""}${hash}`;
  };

  const scopeActivities = data.activities.filter((a) => data.scopeCompanyIds.has(a.companyId) && !a.archived);
  const companiesById = new Map(data.companies.map((c) => [c.id, c]));
  const activitiesById = new Map(data.activities.map((a) => [a.id, a]));
  const hasRevenue = report.activities.some((a) => a.invoiced > 0 || a.collected > 0);
  const empty = scopeActivities.length <= 1 || !hasRevenue;

  /* Règles de répartition (structures de la vue, hors espace personnel) */
  const ruleCompanies: CompanyOption[] = data.companies
    .filter((c) => data.scopeCompanyIds.has(c.id) && c.kind !== "personal" && !c.archived)
    .map((c) => ({ id: c.id, name: c.name, activities: scopeActivities.filter((a) => a.companyId === c.id).map((a) => ({ id: a.id, name: a.name, color: a.color })) }));
  const rules: RuleData[] = data.allocationRules.filter((r) => data.scopeCompanyIds.has(r.companyId))
    .map((r) => ({ id: r.id, companyId: r.companyId, name: r.name, method: r.method, shares: r.shares }));
  const usage = new Map<string, number>();
  for (const e of db.select({ ruleId: schema.expenses.allocationRuleId }).from(schema.expenses).where(eq(schema.expenses.userId, user.id)).all()) {
    if (e.ruleId) usage.set(e.ruleId, (usage.get(e.ruleId) ?? 0) + 1);
  }
  for (const r of db.select({ ruleId: schema.recurringExpenses.allocationRuleId }).from(schema.recurringExpenses).where(eq(schema.recurringExpenses.userId, user.id)).all()) {
    if (r.ruleId) usage.set(r.ruleId, (usage.get(r.ruleId) ?? 0) + 1);
  }

  const rows = report.activities.filter((a) => a.invoiced > 0 || a.collected > 0 || a.totalCosts > 0 || a.outstanding > 0);
  const reading = empty ? [] : buildReadingText(report, cur, base);
  const totalMargin = base === "encaisse" ? report.totals.collected - report.totals.costs : report.totals.margin;
  const totalRef = base === "encaisse" ? report.totals.collected : report.totals.invoiced;
  const baseLabel = base === "encaisse" ? "encaissé" : "facturé";

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={scope.label}
        title="Rentabilité"
        description="Quelle activité crée réellement le plus de valeur ? Revenus, dépenses et marge estimée de chacune, sur la période choisie."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented items={PROFIT_PERIODS.map((p) => ({ key: p.key, label: p.label, href: href({ periode: p.key }) }))} active={period.key} />
            <form className="flex items-center gap-1.5" action="/rentabilite">
              <input type="hidden" name="periode" value="perso" />
              {base !== "facture" && <input type="hidden" name="base" value={base} />}
              <input type="date" name="du" defaultValue={period.key === "perso" ? period.from : ""} max={today} className="field-input h-8 w-[132px] px-2 text-[12.5px]" aria-label="Du" required />
              <input type="date" name="au" defaultValue={period.key === "perso" ? period.to : ""} className="field-input h-8 w-[132px] px-2 text-[12.5px]" aria-label="Au" />
              <button className={cx("h-8 rounded-lg px-2.5 text-[12.5px] font-medium hover:bg-surface-3", period.key === "perso" ? "bg-surface-3 text-ink" : "text-ink-2")}>Appliquer</button>
            </form>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-2"><span className="font-medium text-ink">{period.label}</span> · du {formatDate(period.from)} au {formatDate(period.to)}, comparé à la période précédente de même durée.</p>
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-ink-3">Marge calculée sur le</span>
          <Segmented items={[{ key: "facture", label: "Facturé", href: href({ base: "facture" }) }, { key: "encaisse", label: "Encaissé", href: href({ base: "encaisse" }) }]} active={base} />
        </div>
      </div>

      {/* Rappel des définitions */}
      <Card>
        <details className="group" open={empty}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5">
            <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold"><BookOpen size={16} className="text-ink-3" /> Ce que représentent ces chiffres</span>
            <span className="text-[12px] text-ink-3 group-open:hidden">Afficher</span>
            <span className="hidden text-[12px] text-ink-3 group-open:inline">Masquer</span>
          </summary>
          <dl className="grid gap-x-6 gap-y-3 border-t border-line px-5 py-4 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
            <Def term="Chiffre d'affaires facturé">Factures émises sur la période (date d&apos;émission) + recettes directes. Pas forcément encore payé.</Def>
            <Def term="Chiffre d'affaires encaissé">Argent réellement reçu sur la période pour cette activité (paiements de factures + recettes directes).</Def>
            <Def term="Coûts directs">Dépenses rattachées à l&apos;activité et marquées « coût direct » (sous-traitance, matériel d&apos;un projet…).</Def>
            <Def term="Autres dépenses affectées">Dépenses rattachées à l&apos;activité sans être des coûts directs (outils dédiés, publicité…).</Def>
            <Def term="Frais communs répartis">Part des dépenses partagées (loyer, abonnements…) attribuée via une règle de répartition.</Def>
            <Def term="Marge estimée">Facturé − (coûts directs + autres affectées + frais communs). La « marge sur encaissé » part de l&apos;encaissé : plus proche de la trésorerie.</Def>
          </dl>
          <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3">Les dépenses sont comptées à leur date d&apos;engagement (payées ou à payer, hors annulées), converties dans votre devise de référence ({cur}).</p>
        </details>
      </Card>

      {empty ? (
        <Card>
          <EmptyState icon={<Layers size={20} />}
            title={scopeActivities.length <= 1 ? "Comparez vos activités dès que vous en suivez plusieurs" : "Aucune facture associée à une activité sur la période"}
            description={scopeActivities.length <= 1
              ? "Créez une activité par métier (formation, conseil, création…) dans vos structures, puis choisissez-la sur chaque facture et dépense : Recap calculera la marge de chacune."
              : "Associez vos factures, recettes et dépenses à une activité (champ « Activité » de chaque opération) ou élargissez la période pour comparer vos activités."}
            action={<>
              <ButtonLink href="/structures" variant="primary" size="sm">Organiser mes activités</ButtonLink>
              {scopeActivities.length > 1 && <ButtonLink href={href({ periode: "annee" })} size="sm">Voir l&apos;année</ButtonLink>}
            </>} />
        </Card>
      ) : (
        <>
          {/* Points forts */}
          {report.highlights.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {report.highlights.map((h) => {
                const a = report.activities.find((x) => x.activityId === h.activityId);
                if (!a) return null;
                return (
                  <Card key={h.key} className="p-4">
                    <div className="text-[12px] font-medium text-ink-3">{h.label}</div>
                    <div className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold"><span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden />{a.name}</div>
                    <div className="mt-1 text-[13px] text-ink-2 tabular">{highlightValue(h.key, a, cur)}</div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Lecture + graphique */}
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-5">
              <CardHeader title={<span className="inline-flex items-center gap-2"><Lightbulb size={16} className="text-ink-3" /> En clair</span>} description={`Lecture automatique des chiffres · marge sur le ${baseLabel}`} />
              <div className="space-y-3 px-5 pb-5 text-[13.5px] leading-relaxed text-ink-2">
                {reading.map((p, i) => <p key={i} className={i === reading.length - 1 ? "rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-3" : undefined}>{p}</p>)}
              </div>
            </Card>
            <Card className="lg:col-span-7">
              <CardHeader title={<span className="inline-flex items-center gap-2"><BarChart3 size={16} className="text-ink-3" /> Facturé, coûts et marge par activité</span>} description="Une seule échelle, en devise de référence." />
              <div className="px-3 pb-4 sm:px-5">
                <div className="mb-3"><Legend items={[{ label: "Facturé", color: "var(--series-1)" }, { label: "Coûts (tous)", color: "var(--series-2)" }, { label: "Marge estimée", color: "var(--series-3)" }]} /></div>
                <ActivityBars rows={rows.map((a) => ({ name: a.name, invoiced: a.invoiced, costs: a.totalCosts, margin: a.margin }))} currency={cur} />
              </div>
            </Card>
          </div>

          {/* Tableau comparatif */}
          <Card>
            <CardHeader title="Comparaison détaillée" description={`Marge et taux calculés sur le ${baseLabel}. Évolution du facturé vs période précédente.`} />
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Activité</Th>
                    <Th align="right">Facturé</Th>
                    <Th align="right">Encaissé</Th>
                    <Th align="right">Coûts directs</Th>
                    <Th align="right">Autres affectées</Th>
                    <Th align="right">Frais communs</Th>
                    <Th align="right">Marge {base === "encaisse" ? "sur encaissé" : "estimée"}</Th>
                    <Th>Taux de marge</Th>
                    <Th>Évolution</Th>
                    <Th align="right">Clients</Th>
                    <Th align="right">Panier moyen</Th>
                    <Th align="right">Restant à encaisser</Th>
                    <Th align="right">Délai moyen</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const mg = marginOf(a, base);
                    return (
                      <tr key={a.activityId}>
                        <Td><span className="inline-flex items-center gap-2 font-medium"><span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden /><span className="max-w-[180px] truncate">{a.name}</span></span>
                          {data.scopeCompanyIds.size > 1 && <span className="block pl-[18px] text-[11.5px] text-ink-3">{companiesById.get(a.companyId)?.name}</span>}</Td>
                        <Td align="right"><Money value={a.invoiced} currency={cur} /></Td>
                        <Td align="right"><Money value={a.collected} currency={cur} /></Td>
                        <Td align="right"><Money value={a.directCosts} currency={cur} className="text-ink-2" /></Td>
                        <Td align="right"><Money value={a.assignedCosts} currency={cur} className="text-ink-2" /></Td>
                        <Td align="right"><Money value={a.sharedCosts} currency={cur} className="text-ink-2" /></Td>
                        <Td align="right"><Money value={mg.margin} currency={cur} className={cx("font-semibold", mg.margin < 0 && "text-bad")} /></Td>
                        <Td><RateBar rate={mg.rate} /></Td>
                        <Td><Delta value={a.growth} /></Td>
                        <Td align="right"><span className="tabular">{a.clients}</span></Td>
                        <Td align="right">{a.averageInvoice != null ? <Money value={a.averageInvoice} currency={cur} /> : <span className="text-ink-3">—</span>}</Td>
                        <Td align="right">{a.outstanding > 0 ? <Money value={a.outstanding} currency={cur} /> : <span className="text-ink-3">—</span>}</Td>
                        <Td align="right">{a.averageDaysToPay != null ? <span className="tabular">{a.averageDaysToPay} j</span> : <span className="text-ink-3">—</span>}</Td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface-2/60 font-medium">
                    <Td>Total{report.unassignedRevenue > 0 || report.unassignedCosts > 0 ? <span className="block text-[11.5px] font-normal text-ink-3">y compris non affecté</span> : null}</Td>
                    <Td align="right"><Money value={report.totals.invoiced} currency={cur} /></Td>
                    <Td align="right"><Money value={report.totals.collected} currency={cur} /></Td>
                    <Td align="right" colSpan={3}><span className="text-[12px] font-normal text-ink-3">Coûts totaux : </span><Money value={report.totals.costs} currency={cur} /></Td>
                    <Td align="right"><Money value={totalMargin} currency={cur} className={cx("font-semibold", totalMargin < 0 && "text-bad")} /></Td>
                    <Td><RateBar rate={totalRef > 0 ? (totalMargin / totalRef) * 100 : null} /></Td>
                    <Td colSpan={5} />
                  </tr>
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((a) => <ActivityCard key={a.activityId} a={a} base={base} currency={cur} />)}
              <li className="flex items-center justify-between px-5 py-3 text-[13px]">
                <span className="font-medium">Marge totale {base === "encaisse" ? "sur encaissé" : "estimée"}</span>
                <Money value={totalMargin} currency={cur} className={cx("font-semibold", totalMargin < 0 && "text-bad")} />
              </li>
            </ul>
            {report.unassignedRevenue > 0 && (
              <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-3">
                {m(report.unassignedRevenue)} de chiffre d&apos;affaires facturé n&apos;est rattaché à aucune activité (inclus dans le total).{" "}
                <Link href="/revenus" className="font-medium text-accent hover:underline">Associer les factures</Link>
              </p>
            )}
          </Card>
        </>
      )}

      {/* Frais communs et répartition */}
      {ruleCompanies.length > 0 && scopeActivities.length > 1 && (
        <Card id="repartition" className="scroll-mt-24">
          <CardHeader title={<span className="inline-flex items-center gap-2"><PieChart size={16} className="text-ink-3" /> Frais communs et répartition</span>}
            description="Les règles répartissent les dépenses partagées entre les activités d'une structure. Seules les dépenses qui utilisent une règle sont réparties."
            action={<AllocationRuleDialog companies={ruleCompanies} defaultCompanyId={scope.company?.id} />} />
          <div className="grid gap-5 px-5 pb-5 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              {ruleCompanies.map((c) => {
                const list = rules.filter((r) => r.companyId === c.id);
                return (
                  <div key={c.id}>
                    {ruleCompanies.length > 1 && <div className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.04em] text-ink-3">{c.name}</div>}
                    {list.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-line-2 px-4 py-3 text-[12.5px] text-ink-3">Aucune règle : les frais communs de {c.name} restent non affectés.</p>
                    ) : (
                      <ul className="divide-y divide-line rounded-xl border border-line">
                        {list.map((r) => {
                          const total = r.shares.reduce((acc, s) => acc + s.percent, 0);
                          return (
                            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13.5px] font-medium">{r.name}</span>
                                  <Badge tone={r.method === "revenue" ? "info" : "accent"}>{r.method === "revenue" ? "Au prorata du CA facturé" : "Pourcentages définis"}</Badge>
                                </div>
                                {r.method === "manual" ? (
                                  <div className="mt-1 text-[12.5px] text-ink-3">
                                    {r.shares.map((s) => `${activitiesById.get(s.activityId)?.name ?? "Activité supprimée"} ${formatPercent(s.percent, s.percent % 1 ? 1 : 0)}`).join(" · ")}
                                    {total < 100 && <span className="text-warn"> · {formatPercent(100 - total, (100 - total) % 1 ? 1 : 0)} non affecté</span>}
                                  </div>
                                ) : <div className="mt-1 text-[12.5px] text-ink-3">Réparti selon le chiffre d&apos;affaires facturé de chaque activité sur la période analysée.</div>}
                                <div className="mt-0.5 text-[11.5px] text-ink-3">{usage.get(r.id) ?? 0} dépense(s) ou charge(s) récurrente(s) utilisent cette règle</div>
                              </div>
                              <div className="flex shrink-0 items-center">
                                <AllocationRuleDialog rule={r} companies={ruleCompanies} />
                                <DeleteRuleButton rule={r} usage={usage.get(r.id) ?? 0} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">Frais répartis sur la période</div>
              {report.sharedDetails.length === 0 ? (
                <p className="rounded-xl bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">Aucune dépense répartie sur la période. Pour répartir un frais commun, choisissez une règle de répartition sur la dépense concernée.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {report.sharedDetails.slice().sort((a, b) => b.amount - a.amount).slice(0, 12).map((d, i) => (
                    <li key={i} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13px] font-medium">{d.label}</span>
                        <Money value={d.amount} currency={cur} className="text-[13px]" />
                      </div>
                      <div className="text-[11.5px] text-ink-3">Règle « {d.rule} » · {d.method}</div>
                      {d.split.length > 0 ? (
                        <div className="mt-1 text-[12px] text-ink-2">{d.split.map((s) => `${activitiesById.get(s.activityId)?.name ?? "?"} ${m(s.amount)}`).join(" · ")}</div>
                      ) : <div className="mt-1 text-[12px] text-warn">Non répartie : aucune activité n&apos;a de chiffre d&apos;affaires sur la période.</div>}
                    </li>
                  ))}
                  {report.sharedDetails.length > 12 && <li className="px-4 py-2 text-[12px] text-ink-3">+ {report.sharedDetails.length - 12} autre(s) dépense(s) répartie(s)</li>}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Dépenses non affectées */}
      {!(empty && scopeActivities.length <= 1) && (
        <Card id="non-affectees" className="scroll-mt-24">
          <CardHeader title={<span className="inline-flex items-center gap-2"><Unlink size={16} className="text-ink-3" /> Dépenses non affectées</span>}
            description="Dépenses de la période rattachées à aucune activité ni règle de répartition." />
          <div className="px-5 pb-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Money value={report.unassignedCosts} currency={cur} className="text-[22px] font-semibold tracking-[-0.02em]" />
              {report.totals.costs > 0 && <span className="text-[12.5px] text-ink-3">soit {formatPercent((report.unassignedCosts / report.totals.costs) * 100)} de l&apos;ensemble des dépenses de la période</span>}
            </div>
            <p className="mt-1.5 max-w-3xl text-[12.5px] text-ink-3">Plutôt que de les répartir arbitrairement, Recap les laisse non affectées : elles pèsent sur la marge globale, pas sur celle d&apos;une activité. Rattachez-les à une activité ou à une règle de répartition si elles concernent clairement l&apos;une d&apos;elles.</p>
            {report.unassignedItems.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {report.unassignedItems.slice().sort((a, b) => b.amount - a.amount).slice(0, 15).map((it, i) => {
                  const q = it.label.replace(/ \(part non répartie\)$/, "").split(" · ")[0];
                  return (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <span className="w-20 shrink-0 text-[12px] text-ink-3 tabular">{formatDate(it.date, "day")}</span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      <Money value={it.amount} currency={cur} className="shrink-0" />
                      <Link href={`/depenses?q=${encodeURIComponent(q)}`} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent hover:underline">Affecter <ArrowRight size={12} /></Link>
                    </li>
                  );
                })}
                {report.unassignedItems.length > 15 && <li className="px-4 py-2 text-[12px] text-ink-3">+ {report.unassignedItems.length - 15} autre(s) dépense(s) non affectée(s)</li>}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Def({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-ink">{term}</dt>
      <dd className="mt-0.5 text-ink-3">{children}</dd>
    </div>
  );
}

function RateBar({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="text-[12.5px] text-ink-3">—</span>;
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-surface-3">
        {rate > 0 && <div className="h-full rounded-full bg-[var(--series-3)]" style={{ width: `${Math.max(2, Math.min(100, rate))}%` }} />}
      </div>
      <span className={cx("w-12 text-right text-[12.5px] font-medium tabular", rate < 0 && "text-bad")}>{formatPercent(rate)}</span>
    </div>
  );
}

function ActivityCard({ a, base, currency }: { a: ActivityProfit; base: MarginBase; currency: string }) {
  const m = (v: number) => formatMoney(v, currency);
  const mg = marginOf(a, base);
  return (
    <li className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2 text-[14px] font-semibold"><span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden /><span className="truncate">{a.name}</span></span>
        <Delta value={a.growth} />
      </div>
      <div className="mt-2"><RateBar rate={mg.rate} /></div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
        <dt className="text-ink-3">Facturé</dt><dd className="text-right tabular">{m(a.invoiced)}</dd>
        <dt className="text-ink-3">Encaissé</dt><dd className="text-right tabular">{m(a.collected)}</dd>
        <dt className="text-ink-3">Coûts directs</dt><dd className="text-right tabular">{m(a.directCosts)}</dd>
        <dt className="text-ink-3">Autres affectées</dt><dd className="text-right tabular">{m(a.assignedCosts)}</dd>
        <dt className="text-ink-3">Frais communs</dt><dd className="text-right tabular">{m(a.sharedCosts)}</dd>
        <dt className="font-medium text-ink-2">Marge {base === "encaisse" ? "sur encaissé" : "estimée"}</dt><dd className={cx("text-right font-semibold tabular", mg.margin < 0 && "text-bad")}>{m(mg.margin)}</dd>
        <dt className="text-ink-3">Clients · panier moyen</dt><dd className="text-right tabular">{a.clients} · {a.averageInvoice != null ? m(a.averageInvoice) : "—"}</dd>
        <dt className="text-ink-3">Restant à encaisser</dt><dd className="text-right tabular">{a.outstanding > 0 ? m(a.outstanding) : "—"}</dd>
        <dt className="text-ink-3">Délai moyen d&apos;encaissement</dt><dd className="text-right tabular">{a.averageDaysToPay != null ? `${a.averageDaysToPay} j` : "—"}</dd>
      </dl>
    </li>
  );
}
