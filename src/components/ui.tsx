/**
 * Primitives d'interface (compatibles composants serveur).
 * Règle : une couleur de statut est toujours accompagnée d'un libellé ou d'une icône.
 */
import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Minus, XCircle } from "lucide-react";
import { formatMoney } from "@/lib/money";

export const cx = clsx;

/* ───────── Boutons ───────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-ink/88 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset]",
  accent: "bg-accent text-accent-ink hover:bg-accent/90",
  secondary: "bg-surface text-ink border border-line-2 hover:bg-surface-2 hover:border-ink-3/40",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-3",
  danger: "bg-surface text-bad border border-line-2 hover:bg-bad-soft hover:border-bad/40",
};
const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg", md: "h-9.5 px-4 text-[13.5px] gap-2 rounded-[10px]", lg: "h-11 px-5 text-[14.5px] gap-2 rounded-xl" };

export function buttonClass(variant: Variant = "secondary", size: keyof typeof sizes = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background,border,color,transform] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none select-none",
    variants[variant], sizes[size], extra,
  );
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* ───────── Mise en page ───────── */

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[12.5px] font-medium text-ink-3">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink leading-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[14px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return <section className={cx("card", className)} {...rest}>{children}</section>;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 px-5 pt-4.5 pb-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold text-ink tracking-[-0.005em]">{title}</h2>
        {description && <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Section({ title, description, children, action, id }: { title: string; description?: string; children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="text-[12.5px] text-ink-3">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ───────── Montants ───────── */

export function Money({ value, currency, className, sign, compact, tone }: { value: number; currency: string; className?: string; sign?: boolean; compact?: boolean; tone?: "auto" | "none" }) {
  const color = tone === "auto" ? (value > 0 ? "text-good" : value < 0 ? "text-bad" : "") : "";
  return <span className={cx("tabular whitespace-nowrap", color, className)}>{formatMoney(value, currency, { sign, compact })}</span>;
}

/** Variation vs période précédente — flèche + signe + libellé, jamais la couleur seule. */
export function Delta({ value, goodWhen = "up", suffix }: { value: number | null; goodWhen?: "up" | "down"; suffix?: string }) {
  if (value == null) return <span className="text-[12px] text-ink-3">pas de comparaison</span>;
  const rounded = Math.round(value);
  if (rounded === 0) return <span className="inline-flex items-center gap-1 text-[12px] text-ink-3"><Minus size={12} aria-hidden /> stable{suffix ? ` ${suffix}` : ""}</span>;
  const up = rounded > 0;
  const good = up === (goodWhen === "up");
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="text-[12px] leading-snug">
      <span className={cx("inline-flex items-center gap-0.5 whitespace-nowrap font-medium tabular", good ? "text-good" : "text-bad")}>
        <Icon size={13} aria-hidden />
        {up ? "+" : "−"}{Math.abs(rounded) > 999 ? "999+" : Math.abs(rounded)} %
      </span>
      {suffix ? <span className="ml-1 text-ink-3">{suffix}</span> : null}
    </span>
  );
}

/* ───────── Badges & statuts ───────── */

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  sent: { label: "Envoyée", tone: "info" },
  pending: { label: "En attente de paiement", tone: "info" },
  partial: { label: "Partiellement payée", tone: "warn" },
  paid: { label: "Payée", tone: "good" },
  overdue: { label: "En retard", tone: "bad" },
  cancelled: { label: "Annulée", tone: "neutral" },
  accepted: { label: "Accepté", tone: "good" },
  declined: { label: "Refusé", tone: "neutral" },
};

export function InvoiceStatusBadge({ status, paid }: { status: string; paid?: boolean }) {
  const s = INVOICE_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone} dot>{s.label}{status === "overdue" && paid ? " · partiel" : ""}</Badge>;
}

const severityIcon = { critical: XCircle, warning: AlertTriangle, info: Info, good: CheckCircle2 };
export function SeverityIcon({ severity, size = 16 }: { severity: "critical" | "warning" | "info" | "good"; size?: number }) {
  const Icon = severityIcon[severity];
  const color = severity === "critical" ? "text-bad" : severity === "warning" ? "text-warn" : severity === "good" ? "text-good" : "text-info";
  return <Icon size={size} className={cx("shrink-0", color)} aria-label={severity === "critical" ? "Critique" : severity === "warning" ? "Vigilance" : severity === "good" ? "Favorable" : "Information"} />;
}

/* ───────── États vides ───────── */

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "px-6 py-8" : "px-6 py-14", className)}>
      {icon && <div className="mb-3.5 flex size-11 items-center justify-center rounded-xl bg-surface-3 text-ink-2">{icon}</div>}
      <h3 className="text-[14.5px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/* ───────── Formulaires ───────── */

export function Field({ label, hint, error, children, className, htmlFor, optional }: { label: ReactNode; hint?: ReactNode; error?: string | string[]; children: ReactNode; className?: string; htmlFor?: string; optional?: boolean }) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-2">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-3">· facultatif</span>}
      </label>
      {children}
      {err ? <p className="text-[12px] text-bad" role="alert">{err}</p> : hint ? <p className="text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx("field-input", props.className)} />;
}

export function Select({ children, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx("field-input", props.className)}>{children}</select>;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx("field-input", props.className)} />;
}

/* ───────── Tableaux ───────── */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" | "left" | "center" }) {
  // `relative` : garde les libellés `sr-only` (position absolue) dans la zone de défilement du tableau.
  return <th className={cx("relative border-b border-line px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3 whitespace-nowrap", align === "right" && "text-right", align === "center" && "text-center", className)}>{children}</th>;
}
export function Td({ children, className, align, colSpan }: { children?: ReactNode; className?: string; align?: "right" | "left" | "center"; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("border-b border-line px-4 py-3 align-middle", align === "right" && "text-right", align === "center" && "text-center", className)}>{children}</td>;
}

/* ───────── Onglets (liens) ───────── */

export function Tabs({ items, active }: { items: { key: string; label: ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="Sections">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={t.key === active ? "page" : undefined}
          className={cx(
            "relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium transition-colors",
            t.key === active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
          )}
        >
          {t.label}
          {t.count != null && <span className={cx("rounded-full px-1.5 text-[11px] tabular", t.key === active ? "bg-ink text-bg" : "bg-surface-3 text-ink-3")}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Segmented({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="inline-flex rounded-[10px] bg-surface-3 p-0.5" role="tablist">
      {items.map((i) => (
        <Link key={i.key} href={i.href} scroll={false} role="tab" aria-selected={i.key === active}
          className={cx("rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors", i.key === active ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink-2")}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/* ───────── Indicateurs ───────── */

export function Progress({ value, tone = "accent", label }: { value: number; tone?: "accent" | "good" | "warn" | "bad"; label?: string }) {
  const color = { accent: "bg-accent", good: "bg-good-mark", warn: "bg-warn-mark", bad: "bg-bad-mark" }[tone];
  const track = { accent: "bg-accent-soft", good: "bg-good-soft", warn: "bg-warn-soft", bad: "bg-bad-soft" }[tone];
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full", track)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-2 bg-surface-2 px-1 py-px font-mono text-[10.5px] text-ink-3">{children}</kbd>;
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "bad" | "good"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const sev = tone === "bad" ? "critical" : tone === "warn" ? "warning" : tone === "good" ? "good" : "info";
  const bg = { info: "bg-info-soft/60", warn: "bg-warn-soft/70", bad: "bg-bad-soft/70", good: "bg-good-soft/70" }[tone];
  return (
    <div className={cx("flex gap-3 rounded-xl px-4 py-3", bg)}>
      <div className="pt-0.5"><SeverityIcon severity={sev} /></div>
      <div className="min-w-0 flex-1 text-[13px] text-ink-2">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cx("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} aria-hidden />;
}

export function MoneyText({ value, currency }: { value: number; currency: string }) {
  return <>{formatMoney(value, currency)}</>;
}

/** Montant mis en avant : chiffres en grand, devise en retrait — jamais coupé sur deux lignes. */
export function BigMoney({ value, currency, className, sign }: { value: number; currency: string; className?: string; sign?: boolean }) {
  const full = formatMoney(value, currency, { sign });
  const i = full.lastIndexOf(" ");
  const num = i > 0 ? full.slice(0, i) : full;
  const sym = i > 0 ? full.slice(i + 1) : "";
  return (
    <span className={cx("inline-flex items-baseline whitespace-nowrap tabular", className)}>
      {num}
      {sym && <span className="ml-[0.22em] text-[0.42em] font-medium tracking-normal text-ink-3">{sym}</span>}
    </span>
  );
}
