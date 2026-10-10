"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit, clearFailures, createSession, destroySession, hashPassword, loginThrottle, registerFailure, verifyPassword } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

const signupSchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom."),
  email: z.string().trim().toLowerCase().email("Adresse email invalide."),
  password: z.string().min(10, "10 caractères minimum.").regex(/[^A-Za-z]/, "Ajoutez au moins un chiffre ou un symbole."),
});

export async function signup(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values: { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") } };
  const { name, email, password } = parsed.data;
  const exists = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get();
  if (exists) return { fieldErrors: { email: ["Un compte existe déjà avec cette adresse."] }, values: { name, email } };
  const id = newId("usr_");
  db.insert(schema.users).values({ id, email, name, passwordHash: await hashPassword(password) }).run();
  db.insert(schema.settings).values({ userId: id }).run();
  audit(id, "user", id, "signup");
  await createSession(id);
  redirect("/onboarding");
}

export async function login(_: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const throttle = loginThrottle(email);
  if (throttle.blocked) return { error: `Trop de tentatives. Réessayez dans ${Math.ceil(throttle.retryInSec / 60)} min.`, values: { email } };
  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    registerFailure(email);
    return { error: "Email ou mot de passe incorrect.", values: { email } };
  }
  clearFailures(email);
  await createSession(user.id);
  audit(user.id, "user", user.id, "login");
  const settings = db.select().from(schema.settings).where(eq(schema.settings.userId, user.id)).get();
  redirect(settings?.onboardedAt ? "/" : "/onboarding");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
