import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __recapDb?: DB; __recapSqlite?: Database.Database };

export function openDatabase(file: string): { db: DB; sqlite: Database.Database } {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, sqlite };
}

function init(): DB {
  if (!globalForDb.__recapDb) {
    const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "recap.db");
    const { db, sqlite } = openDatabase(file);
    globalForDb.__recapDb = db;
    globalForDb.__recapSqlite = sqlite;
  }
  return globalForDb.__recapDb;
}

/** Connexion paresseuse : la base n'est ouverte qu'au premier accès (évite d'ouvrir pendant le build). */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = init() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

/** Pour les tests : remplace la connexion globale. */
export function __setDb(next: DB) {
  globalForDb.__recapDb = next;
}

export { schema };
