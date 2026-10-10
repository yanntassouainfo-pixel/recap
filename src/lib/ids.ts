import { randomBytes } from "node:crypto";

/** Identifiant court, triable approximativement par date de création. */
export function newId(prefix = ""): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = randomBytes(8).toString("hex").slice(0, 10);
  return `${prefix}${time}${rand}`;
}
