import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { readFile } from "@/lib/storage";
import { fileResponse } from "@/components/documents/serve-file";

/** GET /api/documents/:id?v=N&inline=1 — sert une version d'un document de l'utilisateur connecté. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id } = await ctx.params;
  const doc = db.select().from(schema.documents).where(and(eq(schema.documents.id, id), eq(schema.documents.userId, user.id))).get();
  if (!doc) return new Response("Document introuvable", { status: 404 });
  const url = new URL(req.url);
  const v = Number(url.searchParams.get("v")) || doc.currentVersion;
  const version = db.select().from(schema.documentVersions).where(and(eq(schema.documentVersions.documentId, doc.id), eq(schema.documentVersions.version, v))).get();
  if (!version) return new Response("Version introuvable", { status: 404 });
  const buf = readFile(user.id, version.storagePath);
  if (!buf) return new Response("Fichier introuvable", { status: 404 });
  return fileResponse(buf, version.fileName, version.mimeType, url.searchParams.get("inline") === "1");
}
