import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { todayISO } from "./dates";
import type { FinanceData } from "./finance/types";
import { buildSnapshot, type Snapshot } from "./finance/insights";
import { planForMonth, invoiceStates } from "./finance/engine";
import { newId } from "./ids";
import { loadFinanceDataFrom } from "./finance/load";

export const SCOPE_COOKIE = "recap_scope";

export type Settings = typeof schema.settings.$inferSelect;

export const getSettings = cache((userId: string): Settings => {
  let s = db.select().from(schema.settings).where(eq(schema.settings.userId, userId)).get();
  if (!s) {
    db.insert(schema.settings).values({ userId }).run();
    s = db.select().from(schema.settings).where(eq(schema.settings.userId, userId)).get()!;
  }
  return s;
});

export const getCompanies = cache((userId: string) =>
  db.select().from(schema.companies).where(eq(schema.companies.userId, userId)).all(),
);

export const getActivities = cache((userId: string) =>
  db.select().from(schema.activities).where(eq(schema.activities.userId, userId)).all(),
);

export const getAccounts = cache((userId: string) =>
  db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)).all(),
);

export const getCategories = cache((userId: string) =>
  db.select().from(schema.categories).where(eq(schema.categories.userId, userId)).all(),
);

export const getContacts = cache((userId: string) =>
  db.select().from(schema.contacts).where(eq(schema.contacts.userId, userId)).all(),
);

export interface Scope {
  key: string; // "all" | "pro" | companyId
  label: string;
  companyIds: Set<string>;
  /** Structure unique sélectionnée (sinon null = vue consolidée) */
  company: typeof schema.companies.$inferSelect | null;
}

/** Structures visibles : l'espace personnel n'existe que s'il est activé. */
export function visibleCompanies(userId: string) {
  const settings = getSettings(userId);
  return getCompanies(userId).filter((c) => !c.archived && (c.kind !== "personal" || settings.personalSpaceEnabled));
}

export const getScope = cache(async (userId: string): Promise<Scope> => {
  const raw = (await cookies()).get(SCOPE_COOKIE)?.value ?? "all";
  const companies = visibleCompanies(userId);
  const settings = getSettings(userId);
  const one = companies.find((c) => c.id === raw);
  if (one) return { key: one.id, label: one.name, companyIds: new Set([one.id]), company: one };
  if (raw === "pro" && settings.personalSpaceEnabled) {
    return { key: "pro", label: "Activités professionnelles", companyIds: new Set(companies.filter((c) => c.kind !== "personal").map((c) => c.id)), company: null };
  }
  const hasPersonal = companies.some((c) => c.kind === "personal");
  const multi = companies.filter((c) => c.kind !== "personal").length > 1;
  return {
    key: "all",
    label: hasPersonal ? "Vue consolidée (pro + perso)" : multi ? "Vue consolidée" : companies[0]?.name ?? "Mon activité",
    companyIds: new Set(companies.map((c) => c.id)),
    company: !hasPersonal && !multi ? companies[0] ?? null : null,
  };
});

export function loadFinanceData(userId: string, scope: Scope, today = todayISO()): FinanceData {
  return loadFinanceDataFrom(db, userId, scope, today);
}

/** Instantané financier de la requête courante (calculé une seule fois par rendu). */
export const getSnapshot = cache(async (userId: string): Promise<Snapshot> => {
  const scope = await getScope(userId);
  const data = loadFinanceData(userId, scope);
  ensureMonthSnapshot(userId, scope.key, data);
  return buildSnapshot(data);
});

/** Photographie le prévisionnel du mois en cours la première fois qu'il est consulté (pour le prévu / réel). */
function ensureMonthSnapshot(userId: string, scopeKey: string, data: FinanceData) {
  const month = data.today.slice(0, 7);
  const exists = db.select({ id: schema.forecastSnapshots.id }).from(schema.forecastSnapshots)
    .where(and(eq(schema.forecastSnapshots.userId, userId), eq(schema.forecastSnapshots.scope, scopeKey), eq(schema.forecastSnapshots.month, month))).get();
  if (exists) return;
  const plan = planForMonth(data, month, invoiceStates(data));
  db.insert(schema.forecastSnapshots).values({
    id: newId("fs_"), userId, scope: scopeKey, month, expectedIncome: plan.expectedIncome, expectedExpense: plan.expectedExpense,
    currency: data.baseCurrency, details: JSON.stringify(plan.details),
  }).onConflictDoNothing().run();
}

/** Vérifie qu'une entité appartient bien à l'utilisateur (isolation des données). */
export function owns<T extends { userId: string }>(row: T | undefined, userId: string): row is T {
  return !!row && row.userId === userId;
}
