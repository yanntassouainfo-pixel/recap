import "server-only";
import { and, eq } from "drizzle-orm";
import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { db, schema } from "./db";
import { parseAmount } from "./money";

/* eslint-disable @typescript-eslint/no-explicit-any */
type OwnedTable = SQLiteTableWithColumns<any> & { id: any; userId: any };

/** Vérifie qu'une référence saisie appartient à l'utilisateur. Renvoie null si vide, lève si étrangère. */
export function ownedId(table: OwnedTable, id: FormDataEntryValue | null | undefined, userId: string): string | null {
  const v = typeof id === "string" ? id.trim() : "";
  if (!v) return null;
  const row = db.select({ id: table.id }).from(table).where(and(eq(table.id, v), eq(table.userId, userId))).get();
  if (!row) throw new OwnershipError();
  return v;
}

export class OwnershipError extends Error {
  constructor() {
    super("Référence invalide.");
  }
}

export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optStr(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v ? v : null;
}

export function isoDate(form: FormData, key: string): string | null {
  const v = str(form, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function money(form: FormData, key: string, currency: string): number | null {
  return parseAmount(str(form, key), currency);
}

export function companyOf(companyId: string) {
  return db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
}

export function accountOf(accountId: string | null) {
  return accountId ? db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get() ?? null : null;
}

export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}
