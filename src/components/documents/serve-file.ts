import "server-only";

/** Types affichables directement dans le navigateur (aperçu). Le SVG et le reste sont servis en téléchargement. */
const INLINE_SAFE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"]);

/** Content-Disposition avec nom de fichier encodé (RFC 6266 / 5987) : accents et espaces conservés. */
export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function fileResponse(buf: Buffer, fileName: string, mimeType: string, wantInline: boolean): Response {
  const inline = wantInline && INLINE_SAFE.has(mimeType);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": inline ? (mimeType === "text/plain" ? "text/plain; charset=utf-8" : mimeType) : mimeType === "image/svg+xml" ? "application/octet-stream" : mimeType,
      "Content-Length": String(buf.length),
      "Content-Disposition": contentDisposition(fileName, inline),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
