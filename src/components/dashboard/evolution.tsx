"use client";

import { useState } from "react";
import { BalanceChart, FlowBars, Legend } from "@/components/charts";
import { cx } from "@/components/ui";

export function EvolutionCard({ flows, history, projection, currency, threshold, comparison }: {
  flows: { key: string; income: number; expense: number; net: number }[];
  history: { date: string; balance: number }[];
  projection: { date: string; balance: number }[];
  currency: string;
  threshold?: number;
  comparison: React.ReactNode;
}) {
  const [tab, setTab] = useState<"flows" | "cash">("flows");
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4.5">
        <div>
          <h2 className="text-[14.5px] font-semibold">Évolution</h2>
          <p className="text-[12.5px] text-ink-3">{tab === "flows" ? "Encaissements et dépenses payées, 12 derniers mois" : "Solde disponible constaté et projection à 60 jours (scénario central)"}</p>
        </div>
        <div className="inline-flex rounded-[10px] bg-surface-3 p-0.5" role="tablist">
          {[["flows", "Entrées & sorties"], ["cash", "Trésorerie"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as "flows" | "cash")}
              className={cx("rounded-lg px-3 py-1.5 text-[12.5px] font-medium", tab === k ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink-2")}>{l}</button>
          ))}
        </div>
      </div>
      <div className="px-3 pb-2 pt-4">
        {tab === "flows" ? <FlowBars data={flows} currency={currency} /> : <BalanceChart history={history} projection={projection} currency={currency} threshold={threshold} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        {tab === "flows" ? <Legend items={[{ label: "Encaissé", color: "var(--series-1)" }, { label: "Payé", color: "var(--series-2)" }]} /> : <Legend items={[{ label: "Constaté", color: "var(--series-1)" }, { label: "Prévu", color: "var(--series-1)", dashed: true }]} />}
        <div className="text-[12.5px] text-ink-2">{comparison}</div>
      </div>
    </div>
  );
}
