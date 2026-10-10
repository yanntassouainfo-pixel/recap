"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveScenarioSettings } from "@/app/actions/planning";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { initialState, type ActionState } from "@/lib/action-state";
import { CURRENCIES, minorToInput } from "@/lib/money";
import { useToast } from "@/components/toast";

export function ScenarioSettingsForm({ prudent, central, optimist, threshold, currency }: { prudent: number; central: number; optimist: number; threshold: number; currency: string }) {
  const [state, action] = useActionState(saveScenarioSettings, initialState);
  const toast = useToast();
  const router = useRouter();
  const last = useRef<ActionState>(state);
  useEffect(() => {
    if (state !== last.current && state.ok) { toast(state.message ?? "Enregistré."); router.refresh(); }
    last.current = state;
  }, [state, toast, router]);
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const symbol = CURRENCIES[currency as keyof typeof CURRENCIES]?.symbol ?? currency;
  const pct = (name: string, label: string, value: number, hint: string) => (
    <Field label={label} htmlFor={`sc-${name}`} error={fe[name]} hint={hint}>
      <div className="relative">
        <Input id={`sc-${name}`} name={name} inputMode="numeric" defaultValue={v[name] ?? String(value)} className="pr-8 tabular" aria-invalid={!!fe[name]} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">%</span>
      </div>
    </Field>
  );
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <div>
        <div className="text-[13px] font-medium text-ink">Factures en retard : part supposée encaissée</div>
        <p className="mt-0.5 text-[12.5px] text-ink-3">Pour chaque scénario, le pourcentage du restant dû des factures déjà en retard que vous pensez récupérer à court terme.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {pct("prudent", "Prudent", prudent, "0 % = on ne compte pas dessus.")}
        {pct("central", "Central", central, "Votre estimation réaliste.")}
        {pct("optimist", "Optimiste", optimist, "Si tout se passe bien.")}
      </div>
      <Field label="Seuil de sécurité de trésorerie" htmlFor="sc-threshold" error={fe.threshold} hint="Montant sous lequel vous ne voulez pas descendre. Affiché sur le graphique ; une alerte se déclenche s'il est franchi.">
        <div className="relative max-w-xs">
          <Input id="sc-threshold" name="threshold" inputMode="decimal" defaultValue={v.threshold ?? minorToInput(threshold, currency)} className="pr-16 tabular" aria-invalid={!!fe.threshold} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">{symbol}</span>
        </div>
      </Field>
      <div><SubmitButton pendingLabel="Enregistrement…">Enregistrer les hypothèses</SubmitButton></div>
    </form>
  );
}
