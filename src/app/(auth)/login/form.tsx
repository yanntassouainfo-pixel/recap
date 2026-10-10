"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { initialState } from "@/lib/action-state";

export function LoginForm() {
  const [state, action] = useActionState(login, initialState);
  return (
    <form action={action} className="mt-8 space-y-4">
      <FormMessage state={state} />
      <Field label="Adresse email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} autoFocus />
      </Field>
      <Field label="Mot de passe" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Connexion…">Se connecter</SubmitButton>
    </form>
  );
}
