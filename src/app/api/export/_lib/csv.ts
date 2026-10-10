/**
 * Génération CSV pour Excel / LibreOffice en français : séparateur « ; », UTF-8 avec BOM, fins de ligne CRLF,
 * décimales à la virgule. Les cellules texte sont protégées contre l'injection de formules.
 */
import { decimalsOf } from "@/lib/money";

export const CSV_SEPARATOR = ";";
export const BOM = "﻿";

const NUMBER = /^-?\d+(,\d+)?$/;

/** Échappe une cellule : guillemets doublés, entourée de guillemets si nécessaire. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  let s = typeof value === "boolean" ? (value ? "oui" : "non") : String(value);
  // Une cellule commençant par = + - @ (hors nombre) serait interprétée comme une formule par le tableur.
  if (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s)) s = `'${s}`;
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Montant en unités mineures → nombre décimal à la française, sans séparateur de milliers. */
export function csvAmount(minor: number | null | undefined, currency: string): string {
  if (minor == null) return "";
  const d = decimalsOf(currency);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const intPart = Math.floor(abs / 10 ** d);
  const frac = d > 0 ? "," + String(abs % 10 ** d).padStart(d, "0") : "";
  return `${neg ? "-" : ""}${intPart}${frac}`;
}

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(CSV_SEPARATOR));
  return BOM + lines.join("\r\n") + "\r\n";
}

export function csvResponse(csv: string, fileName: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
