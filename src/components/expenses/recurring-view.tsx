/** Vue « Charges récurrentes » : coût mensuel équivalent, prochaine échéance, dernier paiement, actions. */
import { Repeat } from "lucide-react";
import { Badge, Card, CardHeader, Dot, EmptyState, Notice, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import { formatDate, relativeDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { inScope, toBase } from "@/lib/finance/engine";
import type { FinanceData, RecurringRow } from "@/lib/finance/types";
import { FREQ_SHORT, buildLookup, isStopped, monthlyEquivalent, nextOccurrence } from "./logic";
import { RecurringActions, type RecurringItem } from "./recurring-actions";
import { Kpi } from "./bits";

interface Line {
  r: RecurringRow;
  stopped: boolean;
  next: string | null;
  monthlyBase: number | null;
  lastPaid: string | null;
}

export function RecurringView({ data }: { data: FinanceData }) {
  const today = data.today;
  const cur = data.baseCurrency;
  const lookup = buildLookup(data);
  const lastPaid = new Map<string, string>();
  for (const e of data.expenses) {
    if (!e.recurringId || e.status !== "paid") continue;
    const d = e.paidDate ?? e.date;
    if ((lastPaid.get(e.recurringId) ?? "") < d) lastPaid.set(e.recurringId, d);
  }
  const lines: Line[] = data.recurring.filter((r) => inScope(data, r.companyId)).map((r) => {
    const conv = toBase(data, monthlyEquivalent(r.amount, r.frequency), r.currency, today);
    return { r, stopped: isStopped(r, today), next: nextOccurrence(r, today), monthlyBase: conv.missing ? null : conv.value, lastPaid: lastPaid.get(r.id) ?? null };
  }).sort((a, b) => Number(a.stopped) - Number(b.stopped) || (b.monthlyBase ?? 0) - (a.monthlyBase ?? 0));

  const active = lines.filter((l) => !l.stopped);
  const monthly = active.reduce((a, l) => a + (l.monthlyBase ?? 0), 0);
  const missing = active.filter((l) => l.monthlyBase == null).length;
  const nextUp = active.filter((l) => l.next).sort((a, b) => (a.next! < b.next! ? -1 : 1))[0];
  const multi = data.scopeCompanyIds.size > 1;

  const toItem = (l: Line): RecurringItem => ({
    id: l.r.id, label: l.r.label, supplier: l.r.supplier, amount: l.r.amount, currency: l.r.currency, frequency: l.r.frequency, endDate: l.r.endDate,
    remindDaysBefore: l.r.remindDaysBefore, companyId: l.r.companyId, activityId: l.r.activityId, allocationRuleId: l.r.allocationRuleId,
    categoryId: l.r.categoryId, stopped: l.stopped,
  });
  const assignment = (r: RecurringRow) => {
    const act = lookup.activity(r.activityId);
    if (act) return <span className="inline-flex items-center gap-1.5"><Dot color={act.color} />{act.name}</span>;
    if (r.allocationRuleId) return <span title={lookup.rule(r.allocationRuleId) ?? undefined}>Frais commun</span>;
    return <span className="text-ink-3">—</span>;
  };
  const nextText = (l: Line) => (l.stopped ? (l.r.endDate ? `Arrêtée le ${formatDate(l.r.endDate)}` : "Arrêtée") : l.next ? `${formatDate(l.next)} · ${relativeDays(l.next, today)}` : "Aucune");

  if (lines.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Repeat size={18} />} title="Aucune charge récurrente"
          description="Loyer, abonnements, assurances, crédit… Déclarez-les une fois : chaque échéance est anticipée dans vos prévisions et vous êtes prévenu avant le prélèvement."
          action={<QuickButton kind="recurring" className={buttonClass("primary", "sm")}><Repeat size={14} /> Ajouter une charge récurrente</QuickButton>} />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Coût mensuel des charges actives" value={formatMoney(monthly, cur)} sub={`soit ${formatMoney(monthly * 12, cur)} par an`} />
        <Kpi label="Charges actives" value={String(active.length)} sub={lines.length > active.length ? `${lines.length - active.length} arrêtée${lines.length - active.length > 1 ? "s" : ""}` : "Aucune charge arrêtée"} />
        <Kpi label="Prochaine échéance" value={nextUp ? formatMoney(nextUp.r.amount, nextUp.r.currency) : "—"}
          sub={nextUp?.next ? `${nextUp.r.label} · ${formatDate(nextUp.next, "day")} (${relativeDays(nextUp.next, today)})` : "Aucune échéance prévue"} />
      </div>
      {missing > 0 && (
        <Notice tone="warn" title="Taux de change manquant">{missing} charge{missing > 1 ? "s" : ""} en devise étrangère {missing > 1 ? "ne sont pas comptées" : "n'est pas comptée"} dans le coût mensuel.</Notice>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="Vos charges récurrentes" description="Coût mensuel : un montant trimestriel est divisé par 3, un montant annuel par 12." />
        <div className="hidden md:block">
          <Table>
            <thead>
              <tr><Th>Charge</Th><Th>Fréquence</Th><Th>Affectation</Th><Th>Prochaine échéance</Th><Th>Dernier paiement</Th><Th align="right">Montant</Th><Th align="right">Par mois</Th><Th><span className="sr-only">Actions</span></Th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.r.id} className={cx("hover:bg-surface-2/60", l.stopped && "opacity-60")}>
                  <Td className="max-w-[280px]">
                    <div className="flex items-center gap-2"><span className="truncate font-medium">{l.r.label}</span>{l.stopped && <Badge>Arrêtée</Badge>}</div>
                    <div className="truncate text-[12px] text-ink-3">
                      {[l.r.supplier, lookup.category(l.r.categoryId)?.name ?? "Sans catégorie", multi ? (lookup.company(l.r.companyId)?.kind === "personal" ? "Espace personnel" : lookup.company(l.r.companyId)?.name) : null].filter(Boolean).join(" · ")}
                    </div>
                  </Td>
                  <Td className="text-ink-2">{FREQ_SHORT[l.r.frequency] ?? l.r.frequency}</Td>
                  <Td className="text-ink-2">{assignment(l.r)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{nextText(l)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{l.lastPaid ? formatDate(l.lastPaid) : <span className="text-ink-3">Jamais confirmé</span>}</Td>
                  <Td align="right" className="whitespace-nowrap font-medium tabular">{formatMoney(l.r.amount, l.r.currency)}</Td>
                  <Td align="right" className="whitespace-nowrap tabular text-ink-2">{l.stopped ? "—" : formatMoney(monthlyEquivalent(l.r.amount, l.r.frequency), l.r.currency)}</Td>
                  <Td className="w-10 pl-0"><RecurringActions item={toItem(l)} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <ul className="divide-y divide-line border-t border-line md:hidden">
          {lines.map((l) => (
            <li key={l.r.id} className={cx("flex items-start gap-3 px-4 py-3", l.stopped && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-[13.5px] font-medium">{l.r.label}</span>
                  <span className="shrink-0 text-[13.5px] font-medium tabular">{formatMoney(l.r.amount, l.r.currency)}</span>
                </div>
                <div className="text-[12px] text-ink-3">{FREQ_SHORT[l.r.frequency]}{l.r.supplier ? ` · ${l.r.supplier}` : ""}</div>
                <div className="mt-1 text-[12px] text-ink-2">Prochaine : {nextText(l)}</div>
                {l.stopped && <div className="mt-1.5"><Badge>Arrêtée</Badge></div>}
              </div>
              <RecurringActions item={toItem(l)} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
