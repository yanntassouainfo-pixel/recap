/**
 * Mot de passe oublié : jetons signés — valides une fois, expirés, falsifiés ; clé de l'app Mac.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_FILE = ":memory:";
let D: typeof import("@/lib/db");
let R: typeof import("@/lib/password-reset");

beforeAll(async () => {
  D = await import("@/lib/db");
  R = await import("@/lib/password-reset");
  D.db.insert(D.schema.users).values({ id: "usr_a", email: "a@test.local", name: "A", passwordHash: "scrypt$old" }).run();
  D.db.insert(D.schema.users).values({ id: "usr_b", email: "b@test.local", name: "B", passwordHash: "scrypt$b" }).run();
});

describe("jetons de réinitialisation", () => {
  it("un jeton valide désigne le bon compte", () => {
    expect(R.verifyResetToken(R.createResetToken("usr_a"))?.email).toBe("a@test.local");
  });

  it("expire après le délai", () => {
    const t = R.createResetToken("usr_a", 60, Date.now() - 61 * 60_000);
    expect(R.verifyResetToken(t)).toBeNull();
  });

  it("refuse un jeton falsifié ou attribué à un autre compte", () => {
    const [, exp, sig] = R.createResetToken("usr_a").split(".");
    expect(R.verifyResetToken(`usr_b.${exp}.${sig}`)).toBeNull();
    expect(R.verifyResetToken(`usr_a.${Number(exp) + 1}.${sig}`)).toBeNull();
    expect(R.verifyResetToken("n'importe quoi")).toBeNull();
    expect(R.verifyResetToken("")).toBeNull();
  });

  it("ne sert qu'une fois : invalide dès que le mot de passe change", () => {
    const t = R.createResetToken("usr_a");
    D.db.update(D.schema.users).set({ passwordHash: "scrypt$new" }).where(eq(D.schema.users.id, "usr_a")).run();
    expect(R.verifyResetToken(t)).toBeNull();
    expect(R.verifyResetToken(R.createResetToken("usr_a"))?.id).toBe("usr_a");
  });
});

describe("clé locale de l'app Mac", () => {
  it("n'accepte que la clé exacte, et jamais sans clé configurée", () => {
    delete process.env.RECAP_LOCAL_KEY;
    expect(R.isValidLocalKey("x".repeat(64))).toBe(false);
    process.env.RECAP_LOCAL_KEY = "a".repeat(64);
    expect(R.isValidLocalKey("a".repeat(64))).toBe(true);
    expect(R.isValidLocalKey("a".repeat(63) + "b")).toBe(false);
    expect(R.isValidLocalKey(null)).toBe(false);
    process.env.RECAP_LOCAL_KEY = "court";
    expect(R.isValidLocalKey("court")).toBe(false);
    delete process.env.RECAP_LOCAL_KEY;
  });
});
