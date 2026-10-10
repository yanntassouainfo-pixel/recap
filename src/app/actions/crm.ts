"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { formValues, isoDate, money, optStr, OwnershipError, ownedId, str } from "@/lib/guards";
import { todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { ActionState } from "@/lib/action-state";
import { getSettings } from "@/lib/data";
import { INTERACTION_TYPES, OPPORTUNITY_STAGES } from "@/lib/labels";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis."),
  email: z.union([z.literal(""), z.string().trim().email("Adresse email invalide.")]),
});

function readContact(form: FormData, userId: string) {
  return {
    type: ["prospect", "client", "supplier"].includes(str(form, "type")) ? str(form, "type") : "prospect",
    name: str(form, "name"),
    organization: optStr(form, "organization"),
    email: optStr(form, "email")?.toLowerCase() ?? null,
    phone: optStr(form, "phone"),
    address: optStr(form, "address"),
    companyId: ownedId(schema.companies, form.get("companyId"), userId),
    brandId: ownedId(schema.brands, form.get("brandId"), userId),
    activityId: ownedId(schema.activities, form.get("activityId"), userId),
    needs: optStr(form, "needs"),
    notes: optStr(form, "notes"),
    source: optStr(form, "source"),
    nextFollowUpAt: isoDate(form, "nextFollowUpAt"),
  };
}

export async function createContact(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = contactSchema.safeParse({ name: str(form, "name"), email: str(form, "email") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values: formValues(form) };
  try {
    const data = readContact(form, user.id);
    if (data.email) {
      const dup = db.select().from(schema.contacts).where(and(eq(schema.contacts.userId, user.id), eq(schema.contacts.email, data.email))).get();
      if (dup) return { fieldErrors: { email: [`Cette adresse est déjà associée à « ${dup.name} ».`] }, values: formValues(form) };
    }
    const id = newId("ct_");
    db.insert(schema.contacts).values({ id, userId: user.id, ...data, convertedAt: data.type === "client" ? todayISO() : null }).run();
    if (data.type !== "supplier") {
      db.insert(schema.interactions).values({ id: newId("ix_"), userId: user.id, contactId: id, type: "first_contact", date: todayISO(), title: data.type === "prospect" ? "Premier contact — fiche prospect créée" : "Fiche client créée", details: data.needs }).run();
    }
    audit(user.id, "contact", id, "create", undefined, data);
    revalidatePath("/clients");
    return { ok: true, id, message: `Fiche « ${data.name} » créée.` };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Référence invalide.", values: formValues(form) };
    throw e;
  }
}

export async function updateContact(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "id");
  const before = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, user.id))).get();
  if (!before) return { error: "Fiche introuvable." };
  const parsed = contactSchema.safeParse({ name: str(form, "name"), email: str(form, "email") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values: formValues(form) };
  const data = readContact(form, user.id);
  db.update(schema.contacts).set({ ...data, type: before.type === "client" && data.type === "prospect" ? "client" : data.type }).where(eq(schema.contacts.id, id)).run();
  audit(user.id, "contact", id, "update", before, data);
  revalidatePath(`/clients/${id}`);
  return { ok: true, message: "Fiche mise à jour." };
}

export async function convertToClient(id: string) {
  const user = await requireUser();
  const c = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, user.id))).get();
  if (!c || c.type === "client") return;
  db.update(schema.contacts).set({ type: "client", convertedAt: todayISO() }).where(eq(schema.contacts.id, id)).run();
  db.insert(schema.interactions).values({ id: newId("ix_"), userId: user.id, contactId: id, type: "converted", date: todayISO(), title: "Prospect devenu client" }).run();
  audit(user.id, "contact", id, "convert");
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
}

export async function archiveContact(id: string, archived: boolean) {
  const user = await requireUser();
  const c = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, user.id))).get();
  if (!c) return;
  db.update(schema.contacts).set({ archived }).where(eq(schema.contacts.id, id)).run();
  audit(user.id, "contact", id, archived ? "archive" : "unarchive");
  revalidatePath("/clients");
}


export async function addInteraction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const contactId = ownedId(schema.contacts, form.get("contactId"), user.id);
  if (!contactId) return { error: "Fiche introuvable." };
  const type = Object.keys(INTERACTION_TYPES).includes(str(form, "type")) ? str(form, "type") : "note";
  const title = str(form, "title") || INTERACTION_TYPES[type];
  const date = isoDate(form, "date") ?? todayISO();
  db.insert(schema.interactions).values({ id: newId("ix_"), userId: user.id, contactId, type, date, title, details: optStr(form, "details") }).run();
  const followUp = isoDate(form, "nextFollowUpAt");
  if (followUp || type === "follow_up") db.update(schema.contacts).set({ nextFollowUpAt: followUp }).where(eq(schema.contacts.id, contactId)).run();
  if (type === "contract_signed") {
    const c = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
    if (c?.type === "prospect") db.update(schema.contacts).set({ type: "client", convertedAt: date }).where(eq(schema.contacts.id, contactId)).run();
  }
  revalidatePath(`/clients/${contactId}`);
  return { ok: true, message: "Événement ajouté à l'historique." };
}

export async function setFollowUp(contactId: string, date: string | null) {
  const user = await requireUser();
  const c = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.userId, user.id))).get();
  if (!c) return;
  db.update(schema.contacts).set({ nextFollowUpAt: date }).where(eq(schema.contacts.id, contactId)).run();
  revalidatePath(`/clients/${contactId}`);
  revalidatePath("/clients");
}

/* ───────────────────────── Opportunités ───────────────────────── */


export async function saveOpportunity(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const contactId = ownedId(schema.contacts, form.get("contactId"), user.id);
    if (!contactId) return { error: "Choisissez un contact." };
    const settings = getSettings(user.id);
    const currency = str(form, "currency") || settings.baseCurrency;
    const amount = money(form, "amount", currency) ?? 0;
    const title = str(form, "title");
    if (!title) return { fieldErrors: { title: ["Donnez un intitulé."] }, values: formValues(form) };
    const stage = Object.keys(OPPORTUNITY_STAGES).includes(str(form, "stage")) ? str(form, "stage") : "lead";
    const probability = Math.max(0, Math.min(100, Number(str(form, "probability") || OPPORTUNITY_STAGES[stage].probability)));
    const id = str(form, "id");
    const values = {
      contactId, title, amount, currency, stage, probability: stage === "won" ? 100 : stage === "lost" ? 0 : probability,
      companyId: ownedId(schema.companies, form.get("companyId"), user.id), activityId: ownedId(schema.activities, form.get("activityId"), user.id),
      expectedCloseDate: isoDate(form, "expectedCloseDate"), agreedTerms: optStr(form, "agreedTerms"), notes: optStr(form, "notes"),
      closedAt: stage === "won" || stage === "lost" ? todayISO() : null,
    };
    if (id) {
      const before = db.select().from(schema.opportunities).where(and(eq(schema.opportunities.id, id), eq(schema.opportunities.userId, user.id))).get();
      if (!before) return { error: "Opportunité introuvable." };
      db.update(schema.opportunities).set(values).where(eq(schema.opportunities.id, id)).run();
      if (before.stage !== stage) stageEvent(user.id, contactId, stage, title, amount, currency);
      audit(user.id, "opportunity", id, "update", before, values);
    } else {
      const nid = newId("opp_");
      db.insert(schema.opportunities).values({ id: nid, userId: user.id, ...values }).run();
      db.insert(schema.interactions).values({ id: newId("ix_"), userId: user.id, contactId, type: "opportunity", date: todayISO(), title: `Nouvelle opportunité : ${title}${amount ? ` (${formatMoney(amount, currency)})` : ""}`, refType: "opportunity", refId: nid }).run();
      audit(user.id, "opportunity", nid, "create", undefined, values);
    }
    revalidatePath("/clients", "layout");
    revalidatePath("/previsionnel");
    return { ok: true, message: "Opportunité enregistrée. Elle n'est comptée comme revenu que dans le scénario optimiste, pondérée par sa probabilité." };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Référence invalide." };
    throw e;
  }
}

function stageEvent(userId: string, contactId: string, stage: string, title: string, amount: number, currency: string) {
  const map: Record<string, [string, string]> = {
    proposal_sent: ["proposal_sent", `Proposition envoyée : ${title}`],
    negotiation: ["follow_up", `Négociation en cours : ${title}`],
    won: ["contract_signed", `Accord obtenu : ${title} (${formatMoney(amount, currency)})`],
    lost: ["note", `Opportunité perdue : ${title}`],
  };
  const ev = map[stage];
  if (!ev) return;
  db.insert(schema.interactions).values({ id: newId("ix_"), userId, contactId, type: ev[0], date: todayISO(), title: ev[1], refType: "opportunity" }).run();
  if (stage === "won") {
    const c = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
    if (c?.type === "prospect") {
      db.update(schema.contacts).set({ type: "client", convertedAt: todayISO() }).where(eq(schema.contacts.id, contactId)).run();
      db.insert(schema.interactions).values({ id: newId("ix_"), userId, contactId, type: "converted", date: todayISO(), title: "Prospect devenu client" }).run();
    }
  }
}

export async function moveOpportunity(id: string, stage: string) {
  const user = await requireUser();
  const o = db.select().from(schema.opportunities).where(and(eq(schema.opportunities.id, id), eq(schema.opportunities.userId, user.id))).get();
  if (!o || !OPPORTUNITY_STAGES[stage] || o.stage === stage) return;
  const probability = stage === "won" ? 100 : stage === "lost" ? 0 : Math.max(o.probability, OPPORTUNITY_STAGES[stage].probability);
  db.update(schema.opportunities).set({ stage, probability, closedAt: stage === "won" || stage === "lost" ? todayISO() : null }).where(eq(schema.opportunities.id, id)).run();
  stageEvent(user.id, o.contactId, stage, o.title, o.amount, o.currency);
  audit(user.id, "opportunity", id, "stage", { stage: o.stage }, { stage });
  revalidatePath("/clients", "layout");
}
