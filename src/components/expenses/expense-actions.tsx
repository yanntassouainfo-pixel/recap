"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Pencil } from "lucide-react";
import { cancelExpense, markExpensePaid, updateExpense } from "@/app/actions/finance";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { useQuick } from "@/components/quick/provider";
import { PAYMENT_METHODS } from "@/components/quick/forms";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { initialState, type ActionState } from "@/lib/action-state";
import { CURRENCIES, formatMoney, minorToInput } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { RowMenu } from "./menu";

/** Dépense sérialisable transmise par la page serveur. */
export interface ExpenseItem {
  id: string;
  label: string;
  supplier: string | null;
  amount: number;
  currency: string;
  date: string;
  dueDate: string | null;
  paidDate: string | null;
  status: string; // paid | planned | cancelled
  companyId: string;
  accountId: string | null;
  accountName: string | null;
  activityId: string | null;
  allocationRuleId: string | null;
  categoryId: string | null;
  costType: string;
  method: string;
  note: string | null;
}

type Dialog = "edit" | "pay" | "cancel" | null;

export function ExpenseActions({ item }: { item: ExpenseItem }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const title = `${item.label}${item.supplier ? ` · ${item.supplier}` : ""}`;
  return (
    <>
      <RowMenu label={`Actions pour ${item.label}`} items={[
        { label: "Modifier", icon: <Pencil size={15} />, onSelect: () => setDialog("edit") },
        { label: "Marquer payée", icon: <Check size={15} />, onSelect: () => setDialog("pay"), hidden: item.status !== "planned" },
        { label: "Annuler la dépense", icon: <Ban size={15} />, onSelect: () => setDialog("cancel"), tone: "danger", hidden: item.status === "cancelled" },
      ]} />
      <Modal open={dialog === "edit"} onClose={close} title="Modifier la dépense" description={title} size="md">
        {dialog === "edit" && <EditExpenseForm item={item} onDone={close} />}
      </Modal>
      <Modal open={dialog === "pay"} onClose={close} title="Marquer comme payée" description={`${title} — ${item.dueDate ? `échéance du ${formatDate(item.dueDate)}` : `du ${formatDate(item.date)}`}`} size="sm">
        {dialog === "pay" && <MarkPaidForm item={item} onDone={close} />}
      </Modal>
      <Modal open={dialog === "cancel"} onClose={close} title="Annuler cette dépense ?" description={title} size="sm">
        {dialog === "cancel" && <CancelConfirm item={item} onDone={close} />}
      </Modal>
    </>
  );
}

function useActionDone(state: ActionState, onDone: () => void) {
  const toast = useToast();
  const router = useRouter();
  const last = useRef<ActionState>(state);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) { toast(state.message ?? "Enregistré."); router.refresh(); onDone(); }
  }, [state, toast, router, onDone]);
}

function EditExpenseForm({ item, onDone }: { item: ExpenseItem; onDone: () => void }) {
  const [state, action] = useActionState(updateExpense, initialState);
  useActionDone(state, onDone);
  const { options } = useQuick();
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const [companyId, setCompanyId] = useState(v.companyId ?? item.companyId);
  const [status, setStatus] = useState(v.status ?? item.status);
  const [activityId, setActivityId] = useState(v.activityId ?? item.activityId ?? "");
  const [accountId, setAccountId] = useState(v.accountId ?? item.accountId ?? "");
  const accounts = options.accounts.filter((a) => a.companyId === companyId);
  const knownAccount = accounts.some((a) => a.id === item.accountId);
  const activities = options.activities.filter((a) => a.companyId === companyId);
  const rules = options.allocationRules.filter((r) => r.companyId === companyId);
  const company = options.companies.find((c) => c.id === companyId);
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? item.currency;
  const symbol = CURRENCIES[currency as keyof typeof CURRENCIES]?.symbol ?? currency;
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={item.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Montant (${symbol})`} htmlFor="e-amount" error={fe.amount} hint={currency !== item.currency ? `Le compte choisi est en ${currency} : le montant sera enregistré dans cette devise.` : undefined}>
          <Input id="e-amount" name="amount" inputMode="decimal" required className="tabular" defaultValue={v.amount ?? minorToInput(item.amount, item.currency)} />
        </Field>
        <Field label="Date de la dépense" htmlFor="e-date" error={fe.date}>
          <Input id="e-date" name="date" type="date" required defaultValue={v.date ?? item.date} />
        </Field>
        <Field label="Libellé" htmlFor="e-label" error={fe.label}>
          <Input id="e-label" name="label" required defaultValue={v.label ?? item.label} />
        </Field>
        <Field label="Fournisseur / bénéficiaire" htmlFor="e-supplier" optional>
          <Input id="e-supplier" name="supplier" defaultValue={v.supplier ?? item.supplier ?? ""} />
        </Field>
      </div>

      <div className="grid gap-4 rounded-xl bg-surface-2 p-3.5 sm:grid-cols-2">
        <Field label="Statut" htmlFor="e-status">
          <Select id="e-status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="paid">Payée</option>
            <option value="planned">À payer</option>
            {item.status === "cancelled" && <option value="cancelled">Annulée</option>}
          </Select>
        </Field>
        <Field label="Échéance de paiement" htmlFor="e-due" optional={status !== "planned"}>
          <Input id="e-due" name="dueDate" type="date" defaultValue={v.dueDate ?? item.dueDate ?? ""} />
        </Field>
        {status === "paid" && (
          <Field label="Date du paiement" htmlFor="e-paid">
            <Input id="e-paid" name="paidDate" type="date" defaultValue={v.paidDate ?? item.paidDate ?? item.date} />
          </Field>
        )}
        <p className="text-[12px] text-ink-3 sm:col-span-2">
          {status === "planned" ? "Une dépense à payer n'est jamais comptée comme un décaissement effectué." : status === "cancelled" ? "Repassez la dépense en « Payée » ou « À payer » pour la rétablir." : "La dépense est déduite du compte sélectionné à la date du paiement."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {options.companies.length > 1 ? (
          <Field label="Structure" htmlFor="e-company">
            <Select id="e-company" name="companyId" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setAccountId(""); setActivityId(""); }}>
              {options.companies.map((c) => <option key={c.id} value={c.id}>{c.kind === "personal" ? "Espace personnel" : c.name}</option>)}
            </Select>
          </Field>
        ) : <input type="hidden" name="companyId" value={companyId} />}
        <Field label={status === "paid" ? "Compte débité" : "Compte prévu"} htmlFor="e-account">
          <Select id="e-account" name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Aucun compte</option>
            {!knownAccount && item.accountId && companyId === item.companyId && <option value={item.accountId}>{item.accountName ?? "Compte actuel"}</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </Select>
        </Field>
        <Field label="Catégorie" htmlFor="e-category">
          <Select id="e-category" name="categoryId" defaultValue={v.categoryId ?? item.categoryId ?? ""}>
            <option value="">Sans catégorie</option>
            {options.categories.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Mode de paiement" htmlFor="e-method">
          <Select id="e-method" name="method" defaultValue={v.method ?? item.method}>
            {Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        {company?.kind !== "personal" && (activities.length > 0 || rules.length > 0) && (
          <>
            <Field label="Affectation" htmlFor="e-activity" hint={activityId ? undefined : "Sans activité ni règle de répartition, la dépense reste « non affectée »."}>
              <Select id="e-activity" name="activityId" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                <option value="">Frais commun / non affecté</option>
                {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            {activityId ? (
              <Field label="Nature du coût" htmlFor="e-cost">
                <Select id="e-cost" name="costType" defaultValue={v.costType ?? item.costType}>
                  <option value="direct">Coût direct de la prestation</option>
                  <option value="overhead">Autre dépense de l&apos;activité</option>
                </Select>
              </Field>
            ) : rules.length > 0 ? (
              <Field label="Répartir entre activités" htmlFor="e-rule" optional>
                <Select id="e-rule" name="allocationRuleId" defaultValue={v.allocationRuleId ?? item.allocationRuleId ?? ""}>
                  <option value="">Ne pas répartir</option>
                  {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            ) : null}
          </>
        )}
      </div>
      <Field label="Note" htmlFor="e-note" optional>
        <Textarea id="e-note" name="note" rows={2} defaultValue={v.note ?? item.note ?? ""} />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Fermer</Button>
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer les modifications</SubmitButton>
      </div>
    </form>
  );
}

function MarkPaidForm({ item, onDone }: { item: ExpenseItem; onDone: () => void }) {
  const [state, action] = useActionState(markExpensePaid, initialState);
  useActionDone(state, onDone);
  const { options } = useQuick();
  const accounts = options.accounts.filter((a) => a.companyId === item.companyId);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={item.id} />
      <div className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
        Montant prévu : <strong className="tabular text-ink">{formatMoney(item.amount, item.currency)}</strong>. Ajustez-le si le montant réellement payé diffère.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Montant payé" htmlFor="p-amount">
          <Input id="p-amount" name="amount" inputMode="decimal" className="tabular" defaultValue={minorToInput(item.amount, item.currency)} />
        </Field>
        <Field label="Date du paiement" htmlFor="p-date">
          <Input id="p-date" name="paidDate" type="date" defaultValue={options.today} />
        </Field>
      </div>
      <Field label="Compte débité" htmlFor="p-account">
        <Select id="p-account" name="accountId" defaultValue={item.accountId ?? accounts[0]?.id ?? ""}>
          {accounts.length === 0 && <option value="">Aucun compte — à créer</option>}
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Fermer</Button>
        <SubmitButton pendingLabel="Confirmation…">Confirmer le paiement</SubmitButton>
      </div>
    </form>
  );
}

function CancelConfirm({ item, onDone }: { item: ExpenseItem; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="grid gap-4">
      {error && <FormMessage state={{ error }} />}
      <p className="text-[13.5px] text-ink-2">
        La dépense de <strong className="tabular text-ink">{formatMoney(item.amount, item.currency)}</strong> sera marquée « Annulée » : elle ne sera plus comptée
        dans vos dépenses ni dans vos prévisions{item.status === "paid" ? ", et le solde du compte sera recalculé" : ""}.
      </p>
      <p className="text-[12.5px] text-ink-3">Rien n&apos;est effacé : la dépense reste visible avec le filtre « Annulées » et l&apos;opération est tracée. Vous pourrez la rétablir en la modifiant.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Conserver</Button>
        <Button type="button" variant="danger" disabled={pending} aria-busy={pending}
          onClick={() => start(async () => {
            try {
              await cancelExpense(item.id);
              toast("Dépense annulée. Elle reste consultable dans les dépenses annulées.");
              router.refresh();
              onDone();
            } catch {
              setError("L'annulation a échoué. La dépense n'a pas été modifiée.");
            }
          })}>
          <Ban size={15} /> {pending ? "Annulation…" : "Annuler la dépense"}
        </Button>
      </div>
    </div>
  );
}
