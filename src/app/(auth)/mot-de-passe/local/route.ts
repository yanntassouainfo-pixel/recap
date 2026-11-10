import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/lib/db";
import { createResetToken, isValidLocalKey } from "@/lib/password-reset";

/**
 * Réinitialisation depuis l'app Mac (menu Recap › Réinitialiser le mot de passe…).
 * Seule l'app connaît la clé, générée à chaque lancement et transmise au moteur local : un lien copié ailleurs ne sert à rien.
 */
export function GET(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || !isValidLocalKey(req.nextUrl.searchParams.get("cle"))) {
    return new NextResponse("Lien non valable.", { status: 403 });
  }
  const users = db.select({ id: schema.users.id }).from(schema.users).limit(2).all();
  const to = (p: string) => NextResponse.redirect(new URL(p, `http://${host}`), 303);
  if (users.length === 0) return to("/inscription");
  if (users.length > 1) return to("/mot-de-passe-oublie?erreur=plusieurs-comptes");
  return to(`/mot-de-passe/nouveau?jeton=${encodeURIComponent(createResetToken(users[0].id, 15))}`);
}
