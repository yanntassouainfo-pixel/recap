"use client";

/**
 * Prévu vs réel par mois : barres groupées sur une seule échelle.
 * Prévu = teinte claire de la série, réel = teinte pleine (légende et survol explicites).
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/dates";
import { Legend } from "@/components/charts";

const axisTick = { fill: "var(--ink-3)", fontSize: 11.5 };

export interface PlanActualRow { month: string; plannedIncome: number; actualIncome: number; plannedExpense: number; actualExpense: number }

export function PlanActualChart({ rows, currency, height = 240 }: { rows: PlanActualRow[]; currency: string; height?: number }) {
  const compact = (v: number) => formatMoney(v, currency, { compact: true }).replace(/ .*$/, "");
  const series = [
    { key: "plannedIncome", label: "Revenus prévus", color: "var(--series-1)", opacity: 0.35 },
    { key: "actualIncome", label: "Revenus encaissés", color: "var(--series-1)", opacity: 1 },
    { key: "plannedExpense", label: "Dépenses prévues", color: "var(--series-2)", opacity: 0.35 },
    { key: "actualExpense", label: "Dépenses payées", color: "var(--series-2)", opacity: 1 },
  ] as const;
  return (
    <div className="grid gap-3">
      <Legend items={series.map((s) => ({ label: s.label, color: s.opacity < 1 ? `color-mix(in srgb, ${s.color} 35%, transparent)` : s.color }))} />
      <div style={{ height }} className="w-full">
        <ResponsiveContainer>
          <BarChart data={rows} barGap={2} barCategoryGap="24%" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="month" tickFormatter={(k) => formatMonth(String(k))} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compact} tick={axisTick} axisLine={false} tickLine={false} width={48} />
            <Tooltip cursor={{ fill: "var(--surface-3)", opacity: 0.6 }} content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="min-w-[200px] rounded-xl bg-surface px-3.5 py-2.5 text-[12.5px] shadow-pop">
                  <div className="mb-1.5 font-medium text-ink">{formatMonth(String(label), true)}</div>
                  {series.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
                      <span className="flex items-center gap-2 text-ink-2">
                        <span className="h-2 w-3 rounded-sm" style={{ background: s.color, opacity: s.opacity }} />
                        {s.label}
                      </span>
                      <span className="font-medium text-ink tabular">{formatMoney(Number(payload[0].payload[s.key]), currency)}</span>
                    </div>
                  ))}
                </div>
              ) : null} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} fillOpacity={s.opacity} radius={[4, 4, 0, 0]} maxBarSize={18} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
