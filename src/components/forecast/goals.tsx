"use client";

import { useState } from "react";
import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { ActionDialog, ConfirmActionButton } from "@/components/action-dialog";
import { Field, Input, Select, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { deleteGoal, saveGoal, setGoalActive } from "@/app/actions/planning";
import { GOAL_TYPES } from "@/lib/labels";
import { CURRENCIES, minorToInput } from "@/lib/money";

export interface GoalData { id: string; type: string; label: string; target: number; deadline: string | null; activityId: string | null; active: boolean }
export interface ActivityOption { id: string; name: string; companyName: string }

export function GoalDialog({ goal, activities, currency }: { goal?: GoalData; activities: ActivityOption[]; currency: string }) {
  return (
    <ActionDialog
      title={goal ? `Modifier l'objectif` : "Nouvel objectif"}
      description="Un objectif chiffré se suit automatiquement à partir de vos opérations. Les montants sont saisis dans votre devise de référence."
      action={saveGoal}
      triggerClassName={goal ? "rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink" : buttonClass("primary", "sm")}
      ariaLabel={goal ? `Modifier l'objectif ${goal.label}` : undefined}
      trigger={goal ? <Pencil size={15} /> : <><Plus size={15} /> Nouvel objectif</>}>
      {(state) => <GoalFields goal={goal} activities={activities} currency={currency} values={state.values} errors={state.fieldErrors ?? {}} />}
    </ActionDialog>
  );
}

function GoalFields({ goal, activities, currency, values, errors }: { goal?: GoalData; activities: ActivityOption[]; currency: string; values?: Record<string, string>; errors: Record<string, string[] | undefined> }) {
  const [type, setType] = useState(values?.type ?? goal?.type ?? "monthly_revenue");
  const def = GOAL_TYPES[type] ?? GOAL_TYPES.monthly_revenue;
  const symbol = CURRENCIES[currency as keyof typeof CURRENCIES]?.symbol ?? currency;
  const targetDefault = values?.target ?? (goal ? (GOAL_TYPES[goal.type]?.unit === "percent" ? String(goal.target) : minorToInput(goal.target, currency)) : "");
  const withActivity = type === "margin_rate" || type === "monthly_revenue";
  return (
    <>
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <Field label="Type d'objectif" htmlFor="goal-type" error={errors.type} hint={def.hint}>
        <Select id="goal-type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(GOAL_TYPES).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
        </Select>
      </Field>
      <Field label="Intitulé" htmlFor="goal-label" optional hint="Laissez vide pour reprendre le type d'objectif.">
        <Input id="goal-label" name="label" defaultValue={values?.label ?? goal?.label ?? ""} placeholder={def.label} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={def.unit === "percent" ? "Taux visé" : "Montant visé"} htmlFor="goal-target" error={errors.target}>
          <div className="relative">
            <Input id="goal-target" name="target" inputMode="decimal" defaultValue={targetDefault} key={def.unit} required className="pr-16 tabular" aria-invalid={!!errors.target} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">{def.unit === "percent" ? "%" : symbol}</span>
          </div>
        </Field>
        <Field label="Échéance" htmlFor="goal-deadline" optional error={errors.deadline}>
          <Input id="goal-deadline" name="deadline" type="date" defaultValue={values?.deadline ?? goal?.deadline ?? ""} />
        </Field>
      </div>
      {withActivity && activities.length > 0 && (
        <Field label="Activité concernée" htmlFor="goal-activity" optional error={errors.activityId}
          hint={type === "margin_rate" ? "Sans activité, le taux de marge global est suivi (90 derniers jours)." : "Sans activité, tous les encaissements de la vue sont comptés."}>
          <Select id="goal-activity" name="activityId" defaultValue={values?.activityId ?? goal?.activityId ?? ""}>
            <option value="">Toutes les activités</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.companyName}</option>)}
          </Select>
        </Field>
      )}
      <div className="flex justify-end"><SubmitButton pendingLabel="Enregistrement…">{goal ? "Enregistrer" : "Créer l'objectif"}</SubmitButton></div>
    </>
  );
}

export function GoalActions({ goal, activities, currency }: { goal: GoalData; activities: ActivityOption[]; currency: string }) {
  return (
    <div className="flex items-center gap-0.5">
      <GoalDialog goal={goal} activities={activities} currency={currency} />
      <ConfirmActionButton run={() => setGoalActive(goal.id, !goal.active)} done={goal.active ? "Objectif désactivé." : "Objectif réactivé."}
        className="rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink">
        {goal.active ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}<span className="sr-only">{goal.active ? "Désactiver" : "Réactiver"}</span>
      </ConfirmActionButton>
      <ConfirmActionButton run={() => deleteGoal(goal.id)} confirm={`Supprimer définitivement l'objectif « ${goal.label} » ?`} done="Objectif supprimé."
        className="rounded-lg p-2 text-ink-3 hover:bg-bad-soft hover:text-bad">
        <Trash2 size={15} aria-hidden /><span className="sr-only">Supprimer</span>
      </ConfirmActionButton>
    </div>
  );
}
