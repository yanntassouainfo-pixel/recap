"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { formValues, isoDate, money, optStr, OwnershipError, ownedId, str } from "@/lib/guards";
import { CURRENCIES } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import type { ActionState } from "@/lib/action-state";
import { createDocument } from "@/lib/documents";
import { guessMime } from "@/lib/storage";
import { getSettings } from "@/lib/data";

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const done = () => revalidatePath("/", "layout");

class LogoError extends Error {}

async function saveLogo(userId: string, companyId: string, form: FormData): Promise<string | null> {
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return null;
  const mimeType = file.type || guessMime(file.name);
  if (!mimeType.startsWith("image/")) throw new LogoError("Le logo doit être une image (PNG, JPG, SVG, WebP).");
  if (file.size > 2 * 1024 * 1024) throw new LogoError("Logo trop volumineux (2 Mo maximum).");
  return createDocument(userId, { name: `Logo — ${str(form, "name")}`, type: "logo", usage: "reusable", companyId }, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType });
}

export async function saveCompany(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "id");
  const name = str(form, "name");
  const currency = str(form, "currency");
  const errors: Record<string, string[]> = {};
  if (!name) errors.name = ["Le nom est requis."];
  if (!(currency in CURRENCIES)) errors.currency = ["Devise invalide."];
  const email = optStr(form, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = ["Adresse email invalide."];
  if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };
  const values = {
    name, legalName: optStr(form, "legalName"), description: optStr(form, "description"), email, phone: optStr(form, "phone"),
    address: optStr(form, "address"), website: optStr(form, "website"), currency, taxId: optStr(form, "taxId"),
    billingDetails: optStr(form, "billingDetails"),
    invoicePrefix: (str(form, "invoicePrefix") || "FAC").replace(/[^A-Za-z0-9-]/g, "").slice(0, 10).toUpperCase() || "FAC",
    quotePrefix: (str(form, "quotePrefix") || "DEV").replace(/[^A-Za-z0-9-]/g, "").slice(0, 12).toUpperCase() || "DEV",
    paymentTermsDays: Math.max(0, Math.min(180, Number(str(form, "paymentTermsDays") || 30))),
    color: COLOR_RE.test(str(form, "color")) ? str(form, "color") : "#2a78d6",
  };
  try {
    if (id) {
      const before = db.select().from(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.userId, user.id))).get();
      if (!before) return { error: "Structure introuvable." };
      const logo = await saveLogo(user.id, id, form);
      db.update(schema.companies).set({ ...values, ...(logo ? { logoPath: logo } : {}) }).where(eq(schema.companies.id, id)).run();
      audit(user.id, "company", id, "update", before, values);
      done();
      return { ok: true, id, message: `« ${name} » mise à jour. Ces informations sont réutilisées dans vos factures et emails.` };
    }
    const nid = newId("cmp_");
    db.insert(schema.companies).values({ id: nid, userId: user.id, kind: "company", ...values }).run();
    const logo = await saveLogo(user.id, nid, form);
    if (logo) db.update(schema.companies).set({ logoPath: logo }).where(eq(schema.companies.id, nid)).run();
    // Une structure démarre avec un compte et une activité pour être utilisable immédiatement.
    db.insert(schema.accounts).values({ id: newId("acc_"), userId: user.id, companyId: nid, name: `Compte ${name}`, type: "bank", currency, openingBalance: money(form, "openingBalance", currency) ?? 0, openingDate: todayISO() }).run();
    db.insert(schema.activities).values({ id: newId("act_"), userId: user.id, companyId: nid, name: str(form, "firstActivity") || name, color: values.color }).run();
    if (email) db.insert(schema.senderIdentities).values({ id: newId("snd_"), userId: user.id, companyId: nid, fromName: name, fromEmail: email, authorized: false }).run();
    const settings = getSettings(user.id);
    const proCount = db.select().from(schema.companies).where(and(eq(schema.companies.userId, user.id), eq(schema.companies.kind, "company"))).all().length;
    if (proCount > 1 && settings.mode !== "multi_company") db.update(schema.settings).set({ mode: "multi_company" }).where(eq(schema.settings.userId, user.id)).run();
    audit(user.id, "company", nid, "create", undefined, values);
    done();
    return { ok: true, id: nid, message: `Structure « ${name} » créée avec un compte et une première activité.` };
  } catch (e) {
    if (e instanceof LogoError) return { error: e.message, values: formValues(form) };
    throw e;
  }
}

export async function archiveCompany(id: string, archived: boolean) {
  const user = await requireUser();
  const c = db.select().from(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.userId, user.id))).get();
  if (!c || c.kind === "personal") return;
  db.update(schema.companies).set({ archived }).where(eq(schema.companies.id, id)).run();
  audit(user.id, "company", id, archived ? "archive" : "unarchive");
  done();
}

export async function saveActivity(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez une structure."] }, values: formValues(form) };
    const company = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get()!;
    const name = str(form, "name");
    if (!name) return { fieldErrors: { name: ["Le nom est requis."] }, values: formValues(form) };
    const values = {
      companyId, name, category: optStr(form, "category"), description: optStr(form, "description"),
      color: COLOR_RE.test(str(form, "color")) ? str(form, "color") : "#2a78d6",
      brandId: ownedId(schema.brands, form.get("brandId"), user.id),
      monthlyRevenueTarget: money(form, "monthlyRevenueTarget", company.currency),
    };
    const id = str(form, "id");
    if (id) {
      const before = db.select().from(schema.activities).where(and(eq(schema.activities.id, id), eq(schema.activities.userId, user.id))).get();
      if (!before) return { error: "Activité introuvable." };
      db.update(schema.activities).set(values).where(eq(schema.activities.id, id)).run();
      audit(user.id, "activity", id, "update", before, values);
    } else {
      const nid = newId("act_");
      db.insert(schema.activities).values({ id: nid, userId: user.id, ...values }).run();
      audit(user.id, "activity", nid, "create", undefined, values);
      const settings = getSettings(user.id);
      const count = db.select().from(schema.activities).where(and(eq(schema.activities.userId, user.id), eq(schema.activities.archived, false))).all().length;
      if (settings.mode === "solo" && count > 1) db.update(schema.settings).set({ mode: "multi_activity" }).where(eq(schema.settings.userId, user.id)).run();
    }
    done();
    return { ok: true, message: id ? "Activité mise à jour." : `Activité « ${name} » créée. Associez-lui vos factures et dépenses pour suivre sa rentabilité.` };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Référence invalide." };
    throw e;
  }
}

export async function archiveActivity(id: string, archived: boolean) {
  const user = await requireUser();
  const a = db.select().from(schema.activities).where(and(eq(schema.activities.id, id), eq(schema.activities.userId, user.id))).get();
  if (!a) return;
  db.update(schema.activities).set({ archived }).where(eq(schema.activities.id, id)).run();
  audit(user.id, "activity", id, archived ? "archive" : "unarchive");
  done();
}

export async function saveBrand(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    const name = str(form, "name");
    if (!companyId || !name) return { fieldErrors: { name: ["Le nom de l'enseigne est requis."] }, values: formValues(form) };
    const id = str(form, "id");
    const values = { companyId, name, description: optStr(form, "description") };
    if (id) {
      const before = db.select().from(schema.brands).where(and(eq(schema.brands.id, id), eq(schema.brands.userId, user.id))).get();
      if (!before) return { error: "Enseigne introuvable." };
      db.update(schema.brands).set(values).where(eq(schema.brands.id, id)).run();
      audit(user.id, "brand", id, "update", before, values);
    } else {
      const nid = newId("brd_");
      db.insert(schema.brands).values({ id: nid, userId: user.id, ...values }).run();
      audit(user.id, "brand", nid, "create", undefined, values);
    }
    done();
    return { ok: true, message: id ? "Enseigne mise à jour." : `Enseigne « ${name} » ajoutée.` };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Référence invalide." };
    throw e;
  }
}

export async function deleteBrand(id: string) {
  const user = await requireUser();
  const b = db.select().from(schema.brands).where(and(eq(schema.brands.id, id), eq(schema.brands.userId, user.id))).get();
  if (!b) return;
  db.delete(schema.brands).where(eq(schema.brands.id, id)).run(); // les références passent à NULL (set null)
  audit(user.id, "brand", id, "delete", b);
  done();
}

export async function saveAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const companyId = ownedId(schema.companies, form.get("companyId"), user.id);
    if (!companyId) return { fieldErrors: { companyId: ["Choisissez une structure."] }, values: formValues(form) };
    const id = str(form, "id");
    const before = id ? db.select().from(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, user.id))).get() : undefined;
    if (id && !before) return { error: "Compte introuvable." };
    const currency = before ? before.currency : str(form, "currency");
    if (!(currency in CURRENCIES)) return { fieldErrors: { currency: ["Devise invalide."] }, values: formValues(form) };
    const name = str(form, "name");
    const openingBalance = money(form, "openingBalance", currency);
    const openingDate = isoDate(form, "openingDate");
    const errors: Record<string, string[]> = {};
    if (!name) errors.name = ["Nommez ce compte."];
    if (openingBalance == null) errors.openingBalance = ["Solde invalide (0 accepté)."];
    if (!openingDate) errors.openingDate = ["Date invalide."];
    if (Object.keys(errors).length) return { fieldErrors: errors, values: formValues(form) };
    const values = { companyId, name, type: str(form, "type") || "bank", institution: optStr(form, "institution"), currency, openingBalance: openingBalance!, openingDate: openingDate! };
    if (before) {
      db.update(schema.accounts).set(values).where(eq(schema.accounts.id, id)).run();
      audit(user.id, "account", id, "update", before, values);
    } else {
      const nid = newId("acc_");
      db.insert(schema.accounts).values({ id: nid, userId: user.id, ...values }).run();
      audit(user.id, "account", nid, "create", undefined, values);
    }
    done();
    return { ok: true, message: before ? "Compte mis à jour. Les soldes ont été recalculés." : `Compte « ${name} » ajouté.` };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Référence invalide." };
    throw e;
  }
}

export async function archiveAccount(id: string, archived: boolean) {
  const user = await requireUser();
  const a = db.select().from(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, user.id))).get();
  if (!a) return;
  db.update(schema.accounts).set({ archived }).where(eq(schema.accounts.id, id)).run();
  audit(user.id, "account", id, archived ? "archive" : "unarchive");
  done();
}
