"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { confirmOccurrence, markExpensePaid } from "@/app/actions/finance";
import { Modal } from "./modal";
import { Field, Input, Select, buttonClass, cx } from "./ui";
import { FormMessage, SubmitButton } from "./form-bits";
import { initialState } from "@/lib/action-state";
import { formatMoney, minorToInput } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { useToast } from "./toast";
import { useQuick } from "./quick/provider";

export interface OutflowItem {
  key: string;
  label: string;
  supplier: string | null;
  amount: number;
  currency: string;
  originalDate: string;
  companyId: string;
  kind: "planned" | "recurring";
  expenseId?: string;
  recurringId?: string;
  occurrenceDate?: string;
  late: boolean;
}

export function ConfirmOutflowButton({ item, compact, autoOpen }: { item: OutflowItem; compact?: boolean; autoOpen?: boolean }) {
  const [open, setOpen] = useState(!!autoOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={compact ? cx("rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink") : buttonClass("secondary", "sm")} aria-label={`Confirmer le paiement : ${item.label}`} title="Confirmer le paiement">
        <Check size={compact ? 16 : 14} />{!compact && "Confirmer"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirmer le paiement" description={`${item.label}${item.supplier ? ` · ${item.supplier}` : ""} — échéance du ${formatDate(item.originalDate)}`} size="sm">
        {open && <ConfirmForm item={item} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function ConfirmForm({ item, onDone }: { item: OutflowItem; onDone: () => void }) {
  const [state, action] = useActionState(item.kind === "recurring" ? confirmOccurrence : markExpensePaid, initialState);
  const { options } = useQuick();
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state.ok) { toast(state.message ?? "Paiement confirmé."); router.refresh(); onDone(); }
  }, [state, toast, router, onDone]);
  const accounts = options.accounts.filter((a) => a.companyId === item.companyId);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      {item.kind === "recurring" ? (
        <>
          <input type="hidden" name="recurringId" value={item.recurringId} />
          <input type="hidden" name="occurrenceDate" value={item.occurrenceDate} />
        </>
      ) : <input type="hidden" name="id" value={item.expenseId} />}
      <div className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
        Montant prévu : <strong className="text-ink tabular">{formatMoney(item.amount, item.currency)}</strong>. Ajustez-le si le montant réel diffère.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Montant payé" htmlFor="amount">
          <Input id="amount" name="amount" inputMode="decimal" defaultValue={minorToInput(item.amount, item.currency)} className="tabular" />
        </Field>
        <Field label="Date du paiement" htmlFor="paidDate">
          <Input id="paidDate" name="paidDate" type="date" defaultValue={options.today} />
        </Field>
      </div>
      <Field label="Compte débité" htmlFor="accountId">
        <Select id="accountId" name="accountId">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap justify-between gap-2 pt-1">
        {item.kind === "recurring" ? (
          <SubmitButton variant="ghost" name="decision" value="skip">Ignorer cette échéance</SubmitButton>
        ) : <span />}
        <SubmitButton name="decision" value="pay" pendingLabel="Confirmation…">Confirmer le paiement</SubmitButton>
      </div>
    </form>
  );
}
