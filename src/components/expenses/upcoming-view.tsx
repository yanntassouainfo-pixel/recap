/** Vue « À venir » : échéances des N prochains jours (dépenses prévues + charges récurrentes), par semaine. */
import { CalendarClock, Plus, Repeat } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Notice, Segmented, buttonClass } from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import { ConfirmOutflowButton } from "@/components/confirm-outflow";
import { addDays, formatDate, relativeDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { UNCONFIRMED_LOOKBACK_DAYS, upcomingOutflows, type UpcomingOutflow } from "@/lib/finance/engine";
import type { FinanceData } from "@/lib/finance/types";
import { HORIZONS, groupByWeek, parseHorizon } from "./logic";
import { DateChip, Kpi } from "./bits";

function companyName(data: FinanceData, id: string): string | null {
  const c = data.companies.find((x) => x.id === id);
  return c ? (c.kind === "personal" ? "Espace personnel" : c.name) : null;
}

function Row({ u, data, autoOpen }: { u: UpcomingOutflow; data: FinanceData; autoOpen: boolean }) {
  const multi = data.scopeCompanyIds.size > 1;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <DateChip iso={u.originalDate} late={u.late} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium">{u.label}</span>
          {u.kind === "recurring" ? <Badge><Repeat size={11} aria-hidden /> Récurrente</Badge> : <Badge tone="info">Dépense prévue</Badge>}
        </div>
        <div className="truncate text-[12px] text-ink-3">
          {u.late ? <span className="text-warn">En retard · prévue {relativeDays(u.originalDate, data.today)} ({formatDate(u.originalDate)})</span> : `${relativeDays(u.originalDate, data.today)} · ${formatDate(u.originalDate, "long")}`}
          {u.supplier ? ` · ${u.supplier}` : ""}
          {multi ? ` · ${companyName(data, u.companyId) ?? ""}` : ""}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[13.5px] font-medium tabular whitespace-nowrap">{formatMoney(u.amount, u.currency)}</div>
        {u.currency !== data.baseCurrency && <div className="text-[11.5px] text-ink-3 tabular">≈ {formatMoney(u.amountBase, data.baseCurrency)}</div>}
      </div>
      <ConfirmOutflowButton item={{ ...u }} autoOpen={autoOpen} />
    </li>
  );
}

export function UpcomingView({ data, sp }: { data: FinanceData; sp: Record<string, string | undefined> }) {
  const today = data.today;
  const cur = data.baseCurrency;
  const horizon = parseHorizon(sp.horizon);
  const items = upcomingOutflows(data, addDays(today, horizon));
  const late = items.filter((u) => u.late);
  const future = items.filter((u) => !u.late);
  const sum = (l: UpcomingOutflow[]) => l.reduce((a, u) => a + u.amountBase, 0);
  const groups = groupByWeek(future, (u) => u.originalDate, (u) => u.amountBase, today);
  const recurringTotal = sum(items.filter((u) => u.kind === "recurring"));
  const confirmKey = sp.confirmer ?? "";
  const confirmMissing = !!confirmKey && !items.some((u) => u.key === confirmKey);
  const hasRecurring = data.recurring.some((r) => data.scopeCompanyIds.has(r.companyId));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented active={String(horizon)} items={HORIZONS.map((h) => ({ key: String(h), label: `${h} jours`, href: `/depenses?vue=a-venir&horizon=${h}` }))} />
        <p className="text-[12.5px] text-ink-3">Jusqu&apos;au {formatDate(addDays(today, horizon), "long")}</p>
      </div>

      {confirmMissing && (
        <Notice title="Échéance déjà traitée">Cette échéance a déjà été confirmée ou ignorée, ou n&apos;existe plus. Rien n&apos;a été enregistré en double.</Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label={`À payer · ${horizon} jours`} value={formatMoney(sum(items), cur)} sub={`${items.length} échéance${items.length > 1 ? "s" : ""}, retards compris`} />
        <Kpi label="En retard, à confirmer" value={formatMoney(sum(late), cur)} tone={late.length > 0 ? "warn" : undefined}
          sub={late.length > 0 ? `${late.length} échéance${late.length > 1 ? "s" : ""} dépassée${late.length > 1 ? "s" : ""} : payée${late.length > 1 ? "s" : ""} ou pas ?` : "Aucune échéance en retard"} />
        <Kpi label="Dont charges récurrentes" value={formatMoney(recurringTotal, cur)} sub={`${formatMoney(sum(items) - recurringTotal, cur)} de dépenses prévues ponctuelles`} />
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarClock size={18} />} title={`Aucune échéance dans les ${horizon} prochains jours`}
            description={hasRecurring ? "Vos charges récurrentes n'ont pas d'échéance sur cette période. Allongez l'horizon pour voir plus loin." : "Ajoutez vos charges récurrentes (loyer, abonnements…) ou une dépense à payer pour les anticiper ici."}
            action={<>
              <QuickButton kind="recurring" className={buttonClass("secondary", "sm")}><Repeat size={14} /> Charge récurrente</QuickButton>
              <QuickButton kind="expense" preset={{ status: "planned" }} className={buttonClass("secondary", "sm")}><Plus size={14} /> Dépense à payer</QuickButton>
            </>} />
        </Card>
      ) : (
        <>
          {late.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="En retard — à confirmer" description="Échéances dépassées : confirmez le paiement s'il a eu lieu, sinon payez-les ou ignorez-les. Elles sont comptées comme à payer aujourd'hui dans les prévisions."
                action={<span className="text-[13.5px] font-semibold tabular text-warn">{formatMoney(sum(late), cur)}</span>} />
              <ul className="divide-y divide-line border-t border-line">
                {late.map((u) => <Row key={u.key} u={u} data={data} autoOpen={u.key === confirmKey} />)}
              </ul>
            </Card>
          )}
          {groups.map((g) => (
            <Card key={g.weekStart} className="overflow-hidden">
              <CardHeader title={g.label} description={`${g.items.length} échéance${g.items.length > 1 ? "s" : ""}`}
                action={<span className="text-[13.5px] font-semibold tabular">{formatMoney(g.total, cur)}</span>} />
              <ul className="divide-y divide-line border-t border-line">
                {g.items.map((u) => <Row key={u.key} u={u} data={data} autoOpen={u.key === confirmKey} />)}
              </ul>
            </Card>
          ))}
          <p className="text-[12px] text-ink-3">
            Une échéance récurrente non confirmée depuis plus de {UNCONFIRMED_LOOKBACK_DAYS} jours n&apos;est plus affichée ni projetée. Les montants en devise étrangère sont convertis au dernier taux connu.
          </p>
        </>
      )}
    </div>
  );
}
