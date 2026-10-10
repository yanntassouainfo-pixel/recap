/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "unpdf", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
