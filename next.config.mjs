import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "unpdf", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  // Build autonome (serveur Node + dépendances tracées) : utilisé par l'app Mac et pour un futur hébergement.
  output: "standalone",
  // Dossier de build séparé pour l'app Mac, afin de ne pas écraser celui du serveur de dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Racine = ce dossier (un package-lock.json dans le dossier personnel trompait la détection automatique).
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
};

export default nextConfig;
