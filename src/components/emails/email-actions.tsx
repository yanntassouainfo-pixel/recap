"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { deleteTemplate, discardDraft, resendEmail, saveTemplate } from "@/app/actions/emails";
import { Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { TEMPLATE_VARIABLES } from "@/lib/templating";
import { ActionButton, FormDialog } from "@/components/crm/dialog";

export function ResendButton({ id, label = "Renvoyer" }: { id: string; label?: string }) {
  return (
    <ActionButton run={() => resendEmail(id)} className={buttonClass("primary", "sm")} pendingLabel="Envoi en cours…">
      <RotateCw size={14} aria-hidden /> {label}
    </ActionButton>
  );
}

export function DiscardDraftButton({ id, redirectTo = "/emails" }: { id: string; redirectTo?: string }) {
  const router = useRouter();
  return (
    <ActionButton className={buttonClass("danger", "sm")} confirm="Supprimer ce brouillon ? Il n'a jamais été envoyé ; cette action est définitive."
      run={async () => { const r = await discardDraft(id); if (r.ok) router.push(redirectTo); return r; }}>
      <Trash2 size={14} aria-hidden /> Supprimer le brouillon
    </ActionButton>
  );
}

export interface TemplateLite {
  id: string;
  name: string;
  purpose: string;
  subject: string;
  body: string;
  companyId: string | null;
  activityId: string | null;
  defaultDocumentIds: string[];
}

export interface TemplateRefs {
  purposes: Record<string, string>;
  companies: { id: string; name: string }[];
  activities: { id: string; companyId: string; name: string }[];
  documents: { id: string; name: string; companyId: string | null }[];
}

export function TemplateDialog({ template, refs }: { template?: TemplateLite; refs: TemplateRefs }) {
  return (
    <FormDialog title={template ? "Modifier le modèle" : "Nouveau modèle"} size="lg" action={saveTemplate}
      description="Les variables entre doubles accolades sont remplies automatiquement dans le composeur."
      triggerClassName={template ? buttonClass("ghost", "sm", "h-7 px-2") : buttonClass("secondary", "md")}
      ariaLabel={template ? `Modifier le modèle ${template.name}` : undefined}
      trigger={template ? <><Pencil size={13} aria-hidden /> Modifier</> : <><Plus size={15} aria-hidden /> Nouveau modèle</>}>
      {(s) => <TemplateFields t={template} refs={refs} values={s.values} errors={s.fieldErrors} />}
    </FormDialog>
  );
}

function TemplateFields({ t, refs, values, errors }: { t?: TemplateLite; refs: TemplateRefs; values?: Record<string, string>; errors?: Record<string, string[] | undefined> }) {
  const [companyId, setCompanyId] = useState(values?.companyId ?? t?.companyId ?? "");
  const activities = companyId ? refs.activities.filter((a) => a.companyId === companyId) : refs.activities;
  const docs = refs.documents.filter((d) => !companyId || !d.companyId || d.companyId === companyId);
  return (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom du modèle" htmlFor="tp-name" error={errors?.name}>
          <Input id="tp-name" name="name" defaultValue={values?.name ?? t?.name} required placeholder="Ex. Proposition coaching" />
        </Field>
        <Field label="Utilisé pour" htmlFor="tp-purpose" hint="Détermine l'événement inscrit sur la fiche du contact après l'envoi.">
          <Select id="tp-purpose" name="purpose" defaultValue={values?.purpose ?? t?.purpose ?? "other"}>
            {Object.entries(refs.purposes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        {refs.companies.length > 1 && (
          <Field label="Structure" htmlFor="tp-company" optional>
            <Select id="tp-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Toutes mes structures</option>
              {refs.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {activities.length > 0 && (
          <Field label="Activité" htmlFor="tp-activity" optional>
            <Select id="tp-activity" name="activityId" defaultValue={values?.activityId ?? t?.activityId ?? ""}>
              <option value="">—</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Objet" htmlFor="tp-subject" error={errors?.subject}>
        <Input id="tp-subject" name="subject" defaultValue={values?.subject ?? t?.subject} required />
      </Field>
      <Field label="Message" htmlFor="tp-body" error={errors?.body}
        hint={<>Variables : {Object.keys(TEMPLATE_VARIABLES).map((k, i) => <span key={k}>{i ? ", " : ""}<code className="text-ink-2">{`{{${k}}}`}</code></span>)}.</>}>
        <Textarea id="tp-body" name="body" rows={10} defaultValue={values?.body ?? t?.body} required />
      </Field>
      {docs.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-ink-2">Documents proposés par défaut <span className="font-normal text-ink-3">· facultatif</span></legend>
          <div className="grid max-h-[180px] gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
            {docs.map((d) => (
              <label key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[13px] hover:bg-surface-2">
                <input type="checkbox" name="defaultDoc" value={d.id} defaultChecked={t?.defaultDocumentIds.includes(d.id)} className="size-4 accent-[var(--ink)]" />
                <span className="truncate">{d.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex justify-end"><SubmitButton pendingLabel="Enregistrement…">{t ? "Enregistrer" : "Créer le modèle"}</SubmitButton></div>
    </>
  );
}

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  return (
    <ActionButton className={buttonClass("ghost", "sm", "h-7 px-2")} title="Supprimer" confirm={`Supprimer le modèle « ${name} » ? Les emails déjà rédigés ne sont pas modifiés.`}
      run={() => deleteTemplate(id)}>
      <Trash2 size={13} aria-hidden /><span className="sr-only">Supprimer {name}</span>
    </ActionButton>
  );
}
