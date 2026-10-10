"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, FolderOpen, Search, Receipt, User, Zap } from "lucide-react";
import { cx, Kbd } from "@/components/ui";
import { useQuick, type QuickKind } from "@/components/quick/provider";
import { NAV, NAV_BOTTOM } from "./nav";
import type { SearchHit } from "@/app/api/search/route";

type Item = { id: string; label: string; hint?: string; group: string; icon: React.ReactNode; run: () => void };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { open: openQuick } = useQuick();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setHits([]); setIndex(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).then((r) => r.json()).then((d) => setHits(d.hits ?? [])).catch(() => {}).finally(() => setLoading(false));
    }, 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const go = (href: string) => { onClose(); router.push(href); };
  const quick = (k: QuickKind) => { onClose(); openQuick(k); };

  const items: Item[] = useMemo(() => {
    const needle = q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    const match = (s: string) => !needle || s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").includes(needle);
    const actions: Item[] = ([
      ["Ajouter un revenu", "income"], ["Ajouter une dépense", "expense"], ["Enregistrer un paiement", "payment"],
      ["Ajouter un client ou un prospect", "contact"], ["Ajouter une charge récurrente", "recurring"], ["Transfert entre comptes", "transfer"],
    ] as [string, QuickKind][]).filter(([l]) => match(l)).map(([label, k]) => ({ id: `q-${k}`, label, group: "Actions rapides", icon: <Zap size={15} />, run: () => quick(k) }));
    const links: Item[] = [
      ["Créer une facture", "/revenus/nouveau"], ["Importer une facture ou un justificatif", "/revenus/importer"],
      ["Préparer une proposition commerciale", "/emails/nouveau?template=proposal"], ["Envoyer un email", "/emails/nouveau"],
      ["Poser une question à l'assistant", "/assistant"],
    ].filter(([l]) => match(l)).map(([label, href]) => ({ id: href, label, group: "Actions rapides", icon: <ArrowRight size={15} />, run: () => go(href) }));
    const pages: Item[] = [...NAV.flatMap((g) => g.items), ...NAV_BOTTOM].filter((p) => match(p.label)).map((p) => ({ id: p.href, label: p.label, group: "Aller à", icon: <p.icon size={15} />, run: () => go(p.href) }));
    const icon = (t: SearchHit["type"]) => (t === "contact" ? <User size={15} /> : t === "invoice" ? <FileText size={15} /> : t === "document" ? <FolderOpen size={15} /> : <Receipt size={15} />);
    const groupOf = (t: SearchHit["type"]) => (t === "contact" ? "Clients & prospects" : t === "invoice" ? "Factures & devis" : t === "document" ? "Documents" : "Dépenses");
    const found: Item[] = hits.map((h) => ({ id: `${h.type}-${h.id}`, label: h.title, hint: h.subtitle, group: groupOf(h.type), icon: icon(h.type), run: () => go(h.href) }));
    return [...found, ...actions, ...links, ...pages];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits]);

  useEffect(() => setIndex(0), [items.length]);

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-ink/30 px-3 pt-[10vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-[600px] overflow-hidden rounded-2xl bg-surface shadow-pop animate-pop-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recherche et actions">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="text-ink-3" aria-hidden />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un client, une facture, un document… ou une action"
            className="h-13 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3" aria-label="Rechercher"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              if (e.key === "Enter") { e.preventDefault(); items[index]?.run(); }
              if (e.key === "Escape") onClose();
            }} />
          <Kbd>Échap</Kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && !loading && (
            <div className="px-4 py-10 text-center text-[13.5px] text-ink-3">Aucun résultat pour « {q} ». Essayez un nom de client, un numéro de facture ou un type de document.</div>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id}>
                {header && <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{header}</div>}
                <button onMouseEnter={() => setIndex(i)} onClick={it.run}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left", i === index ? "bg-surface-3" : "")}>
                  <span className="text-ink-3">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{it.label}</span>
                    {it.hint && <span className="block truncate text-[12px] text-ink-3">{it.hint}</span>}
                  </span>
                  {i === index && <ArrowRight size={14} className="text-ink-3" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
