"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit, clearFailures, createSession, destroySession, hashPassword, loginThrottle, registerFailure, verifyPassword } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { createResetToken, RESET_LINK_MINUTES, verifyResetToken } from "@/lib/password-reset";
import { isMailerConfigured, sendSystemEmail } from "@/lib/mailer";

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

/* ───────── Mot de passe oublié ───────── */

const passwordRule = z.string().min(10, "10 caractères minimum.").regex(/[^A-Za-z]/, "Ajoutez au moins un chiffre ou un symbole.");

export async function requestPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { fieldErrors: { email: ["Adresse email invalide."] }, values: { email } };
  if (!isMailerConfigured()) {
    return { error: "L'envoi d'emails n'est pas configuré sur cette installation : utilisez la réinitialisation depuis l'app Mac (voir ci-dessous).", values: { email } };
  }
  const throttle = loginThrottle(`reset:${email}`);
  if (throttle.blocked) return { error: `Trop de demandes. Réessayez dans ${Math.ceil(throttle.retryInSec / 60)} min.`, values: { email } };
  registerFailure(`reset:${email}`);
  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (user) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
    const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
    const link = `${proto}://${host}/mot-de-passe/nouveau?jeton=${encodeURIComponent(createResetToken(user.id))}`;
    try {
      await sendSystemEmail(user.email, "Recap — réinitialiser votre mot de passe",
        `Bonjour ${user.name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable ${RESET_LINK_MINUTES} minutes, une seule fois) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`);
      audit(user.id, "user", user.id, "password_reset_requested");
    } catch (e) {
      console.error("[mot de passe oublié]", e instanceof Error ? e.message : e);
    }
  }
  // Même réponse que le compte existe ou non (on ne révèle pas quelles adresses sont inscrites).
  return { ok: true, message: `Si un compte existe avec ${email}, un lien de réinitialisation vient de lui être envoyé. Pensez à vérifier les indésirables.` };
}

export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const user = verifyResetToken(token);
  if (!user) return { error: "Ce lien n'est plus valable (expiré ou déjà utilisé). Refaites une demande." };
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const parsed = passwordRule.safeParse(password);
  if (!parsed.success) return { fieldErrors: { password: parsed.error.issues.map((i) => i.message) } };
  if (password !== confirm) return { fieldErrors: { confirm: ["Les deux mots de passe ne correspondent pas."] } };
  db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, user.id)).run();
  // Toutes les sessions existantes sont fermées : seul ce navigateur reste connecté.
  db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id)).run();
  clearFailures(user.email);
  audit(user.id, "user", user.id, "password_reset");
  await createSession(user.id);
  redirect("/");
}
