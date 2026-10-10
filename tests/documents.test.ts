import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

process.env.DATABASE_FILE = ":memory:";
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-docs-"));
process.env.UPLOAD_DIR = uploadDir;

let m: {
  db: typeof import("@/lib/db").db;
  schema: typeof import("@/lib/db").schema;
  documents: typeof import("@/lib/documents");
  storage: typeof import("@/lib/storage");
  serve: typeof import("@/components/documents/serve-file");
};
const U = "usr_docs";
const OTHER = "usr_docs_other";

beforeAll(async () => {
  const dbm = await import("@/lib/db");
  m = { db: dbm.db, schema: dbm.schema, documents: await import("@/lib/documents"), storage: await import("@/lib/storage"), serve: await import("@/components/documents/serve-file") };
  for (const id of [U, OTHER]) m.db.insert(m.schema.users).values({ id, email: `${id}@test.local`, name: id, passwordHash: "x" }).onConflictDoNothing().run();
});

afterAll(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

describe("versions de documents", () => {
  it("numérote les versions, garde l'historique et le classement", () => {
    const id = m.documents.createDocument(U, { name: "CGV", type: "terms", usage: "reusable", tags: "juridique" }, { buffer: Buffer.from("v1"), fileName: "cgv.pdf", mimeType: "application/pdf" }, "Version initiale");
    expect(m.documents.addDocumentVersion(U, id, { buffer: Buffer.from("v2"), fileName: "cgv-2026.pdf", mimeType: "application/pdf" }, "Tarifs 2026")).toBe(2);
    expect(m.documents.addDocumentVersion(U, id, { buffer: Buffer.from("v3"), fileName: "cgv-2027.pdf", mimeType: "application/pdf" })).toBe(3);
    const doc = m.db.select().from(m.schema.documents).where(eq(m.schema.documents.id, id)).get()!;
    expect(doc.currentVersion).toBe(3);
    expect(doc.tags).toBe("juridique");
    const versions = m.db.select().from(m.schema.documentVersions).where(eq(m.schema.documentVersions.documentId, id)).all();
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);
    const v1 = versions.find((v) => v.version === 1)!;
    expect(m.storage.readFile(U, v1.storagePath)?.toString()).toBe("v1"); // l'ancienne version reste lisible
    expect(v1.sha256).toHaveLength(64);
    expect(m.documents.currentVersion(id)?.fileName).toBe("cgv-2027.pdf");
  });

  it("refuse d'ajouter une version au document d'un autre utilisateur", () => {
    const id = m.documents.createDocument(U, { name: "Privé", type: "other" }, { buffer: Buffer.from("x"), fileName: "prive.txt", mimeType: "text/plain" });
    expect(() => m.documents.addDocumentVersion(OTHER, id, { buffer: Buffer.from("pirate"), fileName: "p.txt", mimeType: "text/plain" })).toThrow();
  });
});

describe("stockage privé", () => {
  it("bloque la lecture hors du dossier de l'utilisateur", () => {
    const stored = m.storage.saveFile(U, Buffer.from("secret"), "secret.txt");
    expect(m.storage.readFile(U, stored.storagePath)?.toString()).toBe("secret");
    expect(m.storage.readFile(OTHER, stored.storagePath)).toBeNull();
    expect(m.storage.readFile(U, `${U}/../${OTHER}/x.txt`)).toBeNull();
    expect(m.storage.readFile(U, "../../etc/passwd")).toBeNull();
  });

  it("nettoie les noms de fichiers", () => {
    expect(m.storage.safeFileName("Proposition commerciale — été 2026.pdf")).toBe("Proposition-commerciale-ete-2026.pdf");
    expect(m.storage.safeFileName("../../etc/passwd")).toBe("..-..-etc-passwd");
  });
});

describe("téléchargement", () => {
  it("encode le nom de fichier (accents, espaces)", () => {
    const h = m.serve.contentDisposition("Contrat d'accompagnement — été.pdf", false);
    expect(h).toContain('attachment; filename="Contrat d\'accompagnement _ ete.pdf"');
    expect(h).toContain("filename*=UTF-8''Contrat%20d'accompagnement%20%E2%80%94%20%C3%A9t%C3%A9.pdf");
  });

  it("n'affiche dans le navigateur que les formats sûrs", () => {
    const pdf = m.serve.fileResponse(Buffer.from("%PDF"), "a.pdf", "application/pdf", true);
    expect(pdf.headers.get("content-disposition")).toMatch(/^inline/);
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    const svg = m.serve.fileResponse(Buffer.from("<svg/>"), "logo.svg", "image/svg+xml", true);
    expect(svg.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(svg.headers.get("content-type")).toBe("application/octet-stream");
    const html = m.serve.fileResponse(Buffer.from("<p>"), "x.html", "text/html", true);
    expect(html.headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
