import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { newId } from "./ids";
import { saveFile } from "./storage";

export const DOCUMENT_TYPES: Record<string, string> = {
  presentation: "Présentation",
  brochure: "Brochure / plaquette",
  proposal: "Proposition commerciale",
  contract: "Contrat",
  terms: "Conditions générales",
  quote: "Devis",
  invoice: "Facture",
  receipt: "Justificatif de dépense",
  admin: "Document administratif",
  bank_details: "Coordonnées bancaires",
  logo: "Logo",
  template: "Modèle",
  other: "Autre",
};

export const DOCUMENT_USAGES: Record<string, string> = {
  reusable: "Bibliothèque (réutilisable)",
  client: "Lié à un client",
  accounting: "Justificatif comptable",
};

export interface NewDocumentMeta {
  name: string;
  type: string;
  usage?: string;
  companyId?: string | null;
  activityId?: string | null;
  contactId?: string | null;
  description?: string | null;
  tags?: string | null;
}

export function createDocument(userId: string, meta: NewDocumentMeta, file: { buffer: Buffer; fileName: string; mimeType: string }, note?: string) {
  const id = newId("doc_");
  const stored = saveFile(userId, file.buffer, file.fileName);
  db.transaction((tx) => {
    tx.insert(schema.documents).values({
      id, userId, name: meta.name, type: meta.type, usage: meta.usage ?? "reusable", companyId: meta.companyId ?? null,
      activityId: meta.activityId ?? null, contactId: meta.contactId ?? null, description: meta.description ?? null, tags: meta.tags ?? null,
      currentVersion: 1,
    }).run();
    tx.insert(schema.documentVersions).values({
      id: newId("dv_"), documentId: id, version: 1, fileName: file.fileName, storagePath: stored.storagePath,
      mimeType: file.mimeType, size: stored.size, sha256: stored.sha256, note: note ?? null,
    }).run();
  });
  return id;
}

/** Remplace un document en conservant l'historique : nouvelle version, l'organisation reste intacte. */
export function addDocumentVersion(userId: string, documentId: string, file: { buffer: Buffer; fileName: string; mimeType: string }, note?: string) {
  const doc = db.select().from(schema.documents).where(and(eq(schema.documents.id, documentId), eq(schema.documents.userId, userId))).get();
  if (!doc) throw new Error("Document introuvable");
  const stored = saveFile(userId, file.buffer, file.fileName);
  const last = db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, documentId)).orderBy(desc(schema.documentVersions.version)).get();
  const version = (last?.version ?? 0) + 1;
  db.transaction((tx) => {
    tx.insert(schema.documentVersions).values({
      id: newId("dv_"), documentId, version, fileName: file.fileName, storagePath: stored.storagePath, mimeType: file.mimeType,
      size: stored.size, sha256: stored.sha256, note: note ?? null,
    }).run();
    tx.update(schema.documents).set({ currentVersion: version, updatedAt: new Date().toISOString() }).where(eq(schema.documents.id, documentId)).run();
  });
  return version;
}

export function currentVersion(documentId: string) {
  const doc = db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).get();
  if (!doc) return null;
  return db.select().from(schema.documentVersions)
    .where(and(eq(schema.documentVersions.documentId, documentId), eq(schema.documentVersions.version, doc.currentVersion))).get() ?? null;
}
