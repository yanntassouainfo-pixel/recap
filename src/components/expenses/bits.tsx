/** Petits éléments d'interface partagés par les vues Dépenses et Transactions (composants serveur). */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Card, cx } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { EXPENSE_STATUS, type ExpenseStatusKey } from "./logic";

export function Kpi({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: "bad" | "warn" }) {
  const body = (
    <>
      <div className="text-[12.5px] font-medium text-ink-3">{label}</div>
      <div className={cx("mt-1.5 text-[24px] font-semibold tracking-[-0.02em] leading-tight", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-ink-3">{sub}</div>}
    </>
  );
  return (
    <Card className="min-w-0 p-4.5">
      {href ? <Link href={href} className="block rounded-lg outline-offset-4 hover:opacity-90">{body}</Link> : body}
    </Card>
  );
}

export function ExpenseStatusBadge({ status }: { status: ExpenseStatusKey }) {
  const s = EXPENSE_STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

/** Pastille date (jour + mois) — l'état « en retard » est aussi indiqué en toutes lettres à côté. */
export function DateChip({ iso, late }: { iso: string; late?: boolean }) {
  const [day, month] = formatDate(iso, "day").split(" ");
  return (
    <div className={cx("flex w-11 shrink-0 flex-col items-center rounded-lg py-1", late ? "bg-warn-soft text-warn" : "bg-surface-3 text-ink-2")} aria-hidden>
      <span className="text-[15px] font-semibold leading-none tabular">{day}</span>
      <span className="text-[10.5px] leading-tight">{month}</span>
    </div>
  );
}

export function Pager({ page, pageCount, total, href, noun }: { page: number; pageCount: number; total: number; href: (page: number) => string; noun: string }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[12.5px] text-ink-3" aria-label="Pagination">
      <span>Page {page} sur {pageCount} · {total} {noun}</span>
      <div className="flex gap-1.5">
        {page > 1 ? (
          <Link href={href(page - 1)} scroll={false} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-2 bg-surface px-2.5 font-medium text-ink-2 hover:text-ink"><ChevronLeft size={14} /> Précédente</Link>
        ) : null}
        {page < pageCount ? (
          <Link href={href(page + 1)} scroll={false} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-2 bg-surface px-2.5 font-medium text-ink-2 hover:text-ink">Suivante <ChevronRight size={14} /></Link>
        ) : null}
      </div>
    </nav>
  );
}

export const filterLabel = "text-[11.5px] font-medium text-ink-3";
