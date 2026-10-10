import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { readFile } from "@/lib/storage";
import { fileResponse } from "@/components/documents/serve-file";

/** GET /api/documents/pieces-jointes/:id — la pièce jointe EXACTE d'un email (version figée), propriété vérifiée. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id } = await ctx.params;
  const row = db.select({ att: schema.emailAttachments })
    .from(schema.emailAttachments)
    .innerJoin(schema.emails, eq(schema.emails.id, schema.emailAttachments.emailId))
    .where(and(eq(schema.emailAttachments.id, id), eq(schema.emails.userId, user.id))).get();
  if (!row) return new Response("Pièce jointe introuvable", { status: 404 });
  const buf = readFile(user.id, row.att.storagePath);
  if (!buf) return new Response("Fichier introuvable", { status: 404 });
  return fileResponse(buf, row.att.fileName, row.att.mimeType, new URL(req.url).searchParams.get("inline") === "1");
}
