"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { formValues, isoDate, OwnershipError, ownedId, str } from "@/lib/guards";
import { getSettings } from "@/lib/data";
import { parseAmount } from "@/lib/money";
import { GOAL_TYPES } from "@/lib/labels";
import { parseGoalTarget, parsePercent, validateShares } from "@/lib/planning";
import type { ActionState } from "@/lib/action-state";

function revalidatePlanning() {
  // Les réglages et objectifs alimentent aussi le tableau de bord et les alertes.
  revalidatePath("/", "layout");
}

function fail(e: unknown, form: FormData): ActionState {
  if (e instanceof OwnershipError) return { error: "Une des références sélectionnées est invalide.", values: formValues(form) };
  console.error(e);
  return { error: "L'enregistrement a échoué. Vos données n'ont pas été modifiées.", values: formValues(form) };
}

/* ───────────────────────── Réglages des scénarios ───────────────────────── */

function rate(form: FormData, key: string): number | null {
  const p = parsePercent(str(form, key));
  if (p == null || !str(form, key)) return null;
  if (p < 0 || p > 100) return null;
  return Math.round(p);
}

export async function saveScenarioSettings(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const settings = getSettings(user.id);
    const prudent = rate(form, "prudent");
    const central = rate(form, "central");
    const optimist = rate(form, "optimist");
    const threshold = str(form, "threshold") ? parseAmount(str(form, "threshold"), settings.baseCurrency) : 0;
    const errors: Record<string, string[]> = {};
    if (prudent == null) errors.prudent = ["Entre 0 et 100 %."];
    if (central == null) errors.central = ["Entre 0 et 100 %."];
    if (optimist == null) errors.optimist = ["Entre 0 et 100 %."];
    if (threshold == null || threshold < 0) errors.threshold = ["Indiquez un montant positif ou nul."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };
    if (prudent! > central! || central! > optimist!) {
      return { error: "Les taux doivent aller croissant : prudent ≤ central ≤ optimiste.", values: formValues(form) };
    }
    const before = {
      scenarioPrudentOverdueRate: settings.scenarioPrudentOverdueRate, scenarioCentralOverdueRate: settings.scenarioCentralOverdueRate,
      scenarioOptimistOverdueRate: settings.scenarioOptimistOverdueRate, cashSafetyThreshold: settings.cashSafetyThreshold,
    };
    const after = { scenarioPrudentOverdueRate: prudent!, scenarioCentralOverdueRate: central!, scenarioOptimistOverdueRate: optimist!, cashSafetyThreshold: threshold! };
    db.update(schema.settings).set(after).where(eq(schema.settings.userId, user.id)).run();
    audit(user.id, "settings", user.id, "update", before, after);
    revalidatePlanning();
    return { ok: true, message: "Hypothèses du prévisionnel mises à jour." };
  } catch (e) {
    return fail(e, form);
  }
}

/* ───────────────────────── Objectifs ───────────────────────── */

export async function saveGoal(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const settings = getSettings(user.id);
    const id = str(form, "id");
    const existing = id ? db.select().from(schema.goals).where(and(eq(schema.goals.id, id), eq(schema.goals.userId, user.id))).get() : undefined;
    if (id && !existing) return { error: "Objectif introuvable." };
    const type = str(form, "type");
    const def = GOAL_TYPES[type];
    const errors: Record<string, string[]> = {};
    if (!def) errors.type = ["Choisissez un type d'objectif."];
    const target = def ? parseGoalTarget(str(form, "target"), def.unit, (s) => parseAmount(s, settings.baseCurrency)) : { value: null, error: "Type manquant." };
    if (target.error) errors.target = [target.error];
    const deadlineRaw = str(form, "deadline");
    const deadline = isoDate(form, "deadline");
    if (deadlineRaw && !deadline) errors.deadline = ["Date invalide."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };

    // Une activité n'a de sens que pour les objectifs de revenus ou de marge.
    const activityId = type === "margin_rate" || type === "monthly_revenue" ? ownedId(schema.activities, form.get("activityId"), user.id) : null;
    // La structure d'un objectif découle de son activité : un objectif global suit la vue sélectionnée.
    const companyId = activityId ? db.select().from(schema.activities).where(eq(schema.activities.id, activityId)).get()?.companyId ?? null : null;
    const label = str(form, "label") || def!.label;
    const row = { type, label, target: target.value!, deadline, companyId, activityId };
    if (existing) {
      db.update(schema.goals).set(row).where(and(eq(schema.goals.id, existing.id), eq(schema.goals.userId, user.id))).run();
      audit(user.id, "goal", existing.id, "update", existing, row);
      revalidatePlanning();
      return { ok: true, id: existing.id, message: `Objectif « ${label} » mis à jour.` };
    }
    const newGoalId = newId("goal_");
    db.insert(schema.goals).values({ id: newGoalId, userId: user.id, ...row, active: true }).run();
    audit(user.id, "goal", newGoalId, "create", undefined, row);
    revalidatePlanning();
    return { ok: true, id: newGoalId, message: `Objectif « ${label} » créé.` };
  } catch (e) {
    return fail(e, form);
  }
}

export async function setGoalActive(id: string, active: boolean): Promise<void> {
  const user = await requireUser();
  const row = db.select().from(schema.goals).where(and(eq(schema.goals.id, id), eq(schema.goals.userId, user.id))).get();
  if (!row) return;
  db.update(schema.goals).set({ active }).where(and(eq(schema.goals.id, id), eq(schema.goals.userId, user.id))).run();
  audit(user.id, "goal", id, "update", { active: row.active }, { active });
  revalidatePlanning();
}

export async function deleteGoal(id: string): Promise<void> {
  const user = await requireUser();
  const row = db.select().from(schema.goals).where(and(eq(schema.goals.id, id), eq(schema.goals.userId, user.id))).get();
  if (!row) return;
  db.delete(schema.goals).where(and(eq(schema.goals.id, id), eq(schema.goals.userId, user.id))).run();
  audit(user.id, "goal", id, "delete", row);
  revalidatePlanning();
}

/* ───────────────────────── Règles de répartition des frais communs ───────────────────────── */

export async function saveAllocationRule(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const id = str(form, "id");
    const existing = id ? db.select().from(schema.allocationRules).where(and(eq(schema.allocationRules.id, id), eq(schema.allocationRules.userId, user.id))).get() : undefined;
    if (id && !existing) return { error: "Règle introuvable." };
    const companyId = existing?.companyId ?? ownedId(schema.companies, form.get("companyId"), user.id);
    const name = str(form, "name");
    const method = str(form, "method") === "revenue" ? "revenue" : "manual";
    const errors: Record<string, string[]> = {};
    if (!companyId) errors.companyId = ["Choisissez une structure."];
    if (!name) errors.name = ["Donnez un nom à la règle (ex. « Loyer et charges du bureau »)."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };

    let shares: { activityId: string; percent: number }[] = [];
    if (method === "manual") {
      const activities = db.select().from(schema.activities)
        .where(and(eq(schema.activities.userId, user.id), eq(schema.activities.companyId, companyId!))).all().filter((a) => !a.archived);
      const raw = activities.map((a) => ({ activityId: a.id, percent: parsePercent(str(form, `share_${a.id}`)) }));
      const v = validateShares(raw, activities.map((a) => a.id));
      if (!v.ok) return { fieldErrors: { shares: [v.error!] }, values: formValues(form) };
      shares = v.shares;
    }
    const row = { name, method, shares: JSON.stringify(shares) };
    if (existing) {
      db.update(schema.allocationRules).set(row).where(and(eq(schema.allocationRules.id, existing.id), eq(schema.allocationRules.userId, user.id))).run();
      audit(user.id, "allocation_rule", existing.id, "update", existing, row);
      revalidatePlanning();
      return { ok: true, id: existing.id, message: `Règle « ${name} » mise à jour.` };
    }
    const ruleId = newId("ar_");
    db.insert(schema.allocationRules).values({ id: ruleId, userId: user.id, companyId: companyId!, ...row }).run();
    audit(user.id, "allocation_rule", ruleId, "create", undefined, { companyId, ...row });
    revalidatePlanning();
    return { ok: true, id: ruleId, message: `Règle « ${name} » créée. Choisissez-la sur vos frais communs pour qu'ils soient répartis.` };
  } catch (e) {
    return fail(e, form);
  }
}

export async function deleteAllocationRule(id: string): Promise<void> {
  const user = await requireUser();
  const row = db.select().from(schema.allocationRules).where(and(eq(schema.allocationRules.id, id), eq(schema.allocationRules.userId, user.id))).get();
  if (!row) return;
  // Les dépenses liées redeviennent « non affectées » (aucune n'est supprimée).
  db.update(schema.expenses).set({ allocationRuleId: null }).where(and(eq(schema.expenses.userId, user.id), eq(schema.expenses.allocationRuleId, id))).run();
  db.update(schema.recurringExpenses).set({ allocationRuleId: null }).where(and(eq(schema.recurringExpenses.userId, user.id), eq(schema.recurringExpenses.allocationRuleId, id))).run();
  db.delete(schema.allocationRules).where(and(eq(schema.allocationRules.id, id), eq(schema.allocationRules.userId, user.id))).run();
  audit(user.id, "allocation_rule", id, "delete", row);
  revalidatePlanning();
}
