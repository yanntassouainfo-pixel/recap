"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, PlugZap } from "lucide-react";
import { addRate, changePassword, deleteAccount, saveCategory, saveSender, testSmtp, updatePreferences, updateProfile } from "@/app/actions/settings";
import { ActionDialog } from "@/components/action-dialog";
import { Field, Input, Select, buttonClass, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { useToast } from "@/components/toast";
import { initialState, type ActionState } from "@/lib/action-state";
import { CURRENCIES, minorToInput } from "@/lib/money";
import { MODES } from "@/lib/labels";

function useRefreshOnOk(state: ActionState) {
  const router = useRouter();
  const toast = useToast();
  useEffect(() => { if (state.ok) { toast(state.message ?? "Enregistré."); router.refresh(); } }, [state, router, toast]);
}

export function PreferencesForm({ settings }: { settings: { baseCurrency: string; mode: string; personalSpaceEnabled: boolean; cashSafetyThreshold: number; country: string } }) {
  const [state, action] = useActionState(updatePreferences, initialState);
  useRefreshOnOk(state);
  const [mode, setMode] = useState(settings.mode);
  const [currency, setCurrency] = useState(settings.baseCurrency);
  return (
    <form action={action} className="grid gap-5">
      <FormMessage state={state} />
      <div id="mode" className="scroll-mt-24">
        <div className="mb-2 text-[12.5px] font-medium text-ink-2">Mode d&apos;utilisation</div>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {Object.entries(MODES).map(([k, m]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
              className={cx("rounded-xl border p-3.5 text-left transition", mode === k ? "border-ink bg-surface" : "border-line hover:border-line-2")}>
              <div className="text-[13.5px] font-semibold">{m.label}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-ink-3">{m.description}</div>
            </button>
          ))}
        </div>
        <input type="hidden" name="mode" value={mode} />
        <p className="mt-2 text-[12px] text-ink-3">Le mode adapte l&apos;interface ; aucune donnée n&apos;est supprimée en changeant de mode.</p>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4">
        <input type="checkbox" name="personalSpaceEnabled" defaultChecked={settings.personalSpaceEnabled} className="mt-0.5 size-4 accent-[var(--ink)]" />
        <span>
          <span className="block text-[13.5px] font-medium">Espace personnel</span>
          <span className="block text-[12.5px] text-ink-3">Suivez vos finances personnelles séparément. Les transferts entre comptes pro et perso sont identifiés comme des transferts, jamais comme de nouveaux revenus.</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Devise principale" htmlFor="baseCurrency" hint="Les totaux consolidés sont convertis dans cette devise, avec des taux datés." error={state.fieldErrors?.baseCurrency}>
          <Select id="baseCurrency" name="baseCurrency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
          </Select>
        </Field>
        <Field label="Pays" htmlFor="country" hint="Les conseils fiscaux restent prudents et dépendent du pays.">
          <Select id="country" name="country" defaultValue={settings.country}>
            {[["CI", "Côte d'Ivoire"], ["SN", "Sénégal"], ["BJ", "Bénin"], ["BF", "Burkina Faso"], ["ML", "Mali"], ["TG", "Togo"], ["NE", "Niger"], ["CM", "Cameroun"], ["FR", "France"], ["BE", "Belgique"], ["CH", "Suisse"], ["CA", "Canada"], ["MA", "Maroc"], ["OTHER", "Autre"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Seuil de trésorerie" htmlFor="cashSafetyThreshold" hint="Alerte si le prévisionnel passe dessous. 0 = désactivé." error={state.fieldErrors?.cashSafetyThreshold}>
          <Input id="cashSafetyThreshold" name="cashSafetyThreshold" inputMode="decimal" defaultValue={minorToInput(settings.cashSafetyThreshold, settings.baseCurrency)} className="tabular" />
        </Field>
      </div>
      <div className="flex justify-end"><SubmitButton>Enregistrer les préférences</SubmitButton></div>
    </form>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action] = useActionState(updateProfile, initialState);
  useRefreshOnOk(state);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Nom" htmlFor="name" error={state.fieldErrors?.name}><Input id="name" name="name" defaultValue={name} /></Field>
      <Field label="Email de connexion" htmlFor="email"><Input id="email" value={email} disabled readOnly /></Field>
      <SubmitButton variant="secondary">Enregistrer</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, initialState);
  useRefreshOnOk(state);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
      <Field label="Mot de passe actuel" htmlFor="current" error={state.fieldErrors?.current}><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
      <Field label="Nouveau mot de passe" htmlFor="next" error={state.fieldErrors?.next} hint="10 caractères minimum, dont un chiffre ou un symbole."><Input id="next" name="next" type="password" autoComplete="new-password" required /></Field>
      <div className="sm:pt-[22px]"><SubmitButton variant="secondary">Changer</SubmitButton></div>
    </form>
  );
}

export function RateForm({ baseCurrency, today }: { baseCurrency: string; today: string }) {
  return (
    <ActionDialog title="Ajouter un taux de change" description="Chaque taux est daté et identifié : les montants d'origine sont toujours conservés." action={addRate} size="sm"
      trigger={<><Plus size={14} /> Ajouter un taux</>}>
      {(state) => (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <Field label="1 unité de" htmlFor="base">
              <Select id="base" name="base" defaultValue={state.values?.base ?? (baseCurrency === "USD" ? "EUR" : "USD")}>
                {Object.keys(CURRENCIES).map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <span className="pb-2.5 text-ink-3">=</span>
            <Field label="Devise" htmlFor="quote" error={state.fieldErrors?.quote}>
              <Select id="quote" name="quote" defaultValue={state.values?.quote ?? baseCurrency}>
                {Object.keys(CURRENCIES).map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Taux" htmlFor="rate" error={state.fieldErrors?.rate}><Input id="rate" name="rate" inputMode="decimal" placeholder="Ex. 565,40" defaultValue={state.values?.rate} required className="tabular" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="date" error={state.fieldErrors?.date}><Input id="date" name="date" type="date" defaultValue={state.values?.date ?? today} /></Field>
            <Field label="Source" htmlFor="source" optional><Input id="source" name="source" placeholder="Banque, BCEAO…" defaultValue={state.values?.source} /></Field>
          </div>
          <div className="flex justify-end"><SubmitButton>Enregistrer</SubmitButton></div>
        </>
      )}
    </ActionDialog>
  );
}

export function CategoryDialog({ category, kind }: { category?: { id: string; name: string; nature: string; kind: string }; kind?: "income" | "expense" }) {
  return (
    <ActionDialog title={category ? "Modifier la catégorie" : kind === "income" ? "Nouvelle catégorie de revenus" : "Nouvelle catégorie de dépenses"} action={saveCategory} size="sm"
      triggerClassName={category ? "rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" : buttonClass("ghost", "sm")}
      ariaLabel={category ? `Modifier ${category.name}` : undefined}
      trigger={category ? <Pencil size={13} /> : <><Plus size={14} /> Catégorie</>}>
      {(state) => (
        <>
          {category && <input type="hidden" name="id" value={category.id} />}
          <input type="hidden" name="kind" value={category?.kind ?? kind ?? "expense"} />
          <Field label="Nom" htmlFor="name" error={state.fieldErrors?.name}><Input id="name" name="name" defaultValue={state.values?.name ?? category?.name} required autoFocus /></Field>
          {(category?.kind ?? kind) !== "income" && (
            <Field label="Nature" htmlFor="nature" hint="Une charge fixe revient quel que soit votre niveau d'activité (loyer, abonnements…).">
              <Select id="nature" name="nature" defaultValue={category?.nature ?? "variable"}>
                <option value="variable">Charge variable</option>
                <option value="fixed">Charge fixe</option>
              </Select>
            </Field>
          )}
          <div className="flex justify-end"><SubmitButton>Enregistrer</SubmitButton></div>
        </>
      )}
    </ActionDialog>
  );
}

export function SenderDialog({ companies, sender }: { companies: { id: string; name: string; email: string | null }[]; sender?: { id: string; companyId: string; fromName: string; fromEmail: string; replyTo: string | null; authorized: boolean } }) {
  return (
    <ActionDialog title={sender ? "Modifier l'adresse d'expédition" : "Ajouter une adresse d'expédition"}
      description="Chaque structure envoie sous sa propre identité, pour éviter toute confusion entre vos marques." action={saveSender}
      triggerClassName={sender ? "rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" : buttonClass("secondary", "sm")}
      ariaLabel={sender ? `Modifier ${sender.fromEmail}` : undefined}
      trigger={sender ? <Pencil size={14} /> : <><Plus size={14} /> Adresse d&apos;expédition</>}>
      {(state) => {
        const v = { ...(sender ?? {}), ...(state.values ?? {}) } as Record<string, unknown>;
        const s = (k: string) => (v[k] == null ? "" : String(v[k]));
        return (
          <>
            {sender && <input type="hidden" name="id" value={sender.id} />}
            <Field label="Structure expéditrice" htmlFor="companyId" error={state.fieldErrors?.companyId}>
              <Select id="companyId" name="companyId" defaultValue={s("companyId")}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom affiché" htmlFor="fromName" error={state.fieldErrors?.fromName}><Input id="fromName" name="fromName" defaultValue={s("fromName")} required /></Field>
              <Field label="Adresse d'envoi" htmlFor="fromEmail" error={state.fieldErrors?.fromEmail}><Input id="fromEmail" name="fromEmail" type="email" defaultValue={s("fromEmail")} required /></Field>
            </div>
            <Field label="Répondre à" htmlFor="replyTo" optional><Input id="replyTo" name="replyTo" type="email" defaultValue={s("replyTo")} /></Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2 p-3.5">
              <input type="checkbox" name="authorized" defaultChecked={sender?.authorized} className="mt-0.5 size-4 accent-[var(--ink)]" />
              <span className="text-[12.5px] text-ink-2"><span className="block font-medium text-ink">Autoriser l&apos;envoi depuis cette adresse</span>Je confirme être autorisé(e) à envoyer des emails depuis cette adresse et que mon serveur SMTP l&apos;accepte comme expéditeur.</span>
            </label>
            <div className="flex justify-end"><SubmitButton>Enregistrer</SubmitButton></div>
          </>
        );
      }}
    </ActionDialog>
  );
}

export function TestSmtpButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" disabled={pending} onClick={() => start(async () => setResult(await testSmtp()))} className={buttonClass("secondary", "sm")}>
        <PlugZap size={14} /> {pending ? "Vérification…" : "Tester la connexion"}
      </button>
      {result && <FormMessage state={result} />}
    </div>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action] = useActionState(deleteAccount, initialState);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={buttonClass("danger", "sm")}>Supprimer mon compte…</button>;
  return (
    <form action={action} className="grid gap-4 rounded-xl border border-bad/30 bg-bad-soft/40 p-4">
      <FormMessage state={state} />
      <p className="text-[13px] text-ink-2">Toutes vos données (structures, factures, dépenses, documents, emails) seront définitivement supprimées. Pensez à exporter vos données avant.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Saisissez ${email} pour confirmer`} htmlFor="confirmEmail" error={state.fieldErrors?.confirmEmail}><Input id="confirmEmail" name="confirmEmail" autoComplete="off" /></Field>
        <Field label="Mot de passe" htmlFor="password" error={state.fieldErrors?.password}><Input id="password" name="password" type="password" autoComplete="current-password" /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>Annuler</button>
        <SubmitButton variant="danger" size="sm">Supprimer définitivement</SubmitButton>
      </div>
    </form>
  );
}
