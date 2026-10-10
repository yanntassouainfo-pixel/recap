/**
 * Crée (ou recrée) le compte de démonstration avec des données réalistes.
 * Identifiants : voir README.md (section « Compte de démonstration »).
 */
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase, __setDb } from "../src/lib/db";
import * as schema from "../src/lib/db/schema";
import { newId } from "../src/lib/ids";
import { createDemoData } from "../src/lib/demo";
import { scryptSync, randomBytes } from "node:crypto";
import { deleteUserFiles } from "../src/lib/storage";

const EMAIL = "demo@recap.local";
const PASSWORD = "demo-recap-2026";

const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "recap.db");
const { db } = openDatabase(file);
__setDb(db);

const existing = db.select().from(schema.users).where(eq(schema.users.email, EMAIL)).get();
if (existing) {
  db.delete(schema.users).where(eq(schema.users.id, existing.id)).run();
  deleteUserFiles(existing.id);
}
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("hex")}$${scryptSync(PASSWORD, salt, 64).toString("hex")}`;
const userId = newId("usr_");
db.insert(schema.users).values({ id: userId, email: EMAIL, name: "Yann Démo", passwordHash: hash }).run();
db.insert(schema.settings).values({ userId }).run();
createDemoData(db, userId);
console.log(`Compte de démonstration prêt : ${EMAIL}`);
