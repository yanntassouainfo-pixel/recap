"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui";

export function Modal({ open, onClose, title, description, children, size = "md", footer }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; size?: "sm" | "md" | "lg" | "xl"; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = { sm: "max-w-[420px]", md: "max-w-[560px]", lg: "max-w-[720px]", xl: "max-w-[960px]" }[size];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx(
        "m-auto w-[calc(100%-24px)] rounded-2xl bg-surface p-0 text-ink shadow-pop open:animate-pop-in",
        "max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none",
        width,
      )}
    >
      {open && (
        <div className="flex max-h-[min(88dvh,860px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 pb-4 pt-5">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Fermer">
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
