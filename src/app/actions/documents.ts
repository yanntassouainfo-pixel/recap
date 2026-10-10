"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser, audit } from "@/lib/auth";
import { formValues, optStr, OwnershipError, ownedId, str } from "@/lib/guards";
import type { ActionState } from "@/lib/action-state";
import { addDocumentVersion, createDocument, DOCUMENT_TYPES, DOCUMENT_USAGES } from "@/lib/documents";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, guessMime } from "@/lib/storage";

function fileError(file: File): string | null {
  if (file.size === 0) return `« ${file.name} » est vide.`;
  if (file.size > MAX_UPLOAD_BYTES) return `« ${file.name} » dépasse 15 Mo.`;
  const mime = file.type || guessMime(file.name);
  if (!ALLOWED_MIME.has(mime)) return `« ${file.name} » : format non pris en charge (PDF, images, Word, PowerPoint, Excel, texte, CSV, ZIP).`;
  return null;
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || fileName;
}

function cleanTags(raw: string | null): string | null {
  if (!raw) return null;
  const tags = [...new Set(raw.split(/[,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return tags.length ? tags.join(", ") : null;
}

function readMeta(form: FormData, userId: string) {
  const type = Object.keys(DOCUMENT_TYPES).includes(str(form, "type")) ? str(form, "type") : "other";
  const usage = Object.keys(DOCUMENT_USAGES).includes(str(form, "usage")) ? str(form, "usage") : "reusable";
  return {
    type, usage,
    companyId: ownedId(schema.companies, form.get("companyId"), userId),
    activityId: ownedId(schema.activities, form.get("activityId"), userId),
    contactId: ownedId(schema.contacts, form.get("contactId"), userId),
    description: optStr(form, "description"),
    tags: cleanTags(optStr(form, "tags")),
  };
}

/** Téléverse un ou plusieurs fichiers dans la bibliothèque avec les mêmes informations de classement. */
export async function uploadDocuments(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choisissez au moins un fichier.", values: formValues(form) };
  for (const f of files) {
    const err = fileError(f);
    if (err) return { error: err, values: formValues(form) };
  }
  try {
    const meta = readMeta(form, user.id);
    const name = str(form, "name");
    const ids: string[] = [];
    for (const f of files) {
      const id = createDocument(user.id, { ...meta, name: files.length === 1 && name ? name : baseName(f.name) }, {
        buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name, mimeType: f.type || guessMime(f.name),
      }, optStr(form, "note") ?? "Version initiale");
      ids.push(id);
      audit(user.id, "document", id, "create", undefined, { ...meta, fileName: f.name, size: f.size });
    }
    revalidatePath("/documents");
    if (meta.contactId) revalidatePath(`/clients/${meta.contactId}`);
    return { ok: true, id: ids[0], message: files.length > 1 ? `${files.length} documents ajoutés à la bibliothèque.` : "Document ajouté à la bibliothèque." };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Une des références sélectionnées est invalide.", values: formValues(form) };
    console.error(e);
    return { error: "Le téléversement a échoué. Aucun fichier n'a été enregistré.", values: formValues(form) };
  }
}

/** Nouvelle version : l'historique est conservé, le classement reste identique. */
export async function addVersion(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "id");
  const doc = db.select().from(schema.documents).where(and(eq(schema.documents.id, id), eq(schema.documents.userId, user.id))).get();
  if (!doc) return { error: "Document introuvable." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez le fichier de la nouvelle version." };
  const err = fileError(file);
  if (err) return { error: err };
  try {
    const version = addDocumentVersion(user.id, id, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || guessMime(file.name) }, optStr(form, "note") ?? undefined);
    audit(user.id, "document", id, "new_version", { version: doc.currentVersion }, { version, fileName: file.name });
    revalidatePath("/documents");
    return { ok: true, id, message: `Version ${version} enregistrée. Les versions précédentes restent consultables.` };
  } catch (e) {
    console.error(e);
    return { error: "L'enregistrement de la nouvelle version a échoué." };
  }
}

/** Renommer / reclasser. */
export async function updateDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "id");
  const before = db.select().from(schema.documents).where(and(eq(schema.documents.id, id), eq(schema.documents.userId, user.id))).get();
  if (!before) return { error: "Document introuvable." };
  const name = str(form, "name");
  if (!name) return { fieldErrors: { name: ["Donnez un nom au document."] }, values: formValues(form) };
  try {
    const meta = readMeta(form, user.id);
    db.update(schema.documents).set({ ...meta, name, updatedAt: new Date().toISOString() }).where(eq(schema.documents.id, id)).run();
    audit(user.id, "document", id, "update", before, { ...meta, name });
    revalidatePath("/documents");
    return { ok: true, id, message: "Document mis à jour." };
  } catch (e) {
    if (e instanceof OwnershipError) return { error: "Une des références sélectionnées est invalide.", values: formValues(form) };
    throw e;
  }
}

export async function archiveDocument(id: string, archived: boolean): Promise<ActionState> {
  const user = await requireUser();
  const doc = db.select().from(schema.documents).where(and(eq(schema.documents.id, id), eq(schema.documents.userId, user.id))).get();
  if (!doc) return { error: "Document introuvable." };
  db.update(schema.documents).set({ archived, updatedAt: new Date().toISOString() }).where(eq(schema.documents.id, id)).run();
  audit(user.id, "document", id, archived ? "archive" : "unarchive");
  revalidatePath("/documents");
  return { ok: true, message: archived ? "Document archivé. Il n'est plus proposé, mais reste consultable dans les archives." : "Document restauré." };
}
