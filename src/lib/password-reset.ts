/**
 * Réinitialisation du mot de passe : jetons signés (HMAC), sans table dédiée.
 *
 * jeton = <userId>.<expiration ms>.<signature>, signature = HMAC(secret, userId | expiration | hash du mot de passe actuel).
 * Le hash actuel entre dans la signature : dès que le mot de passe change, tous les liens émis deviennent invalides
 * (un lien ne sert qu'une fois). Le secret est généré au premier usage, à côté de la base, lisible par vous seul.
 */
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export const RESET_LINK_MINUTES = 60;

let cachedSecret: Buffer | null = null;
function secret(): Buffer {
  if (process.env.RESET_SECRET) return Buffer.from(process.env.RESET_SECRET);
  if (cachedSecret) return cachedSecret;
  const dbFile = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "recap.db");
  if (dbFile === ":memory:") return (cachedSecret = randomBytes(32));
  const file = path.join(path.dirname(path.resolve(dbFile)), ".reset-secret");
  try {
    cachedSecret = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    cachedSecret = randomBytes(32);
    fs.writeFileSync(file, cachedSecret.toString("hex"), { mode: 0o600 });
  }
  return cachedSecret;
}

const sign = (userId: string, exp: number, passwordHash: string) =>
  createHmac("sha256", secret()).update(`${userId}|${exp}|${passwordHash}`).digest("base64url");

export function createResetToken(userId: string, minutes = RESET_LINK_MINUTES, now = Date.now()): string {
  const user = db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw new Error("Compte introuvable.");
  const exp = now + minutes * 60_000;
  return `${userId}.${exp}.${sign(userId, exp, user.hash)}`;
}

/** Renvoie le compte visé si le jeton est valide, non expiré et pas déjà utilisé. */
export function verifyResetToken(token: string, now = Date.now()): { id: string; email: string; name: string } | null {
  const [userId, expRaw, sig] = String(token ?? "").split(".");
  const exp = Number(expRaw);
  if (!userId || !sig || !Number.isFinite(exp) || exp < now) return null;
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return null;
  const expected = Buffer.from(sign(userId, exp, user.passwordHash));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { id: user.id, email: user.email, name: user.name };
}

/** Clé de l'app Mac (variable d'environnement posée par Recap.app au lancement) : comparaison à temps constant. */
export function isValidLocalKey(given: string | null): boolean {
  const key = process.env.RECAP_LOCAL_KEY;
  if (!key || key.length < 32 || !given) return false;
  const a = Buffer.from(key), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
