"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronsUpDown, Layers, User } from "lucide-react";
import { setScope } from "@/app/actions/app";
import { cx } from "@/components/ui";

export interface ScopeOption { key: string; label: string; hint?: string; color?: string; kind: "all" | "pro" | "company" | "personal" }

export function ScopeSwitcher({ current, options }: { current: string; options: ScopeOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const active = options.find((o) => o.key === current) ?? options[0];
  if (options.length <= 1) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
        <span className="size-2.5 rounded-full" style={{ background: active?.color ?? "var(--accent)" }} />
        <span className="truncate text-[13px] font-medium">{active?.label}</span>
      </div>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        className={cx("flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2 text-left shadow-card transition hover:border-line-2", pending && "opacity-60")}>
        <ScopeIcon option={active} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-ink-3">Vue affichée</span>
          <span className="block truncate text-[13px] font-medium">{active.label}</span>
        </span>
        <ChevronsUpDown size={15} className="text-ink-3" aria-hidden />
      </button>
      {open && (
        <div role="listbox" className="absolute inset-x-0 top-full z-40 mt-1.5 rounded-xl bg-surface p-1 shadow-pop animate-pop-in">
          {options.map((o, i) => (
            <div key={o.key}>
              {i > 0 && o.kind === "company" && options[i - 1].kind !== "company" && <div className="my-1 border-t border-line" />}
              {o.kind === "personal" && <div className="my-1 border-t border-line" />}
              <button role="option" aria-selected={o.key === current} onClick={() => { setOpen(false); start(() => setScope(o.key)); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-3">
                <ScopeIcon option={o} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{o.label}</span>
                  {o.hint && <span className="block truncate text-[11.5px] text-ink-3">{o.hint}</span>}
                </span>
                {o.key === current && <Check size={15} className="text-ink" aria-hidden />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeIcon({ option }: { option: ScopeOption }) {
  if (option.kind === "all" || option.kind === "pro") return <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-bg"><Layers size={14} /></span>;
  if (option.kind === "personal") return <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2"><User size={14} /></span>;
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold text-white" style={{ background: option.color }}>{option.label.slice(0, 1)}</span>;
}
