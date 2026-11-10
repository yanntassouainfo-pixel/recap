"use client";

import { useActionState } from "react";
import { resetPassword } from "@/app/actions/auth";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { initialState } from "@/lib/action-state";

export function NewPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(resetPassword, initialState);
  return (
    <form action={action} className="mt-8 space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      {/* Aide les gestionnaires de mots de passe (Trousseau iCloud) à associer le nouveau mot de passe au bon compte. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label="Nouveau mot de passe" htmlFor="password" error={state.fieldErrors?.password} hint="10 caractères minimum, dont un chiffre ou un symbole.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
      </Field>
      <Field label="Confirmez le mot de passe" htmlFor="confirm" error={state.fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Enregistrement…">Enregistrer et me connecter</SubmitButton>
    </form>
  );
}
