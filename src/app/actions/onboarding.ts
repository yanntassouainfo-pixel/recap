"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { parseAmount, CURRENCIES } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { ensureDefaultCategories, ensureDefaultRates, ensureDefaultTemplates, ensurePersonalSpace } from "@/lib/setup";
import { createDemoData } from "@/lib/demo";
import type { ActionState } from "@/lib/action-state";
import { formValues, str } from "@/lib/guards";

const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#008300", "#e34948"];

export async function completeOnboarding(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const mode = ["solo", "multi_activity", "multi_company"].includes(str(form, "mode")) ? str(form, "mode") : "solo";
  const companyName = str(form, "companyName");
  const currency = str(form, "currency") in CURRENCIES ? str(form, "currency") : "XOF";
  const country = str(form, "country") || "CI";
  const activitiesRaw = str(form, "activities").split(/[,\n;]/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const accountName = str(form, "accountName") || "Compte principal";
  const accountType = str(form, "accountType") || "bank";
  const balance = parseAmount(str(form, "openingBalance") || "0", currency);
  const threshold = parseAmount(str(form, "threshold") || "0", currency) ?? 0;
  const email = str(form, "companyEmail");
  const errors: Record<string, string[]> = {};
  if (!companyName) errors.companyName = ["Donnez un nom à votre activité ou entreprise."];
  if (balance == null) errors.openingBalance = ["Solde invalide."];
  if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };

  const existing = db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.userId, user.id)).all();
  if (existing.some(Boolean) && db.select().from(schema.settings).where(eq(schema.settings.userId, user.id)).get()?.onboardedAt) redirect("/");

  const today = todayISO();
  const companyId = newId("cmp_");
  db.transaction((tx) => {
    tx.insert(schema.companies).values({
      id: companyId, userId: user.id, name: companyName, currency, email: email || null, color: PALETTE[0],
      invoicePrefix: companyName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "FAC",
    }).run();
    const names = activitiesRaw.length ? activitiesRaw : [mode === "solo" ? "Activité principale" : companyName];
    names.forEach((name, i) => tx.insert(schema.activities).values({ id: newId("act_"), userId: user.id, companyId, name, color: PALETTE[i % PALETTE.length] }).run());
    tx.insert(schema.accounts).values({ id: newId("acc_"), userId: user.id, companyId, name: accountName, type: accountType, currency, openingBalance: balance!, openingDate: today }).run();
    if (email) tx.insert(schema.senderIdentities).values({ id: newId("snd_"), userId: user.id, companyId, fromName: companyName, fromEmail: email, authorized: false }).run();
  });
  ensureDefaultCategories(user.id);
  ensureDefaultTemplates(user.id);
  ensureDefaultRates(user.id, today);
  ensurePersonalSpace(user.id, currency, today);
  db.update(schema.settings).set({
    mode, baseCurrency: currency, country, cashSafetyThreshold: threshold, personalSpaceEnabled: str(form, "personal") === "on",
    onboardedAt: new Date().toISOString(),
  }).where(eq(schema.settings.userId, user.id)).run();
  audit(user.id, "settings", user.id, "onboarding", undefined, { mode, currency, companyName });
  redirect("/");
}

export async function loadDemo() {
  const user = await requireUser();
  const existing = db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.userId, user.id)).all();
  if (existing.length === 0) {
    createDemoData(db, user.id);
    audit(user.id, "settings", user.id, "demo_loaded");
  }
  redirect("/");
}
