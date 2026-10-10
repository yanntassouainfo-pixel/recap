"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ActionDialog, ConfirmActionButton } from "@/components/action-dialog";
import { Field, Input, Select, buttonClass, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { deleteAllocationRule, saveAllocationRule } from "@/app/actions/planning";
import { formatPercent } from "@/lib/money";
import { parsePercent } from "@/lib/planning";

export interface RuleData { id: string; companyId: string; name: string; method: string; shares: { activityId: string; percent: number }[] }
export interface CompanyOption { id: string; name: string; activities: { id: string; name: string; color: string }[] }

export function AllocationRuleDialog({ rule, companies, defaultCompanyId }: { rule?: RuleData; companies: CompanyOption[]; defaultCompanyId?: string }) {
  return (
    <ActionDialog
      title={rule ? `Modifier la règle « ${rule.name} »` : "Nouvelle règle de répartition"}
      description="Une règle répartit des frais communs (loyer, abonnements, assistante…) entre les activités d'une même structure. Choisissez-la ensuite sur les dépenses concernées."
      action={saveAllocationRule} size="lg"
      triggerClassName={rule ? "rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink" : buttonClass("secondary", "sm")}
      ariaLabel={rule ? `Modifier la règle ${rule.name}` : undefined}
      trigger={rule ? <Pencil size={15} /> : <><Plus size={15} /> Nouvelle règle</>}>
      {(state) => <RuleFields rule={rule} companies={companies} defaultCompanyId={defaultCompanyId} values={state.values} errors={state.fieldErrors ?? {}} />}
    </ActionDialog>
  );
}

function RuleFields({ rule, companies, defaultCompanyId, values, errors }: { rule?: RuleData; companies: CompanyOption[]; defaultCompanyId?: string; values?: Record<string, string>; errors: Record<string, string[] | undefined> }) {
  const [companyId, setCompanyId] = useState(values?.companyId ?? rule?.companyId ?? defaultCompanyId ?? companies[0]?.id ?? "");
  const [method, setMethod] = useState(values?.method ?? rule?.method ?? "manual");
  const company = companies.find((c) => c.id === companyId);
  const initial = (activityId: string) => values?.[`share_${activityId}`] ?? String(rule?.shares.find((s) => s.activityId === activityId)?.percent ?? "");
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries((company?.activities ?? []).map((a) => [a.id, initial(a.id)])));
  const total = (company?.activities ?? []).reduce((acc, a) => acc + (parsePercent(shares[a.id] ?? "") ?? 0), 0);
  const over = total > 100;
  const pct = (v: number) => formatPercent(v, v % 1 ? 1 : 0);
  return (
    <>
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom de la règle" htmlFor="rule-name" error={errors.name}>
          <Input id="rule-name" name="name" defaultValue={values?.name ?? rule?.name ?? ""} placeholder="Ex. Loyer et charges du bureau" required autoFocus />
        </Field>
        {rule ? (
          <Field label="Structure" htmlFor="rule-company" hint="La structure d'une règle existante ne peut pas changer.">
            <Input id="rule-company" value={company?.name ?? ""} disabled readOnly />
          </Field>
        ) : (
          <Field label="Structure" htmlFor="rule-company" error={errors.companyId}>
            <Select id="rule-company" name="companyId" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setShares({}); }}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-[12.5px] font-medium text-ink-2">Méthode de répartition</legend>
        {[
          { key: "manual", label: "Pourcentages définis", hint: "Vous fixez la part de chaque activité. Le reste éventuel reste non affecté." },
          { key: "revenue", label: "Au prorata du chiffre d'affaires facturé", hint: "Chaque activité supporte une part égale à son poids dans le chiffre d'affaires facturé de la période." },
        ].map((o) => (
          <label key={o.key} className={cx("flex cursor-pointer gap-3 rounded-xl border px-3.5 py-2.5", method === o.key ? "border-ink/40 bg-surface-2" : "border-line hover:bg-surface-2")}>
            <input type="radio" name="method" value={o.key} checked={method === o.key} onChange={() => setMethod(o.key)} className="mt-1" />
            <span>
              <span className="block text-[13px] font-medium text-ink">{o.label}</span>
              <span className="block text-[12px] text-ink-3">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {method === "manual" && (
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-medium text-ink-2">Part de chaque activité</span>
            <span className={cx("text-[12.5px] tabular", over ? "font-medium text-bad" : "text-ink-3")}>
              Total : {pct(total)}{!over && total < 100 ? ` · ${pct(100 - total)} non affecté` : ""}{over ? " — dépasse 100 %" : ""}
            </span>
          </div>
          {!company || company.activities.length === 0 ? (
            <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[12.5px] text-ink-3">Cette structure n&apos;a aucune activité. Créez d&apos;abord des activités depuis la page Structures.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {company.activities.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3.5 py-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden />
                  <label htmlFor={`share-${a.id}`} className="min-w-0 flex-1 truncate text-[13px]">{a.name}</label>
                  <div className="relative w-24">
                    <Input id={`share-${a.id}`} name={`share_${a.id}`} inputMode="decimal" value={shares[a.id] ?? ""} placeholder="0"
                      onChange={(e) => setShares((s) => ({ ...s, [a.id]: e.target.value }))} className="h-8 pr-7 text-right tabular" />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {errors.shares?.[0] && <p className="text-[12px] text-bad" role="alert">{errors.shares[0]}</p>}
        </div>
      )}
      <div className="flex justify-end"><SubmitButton pendingLabel="Enregistrement…" disabled={method === "manual" && over}>{rule ? "Enregistrer" : "Créer la règle"}</SubmitButton></div>
    </>
  );
}

export function DeleteRuleButton({ rule, usage }: { rule: RuleData; usage: number }) {
  return (
    <ConfirmActionButton run={() => deleteAllocationRule(rule.id)} done="Règle supprimée."
      confirm={`Supprimer la règle « ${rule.name} » ?${usage > 0 ? ` ${usage} dépense(s) ou charge(s) récurrente(s) qui l'utilisent redeviendront non affectées (elles ne sont pas supprimées).` : ""}`}
      className="rounded-lg p-2 text-ink-3 hover:bg-bad-soft hover:text-bad">
      <Trash2 size={15} aria-hidden /><span className="sr-only">Supprimer la règle {rule.name}</span>
    </ConfirmActionButton>
  );
}
