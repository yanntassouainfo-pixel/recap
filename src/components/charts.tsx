"use client";

/**
 * Graphiques : marques fines, une seule échelle, grilles discrètes, survol par défaut.
 * Les libellés utilisent les couleurs de texte, jamais celles des séries.
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";
import { formatDate, formatMonth } from "@/lib/dates";

const axisTick = { fill: "var(--ink-3)", fontSize: 11.5 };

function compact(v: number, currency: string) {
  return formatMoney(v, currency, { compact: true }).replace(/ .*$/, "");
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="min-w-[180px] rounded-xl bg-surface px-3.5 py-2.5 text-[12.5px] shadow-pop">
      <div className="mb-1.5 font-medium text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-2 text-ink-2">
            {r.color && <span className="h-2 w-3 rounded-sm" style={{ background: r.dashed ? "transparent" : r.color, border: r.dashed ? `1.5px dashed ${r.color}` : undefined }} />}
            {r.label}
          </span>
          <span className="font-medium text-ink tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────── Entrées / sorties par période ───────── */

export function FlowBars({ data, currency, height = 260, labelKind = "month" }: { data: { key: string; income: number; expense: number; net: number }[]; currency: string; height?: number; labelKind?: "month" | "day" }) {
  const label = (k: string) => (labelKind === "month" ? formatMonth(k) : formatDate(k, "day"));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="key" tickFormatter={label} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickFormatter={(v) => compact(v, currency)} tick={axisTick} axisLine={false} tickLine={false} width={48} />
          <Tooltip cursor={{ fill: "var(--surface-3)", opacity: 0.6 }} content={({ active, payload, label: l }) =>
            active && payload?.length ? (
              <TooltipBox title={labelKind === "month" ? formatMonth(String(l), true) : `Semaine du ${formatDate(String(l))}`} rows={[
                { label: "Encaissé", value: formatMoney(Number(payload[0]?.payload.income), currency), color: "var(--series-1)" },
                { label: "Payé", value: formatMoney(Number(payload[0]?.payload.expense), currency), color: "var(--series-2)" },
                { label: "Solde net", value: formatMoney(Number(payload[0]?.payload.net), currency, { sign: true }) },
              ]} />
            ) : null} />
          <Bar dataKey="income" name="Encaissé" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expense" name="Payé" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ───────── Historique de trésorerie + projection ───────── */

export function BalanceChart({ history, projection, currency, threshold, height = 260 }: { history: { date: string; balance: number }[]; projection?: { date: string; balance: number }[]; currency: string; threshold?: number; height?: number }) {
  const map = new Map<string, { date: string; actual?: number; projected?: number }>();
  for (const h of history) map.set(h.date, { date: h.date, actual: h.balance });
  if (projection?.length) {
    const last = history.at(-1);
    if (last) map.set(last.date, { ...map.get(last.date)!, projected: last.balance });
    for (const p of projection) map.set(p.date, { ...(map.get(p.date) ?? { date: p.date }), projected: p.balance });
  }
  const data = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="balanceFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, "day")} tick={axisTick} axisLine={false} tickLine={false} minTickGap={36} />
          <YAxis tickFormatter={(v) => compact(v, currency)} tick={axisTick} axisLine={false} tickLine={false} width={48} />
          {threshold ? <ReferenceLine y={threshold} stroke="var(--warn-mark)" strokeWidth={1} label={{ value: "Seuil", position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 11 }} /> : null}
          <ReferenceLine y={0} stroke="var(--line-2)" />
          <Tooltip content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox title={formatDate(String(label), "long")} rows={payload.filter((p) => p.value != null).map((p) => ({
                label: p.dataKey === "actual" ? "Solde constaté" : "Solde prévu (central)", value: formatMoney(Number(p.value), currency),
                color: "var(--series-1)", dashed: p.dataKey === "projected",
              }))} />
            ) : null} />
          <Area type="monotone" dataKey="actual" stroke="var(--series-1)" strokeWidth={2} fill="url(#balanceFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls />
          <Area type="monotone" dataKey="projected" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" fill="transparent" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ───────── Scénarios du prévisionnel ───────── */

export function ScenarioChart({ series, currency, threshold, height = 320 }: { series: { date: string; prudent: number; central: number; optimist: number }[]; currency: string; threshold?: number; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 10, right: 6, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, "day")} tick={axisTick} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tickFormatter={(v) => compact(v, currency)} tick={axisTick} axisLine={false} tickLine={false} width={52} />
          <ReferenceLine y={0} stroke="var(--bad-mark)" strokeWidth={1} label={{ value: "0", position: "insideLeft", fill: "var(--ink-3)", fontSize: 11 }} />
          {threshold ? <ReferenceLine y={threshold} stroke="var(--warn-mark)" strokeWidth={1} label={{ value: "Seuil de sécurité", position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 11 }} /> : null}
          <Tooltip content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox title={formatDate(String(label), "long")} rows={[
                { label: "Optimiste", value: formatMoney(Number(payload[0].payload.optimist), currency), color: "var(--series-3)" },
                { label: "Central", value: formatMoney(Number(payload[0].payload.central), currency), color: "var(--series-1)" },
                { label: "Prudent", value: formatMoney(Number(payload[0].payload.prudent), currency), color: "var(--series-2)" },
              ]} />
            ) : null} />
          <Line type="stepAfter" dataKey="optimist" stroke="var(--series-3)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
          <Line type="stepAfter" dataKey="prudent" stroke="var(--series-2)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
          <Line type="stepAfter" dataKey="central" stroke="var(--series-1)" strokeWidth={2.25} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ───────── Mini-courbe ───────── */

export function Sparkline({ values, height = 44, color = "var(--series-1)" }: { values: number[]; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 4 - ((v - min) / range) * (height - 8)}`).join(" ");
  const last = pts.split(" ").at(-1)!.split(",");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ───────── Comparaison d'activités (barres horizontales) ───────── */

export function ActivityBars({ rows, currency, height }: { rows: { name: string; invoiced: number; costs: number; margin: number }[]; currency: string; height?: number }) {
  return (
    <div style={{ height: height ?? Math.max(160, rows.length * 56 + 30) }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" barGap={2} barCategoryGap="30%" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" tickFormatter={(v) => compact(v, currency)} tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ ...axisTick, fill: "var(--ink-2)" }} axisLine={false} tickLine={false} width={150} />
          <Tooltip cursor={{ fill: "var(--surface-3)", opacity: 0.6 }} content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox title={String(label)} rows={[
                { label: "Facturé", value: formatMoney(Number(payload[0].payload.invoiced), currency), color: "var(--series-1)" },
                { label: "Coûts", value: formatMoney(Number(payload[0].payload.costs), currency), color: "var(--series-2)" },
                { label: "Marge estimée", value: formatMoney(Number(payload[0].payload.margin), currency, { sign: true }), color: "var(--series-3)" },
              ]} />
            ) : null} />
          <Bar dataKey="invoiced" name="Facturé" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={14} />
          <Bar dataKey="costs" name="Coûts" fill="var(--series-2)" radius={[0, 4, 4, 0]} maxBarSize={14} />
          <Bar dataKey="margin" name="Marge" fill="var(--series-3)" radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: i.dashed ? "transparent" : i.color, border: i.dashed ? `1.5px dashed ${i.color}` : undefined }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}
