"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Modal } from "./modal";
import { useToast } from "./toast";
import { FormMessage } from "./form-bits";
import { initialState, type ActionState } from "@/lib/action-state";
import { buttonClass } from "./ui";

/**
 * Bouton + modale + formulaire d'action serveur. Le contenu reçoit l'état (erreurs, valeurs saisies)
 * pour réafficher les champs en cas d'erreur.
 */
export function ActionDialog({ trigger, triggerClassName, title, description, action, children, size = "md", ariaLabel }: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  description?: string;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: (state: ActionState) => ReactNode;
  size?: "sm" | "md" | "lg";
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName ?? buttonClass("secondary", "sm")} aria-label={ariaLabel}>{trigger}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size={size}>
        {open && <DialogForm action={action} onDone={() => setOpen(false)}>{children}</DialogForm>}
      </Modal>
    </>
  );
}

function DialogForm({ action, onDone, children }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; onDone: () => void; children: (state: ActionState) => ReactNode }) {
  const [state, formAction] = useActionState(action, initialState);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state.ok) { toast(state.message ?? "Enregistré."); router.refresh(); onDone(); }
  }, [state, toast, router, onDone]);
  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />
      {children(state)}
    </form>
  );
}

/** Bouton qui exécute une action serveur simple après confirmation. */
export function ConfirmActionButton({ run, confirm, children, className, done }: { run: () => Promise<void>; confirm?: string; children: ReactNode; className?: string; done?: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <button type="button" disabled={pending} className={className ?? buttonClass("ghost", "sm")}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => { await run(); if (done) toast(done); router.refresh(); });
      }}>
      {children}
    </button>
  );
}
