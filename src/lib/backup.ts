/**
 * Sauvegardes automatiques de l'installation : copie cohérente de la base SQLite (API de sauvegarde en ligne, sans
 * arrêter l'app) + copie incrémentale des fichiers envoyés. Au démarrage du serveur puis toutes les 24 h.
 *
 * Dossier : BACKUP_DIR, sinon « sauvegardes/ » à côté de la base.
 *   <dossier>/base/recap_AAAA-MM-JJ_HH-MM-SS_<type>.db   (30 dernières conservées)
 *   <dossier>/fichiers/<userId>/…                         (ajouts seulement : les fichiers stockés sont immuables)
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { db } from "./db";

export type BackupKind = "auto" | "manuelle" | "avant-restauration";
export interface BackupInfo { name: string; createdAt: string; size: number; kind: BackupKind }

export const BACKUPS_KEPT = 30;
const INTERVAL_MS = 24 * 3600 * 1000;
const NAME_RE = /^recap_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})_(auto|manuelle|avant-restauration)\.db$/;

const sqlite = () => (db as unknown as { $client: Database.Database }).$client;
const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));

export function backupDir(): string {
  if (process.env.BACKUP_DIR) return path.resolve(process.env.BACKUP_DIR);
  const file = process.env.DATABASE_FILE;
  return file && file !== ":memory:" ? path.join(path.dirname(path.resolve(file)), "..", "sauvegardes") : path.join(process.cwd(), "data", "sauvegardes");
}
const baseDir = () => path.join(backupDir(), "base");
const filesDir = () => path.join(backupDir(), "fichiers");

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function listBackups(): BackupInfo[] {
  let names: string[] = [];
  try { names = fs.readdirSync(baseDir()); } catch { return []; }
  return names
    .map((name) => {
      const m = NAME_RE.exec(name);
      if (!m) return null;
      const createdAt = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`).toISOString();
      return { name, createdAt, size: fs.statSync(path.join(baseDir(), name)).size, kind: m[5] as BackupKind };
    })
    .filter((b): b is BackupInfo => b !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Copie les fichiers envoyés absents (ou de taille différente) de la sauvegarde. Renvoie le nombre copié. */
function mirrorFiles(from: string, to: string): number {
  if (!fs.existsSync(from)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const src = path.join(from, entry.name), dest = path.join(to, entry.name);
    if (entry.isDirectory()) { copied += mirrorFiles(src, dest); continue; }
    if (!entry.isFile()) continue;
    const exists = fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size;
    if (!exists) { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(src, dest); copied++; }
  }
  return copied;
}

function prune() {
  for (const old of listBackups().slice(BACKUPS_KEPT)) fs.rmSync(path.join(baseDir(), old.name), { force: true });
}

let running: Promise<BackupInfo> | null = null;

export function runBackup(kind: BackupKind, now = new Date()): Promise<BackupInfo> {
  if (running) return running; // une seule sauvegarde à la fois
  running = (async () => {
    fs.mkdirSync(baseDir(), { recursive: true });
    let name = `recap_${stamp(now)}_${kind}.db`;
    for (let i = 1; fs.existsSync(path.join(baseDir(), name)); i++) name = `recap_${stamp(new Date(now.getTime() + i * 1000))}_${kind}.db`;
    const final = path.join(baseDir(), name), part = `${final}.part`;
    await sqlite().backup(part);
    fs.renameSync(part, final);
    mirrorFiles(uploadRoot(), filesDir());
    prune();
    state.lastError = null;
    return { name, createdAt: now.toISOString(), size: fs.statSync(final).size, kind };
  })().finally(() => { running = null; });
  return running;
}

const state = globalThis as unknown as { lastError?: string | null; __recapBackupTimer?: NodeJS.Timeout };
export const lastBackupError = () => state.lastError ?? null;

/** Lance une sauvegarde automatique si la dernière date de plus de 24 h. */
export async function backupIfDue(now = new Date()): Promise<BackupInfo | null> {
  const last = listBackups()[0];
  if (last && now.getTime() - new Date(last.createdAt).getTime() < INTERVAL_MS) return null;
  try { return await runBackup("auto", now); } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    console.error("[sauvegarde]", state.lastError);
    return null;
  }
}

/** Planificateur : 20 s après le démarrage, puis vérification toutes les heures (une sauvegarde par 24 h). */
export function startBackupScheduler() {
  if (state.__recapBackupTimer || process.env.DATABASE_FILE === ":memory:" || process.env.RECAP_BACKUPS === "off") return;
  setTimeout(() => void backupIfDue(), 20_000).unref();
  state.__recapBackupTimer = setInterval(() => void backupIfDue(), 3600_000);
  state.__recapBackupTimer.unref();
}

/**
 * Restaure une sauvegarde à la place des données actuelles (réservé à une installation à un seul utilisateur).
 * Sauvegarde d'abord l'état actuel, puis remplace le contenu de chaque table en une transaction.
 * Les sessions ne sont pas restaurées : l'utilisateur reste connecté.
 */
export async function restoreBackup(name: string, currentUserId: string): Promise<{ tables: number; files: number }> {
  if (!NAME_RE.test(name) || !listBackups().some((b) => b.name === name)) throw new Error("Sauvegarde introuvable.");
  const file = path.join(baseDir(), name);
  const live = sqlite();

  const src = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (src.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Cette sauvegarde est endommagée.");
    const migrations = (d: Database.Database) =>
      (d.prepare("select hash from __drizzle_migrations order by id").all() as { hash: string }[]).map((r) => r.hash).join(",");
    if (migrations(src) !== migrations(live)) throw new Error("Cette sauvegarde vient d'une autre version de Recap : restauration impossible.");
    const users = live.prepare("select id from users").all() as { id: string }[];
    if (users.length > 1 || (users[0] && users[0].id !== currentUserId)) throw new Error("La restauration est réservée à une installation à un seul utilisateur.");
    if (!src.prepare("select 1 from users where id = ?").get(currentUserId)) throw new Error("Cette sauvegarde appartient à un autre compte.");
  } finally {
    src.close();
  }

  await runBackup("avant-restauration");

  const tables = (live.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not in ('__drizzle_migrations','sessions')").all() as { name: string }[]).map((t) => t.name);
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  live.pragma("foreign_keys = OFF");
  live.prepare("ATTACH DATABASE ? AS b").run(file);
  try {
    live.transaction(() => {
      for (const t of tables) {
        const cols = (live.prepare("select name from pragma_table_info(?, 'main')").all(t) as { name: string }[]).map((c) => c.name);
        const srcCols = new Set((live.prepare("select name from pragma_table_info(?, 'b')").all(t) as { name: string }[]).map((c) => c.name));
        const shared = cols.filter((c) => srcCols.has(c)).map(q).join(", ");
        live.exec(`DELETE FROM main.${q(t)}`);
        if (shared) live.exec(`INSERT INTO main.${q(t)} (${shared}) SELECT ${shared} FROM b.${q(t)}`);
      }
      // Sessions orphelines (utilisateur absent de la sauvegarde) : supprimées.
      live.exec("DELETE FROM main.sessions WHERE user_id NOT IN (SELECT id FROM main.users)");
    })();
  } finally {
    live.exec("DETACH DATABASE b");
    live.pragma("foreign_keys = ON");
  }
  const files = mirrorFiles(filesDir(), uploadRoot());
  return { tables: tables.length, files };
}

export const backupLocationLabel = () => {
  const dir = backupDir();
  const icloud = path.join(process.env.HOME ?? "", "Library", "Mobile Documents", "com~apple~CloudDocs");
  if (process.env.HOME && dir.startsWith(icloud)) return `iCloud Drive › ${path.relative(icloud, dir).split(path.sep).join(" › ")}`;
  return dir.replace(process.env.HOME ?? "\0", "~");
};
