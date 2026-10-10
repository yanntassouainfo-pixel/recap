import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { newId } from "./ids";

const ROOT = () => path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
  "text/plain", "text/csv", "application/zip",
]);

export function safeFileName(name: string): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (base || "fichier").slice(0, 120);
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Écrit un fichier dans l'espace de stockage privé de l'utilisateur (jamais servi publiquement). */
export function saveFile(userId: string, buf: Buffer, fileName: string) {
  const dir = path.join(ROOT(), userId);
  fs.mkdirSync(dir, { recursive: true });
  const storagePath = path.join(userId, `${newId()}-${safeFileName(fileName)}`);
  fs.writeFileSync(path.join(ROOT(), storagePath), buf);
  return { storagePath, size: buf.length, sha256: sha256(buf) };
}

/** Lit un fichier en vérifiant qu'il appartient bien au dossier de l'utilisateur (anti-traversée). */
export function readFile(userId: string, storagePath: string): Buffer | null {
  const full = path.resolve(ROOT(), storagePath);
  const userRoot = path.resolve(ROOT(), userId) + path.sep;
  if (!full.startsWith(userRoot) || !fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

export function deleteUserFiles(userId: string) {
  const dir = path.resolve(ROOT(), userId);
  if (dir.startsWith(ROOT()) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

export function guessMime(fileName: string, fallback = "application/octet-stream"): string {
  const ext = fileName.toLowerCase().split(".").pop();
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
    gif: "image/gif", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", txt: "text/plain", csv: "text/csv", zip: "application/zip",
  };
  return map[ext ?? ""] ?? fallback;
}
