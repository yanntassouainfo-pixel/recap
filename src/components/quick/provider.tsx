"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { FormOptions } from "@/lib/options";
import { ContactForm, ExpenseForm, IncomeForm, PaymentForm, TransferForm } from "./forms";

export type QuickKind = "income" | "expense" | "recurring" | "payment" | "contact" | "transfer";

const TITLES: Record<QuickKind, [string, string]> = {
  income: ["Ajouter un revenu", "Une recette encaissée, sans facture."],
  expense: ["Ajouter une dépense", "Payée ou à payer, ponctuelle ou récurrente."],
  recurring: ["Ajouter une charge récurrente", "Loyer, abonnement, assurance… intégrée automatiquement aux prévisions."],
  payment: ["Enregistrer un paiement", "Rattaché à une facture : le restant dû est recalculé."],
  contact: ["Ajouter un client ou un prospect", "Une fiche centralise échanges, documents et factures."],
  transfer: ["Transfert entre comptes", "Rémunération, épargne, rapatriement de fonds…"],
};

interface Ctx {
  open: (kind: QuickKind, preset?: Record<string, string>) => void;
  options: FormOptions;
}
const QuickCtx = createContext<Ctx | null>(null);

export function useQuick() {
  const c = useContext(QuickCtx);
  if (!c) throw new Error("useQuick hors du fournisseur");
  return c;
}

export function QuickActionsProvider({ options, children }: { options: FormOptions; children: ReactNode }) {
  const [state, setState] = useState<{ kind: QuickKind; preset?: Record<string, string>; key: number } | null>(null);
  const toast = useToast();
  const router = useRouter();
  const open = useCallback((kind: QuickKind, preset?: Record<string, string>) => setState({ kind, preset, key: Date.now() }), []);
  const close = useCallback(() => setState(null), []);
  const done = useCallback((message: string, id?: string) => {
    const kind = state?.kind;
    setState(null);
    toast(message);
    router.refresh();
    if (kind === "contact" && id) router.push(`/clients/${id}`);
  }, [state?.kind, toast, router]);

  const kind = state?.kind;
  return (
    <QuickCtx.Provider value={{ open, options }}>
      {children}
      <Modal open={!!state} onClose={close} title={kind ? TITLES[kind][0] : ""} description={kind ? TITLES[kind][1] : undefined} size="md">
        {state && (
          <div key={state.key}>
            {kind === "income" && <IncomeForm options={options} onDone={done} preset={state.preset} />}
            {kind === "expense" && <ExpenseForm options={options} onDone={done} preset={state.preset} />}
            {kind === "recurring" && <ExpenseForm options={options} onDone={done} preset={state.preset} forceRecurring />}
            {kind === "payment" && <PaymentForm options={options} onDone={done} preset={state.preset} />}
            {kind === "contact" && <ContactForm options={options} onDone={done} preset={state.preset} />}
            {kind === "transfer" && <TransferForm options={options} onDone={done} />}
          </div>
        )}
      </Modal>
    </QuickCtx.Provider>
  );
}

/** Bouton qui ouvre une action rapide — utilisable depuis un composant serveur. */
export function QuickButton({ kind, preset, children, className }: { kind: QuickKind; preset?: Record<string, string>; children: ReactNode; className?: string }) {
  const { open } = useQuick();
  return (
    <button type="button" onClick={() => open(kind, preset)} className={className}>
      {children}
    </button>
  );
}
