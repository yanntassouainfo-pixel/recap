import { decimalsOf } from "../money";
import type { RateRow } from "./types";
import type { ISODate } from "../dates";

/** Parités fixes officielles (franc CFA ↔ euro). Toujours disponibles, quelle que soit la date. */
export const FIXED_PEGS: RateRow[] = [
  { date: "1999-01-01", base: "EUR", quote: "XOF", rate: 655.957, source: "Parité fixe BCEAO" },
  { date: "1999-01-01", base: "EUR", quote: "XAF", rate: 655.957, source: "Parité fixe BEAC" },
];

export interface ConversionResult {
  value: number | null; // unités mineures de la devise cible
  rate: number | null;
  rateDate: ISODate | null;
  source: string | null;
}

/** Taux direct (ou inverse) le plus récent à la date donnée. */
function directRate(rates: RateRow[], from: string, to: string, date: ISODate): { rate: number; date: ISODate; source: string } | null {
  let best: { rate: number; date: ISODate; source: string } | null = null;
  for (const r of rates) {
    if (r.date > date) continue;
    let rate: number | null = null;
    if (r.base === from && r.quote === to) rate = r.rate;
    else if (r.base === to && r.quote === from && r.rate !== 0) rate = 1 / r.rate;
    if (rate == null) continue;
    if (!best || r.date > best.date) best = { rate, date: r.date, source: r.source };
  }
  // Si aucun taux n'existe avant la date, on prend le plus ancien taux disponible APRÈS (signalé par sa date).
  if (!best) {
    for (const r of rates) {
      let rate: number | null = null;
      if (r.base === from && r.quote === to) rate = r.rate;
      else if (r.base === to && r.quote === from && r.rate !== 0) rate = 1 / r.rate;
      if (rate == null) continue;
      if (!best || r.date < best.date) best = { rate, date: r.date, source: r.source };
    }
  }
  return best;
}

/** Trouve un taux from→to, directement ou par triangulation via EUR, USD ou franc CFA. */
export function findRate(rates: RateRow[], from: string, to: string, date: ISODate): { rate: number; date: ISODate; source: string } | null {
  if (from === to) return { rate: 1, date, source: "identité" };
  const all = rates.concat(FIXED_PEGS);
  const direct = directRate(all, from, to, date);
  if (direct) return direct;
  for (const pivot of ["EUR", "USD", "XOF", "XAF"]) {
    if (pivot === from || pivot === to) continue;
    const a = directRate(all, from, pivot, date);
    const b = directRate(all, pivot, to, date);
    if (a && b) return { rate: a.rate * b.rate, date: a.date < b.date ? a.date : b.date, source: `${a.source} × ${b.source}` };
  }
  return null;
}

export function convert(amountMinor: number, from: string, to: string, date: ISODate, rates: RateRow[]): ConversionResult {
  if (from === to) return { value: amountMinor, rate: 1, rateDate: date, source: null };
  const r = findRate(rates, from, to, date);
  if (!r) return { value: null, rate: null, rateDate: null, source: null };
  const major = amountMinor / 10 ** decimalsOf(from);
  return { value: Math.round(major * r.rate * 10 ** decimalsOf(to)), rate: r.rate, rateDate: r.date, source: r.source };
}
