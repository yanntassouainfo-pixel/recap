"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus } from "lucide-react";
import { moveOpportunity, saveOpportunity } from "@/app/actions/crm";
import { Field, Input, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { useToast } from "@/components/toast";
import { OPPORTUNITY_STAGES } from "@/lib/labels";
import { CURRENCY_CODES, minorToInput } from "@/lib/money";
import { FormDialog } from "./dialog";
import { STAGE_ORDER } from "./finance";


export interface OpportunityLite {
  id: string;
  contactId: string;
  companyId: string | null;
  activityId: string | null;
  title: string;
  amount: number;
  currency: string;
  probability: number;
  stage: string;
  expectedCloseDate: string | null;
  agreedTerms: string | null;
  notes: string | null;
}

export interface OppRefs {
  contacts: { id: string; name: string; organization: string | null }[];
  companies: { id: string; name: string; currency: string }[];
  activities: { id: string; companyId: string; name: string }[];
  baseCurrency: string;
}

/** Changer d'étape : boutons précédent / suivant + menu, via moveOpportunity. */
export function StageMover({ id, stage, compact }: { id: string; stage: string; compact?: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  const move = (to: string) => {
    if (to === stage) return;
    start(async () => {
      await moveOpportunity(id, to);
      toast(`Opportunité déplacée : ${OPPORTUNITY_STAGES[to].label}.`);
      router.refresh();
    });
  };
  const prev = idx > 0 && stage !== "lost" ? STAGE_ORDER[idx - 1] : null;
  const next = idx >= 0 && idx < 3 ? STAGE_ORDER[idx + 1] : null;
  return (
    <div className="flex items-center gap-1">
      {!compact && prev && (
        <button type="button" disabled={pending} onClick={() => move(prev)} className={buttonClass("ghost", "sm", "h-7 px-1.5")} title={`Revenir à « ${OPPORTUNITY_STAGES[prev].label} »`} aria-label={`Revenir à l'étape ${OPPORTUNITY_STAGES[prev].label}`}>
          <ChevronLeft size={14} />
        </button>
      )}
      <select value={stage} disabled={pending} onChange={(e) => move(e.target.value)} aria-label="Étape de l'opportunité"
        className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12px] text-ink-2 hover:border-line-2">
        {STAGE_ORDER.map((s) => <option key={s} value={s}>{OPPORTUNITY_STAGES[s].label}</option>)}
      </select>
      {pending && <Loader2 size={13} className="animate-spin text-ink-3" aria-label="Déplacement en cours" />}
      {!compact && next && !pending && (
        <button type="button" onClick={() => move(next)} className={buttonClass("ghost", "sm", "h-7 px-1.5")} title={`Passer à « ${OPPORTUNITY_STAGES[next].label} »`} aria-label={`Passer à l'étape ${OPPORTUNITY_STAGES[next].label}`}>
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

export function OpportunityDialog({ refs, opportunity, contactId, defaultCompanyId, triggerLabel, triggerClassName }: {
  refs: OppRefs;
  opportunity?: OpportunityLite;
  contactId?: string;
  defaultCompanyId?: string | null;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const editing = !!opportunity;
  return (
    <FormDialog title={editing ? "Modifier l'opportunité" : "Nouvelle opportunité"} size="lg"
      description="Une affaire en cours. Elle n'est comptée dans le prévisionnel que dans le scénario optimiste, pondérée par sa probabilité."
      action={saveOpportunity}
      triggerClassName={triggerClassName ?? (editing ? buttonClass("ghost", "sm", "h-7 px-2") : buttonClass("secondary", "sm"))}
      ariaLabel={editing ? `Modifier ${opportunity.title}` : undefined}
      trigger={editing ? <><Pencil size={13} aria-hidden /> {triggerLabel ?? "Modifier"}</> : <><Plus size={14} aria-hidden /> {triggerLabel ?? "Nouvelle opportunité"}</>}>
      {(s) => <OpportunityFields refs={refs} o={opportunity} contactId={contactId} defaultCompanyId={defaultCompanyId} values={s.values} errors={s.fieldErrors} />}
    </FormDialog>
  );
}

function OpportunityFields({ refs, o, contactId, defaultCompanyId, values, errors }: { refs: OppRefs; o?: OpportunityLite; contactId?: string; defaultCompanyId?: string | null; values?: Record<string, string>; errors?: Record<string, string[] | undefined> }) {
  const [companyId, setCompanyId] = useState(values?.companyId ?? o?.companyId ?? defaultCompanyId ?? "");
  const companyCurrency = refs.companies.find((c) => c.id === companyId)?.currency;
  const [currency, setCurrency] = useState(values?.currency ?? o?.currency ?? companyCurrency ?? refs.baseCurrency);
  const [stage, setStage] = useState(values?.stage ?? o?.stage ?? "lead");
  const [probability, setProbability] = useState(values?.probability ?? String(o?.probability ?? OPPORTUNITY_STAGES.lead.probability));
  const activities = companyId ? refs.activities.filter((a) => a.companyId === companyId) : refs.activities;
  return (
    <>
      {o && <input type="hidden" name="id" value={o.id} />}
      {contactId || o ? <input type="hidden" name="contactId" value={contactId ?? o!.contactId} /> : (
        <Field label="Contact" htmlFor="op-contact" error={errors?.contactId}>
          <Select id="op-contact" name="contactId" defaultValue={values?.contactId ?? ""} required>
            <option value="">Choisir un client ou prospect…</option>
            {refs.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.organization ? ` — ${c.organization}` : ""}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Intitulé" htmlFor="op-title" error={errors?.title}>
        <Input id="op-title" name="title" defaultValue={values?.title ?? o?.title} placeholder="Ex. Programme de coaching — direction commerciale" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Montant estimé" htmlFor="op-amount">
          <Input id="op-amount" name="amount" inputMode="decimal" defaultValue={values?.amount ?? (o ? minorToInput(o.amount, o.currency) : "")} placeholder="0" />
        </Field>
        <Field label="Devise" htmlFor="op-currency">
          <Select id="op-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Étape" htmlFor="op-stage">
          <Select id="op-stage" name="stage" value={stage} onChange={(e) => { setStage(e.target.value); setProbability(String(OPPORTUNITY_STAGES[e.target.value].probability)); }}>
            {STAGE_ORDER.map((s) => <option key={s} value={s}>{OPPORTUNITY_STAGES[s].label}</option>)}
          </Select>
        </Field>
        <Field label="Probabilité (%)" htmlFor="op-prob" hint="Votre estimation, pas une certitude.">
          <Input id="op-prob" name="probability" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} disabled={stage === "won" || stage === "lost"} />
        </Field>
        <Field label="Date de décision prévue" htmlFor="op-date" optional>
          <Input id="op-date" name="expectedCloseDate" type="date" defaultValue={values?.expectedCloseDate ?? o?.expectedCloseDate ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {refs.companies.length > 1 && (
          <Field label="Structure" htmlFor="op-company" optional>
            <Select id="op-company" name="companyId" value={companyId} onChange={(e) => { setCompanyId(e.target.value); const cur = refs.companies.find((c) => c.id === e.target.value)?.currency; if (cur && !o) setCurrency(cur); }}>
              <option value="">—</option>
              {refs.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {refs.companies.length === 1 && <input type="hidden" name="companyId" value={companyId || refs.companies[0].id} />}
        {activities.length > 0 && (
          <Field label="Activité" htmlFor="op-activity" optional>
            <Select id="op-activity" name="activityId" defaultValue={values?.activityId ?? o?.activityId ?? ""}>
              <option value="">—</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Conditions convenues" htmlFor="op-terms" optional hint="Tarif, échéancier, acompte, durée…">
        <Textarea id="op-terms" name="agreedTerms" rows={2} defaultValue={values?.agreedTerms ?? o?.agreedTerms ?? ""} />
      </Field>
      <Field label="Notes" htmlFor="op-notes" optional>
        <Textarea id="op-notes" name="notes" rows={2} defaultValue={values?.notes ?? o?.notes ?? ""} />
      </Field>
      <div className={cx("flex justify-end")}><SubmitButton pendingLabel="Enregistrement…">{o ? "Enregistrer" : "Créer l'opportunité"}</SubmitButton></div>
    </>
  );
}
