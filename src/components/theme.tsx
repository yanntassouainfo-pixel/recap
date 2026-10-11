"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cx } from "@/components/ui";

/** Préférence de thème : mémorisée dans un cookie lu par le serveur (pas de flash au chargement). */
export type ThemePref = "light" | "dark" | "system";
export const THEME_COOKIE = "recap_theme";

const readPref = (): ThemePref => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
};
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const effective = (p: ThemePref) => (p === "system" ? (systemDark() ? "dark" : "light") : p);

/** Prévient l'app Mac (barre de titre et boîtes de dialogue natives) du thème choisi. */
function notifyNative(pref: ThemePref) {
  (window as unknown as { webkit?: { messageHandlers?: { recapTheme?: { postMessage: (v: string) => void } } } })
    .webkit?.messageHandlers?.recapTheme?.postMessage(pref);
}

export function setThemePref(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === "system") delete el.dataset.theme; else el.dataset.theme = pref;
  document.cookie = pref === "system"
    ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`
    : `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
  notifyNative(pref);
  window.dispatchEvent(new CustomEvent("recap-theme"));
}

/** État courant (préférence + thème réellement affiché), synchronisé entre les contrôles et avec le système. */
function useTheme() {
  const [state, setState] = useState<{ pref: ThemePref; shown: "light" | "dark" } | null>(null);
  useEffect(() => {
    const sync = () => { const pref = readPref(); setState({ pref, shown: effective(pref) }); };
    sync();
    notifyNative(readPref());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    window.addEventListener("recap-theme", sync);
    return () => { mq.removeEventListener("change", sync); window.removeEventListener("recap-theme", sync); };
  }, []);
  return state;
}

/** Bouton de la barre du haut : bascule entre clair et sombre. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTheme();
  const toLight = t?.shown === "dark";
  const label = toLight ? "Passer en mode clair" : "Passer en mode sombre";
  return (
    <button type="button" onClick={() => t && setThemePref(toLight ? "light" : "dark")} aria-label={label} title={label}
      className={cx("flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-2 shadow-card transition hover:border-line-2 hover:text-ink", className)}>
      {!t ? <span className="size-4" aria-hidden /> : toLight ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}

/** Choix complet (Paramètres) : clair, sombre ou automatique (suit macOS / le navigateur). */
export function ThemeChoice() {
  const t = useTheme();
  const options: { key: ThemePref; label: string; icon: React.ReactNode }[] = [
    { key: "light", label: "Clair", icon: <Sun size={14} aria-hidden /> },
    { key: "dark", label: "Sombre", icon: <Moon size={14} aria-hidden /> },
    { key: "system", label: "Automatique", icon: <Monitor size={14} aria-hidden /> },
  ];
  return (
    <div className="inline-flex rounded-[10px] bg-surface-3 p-0.5" role="radiogroup" aria-label="Thème">
      {options.map((o) => {
        const active = t?.pref === o.key;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={active} onClick={() => setThemePref(o.key)}
            className={cx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              active ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink-2")}>
            {o.icon}{o.label}
          </button>
        );
      })}
    </div>
  );
}
