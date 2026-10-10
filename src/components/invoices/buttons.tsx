"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { deleteIncome, deletePayment } from "@/app/actions/finance";
import {
  cancelInvoice, convertQuoteToInvoice, deleteDraftInvoice, duplicateInvoice, markInvoiceSent, setQuoteStatus,
} from "@/app/actions/invoices";

type Result = { error?: string; id?: string } | void;

/**
 * Bouton générique : confirmation facultative, exécution d'une action serveur, message, puis rafraîchissement
 * ou redirection vers le document créé.
 */
function RunButton({ run, confirm, done, redirectTo, children, className, ariaLabel }: {
  run: () => Promise<Result>;
  confirm?: string;
  done?: string;
  /** Si fourni, redirige vers ce chemin (avec l'identifiant renvoyé par l'action). */
  redirectTo?: (id: string) => string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <button type="button" disabled={pending} aria-busy={pending} aria-label={ariaLabel} className={className ?? buttonClass("secondary", "sm")}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          try {
            const r = await run();
            if (r && r.error) {
              toast(r.error, "warn");
              if (r.id && redirectTo) router.push(redirectTo(r.id));
              return;
            }
            if (done) toast(done);
            if (r && r.id && redirectTo) router.push(redirectTo(r.id));
            else router.refresh();
          } catch {
            toast("L'action a échoué. Réessayez.", "bad");
          }
        });
      }}>
      {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const toDoc = (id: string) => `/revenus/${id}`;

export function MarkSentButton({ id, isQuote, className }: { id: string; isQuote: boolean; className?: string }) {
  return (
    <RunButton run={() => markInvoiceSent(id)} done={isQuote ? "Devis marqué comme envoyé." : "Facture marquée comme envoyée."} className={className}>
      Marquer comme envoyé{isQuote ? "" : "e"}
    </RunButton>
  );
}

export function CancelInvoiceButton({ id, isQuote, number, className }: { id: string; isQuote: boolean; number: string; className?: string }) {
  return (
    <RunButton run={() => cancelInvoice(id)} className={className ?? buttonClass("danger", "sm")}
      confirm={`Annuler ${isQuote ? "le devis" : "la facture"} ${number} ? Le document reste consultable mais ne compte plus dans vos montants à encaisser.`}
      done={isQuote ? "Devis annulé." : "Facture annulée."}>
      Annuler {isQuote ? "le devis" : "la facture"}
    </RunButton>
  );
}

export function DeleteDraftButton({ id, number, className }: { id: string; number: string; className?: string }) {
  const router = useRouter();
  return (
    <RunButton run={async () => { const r = await deleteDraftInvoice(id); if (!r.error) router.push("/revenus"); return r; }}
      className={className ?? buttonClass("ghost", "sm")}
      confirm={`Supprimer définitivement le brouillon ${number} ?`} done="Brouillon supprimé.">
      Supprimer le brouillon
    </RunButton>
  );
}

export function DuplicateButton({ id, className }: { id: string; className?: string }) {
  return <RunButton run={() => duplicateInvoice(id)} redirectTo={toDoc} done="Copie créée en brouillon." className={className}>Dupliquer</RunButton>;
}

export function ConvertQuoteButton({ id, className }: { id: string; className?: string }) {
  return (
    <RunButton run={() => convertQuoteToInvoice(id)} redirectTo={toDoc} className={className ?? buttonClass("primary", "sm")}
      confirm="Créer une facture (brouillon) à partir de ce devis ? Le devis sera marqué comme accepté." done="Facture créée à partir du devis.">
      Transformer en facture
    </RunButton>
  );
}

export function QuoteDecisionButtons({ id, status }: { id: string; status: string }) {
  return (
    <>
      {status !== "accepted" && <RunButton run={() => setQuoteStatus(id, "accepted")} done="Devis marqué comme accepté.">Accepté</RunButton>}
      {status !== "declined" && <RunButton run={() => setQuoteStatus(id, "declined")} confirm="Marquer ce devis comme refusé ?" done="Devis marqué comme refusé.">Refusé</RunButton>}
    </>
  );
}

export function DeletePaymentButton({ id, label }: { id: string; label: string }) {
  return (
    <RunButton run={() => deletePayment(id)} className="rounded-lg px-2 py-1 text-[12.5px] text-ink-3 hover:bg-bad-soft hover:text-bad"
      confirm={`Supprimer le paiement ${label} ? Le restant dû de la facture sera recalculé.`} done="Paiement supprimé." ariaLabel={`Supprimer le paiement ${label}`}>
      Supprimer
    </RunButton>
  );
}

export function DeleteIncomeButton({ id, label }: { id: string; label: string }) {
  return (
    <RunButton run={() => deleteIncome(id)} className="rounded-lg px-2 py-1 text-[12.5px] text-ink-3 hover:bg-bad-soft hover:text-bad"
      confirm={`Supprimer la recette « ${label} » ? Elle disparaîtra de vos encaissements.`} done="Recette supprimée." ariaLabel={`Supprimer la recette ${label}`}>
      Supprimer
    </RunButton>
  );
}
