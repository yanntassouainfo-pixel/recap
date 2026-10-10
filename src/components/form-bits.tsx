"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { buttonClass, cx } from "./ui";
import type { ActionState } from "@/lib/action-state";
import type { ReactNode } from "react";
import { SeverityIcon } from "./ui";

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingLabel, name, value, disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "accent" | "danger" | "ghost"; size?: "sm" | "md" | "lg"; className?: string; pendingLabel?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={buttonClass(variant, size, className)} aria-busy={pending}>
      {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-bad-soft/70 px-3.5 py-2.5 text-[13px] text-ink animate-fade-up" role="alert">
        <SeverityIcon severity="critical" />
        <span>{state.error}</span>
      </div>
    );
  }
  if (state.warning) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-warn-soft/80 px-3.5 py-2.5 text-[13px] text-ink animate-fade-up" role="status">
        <SeverityIcon severity="warning" />
        <span>{state.warning}</span>
      </div>
    );
  }
  if (state.ok && state.message) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-good-soft/80 px-3.5 py-2.5 text-[13px] text-ink animate-fade-up" role="status">
        <SeverityIcon severity="good" />
        <span>{state.message}</span>
      </div>
    );
  }
  return null;
}

export function FieldError({ state, name }: { state: ActionState; name: string }) {
  const e = state.fieldErrors?.[name]?.[0];
  return e ? <p className={cx("text-[12px] text-bad")} role="alert">{e}</p> : null;
}
