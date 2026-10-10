"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { FormMessage } from "@/components/form-bits";
import { buttonClass } from "@/components/ui";
import { initialState, type ActionState } from "@/lib/action-state";

type FormAction = (s: ActionState, f: FormData) => Promise<ActionState>;

/** Bouton → modale → formulaire d'action serveur (toast + rafraîchissement à la réussite). */
export function FormDialog({ trigger, triggerClassName, title, description, action, children, size = "md", ariaLabel, onSuccess }: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  description?: string;
  action: FormAction;
  children: (state: ActionState) => ReactNode;
  size?: "sm" | "md" | "lg";
  ariaLabel?: string;
  onSuccess?: (state: ActionState) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName ?? buttonClass("secondary", "sm")} aria-label={ariaLabel}>{trigger}</button>
      <Modal open={open} onClose={close} title={title} description={description} size={size}>
        {open && <DialogForm action={action} onDone={(s) => { close(); onSuccess?.(s); }}>{children}</DialogForm>}
      </Modal>
    </>
  );
}

function DialogForm({ action, onDone, children }: { action: FormAction; onDone: (s: ActionState) => void; children: (state: ActionState) => ReactNode }) {
  const [state, formAction] = useActionState(action, initialState);
  const toast = useToast();
  const router = useRouter();
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast(state.message ?? "Enregistré.");
      router.refresh();
      onDone(state);
    }
  }, [state, toast, router, onDone]);
  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />
      {children(state)}
    </form>
  );
}

/** Bouton qui appelle une action serveur simple (sans formulaire), avec confirmation facultative. */
export function ActionButton({ run, children, className, confirm, pendingLabel, title }: {
  run: () => Promise<ActionState | void>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  pendingLabel?: string;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <button type="button" disabled={pending} title={title} aria-busy={pending} className={className ?? buttonClass("secondary", "sm")}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          try {
            const r = await run();
            if (r && r.error) toast(r.error, "bad");
            else if (r && r.message) toast(r.message, r.warning ? "warn" : "good");
            router.refresh();
          } catch {
            toast("L'action a échoué. Réessayez.", "bad");
          }
        });
      }}>
      {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
