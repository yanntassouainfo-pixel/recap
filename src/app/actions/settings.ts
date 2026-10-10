"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { db, schema } from "@/lib/db";
import { requireUser, audit, hashPassword, verifyPassword, destroySession } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { formValues, isoDate, money, optStr, OwnershipError, ownedId, str } from "@/lib/guards";
import { CURRENCIES } from "@/lib/money";
import type { ActionState } from "@/lib/action-state";
import { ensurePersonalSpace } from "@/lib/setup";
import { todayISO } from "@/lib/dates";
import { getSettings } from "@/lib/data";
import { deleteUserFiles } from "@/lib/storage";

const done = () => revalidatePath("/", "layout");

export async function updatePreferences(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const before = getSettings(user.id);
  const baseCurrency = str(form, "baseCurrency");
  if (!(baseCurrency in CURRENCIES)) return { fieldErrors: { baseCurrency: ["Devise invalide."] } };
  const mode = ["solo", "multi_activity", "multi_company"].includes(str(form, "mode")) ? str(form, "mode") : before.mode;
  const personal = str(form, "personalSpaceEnabled") === "on";
  const threshold = money(form, "cashSafetyThreshold", baseCurrency);
  if (threshold == null || threshold < 0) return { fieldErrors: { cashSafetyThreshold: ["Montant invalide (0 pour désactiver)."] }, values: formValues(form) };
  const after = { baseCurrency, mode, personalSpaceEnabled: personal, cashSafetyThreshold: threshold, country: str(form, "country") || before.country };
  if (personal) ensurePersonalSpace(user.id, baseCurrency, todayISO());
  db.update(schema.settings).set(after).where(eq(schema.settings.userId, user.id)).run();
  if (!personal) (await cookies()).set("recap_scope", "all", { path: "/", httpOnly: true, sameSite: "lax" });
  audit(user.id, "settings", user.id, "update", before, after);
  done();
  return { ok: true, message: before.baseCurrency !== baseCurrency ? `Préférences enregistrées. Les totaux sont désormais convertis en ${baseCurrency} avec les taux datés disponibles.` : "Préférences enregistrées." };
}

export async function updateProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = str(form, "name");
  if (name.length < 2) return { fieldErrors: { name: ["Indiquez votre nom."] } };
  db.update(schema.users).set({ name }).where(eq(schema.users.id, user.id)).run();
  done();
  return { ok: true, message: "Profil mis à jour." };
}

export async function changePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const row = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()!;
  if (!(await verifyPassword(str(form, "current"), row.passwordHash))) return { fieldErrors: { current: ["Mot de passe actuel incorrect."] } };
  const next = String(form.get("next") ?? "");
  if (next.length < 10 || !/[^A-Za-z]/.test(next)) return { fieldErrors: { next: ["10 caractères minimum, dont un chiffre ou un symbole."] } };
  db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, user.id)).run();
  // Déconnecte les autres appareils
  const token = (await cookies()).get("recap_session")?.value ?? "";
  const currentId = createHash("sha256").update(token).digest("hex");
  db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, currentId))).run();
  audit(user.id, "user", user.id, "password_change");
  return { ok: true, message: "Mot de passe modifié. Les autres sessions ont été déconnectées." };
}

export async function revokeOtherSessions() {
  const user = await requireUser();
  const token = (await cookies()).get("recap_session")?.value ?? "";
  const currentId = createHash("sha256").update(token).digest("hex");
  db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, currentId))).run();
  audit(user.id, "user", user.id, "revoke_sessions");
  revalidatePath("/parametres");
}

/* ───────── Taux de change ───────── */

export async function addRate(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const base = str(form, "base");
  const quote = str(form, "quote");
  const rate = Number(str(form, "rate").replace(",", ".").replace(/\s/g, ""));
  const date = isoDate(form, "date");
  if (!(base in CURRENCIES) || !(quote in CURRENCIES) || base === quote) return { fieldErrors: { quote: ["Choisissez deux devises différentes."] }, values: formValues(form) };
  if (!Number.isFinite(rate) || rate <= 0) return { fieldErrors: { rate: ["Taux invalide."] }, values: formValues(form) };
  if (!date) return { fieldErrors: { date: ["Date invalide."] }, values: formValues(form) };
  const id = newId("fx_");
  const row = { id, userId: user.id, base, quote, rate, date, source: optStr(form, "source") ?? "Saisie manuelle" };
  db.insert(schema.exchangeRates).values(row).run();
  audit(user.id, "exchange_rate", id, "create", undefined, row);
  done();
  return { ok: true, message: `Taux enregistré : 1 ${base} = ${rate} ${quote} au ${date}.` };
}

export async function deleteRate(id: string) {
  const user = await requireUser();
  const r = db.select().from(schema.exchangeRates).where(and(eq(schema.exchangeRates.id, id), eq(schema.exchangeRates.userId, user.id))).get();
  if (!r) return;
  db.delete(schema.exchangeRates).where(eq(schema.exchangeRates.id, id)).run();
  audit(user.id, "exchange_rate", id, "delete", r);
  done();
}

/* ───────── Catégories ───────── */

export async function saveCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = str(form, "name");
  if (!name) return { fieldErrors: { name: ["Nom requis."] } };
  const kind = str(form, "kind") === "income" ? "income" : "expense";
  const nature = str(form, "nature") === "fixed" ? "fixed" : "variable";
  const id = str(form, "id");
  if (id) {
    const before = db.select().from(schema.categories).where(and(eq(schema.categories.id, id), eq(schema.categories.userId, user.id))).get();
    if (!before) return { error: "Catégorie introuvable." };
    db.update(schema.categories).set({ name, nature }).where(eq(schema.categories.id, id)).run();
  } else {
    db.insert(schema.categories).values({ id: newId("cat_"), userId: user.id, name, kind, nature }).run();
  }
  done();
  return { ok: true, message: id ? "Catégorie renommée." : `Catégorie « ${name} » ajoutée.` };
}

/* ───────── Identités d'expédition ───────── */

export async function saveSender(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    const fromEmail = str(form, "fromEmail").toLowerCase();
    const fromName = str(form, "fromName");
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez la structure expéditrice."] }, values: formValues(form) };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) return { fieldErrors: { fromEmail: ["Adresse invalide."] }, values: formValues(form) };
    if (!fromName) return { fieldErrors: { fromName: ["Nom affiché requis."] }, values: formValues(form) };
    const authorized = str(form, "authorized") === "on";
    const id = str(form, "id");
    const values = { companyId, fromEmail, fromName, replyTo: optStr(form, "replyTo"), authorized };
    if (id) {
      const before = db.select().from(schema.senderIdentities).where(and(eq(schema.senderIdentities.id, id), eq(schema.senderIdentities.userId, user.id))).get();
      if (!before) return { error: "Adresse introuvable." };
      db.update(schema.senderIdentities).set(values).where(eq(schema.senderIdentities.id, id)).run();
      audit(user.id, "sender_identity", id, "update", before, values);
    } else {
      const nid = newId("snd_");
      db.insert(schema.senderIdentities).values({ id: nid, userId: user.id, ...values }).run();
      audit(user.id, "sender_identity", nid, "create", undefined, values);
    }
    revalidatePath("/parametres");
    revalidatePath("/emails", "layout");
    return { ok: true, message: authorized ? "Adresse d'expédition autorisée." : "Adresse enregistrée (non autorisée : elle ne peut pas encore envoyer)." };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Référence invalide." };
    throw e;
  }
}

export async function deleteSender(id: string) {
  const user = await requireUser();
  const s = db.select().from(schema.senderIdentities).where(and(eq(schema.senderIdentities.id, id), eq(schema.senderIdentities.userId, user.id))).get();
  if (!s) return;
  db.delete(schema.senderIdentities).where(eq(schema.senderIdentities.id, id)).run();
  audit(user.id, "sender_identity", id, "delete", s);
  revalidatePath("/parametres");
}

/** Vérifie la connexion SMTP (sans envoyer d'email). */
export async function testSmtp(): Promise<ActionState> {
  await requireUser();
  if (!process.env.SMTP_HOST) return { error: "Aucun serveur SMTP n'est configuré (variable SMTP_HOST absente)." };
  try {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await t.verify();
    return { ok: true, message: `Connexion au serveur ${process.env.SMTP_HOST} vérifiée.` };
  } catch (e) {
    return { error: `Connexion impossible : ${e instanceof Error ? e.message : "erreur inconnue"}` };
  }
}

/* ───────── Suppression du compte ───────── */

export async function deleteAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const row = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()!;
  if (str(form, "confirmEmail").toLowerCase() !== row.email) return { fieldErrors: { confirmEmail: ["Saisissez exactement votre adresse email."] } };
  if (!(await verifyPassword(String(form.get("password") ?? ""), row.passwordHash))) return { fieldErrors: { password: ["Mot de passe incorrect."] } };
  audit(user.id, "user", user.id, "account_deleted");
  await destroySession();
  // Les suppressions en cascade sont ordonnées : d'abord les enfants qui « restreignent », puis l'utilisateur.
  db.transaction((tx) => {
    tx.delete(schema.payments).where(eq(schema.payments.userId, user.id)).run();
    tx.delete(schema.transfers).where(eq(schema.transfers.userId, user.id)).run();
    tx.delete(schema.emails).where(eq(schema.emails.userId, user.id)).run();
    tx.delete(schema.invoices).where(eq(schema.invoices.userId, user.id)).run();
    tx.delete(schema.incomes).where(eq(schema.incomes.userId, user.id)).run();
    tx.delete(schema.expenses).where(eq(schema.expenses.userId, user.id)).run();
    tx.delete(schema.users).where(eq(schema.users.id, user.id)).run();
    tx.delete(schema.auditLog).where(eq(schema.auditLog.userId, user.id)).run();
  });
  deleteUserFiles(user.id);
  redirect("/login?supprime=1");
}
