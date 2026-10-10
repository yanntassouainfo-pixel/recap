/**
 * DEV UNIQUEMENT — crée une session pour le compte de démonstration et affiche la valeur du cookie,
 * pour tester les pages avec curl :  curl -s -b "recap_session=$(npx tsx scripts/dev-session.ts)" http://localhost:3100/revenus
 */
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/lib/db";
import * as schema from "../src/lib/db/schema";

const { db } = openDatabase(process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "recap.db"));
const user = db.select().from(schema.users).where(eq(schema.users.email, "demo@recap.local")).get();
if (!user) throw new Error("Lancez d'abord npm run db:seed");
const token = randomBytes(32).toString("base64url");
db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt: new Date(Date.now() + 86400000).toISOString() }).run();
process.stdout.write(token);
