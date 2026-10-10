"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Field, Input, cx } from "@/components/ui";
import { CURRENCIES, formatMoney, parseAmount } from "@/lib/money";
import { formatDate, type ISODate } from "@/lib/dates";
import { absorbVerdict, simulateExpense, simulationHorizon } from "@/lib/planning";

type Pt = { date: ISODate; balance: number };

/**
 * « Puis-je absorber une dépense supplémentaire ? » — calcul local sur les trajectoires prévisionnelles
 * (scénarios central et prudent, jusqu'à 12 mois). Rien n'est enregistré.
 */
export function AbsorbSimulator({ central, prudent, today, threshold, currency }: { central: Pt[]; prudent: Pt[]; today: ISODate; threshold: number; currency: string }) {
  const [amountRaw, setAmountRaw] = useState("");
  const [date, setDate] = useState(today);
  const amount = parseAmount(amountRaw, currency);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today && date <= (central.at(-1)?.date ?? today);
  const m = (v: number) => formatMoney(v, currency);
  const symbol = CURRENCIES[currency as keyof typeof CURRENCIES]?.symbol ?? currency;

  const result = useMemo(() => {
    if (!amount || amount <= 0 || !validDate) return null;
    const h = simulationHorizon(today, date);
    const c = simulateExpense(central.slice(0, h + 1), amount, date, threshold);
    const p = simulateExpense(prudent.slice(0, h + 1), amount, date, threshold);
    if (!c || !p) return null;
    return { c, p, h, verdict: absorbVerdict(c, p, threshold) };
  }, [amount, date, validDate, central, prudent, today, threshold]);

  const floorLabel = threshold > 0 ? `votre seuil de sécurité (${m(threshold)})` : "zéro";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
      <div className="grid content-start gap-4">
        <Field label="Montant de la dépense" htmlFor="sim-amount" hint="Ex. un équipement, une avance, un recrutement ponctuel.">
          <div className="relative">
            <Input id="sim-amount" inputMode="decimal" autoComplete="off" placeholder="0" value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)}
              className="h-11 pr-16 text-[17px] font-semibold tabular" />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-medium text-ink-3">{symbol}</span>
          </div>
        </Field>
        <Field label="Date de paiement" htmlFor="sim-date" error={date && !validDate ? "Choisissez une date entre aujourd'hui et les 12 prochains mois." : undefined}>
          <Input id="sim-date" type="date" value={date} min={today} max={central.at(-1)?.date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p className="text-[12px] text-ink-3">Simulation uniquement : rien n&apos;est enregistré.</p>
      </div>

      <div aria-live="polite">
        {!result ? (
          <div className="flex h-full min-h-[140px] items-center justify-center rounded-xl border border-dashed border-line-2 px-6 text-center text-[13px] text-ink-3">
            Saisissez un montant et une date pour voir l&apos;effet sur votre point bas de trésorerie.
          </div>
        ) : (
          <div className="grid gap-3">
            <Verdict verdict={result.verdict} />
            <p className="text-[13px] text-ink-2">
              {result.verdict === "yes" && <>Selon les données renseignées, une dépense de <strong className="font-medium text-ink">{m(amount!)}</strong> le {formatDate(date)} laisserait votre solde au-dessus de {floorLabel}, même dans le scénario prudent.</>}
              {result.verdict === "caution" && <>Dans le scénario central, votre solde resterait au-dessus de {floorLabel} ; mais si vos clients paient plus tard (scénario prudent), il pourrait descendre à <strong className="font-medium text-ink">{m(result.p.minAfter)}</strong> le {formatDate(result.p.minDate)}.</>}
              {result.verdict === "no" && <>Même dans le scénario central, votre solde pourrait descendre à <strong className="font-medium text-bad">{m(result.c.minAfter)}</strong> le {formatDate(result.c.minDate)}, sous {floorLabel}. Envisagez de décaler la dépense, de l&apos;étaler ou d&apos;encaisser d&apos;abord des factures.</>}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ScenarioResult title="Scénario central" r={result.c} threshold={threshold} currency={currency} />
              <ScenarioResult title="Scénario prudent" r={result.p} threshold={threshold} currency={currency} />
            </div>
            <p className="text-[11.5px] text-ink-3">Point bas calculé sur les {result.h} prochains jours, à partir des factures, échéances et charges récurrentes enregistrées.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Verdict({ verdict }: { verdict: "yes" | "caution" | "no" }) {
  const conf = {
    yes: { label: "Oui, a priori", Icon: CheckCircle2, cls: "bg-good-soft/80 text-good" },
    caution: { label: "Prudence", Icon: AlertTriangle, cls: "bg-warn-soft/80 text-warn" },
    no: { label: "Non, pas sans risque", Icon: XCircle, cls: "bg-bad-soft/80 text-bad" },
  }[verdict];
  return (
    <div className={cx("inline-flex items-center gap-2 self-start rounded-xl px-3.5 py-2 text-[15px] font-semibold", conf.cls)}>
      <conf.Icon size={18} aria-hidden /> {conf.label}
    </div>
  );
}

function ScenarioResult({ title, r, threshold, currency }: { title: string; r: NonNullable<ReturnType<typeof simulateExpense>>; threshold: number; currency: string }) {
  const m = (v: number) => formatMoney(v, currency);
  const below = r.minAfter < Math.max(0, threshold);
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-3">
      <div className="text-[12px] font-medium text-ink-3">{title}</div>
      <dl className="mt-2 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3"><dt className="text-ink-3">Point bas sans la dépense</dt><dd className="tabular">{m(r.minBefore)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="font-medium text-ink-2">Point bas avec la dépense</dt><dd className={cx("font-semibold tabular", below ? "text-bad" : "text-ink")}>{m(r.minAfter)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-3">Date du point bas</dt><dd className="tabular">{formatDate(r.minDate)}</dd></div>
        {r.firstNegative && <div className="flex justify-between gap-3"><dt className="text-ink-3">Passage sous zéro</dt><dd className="font-medium text-bad tabular">{formatDate(r.firstNegative)}</dd></div>}
        {!r.firstNegative && r.firstBelowThreshold && <div className="flex justify-between gap-3"><dt className="text-ink-3">Passage sous le seuil</dt><dd className="font-medium text-warn tabular">{formatDate(r.firstBelowThreshold)}</dd></div>}
      </dl>
    </div>
  );
}
