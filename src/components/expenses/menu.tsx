"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cx } from "@/components/ui";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "danger";
  hidden?: boolean;
}

/**
 * Menu d'actions d'une ligne. Positionné en `fixed` pour ne pas être rogné par les tableaux défilants.
 * Fermeture : clic extérieur, Échap, défilement.
 */
export function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = 220;
    const height = menu.current?.offsetHeight ?? visible.length * 38 + 10;
    const below = r.bottom + 4 + height < window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - height - 4), left: Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width)) });
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", key);
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (visible.length === 0) return null;
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title="Actions"
        className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink">
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
          className="fixed z-50 w-[220px] rounded-xl border border-line bg-surface p-1 shadow-pop animate-pop-in">
          {visible.map((i) => (
            <button key={i.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); i.onSelect(); }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
                const idx = all.indexOf(e.currentTarget);
                all[(idx + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
              }}
              className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium outline-none focus-visible:bg-surface-3",
                i.tone === "danger" ? "text-bad hover:bg-bad-soft" : "text-ink-2 hover:bg-surface-3 hover:text-ink")}>
              {i.icon}
              {i.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
