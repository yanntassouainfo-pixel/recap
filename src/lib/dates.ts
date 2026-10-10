/** Dates métier au format ISO court (YYYY-MM-DD), sans fuseau : on raisonne en jours calendaires. */

export type ISODate = string;

export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parts(iso: ISODate): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

function fromUTC(t: number): ISODate {
  return new Date(t).toISOString().slice(0, 10);
}

function toUTC(iso: ISODate): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromUTC(toUTC(iso) + days * 86400000);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86400000);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Ajoute des mois en conservant le jour d'ancrage (31 → dernier jour du mois si besoin). */
export function addMonths(iso: ISODate, months: number, anchorDay?: number): ISODate {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function startOfMonth(iso: ISODate): ISODate {
  return iso.slice(0, 8) + "01";
}

export function endOfMonth(iso: ISODate): ISODate {
  const [y, m] = parts(iso);
  return `${iso.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/** Lundi de la semaine. */
export function startOfWeek(iso: ISODate): ISODate {
  const dow = new Date(toUTC(iso)).getUTCDay(); // 0 = dimanche
  return addDays(iso, -((dow + 6) % 7));
}

export function startOfQuarter(iso: ISODate): ISODate {
  const [y, m] = parts(iso);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, "0")}-01`;
}

export function startOfYear(iso: ISODate): ISODate {
  return `${iso.slice(0, 4)}-01-01`;
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function isBetween(iso: ISODate, from: ISODate, to: ISODate): boolean {
  return iso >= from && iso <= to;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function formatDate(iso: ISODate | null | undefined, style: "short" | "long" | "day" = "short"): string {
  if (!iso) return "—";
  const [y, m, d] = parts(iso);
  if (style === "day") return `${d} ${MONTHS[m - 1]}`;
  if (style === "long") return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatMonth(key: string, long = false): string {
  const [y, m] = key.split("-").map(Number);
  return long ? `${MONTHS_LONG[m - 1]} ${y}` : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

/** "dans 3 jours", "il y a 12 jours", "aujourd'hui" */
export function relativeDays(iso: ISODate, today: ISODate): string {
  const n = daysBetween(today, iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n === -1) return "hier";
  return n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`;
}

export type PeriodKey = "week" | "month" | "quarter" | "year" | "custom";

export interface Period {
  key: PeriodKey;
  from: ISODate;
  to: ISODate;
  prevFrom: ISODate;
  prevTo: ISODate;
  label: string;
  prevLabel: string;
}

/** Période courante (jusqu'à aujourd'hui) et période précédente de même durée "à date". */
export function resolvePeriod(key: PeriodKey, today: ISODate, custom?: { from?: string; to?: string }): Period {
  switch (key) {
    case "week": {
      const from = startOfWeek(today);
      const elapsed = daysBetween(from, today);
      return { key, from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(from, -7 + elapsed), label: "Cette semaine", prevLabel: "semaine précédente" };
    }
    case "quarter": {
      const from = startOfQuarter(today);
      const prevFrom = addMonths(from, -3);
      const elapsed = daysBetween(from, today);
      return { key, from, to: today, prevFrom, prevTo: minDate(addDays(prevFrom, elapsed), addDays(from, -1)), label: "Ce trimestre", prevLabel: "trimestre précédent" };
    }
    case "year": {
      const from = startOfYear(today);
      const prevFrom = addMonths(from, -12);
      return { key, from, to: today, prevFrom, prevTo: addMonths(today, -12), label: "Cette année", prevLabel: "année précédente" };
    }
    case "custom": {
      const from = custom?.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? custom.from : startOfMonth(today);
      const to = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) && custom.to >= from ? custom.to : today;
      const len = daysBetween(from, to);
      return { key, from, to, prevFrom: addDays(from, -len - 1), prevTo: addDays(from, -1), label: `${formatDate(from)} → ${formatDate(to)}`, prevLabel: "période précédente" };
    }
    case "month":
    default: {
      const from = startOfMonth(today);
      const prevFrom = addMonths(from, -1);
      const elapsed = daysBetween(from, today);
      return { key: "month", from, to: today, prevFrom, prevTo: minDate(addDays(prevFrom, elapsed), addDays(from, -1)), label: "Ce mois-ci", prevLabel: "mois précédent à date" };
    }
  }
}
