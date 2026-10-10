/**
 * Montants : entiers en unités mineures de leur devise. Jamais de float stocké.
 * Les conversions passent par des taux datés et identifiables (voir finance/fx.ts).
 */

export const CURRENCIES = {
  XOF: { code: "XOF", label: "Franc CFA BCEAO", symbol: "F CFA", decimals: 0 },
  XAF: { code: "XAF", label: "Franc CFA BEAC", symbol: "F CFA", decimals: 0 },
  EUR: { code: "EUR", label: "Euro", symbol: "€", decimals: 2 },
  USD: { code: "USD", label: "Dollar américain", symbol: "$", decimals: 2 },
  GBP: { code: "GBP", label: "Livre sterling", symbol: "£", decimals: 2 },
  CAD: { code: "CAD", label: "Dollar canadien", symbol: "$ CA", decimals: 2 },
  CHF: { code: "CHF", label: "Franc suisse", symbol: "CHF", decimals: 2 },
  MAD: { code: "MAD", label: "Dirham marocain", symbol: "DH", decimals: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function decimalsOf(currency: string): number {
  return (CURRENCIES as Record<string, { decimals: number }>)[currency]?.decimals ?? 2;
}

/** 1234.5 (unités majeures) → 123450 (centimes) */
export function toMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** decimalsOf(currency));
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** decimalsOf(currency);
}

/** Lit une saisie utilisateur ("1 250,50", "1250.5", "300 000") → unités mineures. null si invalide. */
export function parseAmount(input: string | null | undefined, currency: string): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/[\s  ]/g, "").replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // le dernier séparateur est le séparateur décimal
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // virgule seule : séparateur décimal français, sauf si répétée (séparateur de milliers)
    s = (s.match(/,/g) ?? []).length === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot > -1) {
    const count = (s.match(/\./g) ?? []).length;
    const tail = s.length - lastDot - 1;
    if (count > 1 || (tail === 3 && decimalsOf(currency) === 0)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return toMinor(n, currency);
}

const formatters = new Map<string, Intl.NumberFormat>();
function nf(decimals: number, compact = false) {
  const key = `${decimals}-${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", compact
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(
  minor: number,
  currency: string,
  opts: { compact?: boolean; sign?: boolean; hideDecimals?: boolean } = {},
): string {
  const d = decimalsOf(currency);
  const major = minor / 10 ** d;
  const sym = (CURRENCIES as Record<string, { symbol: string }>)[currency]?.symbol ?? currency;
  const showDecimals = opts.hideDecimals ? 0 : d;
  const body = opts.compact && Math.abs(major) >= 10000 ? nf(0, true).format(Math.abs(major)) : nf(showDecimals).format(Math.abs(major));
  const sign = minor < 0 ? "−" : opts.sign && minor > 0 ? "+" : "";
  return `${sign}${body} ${sym}`;
}

/** Valeur pour un champ de formulaire (unités majeures, sans séparateur de milliers). */
export function minorToInput(minor: number | null | undefined, currency: string): string {
  if (minor == null) return "";
  const d = decimalsOf(currency);
  return (minor / 10 ** d).toFixed(d).replace(".", ",");
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${nf(digits).format(value)} %`;
}
