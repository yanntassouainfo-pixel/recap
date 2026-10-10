"use client";

import { useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Formulaire de filtres en GET : se soumet dès qu'une liste ou une date change (Entrée pour la recherche),
 * et n'écrit dans l'URL que les paramètres renseignés. La pagination repart de la première page.
 */
export function FilterForm({ path, children, className, label = "Filtres" }: { path: string; children: ReactNode; className?: string; label?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => {
    if (!ref.current) return;
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(ref.current).entries()) {
      if (typeof v === "string" && v.trim() !== "") qs.set(k, v.trim());
    }
    const s = qs.toString();
    router.push(s ? `${path}?${s}` : path, { scroll: false });
  };
  return (
    <form ref={ref} role="search" aria-label={label} className={className}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === "date" && (t.value === "" || /^\d{4}-\d{2}-\d{2}$/.test(t.value)))) submit();
      }}>
      {children}
      <button type="submit" className="sr-only">Appliquer les filtres</button>
    </form>
  );
}
