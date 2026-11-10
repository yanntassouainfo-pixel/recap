"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/app/actions/auth";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { initialState } from "@/lib/action-state";

export function ForgotForm() {
  const [state, action] = useActionState(requestPasswordReset, initialState);
  return (
    <form action={action} className="mt-6 space-y-4">
      <h2 className="text-[14px] font-semibold">Recevoir un lien par email</h2>
      <FormMessage state={state} />
      <Field label="Adresse email du compte" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Envoi…">Envoyer le lien</SubmitButton>
    </form>
  );
}
