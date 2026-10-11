import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "./db";
import { audit } from "./audit";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = "recap_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  const h = await headers();
  const ua = h.get("user-agent")?.slice(0, 200) ?? null;
  db.insert(schema.sessions).values({ id: hashToken(token), userId, expiresAt: expiresAt.toISOString(), userAgent: ua }).run();
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date().toISOString())).run();
  // Cookie « Secure » en production, sauf en HTTP local (app Mac) où la vue web le refuserait.
  const localHttp = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h.get("host") ?? "") && h.get("x-forwarded-proto") !== "https";
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && !localHttp, path: "/", expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token))).run();
  jar.delete(COOKIE);
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date().toISOString())))
    .get();
  return row ?? null;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/* Limitation simple des tentatives de connexion (mémoire du processus). */
const attempts = new Map<string, { count: number; until: number }>();
export function loginThrottle(key: string): { blocked: boolean; retryInSec: number } {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= 5) return { blocked: true, retryInSec: Math.ceil((a.until - Date.now()) / 1000) };
  return { blocked: false, retryInSec: 0 };
}
export function registerFailure(key: string) {
  const a = attempts.get(key);
  const now = Date.now();
  if (!a || a.until < now) attempts.set(key, { count: 1, until: now + 15 * 60000 });
  else a.count++;
}
export function clearFailures(key: string) {
  attempts.delete(key);
}

export { audit };
