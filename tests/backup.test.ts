/**
 * Sauvegardes : vraie base SQLite dans un dossier temporaire.
 * Vérifie la copie cohérente de la base, la copie incrémentale des fichiers, la rotation, la périodicité (24 h)
 * et la restauration (aller-retour, garde-fous : autre compte, plusieurs comptes, nom invalide).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recap-backup-"));
process.env.DATABASE_FILE = path.join(tmp, "data", "recap.db");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.BACKUP_DIR = path.join(tmp, "sauvegardes");

type DbMod = typeof import("@/lib/db");
type BackupMod = typeof import("@/lib/backup");
let D: DbMod, B: BackupMod;

const USER = "usr_owner";
const contactNames = () => D.db.select({ name: D.schema.contacts.name }).from(D.schema.contacts).all().map((c) => c.name).sort();
const wipeBackups = () => fs.rmSync(process.env.BACKUP_DIR!, { recursive: true, force: true });

beforeAll(async () => {
  D = await import("@/lib/db");
  B = await import("@/lib/backup");
  D.db.insert(D.schema.users).values({ id: USER, email: "owner@test.local", name: "Owner", passwordHash: "x" }).run();
  D.db.insert(D.schema.contacts).values({ id: "ct_a", userId: USER, name: "Client A", type: "client" }).run();
  fs.mkdirSync(path.join(process.env.UPLOAD_DIR!, USER), { recursive: true });
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR!, USER, "doc-1.pdf"), "%PDF-1.4 premier");
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => wipeBackups());

describe("sauvegarde", () => {
  it("copie la base et les fichiers, et liste la sauvegarde", async () => {
    const info = await B.runBackup("manuelle", new Date("2026-10-11T09:00:00"));
    expect(info.kind).toBe("manuelle");
    const list = B.listBackups();
    expect(list.map((b) => b.name)).toEqual([info.name]);
    const copy = path.join(process.env.BACKUP_DIR!, "base", info.name);
    const Database = (await import("better-sqlite3")).default;
    const c = new Database(copy, { readonly: true });
    expect(c.prepare("select name from contacts").all()).toEqual([{ name: "Client A" }]);
    c.close();
    expect(fs.readFileSync(path.join(process.env.BACKUP_DIR!, "fichiers", USER, "doc-1.pdf"), "utf8")).toBe("%PDF-1.4 premier");
  });

  it("n'ajoute que les nouveaux fichiers d'une sauvegarde à l'autre", async () => {
    await B.runBackup("auto", new Date("2026-10-11T09:00:00"));
    const mirrored = path.join(process.env.BACKUP_DIR!, "fichiers", USER, "doc-1.pdf");
    const before = fs.statSync(mirrored).mtimeMs;
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR!, USER, "doc-2.pdf"), "%PDF-1.4 second");
    await B.runBackup("auto", new Date("2026-10-12T09:00:00"));
    expect(fs.statSync(mirrored).mtimeMs).toBe(before);
    expect(fs.existsSync(path.join(process.env.BACKUP_DIR!, "fichiers", USER, "doc-2.pdf"))).toBe(true);
  });

  it("ne relance pas de sauvegarde automatique avant 24 h", async () => {
    const t0 = new Date("2026-10-11T09:00:00");
    expect(await B.backupIfDue(t0)).not.toBeNull();
    expect(await B.backupIfDue(new Date(t0.getTime() + 23 * 3600_000))).toBeNull();
    expect(await B.backupIfDue(new Date(t0.getTime() + 25 * 3600_000))).not.toBeNull();
    expect(B.listBackups()).toHaveLength(2);
  });

  it(`ne garde que les ${30} dernières sauvegardes`, async () => {
    for (let d = 0; d < 33; d++) await B.runBackup("auto", new Date(Date.UTC(2026, 8, 1 + d, 9)));
    const list = B.listBackups();
    expect(list).toHaveLength(B.BACKUPS_KEPT);
    expect(list.at(-1)!.createdAt.slice(0, 10)).toBe("2026-09-04");
  });
});

describe("restauration", () => {
  it("remet les données de la sauvegarde, garde la session et sauvegarde l'état d'avant", async () => {
    D.db.insert(D.schema.sessions).values({ id: "sess_now", userId: USER, expiresAt: "2099-01-01" }).run();
    const snap = await B.runBackup("manuelle", new Date("2026-10-11T09:00:00"));
    D.db.delete(D.schema.contacts).where(eq(D.schema.contacts.id, "ct_a")).run();
    D.db.insert(D.schema.contacts).values({ id: "ct_b", userId: USER, name: "Client B", type: "prospect" }).run();
    fs.rmSync(path.join(process.env.UPLOAD_DIR!, USER, "doc-1.pdf"));
    expect(contactNames()).toEqual(["Client B"]);

    await B.restoreBackup(snap.name, USER);

    expect(contactNames()).toEqual(["Client A"]);
    expect(D.db.select().from(D.schema.sessions).where(eq(D.schema.sessions.id, "sess_now")).get()).toBeTruthy();
    expect(fs.existsSync(path.join(process.env.UPLOAD_DIR!, USER, "doc-1.pdf"))).toBe(true);
    expect(B.listBackups().some((b) => b.kind === "avant-restauration")).toBe(true);
    const fk = (D.db as unknown as { $client: { pragma: (s: string) => unknown[] } }).$client.pragma("foreign_key_check");
    expect(fk).toEqual([]);
  });

  it("refuse un nom invalide ou une sauvegarde d'un autre compte", async () => {
    const snap = await B.runBackup("manuelle");
    await expect(B.restoreBackup("../recap.db", USER)).rejects.toThrow("introuvable");
    await expect(B.restoreBackup(snap.name, "usr_autre")).rejects.toThrow();
    expect(contactNames()).toEqual(["Client A"]);
  });

  it("refuse de restaurer quand l'installation a plusieurs comptes", async () => {
    const snap = await B.runBackup("manuelle");
    D.db.insert(D.schema.users).values({ id: "usr_2", email: "deux@test.local", name: "Deux", passwordHash: "x" }).run();
    try {
      await expect(B.restoreBackup(snap.name, USER)).rejects.toThrow("un seul utilisateur");
    } finally {
      D.db.delete(D.schema.users).where(eq(D.schema.users.id, "usr_2")).run();
    }
  });
});
