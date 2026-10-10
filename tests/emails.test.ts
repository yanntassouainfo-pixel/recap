/**
 * Envoi d'emails : base SQLite en mémoire + transport factice.
 * Vérifie qu'un email n'est « envoyé » QUE sur confirmation (messageId), que les pièces jointes partent à la
 * version exacte figée, et que l'historique du contact / la facture ne sont mis à jour qu'après un envoi confirmé.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { MailTransport, OutgoingMessage } from "@/lib/mailer";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async () => {
  const { audit } = await import("@/lib/audit");
  return { requireUser: async () => ({ id: "usr_mail", name: "Test", email: "usr_mail@test.local" }), audit };
});

process.env.DATABASE_FILE = ":memory:";
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-emails-"));
process.env.UPLOAD_DIR = uploadDir;
delete process.env.SMTP_HOST;

type Mod = {
  db: typeof import("@/lib/db").db;
  schema: typeof import("@/lib/db").schema;
  mailer: typeof import("@/lib/mailer");
  documents: typeof import("@/lib/documents");
  storage: typeof import("@/lib/storage");
};
let m: Mod;

const U = "usr_mail";
const OTHER = "usr_other";
let docId = "";
let identityOk = "";
let identityNo = "";
let otherIdentity = "";
let templateProposal = "";
let invoiceDraft = "";

beforeAll(async () => {
  const dbm = await import("@/lib/db");
  m = { db: dbm.db, schema: dbm.schema, mailer: await import("@/lib/mailer"), documents: await import("@/lib/documents"), storage: await import("@/lib/storage") };
  const { db, schema } = m;
  for (const id of [U, OTHER]) {
    db.insert(schema.users).values({ id, email: `${id}@test.local`, name: id, passwordHash: "x" }).onConflictDoNothing().run();
    db.insert(schema.companies).values({ id: `co_${id}`, userId: id, name: `Structure ${id}`, currency: "XOF" }).onConflictDoNothing().run();
  }
  db.insert(schema.contacts).values({ id: "ct_mail", userId: U, type: "prospect", name: "Awa Koné", email: "awa@client.ci" }).onConflictDoNothing().run();
  identityOk = "snd_ok";
  identityNo = "snd_no";
  otherIdentity = "snd_other";
  db.insert(schema.senderIdentities).values([
    { id: identityOk, userId: U, companyId: `co_${U}`, fromName: "Parole & Présence", fromEmail: "bonjour@pp.ci", authorized: true },
    { id: identityNo, userId: U, companyId: `co_${U}`, fromName: "Pas autorisée", fromEmail: "x@pp.ci", authorized: false },
    { id: otherIdentity, userId: OTHER, companyId: `co_${OTHER}`, fromName: "Autre", fromEmail: "autre@ailleurs.ci", authorized: true },
  ]).onConflictDoNothing().run();
  templateProposal = "tpl_prop";
  db.insert(schema.emailTemplates).values({ id: templateProposal, userId: U, purpose: "proposal", name: "Proposition", subject: "s", body: "b" }).onConflictDoNothing().run();

  // Document à deux versions : l'email doit partir avec la version 1 figée, pas la version actuelle.
  docId = m.documents.createDocument(U, { name: "Proposition", type: "proposal" }, { buffer: Buffer.from("VERSION-1"), fileName: "proposition.pdf", mimeType: "application/pdf" });
  m.documents.addDocumentVersion(U, docId, { buffer: Buffer.from("VERSION-2-PLUS-LONGUE"), fileName: "proposition-v2.pdf", mimeType: "application/pdf" });

  invoiceDraft = "inv_mail";
  db.insert(schema.invoices).values({ id: invoiceDraft, userId: U, companyId: `co_${U}`, contactId: "ct_mail", number: "FAC-1", issueDate: "2026-10-01", dueDate: "2026-10-31", currency: "XOF", total: 100_000, status: "draft" }).onConflictDoNothing().run();
});

afterAll(() => {
  m.mailer.setTransportForTests(null);
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

class FakeTransport implements MailTransport {
  sent: OutgoingMessage[] = [];
  constructor(private behavior: "ok" | "throw" | "no-id" = "ok") {}
  async sendMail(message: OutgoingMessage) {
    this.sent.push(message);
    if (this.behavior === "throw") throw new Error("550 boîte inexistante");
    if (this.behavior === "no-id") return {};
    return { messageId: `<${this.sent.length}@fake.test>` };
  }
}

let n = 0;
function makeEmail(opts: { identity?: string | null; templateId?: string | null; invoiceId?: string | null; versions?: number[]; userId?: string } = {}) {
  const { db, schema } = m;
  const id = `eml_t${++n}`;
  const userId = opts.userId ?? U;
  db.insert(schema.emails).values({
    id, userId, companyId: `co_${userId}`, senderIdentityId: opts.identity === undefined ? identityOk : opts.identity,
    contactId: userId === U ? "ct_mail" : null, templateId: opts.templateId ?? null, invoiceId: opts.invoiceId ?? null,
    to: "awa@client.ci", subject: `Sujet ${n}`, body: "Bonjour", status: "draft",
  }).run();
  for (const v of opts.versions ?? [1, 2]) {
    const ver = db.select().from(schema.documentVersions).where(and(eq(schema.documentVersions.documentId, docId), eq(schema.documentVersions.version, v))).get()!;
    db.insert(schema.emailAttachments).values({ id: `att_${n}_${v}`, emailId: id, documentId: docId, documentVersionId: ver.id, fileName: ver.fileName, storagePath: ver.storagePath, mimeType: ver.mimeType, size: ver.size }).run();
  }
  return id;
}
const emailRow = (id: string) => m.db.select().from(m.schema.emails).where(eq(m.schema.emails.id, id)).get()!;
const interactionsFor = (id: string) => m.db.select().from(m.schema.interactions).where(and(eq(m.schema.interactions.refType, "email"), eq(m.schema.interactions.refId, id))).all();

describe("envoi confirmé", () => {
  let t: FakeTransport;
  beforeEach(() => { t = new FakeTransport("ok"); m.mailer.setTransportForTests(t); });

  it("envoie plusieurs pièces jointes à leur version exacte et marque envoyé avec l'identifiant", async () => {
    const id = makeEmail({ versions: [1, 2], templateId: templateProposal });
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("sent");
    expect(t.sent).toHaveLength(1);
    const msg = t.sent[0];
    expect(msg.from).toBe('"Parole & Présence" <bonjour@pp.ci>');
    expect(msg.attachments.map((a) => a.filename)).toEqual(["proposition.pdf", "proposition-v2.pdf"]);
    expect(msg.attachments[0].content.toString()).toBe("VERSION-1");
    expect(msg.attachments[1].content.toString()).toBe("VERSION-2-PLUS-LONGUE");
    const row = emailRow(id);
    expect(row.status).toBe("sent");
    expect(row.providerMessageId).toBe("<1@fake.test>");
    expect(row.sentAt).toBeTruthy();
    const ix = interactionsFor(id);
    expect(ix).toHaveLength(1);
    expect(ix[0].type).toBe("proposal_sent"); // déduit de l'objet du modèle
    expect(ix[0].details).toContain("2 pièces jointes");
  });

  it("ne renvoie pas un email déjà envoyé", async () => {
    const id = makeEmail({ versions: [] });
    await m.mailer.deliverEmail(U, id);
    const again = await m.mailer.deliverEmail(U, id);
    expect(again.status).toBe("sent");
    expect(t.sent).toHaveLength(1);
    expect(interactionsFor(id)).toHaveLength(1);
  });

  it("passe la facture brouillon au statut envoyé", async () => {
    const id = makeEmail({ invoiceId: invoiceDraft, versions: [] });
    await m.mailer.deliverEmail(U, id);
    const inv = m.db.select().from(m.schema.invoices).where(eq(m.schema.invoices.id, invoiceDraft)).get()!;
    expect(inv.status).toBe("sent");
    expect(inv.sentAt).toBeTruthy();
  });
});

describe("échecs : jamais marqué envoyé", () => {
  it("transport en erreur → échec avec le message, aucun historique", async () => {
    m.mailer.setTransportForTests(new FakeTransport("throw"));
    const id = makeEmail();
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("failed");
    const row = emailRow(id);
    expect(row.status).toBe("failed");
    expect(row.error).toContain("550 boîte inexistante");
    expect(row.sentAt).toBeNull();
    expect(interactionsFor(id)).toHaveLength(0);
  });

  it("pas d'identifiant de message → échec", async () => {
    m.mailer.setTransportForTests(new FakeTransport("no-id"));
    const id = makeEmail();
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("failed");
    expect(emailRow(id).status).toBe("failed");
    expect(emailRow(id).providerMessageId).toBeNull();
  });

  it("un échec peut être renvoyé ensuite avec les mêmes pièces jointes", async () => {
    m.mailer.setTransportForTests(new FakeTransport("throw"));
    const id = makeEmail({ versions: [1] });
    await m.mailer.deliverEmail(U, id);
    const ok = new FakeTransport("ok");
    m.mailer.setTransportForTests(ok);
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("sent");
    expect(ok.sent[0].attachments[0].content.toString()).toBe("VERSION-1");
    expect(emailRow(id).error).toBeNull();
  });

  it("adresse non autorisée → échec sans contacter le serveur", async () => {
    const t = new FakeTransport("ok");
    m.mailer.setTransportForTests(t);
    const id = makeEmail({ identity: identityNo });
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/autorisée/);
    expect(t.sent).toHaveLength(0);
  });

  it("identité d'un autre utilisateur → refusée", async () => {
    const t = new FakeTransport("ok");
    m.mailer.setTransportForTests(t);
    const id = makeEmail({ identity: otherIdentity });
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("failed");
    expect(t.sent).toHaveLength(0);
  });

  it("un autre utilisateur ne peut pas déclencher l'envoi", async () => {
    const t = new FakeTransport("ok");
    m.mailer.setTransportForTests(t);
    const id = makeEmail();
    const r = await m.mailer.deliverEmail(OTHER, id);
    expect(r.status).toBe("failed");
    expect(t.sent).toHaveLength(0);
    expect(emailRow(id).status).toBe("draft");
  });

  it("pièce jointe manquante sur le disque → échec explicite", async () => {
    const t = new FakeTransport("ok");
    m.mailer.setTransportForTests(t);
    const id = makeEmail({ versions: [] });
    m.db.insert(m.schema.emailAttachments).values({ id: `att_missing_${id}`, emailId: id, fileName: "absent.pdf", storagePath: `${U}/absent.pdf`, mimeType: "application/pdf", size: 10 }).run();
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("absent.pdf");
    expect(t.sent).toHaveLength(0);
  });

  it("sans configuration SMTP → reste un brouillon", async () => {
    m.mailer.setTransportForTests(null);
    expect(m.mailer.isMailerConfigured()).toBe(false);
    const id = makeEmail();
    const r = await m.mailer.deliverEmail(U, id);
    expect(r.status).toBe("draft");
    expect(emailRow(id).status).toBe("draft");
  });
});

describe("composeur (action serveur submitEmail)", () => {
  const form = (entries: [string, string | File][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };

  it("enregistre un brouillon avec la version choisie et classe le fichier joint depuis l'ordinateur", async () => {
    const { submitEmail } = await import("@/app/actions/emails");
    const r = await submitEmail({}, form([
      ["intent", "draft"], ["companyId", `co_${U}`], ["senderIdentityId", identityOk], ["contactId", "ct_mail"],
      ["to", "awa@client.ci"], ["subject", "Proposition"], ["body", "Bonjour"],
      ["doc", `${docId}:1`],
      ["file", new File(["BRIEF"], "brief client.pdf", { type: "application/pdf" })],
    ]));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/pas été envoyé/);
    const row = emailRow(r.id!);
    expect(row.status).toBe("draft");
    const atts = m.db.select().from(m.schema.emailAttachments).where(eq(m.schema.emailAttachments.emailId, r.id!)).all();
    expect(atts).toHaveLength(2);
    const lib = atts.find((a) => a.documentId === docId)!;
    expect(m.storage.readFile(U, lib.storagePath)?.toString()).toBe("VERSION-1");
    const uploaded = atts.find((a) => a.documentId !== docId)!;
    const doc = m.db.select().from(m.schema.documents).where(eq(m.schema.documents.id, uploaded.documentId!)).get()!;
    expect(doc.usage).toBe("client");
    expect(doc.contactId).toBe("ct_mail");
  });

  it("envoie avec le PDF de facture généré et rapporte la confirmation", async () => {
    const t = new FakeTransport("ok");
    m.mailer.setTransportForTests(t);
    m.db.insert(m.schema.invoices).values({ id: "inv_pdf", userId: U, companyId: `co_${U}`, contactId: "ct_mail", number: "FAC-PDF", issueDate: "2026-10-01", dueDate: "2026-10-31", currency: "XOF", total: 50_000, status: "draft" }).onConflictDoNothing().run();
    const { submitEmail } = await import("@/app/actions/emails");
    const r = await submitEmail({}, form([
      ["intent", "send"], ["companyId", `co_${U}`], ["senderIdentityId", identityOk], ["contactId", "ct_mail"], ["invoiceId", "inv_pdf"],
      ["includeInvoicePdf", "1"], ["to", "awa@client.ci, compta@client.ci"], ["cc", ""], ["subject", "Facture FAC-PDF"], ["body", "Ci-joint"],
    ]));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/confirmé/);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toBe("awa@client.ci, compta@client.ci");
    expect(t.sent[0].attachments[0].filename).toBe("Facture-FAC-PDF.pdf");
    expect(t.sent[0].attachments[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(emailRow(r.id!).status).toBe("sent");
  });

  it("refuse l'envoi avec une adresse invalide ou non autorisée", async () => {
    m.mailer.setTransportForTests(new FakeTransport("ok"));
    const { submitEmail } = await import("@/app/actions/emails");
    const bad = await submitEmail({}, form([["intent", "send"], ["companyId", `co_${U}`], ["senderIdentityId", identityOk], ["to", "pas-une-adresse"], ["subject", "x"], ["body", "y"]]));
    expect(bad.fieldErrors?.to?.[0]).toMatch(/invalide/);
    const unauth = await submitEmail({}, form([["intent", "send"], ["companyId", `co_${U}`], ["senderIdentityId", identityNo], ["to", "a@b.ci"], ["subject", "x"], ["body", "y"]]));
    expect(unauth.fieldErrors?.senderIdentityId?.[0]).toMatch(/autorisée/);
  });

  it("refuse les références d'un autre utilisateur", async () => {
    const { submitEmail } = await import("@/app/actions/emails");
    const r = await submitEmail({}, form([["intent", "draft"], ["companyId", `co_${U}`], ["senderIdentityId", otherIdentity], ["to", "a@b.ci"], ["subject", "x"], ["body", "y"]]));
    expect(r.error).toMatch(/invalide/);
  });

  it("garde un échec d'envoi visible avec son identifiant", async () => {
    m.mailer.setTransportForTests(new FakeTransport("throw"));
    const { submitEmail } = await import("@/app/actions/emails");
    const r = await submitEmail({}, form([["intent", "send"], ["companyId", `co_${U}`], ["senderIdentityId", identityOk], ["to", "a@b.ci"], ["subject", "x"], ["body", "y"]]));
    expect(r.ok).toBeFalsy();
    expect(r.id).toBeTruthy();
    expect(r.error).toMatch(/n'a pas été envoyé/);
    expect(emailRow(r.id!).status).toBe("failed");
  });
});
