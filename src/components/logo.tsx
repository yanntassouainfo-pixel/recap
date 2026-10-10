import Link from "next/link";

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path d="M9 21.5V10.5h7.2a4.3 4.3 0 0 1 0 8.6H9" fill="none" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m16.4 19.1 4.9 4.9" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.02em] text-ink">
      <LogoMark />
      Recap
    </Link>
  );
}
