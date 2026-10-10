"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play } from "lucide-react";
import { toggleRecurring, updateRecurring } from "@/app/actions/finance";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { useQuick } from "@/components/quick/provider";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Button, Field, Input, Select } from "@/components/ui";
import { initialState, type ActionState } from "@/lib/action-state";
import { CURRENCIES, formatMoney, minorToInput } from "@/lib/money";
import { RowMenu } from "./menu";

export interface RecurringItem {
  id: string;
  label: string;
  supplier: string | null;
  amount: number;
  currency: string;
  frequency: string;
  endDate: string | null;
  remindDaysBefore: number;
  companyId: string;
  activityId: string | null;
  allocationRuleId: string | null;
  categoryId: string | null;
  stopped: boolean;
}

type Dialog = "edit" | "toggle" | null;

export function RecurringActions({ item }: { item: RecurringItem }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  return (
    <>
      <RowMenu label={`Actions pour ${item.label}`} items={[
        { label: "Modifier", icon: <Pencil size={15} />, onSelect: () => setDialog("edit") },
        item.stopped
          ? { label: "Reprendre", icon: <Play size={15} />, onSelect: () => setDialog("toggle") }
          : { label: "Arrêter", icon: <Pause size={15} />, onSelect: () => setDialog("toggle"), tone: "danger" },
      ]} />
      <Modal open={dialog === "edit"} onClose={close} title="Modifier la charge récurrente" description={`${item.label}${item.supplier ? ` · ${item.supplier}` : ""}`} size="md">
        {dialog === "edit" && <EditRecurringForm item={item} onDone={close} />}
      </Modal>
      <Modal open={dialog === "toggle"} onClose={close} title={item.stopped ? "Reprendre cette charge ?" : "Arrêter cette charge ?"} description={item.label} size="sm">
        {dialog === "toggle" && <ToggleConfirm item={item} onDone={close} />}
      </Modal>
    </>
  );
}

function EditRecurringForm({ item, onDone }: { item: RecurringItem; onDone: () => void }) {
  const [state, action] = useActionState(updateRecurring, initialState);
  const toast = useToast();
  const router = useRouter();
  const last = useRef<ActionState>(state);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) { toast(state.message ?? "Charge mise à jour."); router.refresh(); onDone(); }
  }, [state, toast, router, onDone]);
  const { options } = useQuick();
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const [activityId, setActivityId] = useState(v.activityId ?? item.activityId ?? "");
  const activities = options.activities.filter((a) => a.companyId === item.companyId);
  const rules = options.allocationRules.filter((r) => r.companyId === item.companyId);
  const isPersonal = options.companies.find((c) => c.id === item.companyId)?.kind === "personal";
  const symbol = CURRENCIES[item.currency as keyof typeof CURRENCIES]?.symbol ?? item.currency;
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={item.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Libellé" htmlFor="r-label">
          <Input id="r-label" name="label" required defaultValue={v.label ?? item.label} />
        </Field>
        <Field label="Fournisseur / bénéficiaire" htmlFor="r-supplier" optional>
          <Input id="r-supplier" name="supplier" defaultValue={v.supplier ?? item.supplier ?? ""} />
        </Field>
        <Field label={`Montant de chaque échéance (${symbol})`} htmlFor="r-amount" error={fe.amount}>
          <Input id="r-amount" name="amount" inputMode="decimal" required className="tabular" defaultValue={v.amount ?? minorToInput(item.amount, item.currency)} />
        </Field>
        <Field label="Fréquence" htmlFor="r-frequency">
          <Select id="r-frequency" name="frequency" defaultValue={v.frequency ?? item.frequency}>
            <option value="monthly">Chaque mois</option>
            <option value="quarterly">Chaque trimestre</option>
            <option value="yearly">Chaque année</option>
          </Select>
        </Field>
        <Field label="Dernière échéance" htmlFor="r-end" optional hint="Laissez vide si la charge continue sans date de fin.">
          <Input id="r-end" name="endDate" type="date" defaultValue={v.endDate ?? item.endDate ?? ""} />
        </Field>
        <Field label="Me prévenir" htmlFor="r-remind">
          <Select id="r-remind" name="remindDaysBefore" defaultValue={v.remindDaysBefore ?? String(item.remindDaysBefore)}>
            {[1, 3, 5, 7, 14].map((n) => <option key={n} value={n}>{n} j avant</option>)}
          </Select>
        </Field>
        <Field label="Catégorie" htmlFor="r-category">
          <Select id="r-category" name="categoryId" defaultValue={v.categoryId ?? item.categoryId ?? ""}>
            <option value="">Sans catégorie</option>
            {options.categories.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!isPersonal && activities.length > 0 && (
          <Field label="Affectation" htmlFor="r-activity">
            <Select id="r-activity" name="activityId" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              <option value="">Frais commun / non affecté</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        {!isPersonal && !activityId && rules.length > 0 && (
          <Field label="Répartir entre activités" htmlFor="r-rule" optional>
            <Select id="r-rule" name="allocationRuleId" defaultValue={v.allocationRuleId ?? item.allocationRuleId ?? ""}>
              <option value="">Ne pas répartir</option>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <p className="text-[12px] text-ink-3">Les échéances déjà confirmées ne changent pas. Les prochaines échéances et les prévisions utilisent les nouvelles valeurs.</p>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Fermer</Button>
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

function ToggleConfirm({ item, onDone }: { item: RecurringItem; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const resume = item.stopped;
  return (
    <div className="grid gap-4">
      {error && <FormMessage state={{ error }} />}
      <p className="text-[13.5px] text-ink-2">
        {resume
          ? <>Les échéances de <strong className="text-ink">{formatMoney(item.amount, item.currency)}</strong> réapparaîtront dans vos dépenses à venir et vos prévisions, sans date de fin.</>
          : <>Plus aucune échéance ne sera prévue à partir d&apos;aujourd&apos;hui. Les paiements déjà confirmés restent dans l&apos;historique.</>}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Fermer</Button>
        <Button type="button" variant={resume ? "primary" : "danger"} disabled={pending} aria-busy={pending}
          onClick={() => start(async () => {
            try {
              await toggleRecurring(item.id, resume);
              toast(resume ? `${item.label} : charge reprise.` : `${item.label} : charge arrêtée.`);
              router.refresh();
              onDone();
            } catch {
              setError("L'opération a échoué. Réessayez.");
            }
          })}>
          {resume ? <Play size={15} /> : <Pause size={15} />} {pending ? "En cours…" : resume ? "Reprendre la charge" : "Arrêter la charge"}
        </Button>
      </div>
    </div>
  );
}
