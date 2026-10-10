"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { cx } from "@/components/ui";

/** Filtres de la liste des contacts, synchronisés avec l'URL (lien partageable, bouton retour du navigateur). */
export function ClientFilters({ types, activities }: { types: { key: string; label: string; count: number }[]; activities: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const type = sp.get("type") ?? "actifs";
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Type de fiche">
        {types.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={type === t.key} onClick={() => push({ type: t.key === "actifs" ? null : t.key })}
            className={cx("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              type === t.key ? "bg-ink text-bg" : "text-ink-3 hover:bg-surface-3 hover:text-ink-2")}>
            {t.label}
            <span className={cx("rounded-full px-1.5 text-[11px] tabular", type === t.key ? "bg-bg/15" : "bg-surface-3")}>{t.count}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {activities.length > 1 && (
          <select value={sp.get("activite") ?? ""} onChange={(e) => push({ activite: e.target.value || null })} aria-label="Filtrer par activité"
            className="field-input h-8 w-auto py-0 text-[12.5px]">
            <option value="">Toutes les activités</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} placeholder="Nom, organisation, email…" aria-label="Rechercher un contact"
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => push({ q: v.trim() || null }), 250);
            }}
            className="field-input h-8 w-[220px] pl-8 pr-7 text-[12.5px]" />
          {pending ? <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-ink-3" aria-label="Chargement" />
            : q ? <button type="button" onClick={() => { setQ(""); push({ q: null }); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink" aria-label="Effacer la recherche"><X size={13} /></button> : null}
        </div>
      </div>
    </div>
  );
}
