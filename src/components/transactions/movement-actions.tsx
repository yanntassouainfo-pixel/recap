"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Trash2 } from "lucide-react";
import { deleteIncome, deleteTransfer } from "@/app/actions/finance";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { FormMessage } from "@/components/form-bits";
import { Button } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { RowMenu, type MenuItem } from "@/components/expenses/menu";

export interface MovementItem {
  source: "payment" | "income" | "expense" | "transfer" | "fee";
  sourceId: string;
  label: string;
  /** Montant non signé, devise d'origine. */
  amount: number;
  currency: string;
  date: string;
  /** Facture liée (paiements et frais sur encaissement). */
  invoiceId: string | null;
  /** Transfert : les deux comptes sont-ils visibles dans la vue courante ? */
  bothSides?: boolean;
}

/**
 * Actions d'un mouvement réel. Les transferts et recettes directes se suppriment ici (avec confirmation) ;
 * les dépenses et paiements de factures se gèrent depuis leur fiche, où leurs règles propres s'appliquent.
 */
export function MovementActions({ item }: { item: MovementItem }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const deletable = item.source === "transfer" || item.source === "income";
  const items: MenuItem[] = [
    { label: "Voir la dépense", icon: <ExternalLink size={15} />, onSelect: () => router.push(`/depenses?depense=${encodeURIComponent(item.sourceId)}`), hidden: item.source !== "expense" },
    { label: "Voir la facture", icon: <ExternalLink size={15} />, onSelect: () => router.push(`/revenus/${encodeURIComponent(item.invoiceId ?? "")}`), hidden: !item.invoiceId },
    { label: item.source === "transfer" ? "Supprimer le transfert" : "Supprimer la recette", icon: <Trash2 size={15} />, onSelect: () => setConfirm(true), tone: "danger", hidden: !deletable },
  ];
  return (
    <>
      <RowMenu label={`Actions pour ${item.label}`} items={items} />
      {deletable && (
        <Modal open={confirm} onClose={() => setConfirm(false)} size="sm"
          title={item.source === "transfer" ? "Supprimer ce transfert ?" : "Supprimer cette recette ?"}
          description={`${item.label} · ${formatDate(item.date)}`}>
          {confirm && <DeleteConfirm item={item} onDone={() => setConfirm(false)} />}
        </Modal>
      )}
    </>
  );
}

function DeleteConfirm({ item, onDone }: { item: MovementItem; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const transfer = item.source === "transfer";
  return (
    <div className="grid gap-4">
      {error && <FormMessage state={{ error }} />}
      <p className="text-[13.5px] text-ink-2">
        {transfer ? (
          <>Le transfert de <strong className="tabular text-ink">{formatMoney(item.amount, item.currency)}</strong> sera supprimé des deux comptes{item.bothSides === false ? " (y compris celui qui n'est pas visible dans la vue actuelle)" : ""} : leurs soldes seront recalculés.</>
        ) : (
          <>La recette de <strong className="tabular text-ink">{formatMoney(item.amount, item.currency)}</strong> sera retirée de vos revenus encaissés, et le solde du compte sera recalculé.</>
        )}
      </p>
      <p className="text-[12.5px] text-ink-3">Cette suppression est définitive. L&apos;opération est conservée dans le journal d&apos;activité de votre compte.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Conserver</Button>
        <Button type="button" variant="danger" disabled={pending} aria-busy={pending}
          onClick={() => start(async () => {
            try {
              if (transfer) await deleteTransfer(item.sourceId);
              else await deleteIncome(item.sourceId);
              toast(transfer ? "Transfert supprimé. Les soldes ont été recalculés." : "Recette supprimée. Le solde a été recalculé.");
              router.refresh();
              onDone();
            } catch {
              setError("La suppression a échoué. Rien n'a été modifié.");
            }
          })}>
          <Trash2 size={15} /> {pending ? "Suppression…" : "Supprimer définitivement"}
        </Button>
      </div>
    </div>
  );
}
