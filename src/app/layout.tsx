import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Recap — pilotage financier", template: "%s · Recap" },
  description: "Comprendre en quelques secondes ce que vous gagnez, dépensez, devez encaisser et pouvez anticiper.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Thème choisi (cookie posé par le bouton clair/sombre) ; absent = suit le système.
  const pref = (await cookies()).get("recap_theme")?.value;
  const theme = pref === "light" || pref === "dark" ? pref : undefined;
  return (
    <html lang="fr" data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
