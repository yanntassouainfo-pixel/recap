/**
 * Logique pure des modules « Prévisionnel » et « Rentabilité » (aucun accès à la base, aucun effet de bord).
 * Utilisable côté serveur comme côté client (simulateur).
 */
import { addDays, daysBetween, formatDate, startOfMonth, startOfQuarter, startOfWeek, startOfYear, type ISODate } from "./dates";
import { formatMoney, formatPercent } from "./money";
import type { ActivityProfit, ForecastEvent, ForecastResult, ProfitabilityReport, Scenario } from "./finance/engine";

/* ───────────────────────── Paramètres d'URL ───────────────────────── */

export const HORIZONS = [30, 60, 90, 180, 365] as const;
export type Horizon = (typeof HORIZONS)[number];

export function parseHorizon(raw: string | null | undefined): Horizon {
  const n = Number(raw);
  return (HORIZONS as readonly number[]).includes(n) ? (n as Horizon) : 90;
}

export function horizonLabel(h: number): string {
  if (h === 365) return "12 mois";
  if (h === 180) return "6 mois";
  return `${h} jours`;
}

export const SCENARIOS: Scenario[] = ["prudent", "central", "optimist"];

export function parseScenario(raw: string | null | undefined): Scenario {
  return raw === "prudent" || raw === "optimist" ? raw : "central";
}

/* ───────────────────────── Événements prévus ───────────────────────── */

export type EventTone = "info" | "warn" | "neutral" | "accent" | "bad";

/** Nature affichée d'un événement : jamais une opportunité non confirmée présentée comme certaine. */
export function eventNature(e: Pick<ForecastEvent, "kind" | "certainty">): { label: string; tone: EventTone; certainty: string } {
  const certainty = e.certainty === "contractual" ? "Contractuel" : e.certainty === "estimated" ? "Estimé" : "Hypothétique";
  switch (e.kind) {
    case "invoice": return { label: "Facture attendue", tone: "info", certainty };
    case "overdue_invoice": return { label: "Facture en retard", tone: "bad", certainty };
    case "opportunity": return e.certainty === "hypothetical"
      ? { label: "Opportunité non confirmée", tone: "neutral", certainty }
      : { label: "Accord signé, non facturé", tone: "accent", certainty };
    case "income": return { label: "Recette prévue", tone: "accent", certainty };
    case "planned": return { label: "Dépense prévue", tone: "warn", certainty };
    case "recurring": return { label: "Charge récurrente", tone: "warn", certainty };
    default: return { label: "Événement", tone: "neutral", certainty };
  }
}

export interface WeekGroup {
  weekStart: ISODate;
  weekEnd: ISODate;
  events: ForecastEvent[];
  inflow: number;
  outflow: number; // positif
  /** Solde projeté à la fin de la semaine (ou à la fin de l'horizon si plus tôt). */
  endBalance: number;
}

/**
 * Regroupe les événements par semaine (lundi → dimanche) et calcule le solde projeté après chaque semaine.
 * Les événements datés avant aujourd'hui sont ramenés à aujourd'hui (comme dans le moteur).
 * Les semaines sans événement ne sont pas listées, mais le solde reste cumulatif.
 */
export function groupEventsByWeek(events: ForecastEvent[], startBalance: number, today: ISODate): WeekGroup[] {
  const sorted = events
    .map((e) => (e.date < today ? { ...e, date: today } : e))
    .sort((a, b) => (a.date === b.date ? b.amount - a.amount : a.date < b.date ? -1 : 1));
  const groups: WeekGroup[] = [];
  let balance = startBalance;
  for (const e of sorted) {
    const ws = startOfWeek(e.date);
    let g = groups.at(-1);
    if (!g || g.weekStart !== ws) {
      g = { weekStart: ws, weekEnd: addDays(ws, 6), events: [], inflow: 0, outflow: 0, endBalance: balance };
      groups.push(g);
    }
    g.events.push(e);
    if (e.amount >= 0) g.inflow += e.amount; else g.outflow += -e.amount;
    balance += e.amount;
    g.endBalance = balance;
  }
  return groups;
}

/* ───────────────────────── Simulateur de dépense ───────────────────────── */

export interface SimulationResult {
  minBefore: number;
  minAfter: number;
  minDate: ISODate;
  endAfter: number;
  firstNegative: ISODate | null;
  firstBelowThreshold: ISODate | null;
}

/**
 * Retire une dépense ponctuelle (à la date indiquée) d'une trajectoire de solde prévisionnelle.
 * Le point bas n'est cherché qu'à partir d'aujourd'hui ; une date passée est ramenée au premier point.
 */
export function simulateExpense(points: { date: ISODate; balance: number }[], amount: number, date: ISODate, threshold: number): SimulationResult | null {
  if (!points.length) return null;
  const effective = date < points[0].date ? points[0].date : date;
  let minBefore = Infinity;
  let minAfter = Infinity;
  let minDate = points[0].date;
  let firstNegative: ISODate | null = null;
  let firstBelowThreshold: ISODate | null = null;
  let endAfter = points[0].balance;
  for (const p of points) {
    const after = p.date >= effective ? p.balance - amount : p.balance;
    if (p.balance < minBefore) minBefore = p.balance;
    if (after < minAfter) { minAfter = after; minDate = p.date; }
    if (after < 0 && !firstNegative) firstNegative = p.date;
    if (threshold > 0 && after < threshold && !firstBelowThreshold) firstBelowThreshold = p.date;
    endAfter = after;
  }
  return { minBefore, minAfter, minDate, endAfter, firstNegative, firstBelowThreshold };
}

export type AbsorbVerdict = "yes" | "caution" | "no";

/**
 * Oui : le point bas reste au-dessus du seuil (ou de zéro) même dans le scénario prudent.
 * Prudence : il reste au-dessus dans le scénario central seulement.
 * Non : il passe sous le seuil (ou sous zéro) dès le scénario central.
 */
export function absorbVerdict(central: SimulationResult, prudent: SimulationResult, threshold: number): AbsorbVerdict {
  const floor = Math.max(0, threshold);
  if (central.minAfter < floor) return "no";
  if (prudent.minAfter < floor) return "caution";
  return "yes";
}

/** Horizon de simulation : au moins 60 jours, et 30 jours après la date de la dépense (max. 365). */
export function simulationHorizon(today: ISODate, date: ISODate): number {
  const d = Math.max(0, daysBetween(today, date));
  return Math.min(365, Math.max(60, d + 30));
}

/* ───────────────────────── Résumé d'un scénario ───────────────────────── */

export function scenarioSummary(f: ForecastResult) {
  return { start: f.start, end: f.end, min: f.min, firstNegative: f.firstNegative, firstBelowThreshold: f.firstBelowThreshold, totalIn: f.totalIn, totalOut: f.totalOut };
}

/** Fusionne trois trajectoires en une série pour le graphique (une seule échelle). */
export function mergeScenarioSeries(prudent: ForecastResult, central: ForecastResult, optimist: ForecastResult) {
  return central.points.map((p, i) => ({
    date: p.date,
    prudent: prudent.points[i]?.balance ?? p.balance,
    central: p.balance,
    optimist: optimist.points[i]?.balance ?? p.balance,
  }));
}

/* ───────────────────────── Règles de répartition ───────────────────────── */

export interface ShareInput { activityId: string; percent: number }

/** Lit un pourcentage saisi ("70", "70,5", "70 %"). Vide → 0. null si invalide. */
export function parsePercent(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").replace(/\s|%/g, "").replace(",", ".");
  if (!s) return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export interface SharesValidation {
  ok: boolean;
  error?: string;
  shares: ShareInput[];
  total: number;
  unassigned: number;
}

/**
 * Valide la saisie des pourcentages d'une règle « pourcentages définis » :
 * chaque part entre 0 et 100, activités de la structure, somme ≤ 100 %, au moins une part positive.
 * Le reste (100 − somme) reste non affecté.
 */
export function validateShares(raw: { activityId: string; percent: number | null }[], allowedActivityIds: Iterable<string>): SharesValidation {
  const allowed = new Set(allowedActivityIds);
  const seen = new Set<string>();
  const shares: ShareInput[] = [];
  for (const r of raw) {
    if (r.percent == null || !Number.isFinite(r.percent)) return { ok: false, error: "Un pourcentage saisi n'est pas un nombre valide.", shares: [], total: 0, unassigned: 100 };
    if (r.percent < 0 || r.percent > 100) return { ok: false, error: "Chaque pourcentage doit être compris entre 0 et 100.", shares: [], total: 0, unassigned: 100 };
    if (!allowed.has(r.activityId)) return { ok: false, error: "Une activité ne fait pas partie de cette structure.", shares: [], total: 0, unassigned: 100 };
    if (seen.has(r.activityId)) return { ok: false, error: "Une activité apparaît deux fois.", shares: [], total: 0, unassigned: 100 };
    seen.add(r.activityId);
    if (r.percent > 0) shares.push({ activityId: r.activityId, percent: r.percent });
  }
  const total = Math.round(shares.reduce((a, s) => a + s.percent, 0) * 100) / 100;
  if (!shares.length) return { ok: false, error: "Indiquez au moins un pourcentage supérieur à 0.", shares, total, unassigned: 100 };
  if (total > 100) return { ok: false, error: `La somme des pourcentages fait ${formatPercent(total, total % 1 ? 1 : 0)} : elle ne peut pas dépasser 100 %.`, shares, total, unassigned: 0 };
  return { ok: true, shares, total, unassigned: Math.round((100 - total) * 100) / 100 };
}

/* ───────────────────────── Objectifs ───────────────────────── */

export function parseGoalTarget(raw: string, unit: "money" | "percent", parseMoney: (s: string) => number | null): { value: number | null; error?: string } {
  if (unit === "percent") {
    const p = parsePercent(raw);
    if (p == null || !raw.trim()) return { value: null, error: "Indiquez un pourcentage." };
    if (p <= 0 || p > 100) return { value: null, error: "Le taux doit être compris entre 1 et 100 %." };
    return { value: Math.round(p) };
  }
  const v = parseMoney(raw);
  if (v == null) return { value: null, error: "Indiquez un montant." };
  if (v < 0) return { value: null, error: "Le montant ne peut pas être négatif." };
  return { value: v };
}

/* ───────────────────────── Périodes de rentabilité ───────────────────────── */

export const PROFIT_PERIODS = [
  { key: "90j", label: "90 jours" },
  { key: "mois", label: "Mois" },
  { key: "trimestre", label: "Trimestre" },
  { key: "6mois", label: "6 mois" },
  { key: "annee", label: "Année" },
] as const;

export interface ProfitPeriod { key: string; from: ISODate; to: ISODate; label: string }

export function resolveProfitPeriod(key: string | undefined, today: ISODate, custom?: { from?: string; to?: string }): ProfitPeriod {
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  switch (key) {
    case "mois": return { key, from: startOfMonth(today), to: today, label: "Ce mois-ci" };
    case "trimestre": return { key, from: startOfQuarter(today), to: today, label: "Ce trimestre" };
    case "6mois": return { key, from: addDays(today, -182), to: today, label: "6 derniers mois" };
    case "annee": return { key, from: startOfYear(today), to: today, label: "Cette année" };
    case "perso": {
      const from = iso(custom?.from);
      const to = iso(custom?.to);
      if (from && to && from <= to) return { key, from, to, label: `Du ${formatDate(from)} au ${formatDate(to)}` };
      if (from && !to && from <= today) return { key, from, to: today, label: `Du ${formatDate(from)} à aujourd'hui` };
      break;
    }
  }
  return { key: "90j", from: addDays(today, -89), to: today, label: "90 derniers jours" };
}

/* ───────────────────────── Marge selon la base ───────────────────────── */

export type MarginBase = "facture" | "encaisse";

export function parseMarginBase(raw: string | null | undefined): MarginBase {
  return raw === "encaisse" ? "encaisse" : "facture";
}

export function marginOf(a: Pick<ActivityProfit, "margin" | "cashMargin" | "invoiced" | "collected" | "marginRate">, base: MarginBase): { margin: number; rate: number | null; reference: number } {
  if (base === "encaisse") return { margin: a.cashMargin, rate: a.collected > 0 ? (a.cashMargin / a.collected) * 100 : null, reference: a.collected };
  return { margin: a.margin, rate: a.marginRate, reference: a.invoiced };
}

/* ───────────────────────── Texte de lecture automatique ───────────────────────── */

const q = (name: string) => `« ${name} »`;

/**
 * Lecture déterministe du rapport de rentabilité, construite uniquement à partir des chiffres.
 * Renvoie des paragraphes courts ; le dernier rappelle systématiquement la limite liée au temps passé.
 */
export function buildReadingText(report: ProfitabilityReport, currency: string, base: MarginBase = "facture"): string[] {
  const m = (v: number) => formatMoney(v, currency);
  const rows = report.activities.filter((a) => (base === "encaisse" ? a.collected : a.invoiced) > 0);
  const out: string[] = [];
  if (rows.length === 0) {
    out.push("Aucune activité n'a de chiffre d'affaires associé sur la période : la comparaison n'est pas encore possible.");
    out.push(TIME_CAVEAT);
    return out;
  }
  const baseWord = base === "encaisse" ? "encaissés" : "facturés";
  const withRate = rows.map((a) => ({ a, ...marginOf(a, base) })).filter((r) => r.rate != null);
  const byRevenue = rows.slice().sort((x, y) => (base === "encaisse" ? y.collected - x.collected : y.invoiced - x.invoiced))[0];
  const revOf = (a: ActivityProfit) => (base === "encaisse" ? a.collected : a.invoiced);
  const byMargin = withRate.slice().sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0))[0];
  const topRate = marginOf(byRevenue, base).rate;

  if (rows.length === 1) {
    out.push(`${q(byRevenue.name)} est la seule activité avec du chiffre d'affaires sur la période (${m(revOf(byRevenue))} ${baseWord}), pour une marge estimée de ${m(marginOf(byRevenue, base).margin)}${topRate != null ? ` (${formatPercent(topRate)})` : ""}.`);
  } else if (byMargin && byMargin.a.activityId !== byRevenue.activityId) {
    out.push(`${q(byRevenue.name)} génère le plus de revenus (${m(revOf(byRevenue))} ${baseWord}), mais ${q(byMargin.a.name)} présente une marge supérieure : ${formatPercent(byMargin.rate)} contre ${formatPercent(topRate)}. Autrement dit, ${q(byMargin.a.name)} conserve une part plus importante de chaque franc ${base === "encaisse" ? "encaissé" : "facturé"}.`);
  } else {
    out.push(`${q(byRevenue.name)} génère le plus de revenus (${m(revOf(byRevenue))} ${baseWord}) et présente aussi le meilleur taux de marge (${formatPercent(topRate)}).`);
  }

  const losing = withRate.filter((r) => r.margin < 0);
  if (losing.length) {
    out.push(`${losing.map((r) => q(r.a.name)).join(", ")} ${losing.length > 1 ? "affichent" : "affiche"} une marge négative sur la période (${losing.map((r) => m(r.margin)).join(", ")}) : les dépenses qui ${losing.length > 1 ? "leur" : "lui"} sont associées dépassent le chiffre d'affaires.`);
  }

  const delays = rows.filter((a) => a.averageDaysToPay != null);
  if (delays.length >= 2) {
    const fast = delays.slice().sort((x, y) => x.averageDaysToPay! - y.averageDaysToPay!)[0];
    const slow = delays.slice().sort((x, y) => y.averageDaysToPay! - x.averageDaysToPay!)[0];
    if (fast.activityId !== slow.activityId && slow.averageDaysToPay! - fast.averageDaysToPay! >= 7) {
      out.push(`Côté trésorerie, ${q(fast.name)} est encaissée en ${fast.averageDaysToPay} jours en moyenne, contre ${slow.averageDaysToPay} jours pour ${q(slow.name)}.`);
    }
  }

  const outstanding = rows.filter((a) => a.outstanding > 0).sort((x, y) => y.outstanding - x.outstanding)[0];
  if (outstanding && base === "facture" && outstanding.outstanding >= outstanding.invoiced * 0.3 && outstanding.invoiced > 0) {
    out.push(`${m(outstanding.outstanding)} restent à encaisser sur ${q(outstanding.name)} : sa marge facturée ne se traduit pas encore entièrement en argent disponible.`);
  }

  if (report.unassignedCosts > 0 && report.totals.costs > 0) {
    const share = (report.unassignedCosts / report.totals.costs) * 100;
    if (share >= 5) out.push(`${m(report.unassignedCosts)} de dépenses (${formatPercent(share)} du total) ne sont rattachées à aucune activité : les marges par activité sont donc surestimées d'autant, au global.`);
  }

  out.push(TIME_CAVEAT);
  return out;
}

export const TIME_CAVEAT = "Ces chiffres ne tiennent pas compte du temps que vous consacrez à chaque activité : une activité très rentable par franc facturé peut l'être beaucoup moins par heure travaillée. Vérifiez-le avant de décider laquelle développer.";

/* ───────────────────────── Points forts ───────────────────────── */

export function highlightValue(key: string, a: ActivityProfit, currency: string): string {
  const m = (v: number) => formatMoney(v, currency);
  switch (key) {
    case "revenue": return `${m(a.invoiced)} facturés`;
    case "margin": return `${formatPercent(a.marginRate)} de marge estimée (${m(a.margin)})`;
    case "speed": return `${a.averageDaysToPay} jour${(a.averageDaysToPay ?? 0) > 1 ? "s" : ""} en moyenne entre facture et paiement`;
    case "lean": return `${formatPercent(a.invoiced > 0 ? (a.totalCosts / a.invoiced) * 100 : null)} du facturé absorbé par les dépenses`;
    case "growth": return `${a.growth != null && a.growth > 0 ? "+" : ""}${formatPercent(a.growth)} de facturé vs période précédente`;
    case "resources": return `${m(a.totalCosts)} de dépenses associées`;
    default: return "";
  }
}

/* ───────────────────────── Prévu / réel ───────────────────────── */

export function gapPercent(actual: number, planned: number): number | null {
  if (planned === 0) return null;
  return ((actual - planned) / Math.abs(planned)) * 100;
}

export interface SnapshotDetails {
  incomes: { id: string; label: string; amount: number }[];
  outflows: { key: string; label: string; amount: number }[];
  reconstructed: boolean;
}

export function parseSnapshotDetails(raw: string | null | undefined): SnapshotDetails {
  try {
    const d = JSON.parse(raw ?? "{}") as Partial<SnapshotDetails>;
    return {
      incomes: Array.isArray(d.incomes) ? d.incomes : [],
      outflows: Array.isArray(d.outflows) ? d.outflows : [],
      reconstructed: d.reconstructed === true,
    };
  } catch {
    return { incomes: [], outflows: [], reconstructed: false };
  }
}
