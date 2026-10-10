"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { saveInvoice } from "@/app/actions/invoices";
import { initialState } from "@/lib/action-state";
import { computeTotals, parseLines, type RawLine } from "@/lib/invoices";
import { CURRENCY_CODES, CURRENCIES, formatMoney } from "@/lib/money";
import { addDays } from "@/lib/dates";
import { Card, CardHeader, Field, Input, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { useToast } from "@/components/toast";
import { QuickButton } from "@/components/quick/provider";

export interface EditorCompany { id: string; name: string; currency: string; paymentTermsDays: number; prefix: string; kind: string }
export interface EditorOptions {
  companies: EditorCompany[];
  activities: { id: string; companyId: string; name: string }[];
  brands: { id: string; companyId: string; name: string }[];
  contacts: { id: string; name: string; organization: string | null }[];
}

export interface EditorInitial {
  id?: string;
  docType: "invoice" | "quote";
  number?: string;
  status?: string;
  companyId: string;
  activityId: string;
  brandId: string;
  contactId: string;
  opportunityId: string;
  counterpartCompanyId: string;
  title: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  lines: RawLine[];
}

const emptyLine = (): RawLine => ({ description: "", quantity: "1", unitPrice: "", taxRate: "" });

export function InvoiceEditor({ options, initial, paid, paidCurrency }: {
  options: EditorOptions;
  initial: EditorInitial;
  /** Montant déjà encaissé (édition d'une facture qui a des paiements). */
  paid: number;
  paidCurrency: string;
}) {
  const [state, action] = useActionState(saveInvoice, initialState);
  const router = useRouter();
  const toast = useToast();
  const isQuote = initial.docType === "quote";
  const editing = !!initial.id;
  const locked = paid > 0;

  const [v, setV] = useState(() => ({ ...initial, lines: initial.lines.length ? initial.lines : [emptyLine()] }));
  const [dueTouched, setDueTouched] = useState(editing);
  const [internal, setInternal] = useState(!!initial.counterpartCompanyId);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  const company = options.companies.find((c) => c.id === v.companyId);
  const activities = options.activities.filter((a) => a.companyId === v.companyId);
  const brands = options.brands.filter((b) => b.companyId === v.companyId);
  const otherCompanies = options.companies.filter((c) => c.id !== v.companyId && c.kind !== "personal");

  // Échéance calculée depuis les conditions de paiement de la structure, tant qu'elle n'a pas été modifiée à la main.
  useEffect(() => {
    if (dueTouched || !company || !/^\d{4}-\d{2}-\d{2}$/.test(v.issueDate)) return;
    setV((s) => ({ ...s, dueDate: addDays(s.issueDate, company.paymentTermsDays) }));
  }, [v.issueDate, company, dueTouched]);

  useEffect(() => {
    if (state.ok && state.id) {
      toast(state.message ?? "Enregistré.");
      router.push(`/revenus/${state.id}`);
    }
  }, [state, router, toast]);

  const parsed = useMemo(() => parseLines(v.lines, v.currency), [v.lines, v.currency]);
  const totals = useMemo(() => computeTotals(parsed.lines), [parsed.lines]);
  const m = (n: number) => formatMoney(n, v.currency);
  const fe = (k: string) => state.fieldErrors?.[k];
  const lineErrors = state.fieldErrors?.lines;

  const updateLine = (i: number, patch: Partial<RawLine>) => set("lines", v.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => set("lines", v.lines.length > 1 ? v.lines.filter((_, j) => j !== i) : [emptyLine()]);
  const lineAmount = (l: RawLine) => {
    const p = parseLines([l], v.currency).lines[0];
    return p ? computeTotals([p]).subtotal : null;
  };

  return (
    <form action={action} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <input type="hidden" name="id" value={initial.id ?? ""} />
      <input type="hidden" name="docType" value={initial.docType} />
      <input type="hidden" name="opportunityId" value={v.opportunityId} />
      <input type="hidden" name="lines" value={JSON.stringify(v.lines)} />

      <div className="grid min-w-0 gap-5">
        <FormMessage state={state} />

        <Card>
          <CardHeader title="Qui facture, et à qui ?" description={isQuote ? "Le devis est émis au nom de la structure choisie." : "La facture est émise au nom de la structure choisie et numérotée automatiquement."} />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label="Structure émettrice" error={fe("companyId")} htmlFor="companyId">
              <Select id="companyId" name="companyId" value={v.companyId} disabled={locked}
                onChange={(e) => {
                  const c = options.companies.find((x) => x.id === e.target.value);
                  setV((s) => ({ ...s, companyId: e.target.value, activityId: "", brandId: "", currency: locked ? s.currency : c?.currency ?? s.currency, counterpartCompanyId: s.counterpartCompanyId === e.target.value ? "" : s.counterpartCompanyId }));
                }}>
                {options.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {locked && <input type="hidden" name="companyId" value={v.companyId} />}
            </Field>
            <Field label="Activité" optional hint="Pour suivre ce que rapporte chaque activité." error={fe("activityId")} htmlFor="activityId">
              <Select id="activityId" name="activityId" value={v.activityId} onChange={(e) => set("activityId", e.target.value)}>
                <option value="">Non affectée</option>
                {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            {brands.length > 0 && (
              <Field label="Enseigne" optional error={fe("brandId")} htmlFor="brandId">
                <Select id="brandId" name="brandId" value={v.brandId} onChange={(e) => set("brandId", e.target.value)}>
                  <option value="">Aucune</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            )}
            {!internal ? (
              <Field label="Client" error={fe("contactId")} htmlFor="contactId" className={brands.length ? "" : "sm:col-span-2"}
                hint={<span className="inline-flex flex-wrap items-center gap-x-2">Absent de la liste ?
                  <QuickButton kind="contact" preset={{ type: "client", companyId: v.companyId }} className="inline-flex items-center gap-1 font-medium text-accent hover:underline underline-offset-4"><UserPlus size={13} aria-hidden /> Créer un client</QuickButton>
                </span>}>
                <Select id="contactId" name="contactId" value={v.contactId} onChange={(e) => set("contactId", e.target.value)}>
                  <option value="">Choisir un client…</option>
                  {options.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.organization ? ` — ${c.organization}` : ""}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Structure facturée" error={fe("counterpartCompanyId")} htmlFor="counterpartCompanyId" className={brands.length ? "" : "sm:col-span-2"}
                hint="Flux interne : il est neutralisé dans la vue consolidée.">
                <Select id="counterpartCompanyId" name="counterpartCompanyId" value={v.counterpartCompanyId} onChange={(e) => set("counterpartCompanyId", e.target.value)}>
                  <option value="">Choisir la structure…</option>
                  {otherCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            {otherCompanies.length > 0 && (
              <label className="flex items-center gap-2 text-[13px] text-ink-2 sm:col-span-2">
                <input type="checkbox" checked={internal} className="size-4 accent-[var(--accent)]"
                  onChange={(e) => { setInternal(e.target.checked); setV((s) => ({ ...s, counterpartCompanyId: e.target.checked ? s.counterpartCompanyId : "" })); }} />
                Facturée à une autre de vos structures
              </label>
            )}
            {!internal && <input type="hidden" name="counterpartCompanyId" value="" />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Prestations" description="Quantité × prix unitaire hors taxes. Laissez la TVA vide si elle ne s'applique pas." />
          <div className="px-5 pb-5">
            <Field label={isQuote ? "Objet du devis" : "Objet de la facture"} optional htmlFor="title" className="mb-4">
              <Input id="title" name="title" value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex. Accompagnement digital — octobre" maxLength={200} />
            </Field>

            <div className="hidden grid-cols-[minmax(0,1fr)_80px_130px_80px_120px_36px] gap-2 border-b border-line pb-2 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3 md:grid">
              <span>Description</span><span className="text-right">Qté</span><span className="text-right">Prix unit. HT</span><span className="text-right">TVA %</span><span className="text-right">Montant HT</span><span />
            </div>
            <ol className="divide-y divide-line">
              {v.lines.map((l, i) => {
                const amt = lineAmount(l);
                return (
                  <li key={i} className="grid grid-cols-2 gap-2 py-3 md:grid-cols-[minmax(0,1fr)_80px_130px_80px_120px_36px] md:items-center">
                    <Input aria-label={`Description de la ligne ${i + 1}`} className="col-span-2 md:col-span-1" value={l.description} placeholder="Description" maxLength={500}
                      onChange={(e) => updateLine(i, { description: e.target.value })} />
                    <label className="flex flex-col gap-1 md:block"><span className="text-[11.5px] text-ink-3 md:hidden">Quantité</span>
                      <Input aria-label={`Quantité de la ligne ${i + 1}`} inputMode="decimal" className="text-right tabular" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 md:block"><span className="text-[11.5px] text-ink-3 md:hidden">Prix unitaire HT</span>
                      <Input aria-label={`Prix unitaire de la ligne ${i + 1}`} inputMode="decimal" className="text-right tabular" value={l.unitPrice} placeholder="0" onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 md:block"><span className="text-[11.5px] text-ink-3 md:hidden">TVA %</span>
                      <Input aria-label={`Taux de TVA de la ligne ${i + 1}`} inputMode="decimal" className="text-right tabular" value={l.taxRate} placeholder="—" onChange={(e) => updateLine(i, { taxRate: e.target.value })} />
                    </label>
                    <div className="flex items-center justify-between md:justify-end">
                      <span className="text-[11.5px] text-ink-3 md:hidden">Montant HT</span>
                      <span className="tabular text-[13.5px] font-medium text-ink">{amt != null ? m(amt) : "—"}</span>
                    </div>
                    <button type="button" onClick={() => removeLine(i)} className="justify-self-end rounded-lg p-2 text-ink-3 hover:bg-bad-soft hover:text-bad" aria-label={`Supprimer la ligne ${i + 1}`}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ol>
            {lineErrors && <ul className="mt-2 space-y-0.5 text-[12px] text-bad" role="alert">{lineErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
            <button type="button" onClick={() => set("lines", [...v.lines, emptyLine()])} className={buttonClass("secondary", "sm", "mt-3")}>
              <Plus size={14} aria-hidden /> Ajouter une ligne
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Dates et mentions" />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-3">
            <Field label="Devise" error={fe("currency")} htmlFor="currency" hint={locked ? `Des paiements existent en ${paidCurrency} : devise verrouillée.` : undefined}>
              <Select id="currency" name="currency" value={v.currency} disabled={locked} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c} — {CURRENCIES[c].label}</option>)}
              </Select>
              {locked && <input type="hidden" name="currency" value={v.currency} />}
            </Field>
            <Field label="Date d'émission" error={fe("issueDate")} htmlFor="issueDate">
              <Input id="issueDate" type="date" name="issueDate" value={v.issueDate} onChange={(e) => set("issueDate", e.target.value)} required />
            </Field>
            <Field label={isQuote ? "Valable jusqu'au" : "Échéance de paiement"} error={fe("dueDate")} htmlFor="dueDate"
              hint={!dueTouched && company ? `${company.paymentTermsDays} jours, selon les conditions de ${company.name}` : undefined}>
              <Input id="dueDate" type="date" name="dueDate" value={v.dueDate} onChange={(e) => { setDueTouched(true); set("dueDate", e.target.value); }} required />
            </Field>
            <Field label="Notes et mentions" optional className="sm:col-span-3" htmlFor="notes" hint="Affichées en bas du document (conditions, remerciements…).">
              <Textarea id="notes" name="notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
            </Field>
          </div>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader title="Total" description={editing ? `${isQuote ? "Devis" : "Facture"} ${initial.number}` : `Numéro attribué à l'enregistrement${company ? ` (${company.prefix}-${v.issueDate.slice(0, 4)}-…)` : ""}`} />
          <dl className="space-y-2 px-5 text-[13.5px]">
            <div className="flex justify-between"><dt className="text-ink-3">Total HT</dt><dd className="tabular">{m(totals.subtotal)}</dd></div>
            {totals.taxes.map((t) => (
              <div key={t.rate} className="flex justify-between"><dt className="text-ink-3">TVA {String(t.rate).replace(".", ",")} %</dt><dd className="tabular">{m(t.amount)}</dd></div>
            ))}
            {!totals.taxes.length && <div className="flex justify-between"><dt className="text-ink-3">TVA</dt><dd className="text-ink-3">non applicable</dd></div>}
            <div className="flex items-baseline justify-between border-t border-line pt-3"><dt className="font-medium text-ink">Total TTC</dt><dd className="tabular text-[20px] font-semibold text-ink">{m(totals.total)}</dd></div>
            {locked && (
              <div className={cx("flex justify-between text-[12.5px]", totals.total < paid ? "text-bad" : "text-ink-3")}>
                <dt>Déjà encaissé</dt><dd className="tabular">{formatMoney(paid, paidCurrency)}</dd>
              </div>
            )}
          </dl>
          <div className="grid gap-2 p-5">
            {(!editing || initial.status === "draft") && (
              <SubmitButton name="intent" value="send" pendingLabel="Enregistrement…">{isQuote ? "Enregistrer et marquer comme envoyé" : "Enregistrer et marquer comme envoyée"}</SubmitButton>
            )}
            <SubmitButton name="intent" value="draft" variant={!editing || initial.status === "draft" ? "secondary" : "primary"} pendingLabel="Enregistrement…">
              {!editing || initial.status === "draft" ? "Enregistrer en brouillon" : "Enregistrer les modifications"}
            </SubmitButton>
            <Link href={editing ? `/revenus/${initial.id}` : "/revenus"} className={buttonClass("ghost", "sm")}>Annuler</Link>
          </div>
          <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-ink-3">
            Les totaux sont recalculés à l&apos;enregistrement. {isQuote ? "Un devis n'entre pas dans vos montants à encaisser." : "« Envoyée » signifie que le client l'a reçue : elle entre alors dans vos montants à encaisser."}
          </p>
        </Card>
      </aside>
    </form>
  );
}
