/** Vue « Toutes les dépenses » : filtres, synthèse de la période, répartition par catégorie, liste paginée. */
import Link from "next/link";
import { Download, Paperclip, Plus, Repeat, Search, X } from "lucide-react";
import { Badge, Card, CardHeader, Delta, Dot, EmptyState, Input, Notice, Select, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { pctChange } from "@/lib/finance/engine";
import type { ExpenseRow, FinanceData } from "@/lib/finance/types";
import {
  STATUS_FILTER_LABELS, assignmentOf, buildHref, buildLookup, expenseStatus, filterExpenses, paginate, parseExpenseFilters,
  recentMonths, referenceDate, summarizeExpenses, type Lookup,
} from "./logic";
import { ExpenseActions, type ExpenseItem } from "./expense-actions";
import { FilterForm } from "./filter-form";
import { DateChip, ExpenseStatusBadge, Kpi, Pager, filterLabel } from "./bits";

export type ExpenseDbRow = ExpenseRow & { note: string | null; documentId: string | null };

const PAGE_SIZE = 50;
/** Paramètres d'URL propres à cette vue (les autres sont ignorés pour les liens). */
const KEYS = ["mois", "du", "au", "structure", "activite", "categorie", "statut", "q", "depense"] as const;

function toItem(e: ExpenseDbRow, lookup: Lookup): ExpenseItem {
  return {
    id: e.id, label: e.label, supplier: e.supplier, amount: e.amount, currency: e.currency, date: e.date, dueDate: e.dueDate,
    paidDate: e.paidDate, status: e.status, companyId: e.companyId, accountId: e.accountId, accountName: lookup.account(e.accountId)?.name ?? null,
    activityId: e.activityId, allocationRuleId: e.allocationRuleId, categoryId: e.categoryId, costType: e.costType, method: e.method, note: e.note,
  };
}

export function AllExpensesView({ data, sp, rows }: { data: FinanceData; sp: Record<string, string | undefined>; rows: ExpenseDbRow[] }) {
  const today = data.today;
  const cur = data.baseCurrency;
  const f = parseExpenseFilters(sp, today);
  const lookup = buildLookup(data);
  const params: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, sp[k]]));
  const href = (patch: Record<string, string | undefined | null> = {}) => buildHref("/depenses", params, patch);

  const list = filterExpenses(rows, data, f, lookup);
  const summary = summarizeExpenses(list, data, lookup);
  const prev = f.expenseId ? null : summarizeExpenses(filterExpenses(rows, data, f, lookup, { from: f.prevFrom, to: f.prevTo }), data, lookup);
  const paged = paginate(list, f.page, PAGE_SIZE);

  const companies = data.companies.filter((c) => data.scopeCompanyIds.has(c.id));
  const activities = data.activities.filter((a) => data.scopeCompanyIds.has(a.companyId) && !a.archived);
  const expenseCats = data.categories.filter((c) => c.kind === "expense").sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const hasAny = rows.some((e) => data.scopeCompanyIds.has(e.companyId));
  const filtered = !!(f.companyId || f.activity || f.categoryId || f.status !== "all" || f.q || f.expenseId);
  const exportHref = buildHref("/api/export/expenses", params);
  const catMax = summary.byCategory[0]?.amount ?? 0;
  const multiCompany = companies.length > 1;

  if (!hasAny) {
    return (
      <Card>
        <EmptyState icon={<Plus size={18} />} title="Aucune dépense enregistrée"
          description="Ajoutez vos dépenses au fil de l'eau, ou vos charges récurrentes (loyer, abonnements, assurances) pour qu'elles soient anticipées automatiquement."
          action={<>
            <QuickButton kind="expense" className={buttonClass("primary", "sm")}><Plus size={14} /> Ajouter une dépense</QuickButton>
            <QuickButton kind="recurring" className={buttonClass("secondary", "sm")}><Repeat size={14} /> Charge récurrente</QuickButton>
          </>} />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <FilterForm path="/depenses" className="card flex flex-wrap items-end gap-3 p-4" label="Filtrer les dépenses">
        <label className="flex min-w-[150px] flex-col gap-1">
          <span className={filterLabel}>Période</span>
          <Select name="mois" defaultValue={f.custom ? "personnalise" : f.month ?? ""} aria-label="Période">
            {recentMonths(today).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            {f.month && !recentMonths(today).some((m) => m.key === f.month) && <option value={f.month}>{f.label}</option>}
            <option value="personnalise">Période personnalisée…</option>
          </Select>
        </label>
        {f.custom && (
          <>
            <label className="flex flex-col gap-1"><span className={filterLabel}>Du</span><Input type="date" name="du" defaultValue={f.from} /></label>
            <label className="flex flex-col gap-1"><span className={filterLabel}>Au</span><Input type="date" name="au" defaultValue={f.to} /></label>
          </>
        )}
        {multiCompany && (
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
            <span className={filterLabel}>Affectation</span>
            <Select name="activite" defaultValue={f.activity}>
              <option value="">Toutes</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="commun">Frais communs répartis</option>
              <option value="aucune">Non affectées</option>
            </Select>
          </label>
        )}
        <label className="flex min-w-[150px] flex-col gap-1">
          <span className={filterLabel}>Catégorie</span>
          <Select name="categorie" defaultValue={f.categoryId}>
            <option value="">Toutes</option>
            {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="aucune">Sans catégorie</option>
          </Select>
        </label>
        <label className="flex min-w-[150px] flex-col gap-1">
          <span className={filterLabel}>Statut</span>
          <Select name="statut" defaultValue={sp.statut ?? ""}>
            {STATUS_FILTER_LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className={filterLabel}>Recherche</span>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input name="q" type="search" defaultValue={f.q} placeholder="Libellé, fournisseur, catégorie… puis Entrée" className="pl-8" />
          </div>
        </label>
        {filtered && (
          <Link href={buildHref("/depenses", { mois: sp.mois, du: sp.du, au: sp.au })} className={buttonClass("ghost", "md")}><X size={14} /> Effacer les filtres</Link>
        )}
      </FilterForm>

      {f.expenseId && (
        <Notice title="Affichage d'une dépense précise" action={<Link href="/depenses" className={buttonClass("secondary", "sm")}>Voir toutes les dépenses</Link>}>
          {list.length === 0 ? "Cette dépense est introuvable dans la vue actuelle (autre structure ou supprimée)." : "Ouverte depuis les transactions."}
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Payé · ${f.label.toLowerCase()}`} value={formatMoney(summary.paid, cur)}
          sub={<>{summary.paidCount} dépense{summary.paidCount > 1 ? "s" : ""}{prev && <> · <Delta value={pctChange(summary.paid, prev.paid)} goodWhen="down" suffix={`vs ${f.prevLabel}`} /></>}</>} />
        <Kpi label="Reste à payer" value={formatMoney(summary.committed, cur)} tone={summary.overdueCount > 0 ? "warn" : undefined}
          href={href({ statut: "a-payer", page: null })}
          sub={summary.overdueCount > 0 ? <span className="text-warn">dont {formatMoney(summary.overdueAmount, cur)} en retard ({summary.overdueCount})</span> : `${summary.committedCount} dépense${summary.committedCount > 1 ? "s" : ""} engagée${summary.committedCount > 1 ? "s" : ""}, non payée${summary.committedCount > 1 ? "s" : ""}`} />
        <Kpi label="Part des charges fixes" value={summary.fixedShare == null ? "—" : formatPercent(summary.fixedShare * 100)}
          sub={summary.fixedShare == null ? "Rien de payé sur la période" : `${formatMoney(summary.fixedAmount, cur)} de charges fixes payées`} />
        <Kpi label="Dépenses non affectées" value={formatMoney(summary.unassignedAmount, cur)} tone={summary.unassignedCount > 0 ? "warn" : undefined}
          href={activities.length > 0 ? href({ activite: "aucune", page: null }) : undefined}
          sub={summary.unassignedCount > 0 ? `${summary.unassignedCount} à rattacher à une activité` : "Tout est rattaché à une activité"} />
      </div>

      {(summary.missingRates > 0 || summary.internalCount > 0) && (
        <div className="space-y-2">
          {summary.missingRates > 0 && (
            <Notice tone="warn" title="Taux de change manquant">
              {summary.missingRates} dépense{summary.missingRates > 1 ? "s" : ""} en devise étrangère {summary.missingRates > 1 ? "ne sont pas comptées" : "n'est pas comptée"} dans les totaux faute de taux de change. Ajoutez un taux dans les paramètres.
            </Notice>
          )}
          {summary.internalCount > 0 && (
            <Notice title="Flux internes neutralisés">
              {summary.internalCount} dépense{summary.internalCount > 1 ? "s" : ""} versée{summary.internalCount > 1 ? "s" : ""} à une autre de vos structures {summary.internalCount > 1 ? "apparaissent" : "apparaît"} dans la liste mais {summary.internalCount > 1 ? "ne sont pas comptées" : "n'est pas comptée"} dans les totaux de cette vue consolidée.
            </Notice>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title={`${list.length} dépense${list.length > 1 ? "s" : ""}`} description={`${f.label}${filtered ? " · filtres actifs" : ""} — en retard de paiement : toujours affichées tant qu'elles sont dues`}
            action={list.length > 0 ? <a href={exportHref} className={buttonClass("secondary", "sm")} download><Download size={14} /> Exporter (CSV)</a> : undefined} />
          {list.length === 0 ? (
            <EmptyState compact title="Aucune dépense ne correspond"
              description={filtered ? "Élargissez la période ou effacez les filtres." : "Aucune dépense sur cette période. Changez de mois ou ajoutez une dépense."}
              action={filtered ? <Link href={buildHref("/depenses", { mois: sp.mois, du: sp.du, au: sp.au })} className={buttonClass("secondary", "sm")}>Effacer les filtres</Link>
                : <QuickButton kind="expense" className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter une dépense</QuickButton>} />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr><Th>Date</Th><Th>Dépense</Th><Th>Catégorie</Th><Th>Affectation</Th><Th>Statut</Th><Th align="right">Montant</Th><Th><span className="sr-only">Actions</span></Th></tr>
                  </thead>
                  <tbody>
                    {paged.items.map((e) => {
                      const st = expenseStatus(e, today);
                      const a = assignmentOf(e, lookup);
                      const cat = lookup.category(e.categoryId);
                      return (
                        <tr key={e.id} className={cx("hover:bg-surface-2/60", st === "cancelled" && "opacity-60")}>
                          <Td className="whitespace-nowrap text-ink-2 tabular">{formatDate(referenceDate(e))}</Td>
                          <Td className="max-w-[300px]">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-ink">{e.label}</span>
                              {e.recurringId && <Repeat size={13} className="shrink-0 text-ink-3" aria-label="Échéance d'une charge récurrente" />}
                              {e.documentId && <a href={`/api/documents/${e.documentId}`} target="_blank" rel="noreferrer" className="shrink-0 text-ink-3 hover:text-ink" title="Voir le justificatif" aria-label="Voir le justificatif"><Paperclip size={13} /></a>}
                            </div>
                            <div className="truncate text-[12px] text-ink-3">
                              {[e.supplier, multiCompany ? (lookup.company(e.companyId)?.kind === "personal" ? "Espace personnel" : lookup.company(e.companyId)?.name) : null, lookup.account(e.accountId)?.name].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </Td>
                          <Td className="text-ink-2">{cat ? <>{cat.name}{cat.nature === "fixed" && <span className="ml-1.5 text-[11.5px] text-ink-3">fixe</span>}</> : <span className="text-ink-3">Sans catégorie</span>}</Td>
                          <Td>
                            <span className="inline-flex items-center gap-1.5 text-ink-2" title={a.detail}>
                              {a.color && <Dot color={a.color} />}
                              <span className={a.kind === "none" ? "text-warn" : undefined}>{a.label}</span>
                            </span>
                          </Td>
                          <Td>
                            <ExpenseStatusBadge status={st} />
                            {st !== "paid" && st !== "cancelled" && e.dueDate && <div className="mt-0.5 text-[11.5px] text-ink-3">échéance {formatDate(e.dueDate, "day")}</div>}
                          </Td>
                          <Td align="right" className="font-medium tabular whitespace-nowrap">{formatMoney(e.amount, e.currency)}</Td>
                          <Td className="w-10 pl-0"><ExpenseActions item={toItem(e, lookup)} /></Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {paged.items.map((e) => {
                  const st = expenseStatus(e, today);
                  const a = assignmentOf(e, lookup);
                  return (
                    <li key={e.id} className={cx("flex items-start gap-3 px-4 py-3", st === "cancelled" && "opacity-60")}>
                      <DateChip iso={referenceDate(e)} late={st === "overdue"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate text-[13.5px] font-medium">{e.label}</span>
                          <span className="shrink-0 text-[13.5px] font-medium tabular">{formatMoney(e.amount, e.currency)}</span>
                        </div>
                        <div className="truncate text-[12px] text-ink-3">{[e.supplier, lookup.category(e.categoryId)?.name ?? "Sans catégorie", a.label].filter(Boolean).join(" · ")}</div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <ExpenseStatusBadge status={st} />
                          {e.recurringId && <Badge>Récurrente</Badge>}
                        </div>
                      </div>
                      <ExpenseActions item={toItem(e, lookup)} />
                    </li>
                  );
                })}
              </ul>
              <Pager page={paged.page} pageCount={paged.pageCount} total={paged.total} noun="dépenses" href={(p) => href({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader title="Où part l'argent" description={`Dépenses payées par catégorie · ${f.label.toLowerCase()}`} />
          {summary.byCategory.length === 0 ? (
            <EmptyState compact title="Rien de payé sur la période" description="Les dépenses payées apparaîtront ici, regroupées par catégorie." />
          ) : (
            <ul className="space-y-3 px-5 pb-5">
              {summary.byCategory.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <Link href={href({ categorie: c.id, page: null })} className="group block">
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="truncate text-ink-2 group-hover:text-ink">{c.name}{c.fixed && <span className="ml-1.5 text-[11.5px] text-ink-3">fixe</span>}</span>
                      <span className="shrink-0 tabular">{formatMoney(c.amount, cur)} <span className="text-ink-3">· {formatPercent((c.amount / summary.paid) * 100)}</span></span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-[var(--series-2)]" style={{ width: `${Math.max(2, (c.amount / catMax) * 100)}%` }} /></div>
                  </Link>
                </li>
              ))}
              {summary.byCategory.length > 8 && <li className="text-[12px] text-ink-3">+ {summary.byCategory.length - 8} autres catégories</li>}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
