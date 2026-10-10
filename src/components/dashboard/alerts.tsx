"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BookOpen, X } from "lucide-react";
import { dismissAlert } from "@/app/actions/finance";
import { SeverityIcon, cx } from "@/components/ui";
import type { Alert } from "@/lib/finance/insights";

export function AlertList({ alerts, limit = 5 }: { alerts: Alert[]; limit?: number }) {
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const visible = alerts.filter((a) => !hidden.has(a.key));
  const list = showAll ? visible : visible.slice(0, limit);
  return (
    <div>
      <ul className="divide-y divide-line">
        {list.map((a) => (
          <li key={a.key} className="group relative flex gap-3 px-5 py-3.5">
            <div className="pt-0.5"><SeverityIcon severity={a.severity} /></div>
            <div className="min-w-0 flex-1">
              <div className="pr-6 text-[13.5px] font-medium leading-snug text-ink">{a.title}</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{a.message}</p>
              {a.hypothesis && <p className="mt-1 text-[11.5px] text-ink-3">Hypothèses : {a.hypothesis}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {a.action && <Link href={a.action.href} className="text-[12.5px] font-medium text-accent hover:underline underline-offset-4">{a.action.label} →</Link>}
                {a.learnMore && <Link href={`/assistant/ressources#${a.learnMore}`} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink-2"><BookOpen size={12} /> Comprendre</Link>}
              </div>
            </div>
            <button onClick={() => { setHidden(new Set([...hidden, a.key])); start(() => dismissAlert(a.key)); }}
              className="absolute right-3 top-3 rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-surface-3 hover:text-ink group-hover:opacity-100 focus:opacity-100" aria-label="Masquer 7 jours" title="Masquer pendant 7 jours">
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      {visible.length > limit && (
        <button onClick={() => setShowAll(!showAll)} className={cx("w-full border-t border-line px-5 py-2.5 text-left text-[12.5px] font-medium text-ink-2 hover:text-ink")}>
          {showAll ? "Réduire" : `Voir les ${visible.length - limit} autres points d'attention`}
        </button>
      )}
    </div>
  );
}
