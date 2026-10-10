"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Paperclip, Repeat } from "lucide-react";
import { createExpense, createIncome, createTransfer, recordPayment } from "@/app/actions/finance";
import { createContact } from "@/app/actions/crm";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { initialState, type ActionState } from "@/lib/action-state";
import { CURRENCIES, formatMoney, minorToInput } from "@/lib/money";
import type { FormOptions } from "@/lib/options";

export const PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: "Virement",
  mobile_money: "Mobile money",
  cash: "Espèces",
  card: "Carte",
  check: "Chèque",
  direct_debit: "Prélèvement",
  other: "Autre",
};

type DoneFn = (message: string, id?: string) => void;

function useDone(state: ActionState, onDone?: DoneFn) {
  const last = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state !== last.current && state.ok) onDone?.(state.message ?? "Enregistré.", state.id);
    last.current = state;
  }, [state, onDone]);
}

/** Filtre activités / comptes selon la structure choisie. */
function useCompanyScoped(options: FormOptions, initialCompany?: string | null) {
  const [companyId, setCompanyId] = useState(initialCompany || options.defaultCompanyId || options.companies[0]?.id || "");
  const activities = options.activities.filter((a) => a.companyId === companyId);
  const accounts = options.accounts.filter((a) => a.companyId === companyId);
  const company = options.companies.find((c) => c.id === companyId);
  return { companyId, setCompanyId, activities, accounts, company };
}

function AmountField({ name = "amount", label = "Montant", currency, defaultValue, error, autoFocus, hint }: { name?: string; label?: string; currency: string; defaultValue?: string; error?: string[]; autoFocus?: boolean; hint?: ReactNode }) {
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint}>
      <div className="relative">
        <Input id={name} name={name} inputMode="decimal" autoComplete="off" placeholder="0" defaultValue={defaultValue} autoFocus={autoFocus} aria-invalid={!!error}
          className="h-12 pr-16 text-[20px] font-semibold tabular tracking-[-0.01em]" required />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-medium text-ink-3">{CURRENCIES[currency as keyof typeof CURRENCIES]?.symbol ?? currency}</span>
      </div>
    </Field>
  );
}

function CompanySelect({ options, value, onChange, error }: { options: FormOptions; value: string; onChange: (v: string) => void; error?: string[] }) {
  if (options.companies.length <= 1) return <input type="hidden" name="companyId" value={value} />;
  return (
    <Field label="Structure" htmlFor="companyId" error={error}>
      <Select id="companyId" name="companyId" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.companies.map((c) => <option key={c.id} value={c.id}>{c.kind === "personal" ? "Espace personnel" : c.name}</option>)}
      </Select>
    </Field>
  );
}

function Disclosure({ label, children, defaultOpen }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-xl border border-line">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-[13px] font-medium text-ink-2 hover:text-ink" aria-expanded={open}>
        {label}
        <ChevronDown size={16} className={cx("transition-transform", open && "rotate-180")} />
      </button>
      <div className={cx("grid gap-4 px-4 pb-4", !open && "hidden")}>{children}</div>
    </div>
  );
}

function ReceiptInput() {
  const [name, setName] = useState<string | null>(null);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-2 hover:border-ink-3 hover:bg-surface-2">
      <Paperclip size={16} className="text-ink-3" />
      <span className="flex-1 truncate">{name ?? "Joindre un justificatif (PDF, image)"}</span>
      <input type="file" name="receipt" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setName(e.target.files?.[0]?.name ?? null)} />
    </label>
  );
}

/* ───────────────────────── Revenu ───────────────────────── */

export function IncomeForm({ options, onDone, preset }: { options: FormOptions; onDone?: DoneFn; preset?: Record<string, string> }) {
  const [state, action] = useActionState(createIncome, initialState);
  useDone(state, onDone);
  const v = state.values ?? preset ?? {};
  const scoped = useCompanyScoped(options, v.companyId);
  const [accountId, setAccountId] = useState(v.accountId ?? "");
  const account = scoped.accounts.find((a) => a.id === accountId) ?? scoped.accounts[0];
  const currency = account?.currency ?? scoped.company?.currency ?? options.baseCurrency;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <p className="text-[12.5px] text-ink-3">Pour une recette encaissée sans facture. Pour un paiement de facture, utilisez « Enregistrer un paiement ».</p>
      <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
        <AmountField currency={currency} defaultValue={v.amount} error={fe.amount} autoFocus />
        <Field label="Date d'encaissement" htmlFor="date" error={fe.date}>
          <Input id="date" name="date" type="date" defaultValue={v.date ?? options.today} required className="h-12" />
        </Field>
      </div>
      <Field label="Description" htmlFor="description" error={fe.description}>
        <Input id="description" name="description" placeholder="Ex. Séance de coaching — M. Kouassi" defaultValue={v.description} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <CompanySelect options={options} value={scoped.companyId} onChange={(c) => { scoped.setCompanyId(c); setAccountId(""); }} error={fe.companyId} />
        {scoped.activities.length > 0 && (
          <Field label="Activité" htmlFor="activityId" optional>
            <Select id="activityId" name="activityId" defaultValue={v.activityId ?? (scoped.activities.length === 1 ? scoped.activities[0].id : "")}>
              <option value="">Non précisée</option>
              {scoped.activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Compte crédité" htmlFor="accountId" error={fe.accountId}>
          <Select id="accountId" name="accountId" value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {scoped.accounts.length === 0 && <option value="">Aucun compte — à créer</option>}
            {scoped.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </Select>
        </Field>
        <Field label="Mode de paiement" htmlFor="method">
          <Select id="method" name="method" defaultValue={v.method ?? (account?.type === "mobile_money" ? "mobile_money" : account?.type === "cash" ? "cash" : "bank_transfer")}>
            {Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
      </div>
      <Disclosure label="Client, catégorie, justificatif">
        <Field label="Client" htmlFor="contactId" optional>
          <Select id="contactId" name="contactId" defaultValue={v.contactId ?? ""}>
            <option value="">Aucun</option>
            {options.contacts.filter((c) => c.type !== "supplier").map((c) => <option key={c.id} value={c.id}>{c.name}{c.organization ? ` — ${c.organization}` : ""}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Catégorie" htmlFor="categoryId" optional>
            <Select id="categoryId" name="categoryId" defaultValue={v.categoryId ?? ""}>
              <option value="">Sans catégorie</option>
              {options.categories.filter((c) => c.kind === "income").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Référence" htmlFor="reference" optional>
            <Input id="reference" name="reference" defaultValue={v.reference} />
          </Field>
        </div>
        <ReceiptInput />
      </Disclosure>
      <input type="hidden" name="currency" value={currency} />
      <div className="flex justify-end gap-2 pt-1">
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer la recette</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────────────────── Dépense ───────────────────────── */

export function ExpenseForm({ options, onDone, preset, forceRecurring }: { options: FormOptions; onDone?: DoneFn; preset?: Record<string, string>; forceRecurring?: boolean }) {
  const [state, action] = useActionState(createExpense, initialState);
  useDone(state, onDone);
  const v = state.values ?? preset ?? {};
  const scoped = useCompanyScoped(options, v.companyId);
  const [accountId, setAccountId] = useState(v.accountId ?? "");
  const [status, setStatus] = useState(v.status ?? (forceRecurring ? "planned" : "paid"));
  const [recurring, setRecurring] = useState(forceRecurring || !!v.frequency);
  const [activityId, setActivityId] = useState(v.activityId ?? "");
  const account = scoped.accounts.find((a) => a.id === accountId) ?? scoped.accounts[0];
  const currency = account?.currency ?? scoped.company?.currency ?? options.baseCurrency;
  const rules = options.allocationRules.filter((r) => r.companyId === scoped.companyId);
  const fe = state.fieldErrors ?? {};
  const isPersonal = scoped.company?.kind === "personal";
  return (
    <form action={action} className="grid gap-4" encType="multipart/form-data">
      <FormMessage state={state} />
      {v.confirmDuplicate && <input type="hidden" name="confirmDuplicate" value="1" />}
      <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
        <AmountField currency={currency} defaultValue={v.amount} error={fe.amount} autoFocus />
        <Field label={recurring ? "Première échéance" : "Date de la dépense"} htmlFor="date" error={fe.date}>
          <Input id="date" name="date" type="date" defaultValue={v.date ?? options.today} required className="h-12" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Libellé" htmlFor="label" error={fe.label}>
          <Input id="label" name="label" placeholder="Ex. Loyer du bureau" defaultValue={v.label} required />
        </Field>
        <Field label="Fournisseur / bénéficiaire" htmlFor="supplier" optional>
          <Input id="supplier" name="supplier" defaultValue={v.supplier} />
        </Field>
      </div>
      <Field label="Catégorie" htmlFor="categoryId">
        <Select id="categoryId" name="categoryId" defaultValue={v.categoryId ?? ""}>
          <option value="">Sans catégorie</option>
          {options.categories.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>

      <div className="grid gap-3 rounded-xl bg-surface-2 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-surface-3 p-0.5" role="radiogroup" aria-label="Statut de paiement">
            {[["paid", "Déjà payée"], ["planned", "À payer"]].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={status === k} onClick={() => setStatus(k)}
                className={cx("rounded-md px-3 py-1.5 text-[12.5px] font-medium", status === k ? "bg-surface text-ink shadow-card" : "text-ink-3")}>{l}</button>
            ))}
          </div>
          {!forceRecurring && (
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="size-4 accent-[var(--ink)]" />
              <Repeat size={14} aria-hidden /> Revient régulièrement
            </label>
          )}
        </div>
        <input type="hidden" name="status" value={status} />
        {status === "planned" && !recurring && (
          <Field label="Échéance de paiement" htmlFor="dueDate" error={fe.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" defaultValue={v.dueDate} />
          </Field>
        )}
        {status === "planned" && recurring && <input type="hidden" name="dueDate" value="" />}
        {recurring && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fréquence" htmlFor="frequency">
              <Select id="frequency" name="frequency" defaultValue={v.frequency ?? "monthly"}>
                <option value="monthly">Chaque mois</option>
                <option value="quarterly">Chaque trimestre</option>
                <option value="yearly">Chaque année</option>
              </Select>
            </Field>
            <Field label="Fin" htmlFor="endDate" optional>
              <Input id="endDate" name="endDate" type="date" defaultValue={v.endDate} />
            </Field>
            <Field label="Me prévenir" htmlFor="remindDaysBefore">
              <Select id="remindDaysBefore" name="remindDaysBefore" defaultValue={v.remindDaysBefore ?? "3"}>
                {[1, 3, 5, 7, 14].map((n) => <option key={n} value={n}>{n} j avant</option>)}
              </Select>
            </Field>
          </div>
        )}
        <p className="text-[12px] text-ink-3">
          {recurring
            ? status === "paid" ? "La première échéance est enregistrée comme payée ; les suivantes apparaissent dans le prévisionnel et vous seront rappelées." : "Les échéances apparaissent dans le prévisionnel. Vous confirmerez chaque paiement — rien n'est compté comme payé d'avance."
            : status === "planned" ? "Une dépense à payer est comptée dans les dépenses à venir, jamais comme un décaissement effectué." : "La dépense est déduite du compte sélectionné."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CompanySelect options={options} value={scoped.companyId} onChange={(c) => { scoped.setCompanyId(c); setAccountId(""); setActivityId(""); }} error={fe.companyId} />
        <Field label={status === "paid" ? "Compte débité" : "Compte prévu"} htmlFor="accountId" error={fe.accountId}>
          <Select id="accountId" name="accountId" value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {scoped.accounts.length === 0 && <option value="">Aucun compte — à créer</option>}
            {scoped.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </Select>
        </Field>
      </div>

      {!isPersonal && (scoped.activities.length > 0 || rules.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Affectation" htmlFor="activityId" hint={activityId ? undefined : "Sans activité ni règle, la dépense reste « non affectée » dans l'analyse de rentabilité."}>
            <Select id="activityId" name="activityId" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              <option value="">Frais commun / non affecté</option>
              {scoped.activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          {activityId ? (
            <Field label="Nature du coût" htmlFor="costType">
              <Select id="costType" name="costType" defaultValue={v.costType ?? "direct"}>
                <option value="direct">Coût direct de la prestation</option>
                <option value="overhead">Autre dépense de l&apos;activité</option>
              </Select>
            </Field>
          ) : rules.length > 0 ? (
            <Field label="Répartir entre activités" htmlFor="allocationRuleId" optional>
              <Select id="allocationRuleId" name="allocationRuleId" defaultValue={v.allocationRuleId ?? ""}>
                <option value="">Ne pas répartir</option>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
          ) : null}
        </div>
      )}

      <Disclosure label="Mode de paiement, note, justificatif">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode de paiement" htmlFor="method">
            <Select id="method" name="method" defaultValue={v.method ?? "bank_transfer"}>
              {Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          {options.companies.filter((c) => c.kind !== "personal").length > 1 && !isPersonal && (
            <Field label="Payée à une autre de vos structures" htmlFor="counterpartCompanyId" optional hint="Flux interne : neutralisé en vue consolidée.">
              <Select id="counterpartCompanyId" name="counterpartCompanyId" defaultValue={v.counterpartCompanyId ?? ""}>
                <option value="">Non (tiers)</option>
                {options.companies.filter((c) => c.id !== scoped.companyId && c.kind !== "personal").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Note" htmlFor="note" optional>
          <Textarea id="note" name="note" rows={2} defaultValue={v.note} />
        </Field>
        <ReceiptInput />
      </Disclosure>
      <input type="hidden" name="currency" value={currency} />
      <div className="flex justify-end gap-2 pt-1">
        <SubmitButton pendingLabel="Enregistrement…">{v.confirmDuplicate ? "Confirmer et enregistrer" : recurring ? "Créer la charge récurrente" : "Enregistrer la dépense"}</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────────────────── Paiement ───────────────────────── */

export function PaymentForm({ options, onDone, preset }: { options: FormOptions; onDone?: DoneFn; preset?: Record<string, string> }) {
  const [state, action] = useActionState(recordPayment, initialState);
  useDone(state, onDone);
  const v = state.values ?? preset ?? {};
  const [invoiceId, setInvoiceId] = useState(v.invoiceId ?? options.openInvoices[0]?.id ?? "");
  const invoice = options.openInvoices.find((i) => i.id === invoiceId);
  const accounts = options.accounts.filter((a) => invoice && a.companyId === invoice.companyId && a.currency === invoice.currency);
  const fe = state.fieldErrors ?? {};
  if (options.openInvoices.length === 0) {
    return <p className="py-6 text-center text-[13.5px] text-ink-3">Aucune facture en attente de paiement. Les factures envoyées et non soldées apparaîtront ici.</p>;
  }
  return (
    <form action={action} className="grid gap-4" key={invoiceId}>
      <FormMessage state={state} />
      {v.confirmDuplicate && <input type="hidden" name="confirmDuplicate" value="1" />}
      <Field label="Facture" htmlFor="invoiceId" error={fe.invoiceId}>
        <Select id="invoiceId" name="invoiceId" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          {options.openInvoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.number} · {i.contactName ?? "sans client"} · reste {formatMoney(i.remaining, i.currency)}{i.overdue ? " · en retard" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {invoice && (
        <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-[13px]">
          <span className="text-ink-2">{invoice.title ?? invoice.number}</span>
          <span className="text-ink-3">Restant dû <strong className="ml-1 font-semibold text-ink tabular">{formatMoney(invoice.remaining, invoice.currency)}</strong></span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
        <AmountField label="Montant reçu" currency={invoice?.currency ?? options.baseCurrency} defaultValue={v.amount ?? (invoice ? minorToInput(invoice.remaining, invoice.currency) : "")} error={fe.amount}
          hint="Un montant inférieur enregistre un paiement partiel ; le reste dû est recalculé." />
        <Field label="Date du paiement" htmlFor="date" error={fe.date}>
          <Input id="date" name="date" type="date" defaultValue={v.date ?? options.today} required className="h-12" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Compte ayant reçu les fonds" htmlFor="accountId" error={fe.accountId}>
          <Select id="accountId" name="accountId" defaultValue={v.accountId ?? accounts[0]?.id ?? ""}>
            {accounts.length === 0 && <option value="">Aucun compte en {invoice?.currency}</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Mode de paiement" htmlFor="method">
          <Select id="method" name="method" defaultValue={v.method ?? "bank_transfer"}>
            {Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Référence de la transaction" htmlFor="reference" optional>
          <Input id="reference" name="reference" defaultValue={v.reference} />
        </Field>
        <Field label="Frais prélevés" htmlFor="fees" optional error={fe.fees} hint="Ex. commission mobile money.">
          <Input id="fees" name="fees" inputMode="decimal" defaultValue={v.fees} placeholder="0" />
        </Field>
      </div>
      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Enregistrement…">{v.confirmDuplicate ? "Confirmer le paiement" : "Enregistrer le paiement"}</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────────────────── Contact ───────────────────────── */

export function ContactForm({ options, onDone, preset }: { options: FormOptions; onDone?: DoneFn; preset?: Record<string, string> }) {
  const [state, action] = useActionState(createContact, initialState);
  useDone(state, onDone);
  const v = state.values ?? preset ?? {};
  const fe = state.fieldErrors ?? {};
  const [type, setType] = useState(v.type ?? "prospect");
  const proCompanies = options.companies.filter((c) => c.kind !== "personal");
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <div className="inline-flex w-fit rounded-lg bg-surface-3 p-0.5" role="radiogroup" aria-label="Type de contact">
        {[["prospect", "Prospect"], ["client", "Client"], ["supplier", "Fournisseur"]].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)}
            className={cx("rounded-md px-3 py-1.5 text-[12.5px] font-medium", type === k ? "bg-surface text-ink shadow-card" : "text-ink-3")}>{l}</button>
        ))}
      </div>
      <input type="hidden" name="type" value={type} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom ou raison sociale" htmlFor="name" error={fe.name}>
          <Input id="name" name="name" defaultValue={v.name} required autoFocus />
        </Field>
        <Field label="Organisation" htmlFor="organization" optional>
          <Input id="organization" name="organization" defaultValue={v.organization} />
        </Field>
        <Field label="Email" htmlFor="email" optional error={fe.email}>
          <Input id="email" name="email" type="email" defaultValue={v.email} />
        </Field>
        <Field label="Téléphone" htmlFor="phone" optional>
          <Input id="phone" name="phone" type="tel" defaultValue={v.phone} />
        </Field>
      </div>
      {type !== "supplier" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {proCompanies.length > 1 && (
              <Field label="Structure concernée" htmlFor="companyId" optional>
                <Select id="companyId" name="companyId" defaultValue={v.companyId ?? options.defaultCompanyId ?? ""}>
                  <option value="">—</option>
                  {proCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            {options.activities.length > 0 && (
              <Field label="Activité / prestation" htmlFor="activityId" optional>
                <Select id="activityId" name="activityId" defaultValue={v.activityId ?? ""}>
                  <option value="">—</option>
                  {options.activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          {type === "prospect" && (
            <Field label="Besoins exprimés" htmlFor="needs" optional>
              <Textarea id="needs" name="needs" rows={3} defaultValue={v.needs} placeholder="Ex. Accompagnement en prise de parole avant une conférence en décembre." />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Origine du contact" htmlFor="source" optional>
              <Input id="source" name="source" defaultValue={v.source} placeholder="Recommandation, LinkedIn…" list="sources" />
              <datalist id="sources">{["Recommandation", "LinkedIn", "Site web", "Événement", "Appel entrant"].map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Prochaine relance" htmlFor="nextFollowUpAt" optional>
              <Input id="nextFollowUpAt" name="nextFollowUpAt" type="date" defaultValue={v.nextFollowUpAt} />
            </Field>
          </div>
        </>
      )}
      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Création…">Créer la fiche</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────────────────── Transfert ───────────────────────── */

export function TransferForm({ options, onDone }: { options: FormOptions; onDone?: DoneFn }) {
  const [state, action] = useActionState(createTransfer, initialState);
  useDone(state, onDone);
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const [fromId, setFromId] = useState(v.fromAccountId ?? options.accounts[0]?.id ?? "");
  const [toId, setToId] = useState(v.toAccountId ?? options.accounts[1]?.id ?? "");
  const from = options.accounts.find((a) => a.id === fromId);
  const to = options.accounts.find((a) => a.id === toId);
  const companyName = (id?: string) => options.companies.find((c) => c.id === id);
  const sameCompany = from && to && from.companyId === to.companyId;
  const suggested = useMemo(() => {
    const fc = companyName(from?.companyId);
    const tc = companyName(to?.companyId);
    if (!fc || !tc || fc.id === tc.id) return "internal";
    if (fc.kind !== "personal" && tc.kind === "personal") return "owner_draw";
    if (fc.kind === "personal") return "owner_contribution";
    return "intercompany";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, toId]);
  const label = (a: FormOptions["accounts"][number]) => `${a.name} · ${companyName(a.companyId)?.kind === "personal" ? "Perso" : companyName(a.companyId)?.name} · ${a.currency}`;
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <p className="text-[12.5px] text-ink-3">Un transfert déplace de l&apos;argent entre vos comptes. Il n&apos;est jamais compté comme un nouveau revenu ou une nouvelle dépense en vue consolidée.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Depuis" htmlFor="fromAccountId">
          <Select id="fromAccountId" name="fromAccountId" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {options.accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
          </Select>
        </Field>
        <Field label="Vers" htmlFor="toAccountId" error={fe.toAccountId}>
          <Select id="toAccountId" name="toAccountId" value={toId} onChange={(e) => setToId(e.target.value)}>
            {options.accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountField label="Montant envoyé" currency={from?.currency ?? options.baseCurrency} defaultValue={v.amount} error={fe.amount} />
        {from && to && from.currency !== to.currency ? (
          <AmountField name="toAmount" label="Montant reçu" currency={to.currency} defaultValue={v.toAmount} error={fe.toAmount} hint="Le taux réellement appliqué est ainsi conservé." />
        ) : (
          <Field label="Date" htmlFor="date" error={fe.date}>
            <Input id="date" name="date" type="date" defaultValue={v.date ?? options.today} className="h-12" />
          </Field>
        )}
      </div>
      {from && to && from.currency !== to.currency && (
        <Field label="Date" htmlFor="date" error={fe.date}>
          <Input id="date" name="date" type="date" defaultValue={v.date ?? options.today} />
        </Field>
      )}
      {!sameCompany && (
        <Field label="Nature du mouvement" htmlFor="nature" hint="Enregistrez le mouvement selon sa nature réelle.">
          <Select id="nature" name="nature" key={suggested} defaultValue={suggested}>
            <option value="owner_draw">Rémunération / prélèvement du dirigeant</option>
            <option value="owner_contribution">Apport personnel</option>
            <option value="intercompany">Flux entre deux structures</option>
          </Select>
        </Field>
      )}
      <Field label="Note" htmlFor="note" optional>
        <Input id="note" name="note" defaultValue={v.note} />
      </Field>
      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer le transfert</SubmitButton>
      </div>
    </form>
  );
}
