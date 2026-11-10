/**
 * Affiche un lien de réinitialisation du mot de passe (valable 60 min, une seule fois), sans envoi d'email.
 *   npm run reset-password -- votre@email                         (base du projet : data/recap.db)
 *   DATABASE_FILE=… APP_URL=http://localhost:3217 npm run reset-password -- votre@email
 */
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase, __setDb, schema } from "../src/lib/db";
import { createResetToken, RESET_LINK_MINUTES } from "../src/lib/password-reset";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) { console.error("Usage : npm run reset-password -- votre@email"); process.exit(1); }
const { db } = openDatabase(process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "recap.db"));
__setDb(db);
const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
if (!user) { console.error(`Aucun compte avec l'adresse ${email}.`); process.exit(1); }
const base = process.env.APP_URL ?? "http://localhost:3100";
console.log(`Lien pour ${email} (valable ${RESET_LINK_MINUTES} min, une seule fois) :\n${base}/mot-de-passe/nouveau?jeton=${encodeURIComponent(createResetToken(user.id))}`);
