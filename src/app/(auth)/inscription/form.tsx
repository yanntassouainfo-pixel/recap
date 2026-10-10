"use client";

import { useActionState } from "react";
import { signup } from "@/app/actions/auth";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { initialState } from "@/lib/action-state";

export function SignupForm() {
  const [state, action] = useActionState(signup, initialState);
  return (
    <form action={action} className="mt-8 space-y-4">
      <FormMessage state={state} />
      <Field label="Votre nom" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="name" required defaultValue={state.values?.name} autoFocus />
      </Field>
      <Field label="Adresse email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <Field label="Mot de passe" htmlFor="password" error={state.fieldErrors?.password} hint="10 caractères minimum, dont un chiffre ou un symbole.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Création…">Créer mon compte</SubmitButton>
    </form>
  );
}
