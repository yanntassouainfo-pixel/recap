import { getCurrentUser } from "@/lib/auth";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

/** GET /api/invoices/:id/pdf[?inline=1] — PDF d'une facture ou d'un devis de l'utilisateur connecté. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id } = await ctx.params;
  let pdf: ReturnType<typeof renderInvoicePdf>;
  try {
    pdf = renderInvoicePdf(user.id, id);
  } catch (e) {
    console.error("[invoice-pdf]", e);
    return new Response("La génération du PDF a échoué.", { status: 500 });
  }
  if (!pdf) return new Response("Document introuvable", { status: 404 });
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const ascii = pdf.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(pdf.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.buffer.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
