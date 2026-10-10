"use client";

import { useActionState, useState } from "react";
import { Briefcase, Building2, Layers, Sparkles } from "lucide-react";
import { completeOnboarding, loadDemo } from "@/app/actions/onboarding";
import { Button, Field, Input, Select, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { initialState } from "@/lib/action-state";
import { CURRENCIES } from "@/lib/money";
import { MODES, ACCOUNT_TYPES } from "@/lib/labels";

const MODE_ICONS = { solo: Briefcase, multi_activity: Layers, multi_company: Building2 } as const;

export function OnboardingForm() {
  const [state, action] = useActionState(completeOnboarding, initialState);
  const v = state.values ?? {};
  const [mode, setMode] = useState(v.mode ?? "solo");
  const [currency, setCurrency] = useState(v.currency ?? "XOF");
  const fe = state.fieldErrors ?? {};
  return (
    <>
      <form action={action} className="mt-8 space-y-8">
        <FormMessage state={state} />
        <section>
          <h2 className="text-[15px] font-semibold"><span className="mr-2 text-ink-3 tabular">1</span>Comment travaillez-vous ?</h2>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-3" role="radiogroup">
            {Object.entries(MODES).map(([k, m]) => {
              const Icon = MODE_ICONS[k as keyof typeof MODE_ICONS];
              return (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                  className={cx("rounded-2xl border p-4 text-left transition", mode === k ? "border-ink bg-surface shadow-card" : "border-line bg-surface/50 hover:border-line-2")}>
                  <Icon size={19} className={mode === k ? "text-ink" : "text-ink-3"} />
                  <div className="mt-3 text-[14px] font-semibold">{m.label}</div>
                  <div className="mt-1 text-[12.5px] leading-snug text-ink-3">{m.description}</div>
                </button>
              );
            })}
          </div>
          <input type="hidden" name="mode" value={mode} />
        </section>

        <section className="space-y-4">
          <h2 className="text-[15px] font-semibold"><span className="mr-2 text-ink-3 tabular">2</span>{mode === "multi_company" ? "Votre première structure" : "Votre activité"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={mode === "solo" ? "Nom de votre activité" : "Nom de l'entreprise"} htmlFor="companyName" error={fe.companyName}>
              <Input id="companyName" name="companyName" defaultValue={v.companyName} placeholder="Ex. Parole & Présence" required />
            </Field>
            <Field label="Email professionnel" htmlFor="companyEmail" optional hint="Réutilisé pour vos factures et emails.">
              <Input id="companyEmail" name="companyEmail" type="email" defaultValue={v.companyEmail} />
            </Field>
            <Field label="Devise principale" htmlFor="currency">
              <Select id="currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
              </Select>
            </Field>
            <Field label="Pays" htmlFor="country" hint="Les conseils fiscaux restent prudents et dépendent du pays.">
              <Select id="country" name="country" defaultValue={v.country ?? "CI"}>
                {[["CI", "Côte d'Ivoire"], ["SN", "Sénégal"], ["BJ", "Bénin"], ["BF", "Burkina Faso"], ["ML", "Mali"], ["TG", "Togo"], ["NE", "Niger"], ["CM", "Cameroun"], ["FR", "France"], ["BE", "Belgique"], ["CH", "Suisse"], ["CA", "Canada"], ["MA", "Maroc"], ["OTHER", "Autre"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
          </div>
          {mode !== "solo" && (
            <Field label="Vos activités" htmlFor="activities" hint="Séparez-les par des virgules. Ex. Formation, Coaching, Direction de création">
              <Input id="activities" name="activities" defaultValue={v.activities} placeholder="Formation, Coaching, Conseil" />
            </Field>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-[15px] font-semibold"><span className="mr-2 text-ink-3 tabular">3</span>Votre argent aujourd&apos;hui</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Compte principal" htmlFor="accountName">
              <Input id="accountName" name="accountName" defaultValue={v.accountName ?? "Compte bancaire pro"} />
            </Field>
            <Field label="Type" htmlFor="accountType">
              <Select id="accountType" name="accountType" defaultValue={v.accountType ?? "bank"}>
                {Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label={`Solde actuel (${CURRENCIES[currency as keyof typeof CURRENCIES]?.symbol})`} htmlFor="openingBalance" error={fe.openingBalance}>
              <Input id="openingBalance" name="openingBalance" inputMode="decimal" defaultValue={v.openingBalance} placeholder="0" className="tabular" />
            </Field>
          </div>
          <Field label="Seuil de trésorerie à ne pas franchir" htmlFor="threshold" optional hint="Recap vous alertera si le prévisionnel passe en dessous.">
            <Input id="threshold" name="threshold" inputMode="decimal" defaultValue={v.threshold} placeholder="Ex. 500 000" className="tabular sm:max-w-xs" />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface/60 p-4">
            <input type="checkbox" name="personal" className="mt-0.5 size-4 accent-[var(--ink)]" defaultChecked={v.personal === "on"} />
            <span>
              <span className="block text-[13.5px] font-medium">Activer un espace personnel</span>
              <span className="block text-[12.5px] text-ink-3">Pour comprendre comment vos revenus pro alimentent vos finances personnelles, sans jamais les confondre.</span>
            </span>
          </label>
        </section>

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-ink-3">Vous pourrez ajouter d&apos;autres comptes, structures et activités ensuite.</p>
          <SubmitButton size="lg" pendingLabel="Préparation…">Ouvrir mon tableau de bord</SubmitButton>
        </div>
      </form>
      <form action={loadDemo} className="mt-10 flex flex-col items-start gap-3 rounded-2xl bg-surface-3/70 p-5 sm:flex-row sm:items-center">
        <Sparkles size={20} className="shrink-0 text-accent" />
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">Envie de découvrir d&apos;abord ?</div>
          <div className="text-[12.5px] text-ink-3">Explorez Recap avec un exemple complet : deux structures, cinq activités, un espace personnel, des clients et des documents.</div>
        </div>
        <Button type="submit" variant="secondary">Explorer avec des données d&apos;exemple</Button>
      </form>
    </>
  );
}
