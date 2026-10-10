"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight, BarChart3, Bot, Building2, FileText, FolderOpen, Gauge, LineChart, LogOut, Mail, MoreHorizontal, Plus,
  Receipt, Settings, Users, Wallet, X,
} from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";
import { LogoMark } from "@/components/logo";
import { useQuick } from "@/components/quick/provider";
import { logout } from "@/app/actions/auth";

export const NAV = [
  {
    group: "Pilotage",
    items: [
      { href: "/", label: "Tableau de bord", icon: Gauge },
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/previsionnel", label: "Prévisionnel", icon: LineChart },
      { href: "/rentabilite", label: "Rentabilité", icon: BarChart3 },
    ],
  },
  {
    group: "Flux",
    items: [
      { href: "/revenus", label: "Revenus & factures", icon: FileText },
      { href: "/depenses", label: "Dépenses & charges", icon: Receipt },
    ],
  },
  {
    group: "Relation client",
    items: [
      { href: "/clients", label: "Clients & prospects", icon: Users },
      { href: "/documents", label: "Documents", icon: FolderOpen },
      { href: "/emails", label: "Emails", icon: Mail },
    ],
  },
  {
    group: "Aide à la décision",
    items: [{ href: "/assistant", label: "Assistant financier", icon: Bot }],
  },
];

export const NAV_BOTTOM = [
  { href: "/structures", label: "Entreprises & activités", icon: Building2 },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ href, label, icon: Icon, badge, onClick }: { href: string; label: string; icon: typeof Gauge; badge?: number; onClick?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined}
      className={cx(
        "group flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[13.5px] font-medium transition-colors",
        active ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:bg-surface-3/70 hover:text-ink",
      )}>
      <Icon size={17} strokeWidth={active ? 2.1 : 1.8} className={active ? "text-ink" : "text-ink-3 group-hover:text-ink-2"} aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full bg-bad-soft px-1.5 text-[11px] font-semibold text-bad tabular" aria-label={`${badge} en retard`}>{badge}</span> : null}
    </Link>
  );
}

export function Sidebar({ userName, overdueCount, scopeSwitcher }: { userName: string; overdueCount: number; scopeSwitcher: React.ReactNode }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-bg px-3 pb-3 pt-4 lg:flex">
      <Link href="/" className="mb-4 flex items-center gap-2.5 px-2 text-[16px] font-semibold tracking-[-0.02em]">
        <LogoMark /> Recap
      </Link>
      <div className="mb-4">{scopeSwitcher}</div>
      <nav className="flex-1 space-y-5 overflow-y-auto" aria-label="Navigation principale">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{g.group}</div>
            <div className="space-y-0.5">
              {g.items.map((i) => <NavLink key={i.href} {...i} badge={i.href === "/revenus" ? overdueCount : undefined} />)}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-line pt-3">
        {NAV_BOTTOM.map((i) => <NavLink key={i.href} {...i} />)}
        <div className="mt-2 flex items-center gap-2.5 px-2.5 pt-2 text-[12.5px] text-ink-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold text-ink-2">{userName.slice(0, 1).toUpperCase()}</span>
          <span className="truncate">{userName}</span>
        </div>
      </div>
    </aside>
  );
}

/** Navigation mobile : accès direct à l'essentiel + bouton d'action rapide central. */
export function MobileNav({ scopeSwitcher }: { scopeSwitcher: React.ReactNode }) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const { open } = useQuick();
  const items = [
    { href: "/", label: "Accueil", icon: Gauge },
    { href: "/revenus", label: "Revenus", icon: FileText },
    null,
    { href: "/previsionnel", label: "Prévisions", icon: LineChart },
  ];
  const quickItems: [string, () => void][] = [
    ["Ajouter un revenu", () => open("income")],
    ["Ajouter une dépense", () => open("expense")],
    ["Enregistrer un paiement", () => open("payment")],
    ["Ajouter un client", () => open("contact")],
    ["Charge récurrente", () => open("recurring")],
  ];
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-line bg-bg/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur lg:hidden" aria-label="Navigation mobile">
        {items.map((i) =>
          i ? (
            <Link key={i.href} href={i.href} className={cx("flex w-16 flex-col items-center gap-0.5 text-[10.5px] font-medium", isActive(pathname, i.href) ? "text-ink" : "text-ink-3")}>
              <i.icon size={21} strokeWidth={isActive(pathname, i.href) ? 2.1 : 1.7} aria-hidden />
              {i.label}
            </Link>
          ) : (
            <button key="plus" onClick={() => setQuick(true)} className="-mt-5 flex size-13 items-center justify-center rounded-2xl bg-ink text-bg shadow-pop" aria-label="Action rapide">
              <Plus size={24} />
            </button>
          ),
        )}
        <button onClick={() => setMore(true)} className="flex w-16 flex-col items-center gap-0.5 text-[10.5px] font-medium text-ink-3">
          <MoreHorizontal size={21} aria-hidden />
          Plus
        </button>
      </nav>

      {(more || quick) && (
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px] lg:hidden" onClick={() => { setMore(false); setQuick(false); }}>
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(env(safe-area-inset-bottom),20px)] animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">{quick ? "Action rapide" : "Menu"}</h2>
              <button onClick={() => { setMore(false); setQuick(false); }} className="rounded-lg p-2 text-ink-3" aria-label="Fermer"><X size={18} /></button>
            </div>
            {quick ? (
              <div className="grid gap-2">
                {quickItems.map(([label, fn]) => (
                  <button key={label} onClick={() => { setQuick(false); fn(); }} className="flex h-12 items-center gap-3 rounded-xl bg-surface-2 px-4 text-left text-[14.5px] font-medium">
                    <Wallet size={18} className="text-ink-3" /> {label}
                  </button>
                ))}
                <Link href="/revenus/importer" onClick={() => setQuick(false)} className="flex h-12 items-center gap-3 rounded-xl bg-surface-2 px-4 text-[14.5px] font-medium"><FileText size={18} className="text-ink-3" /> Importer une facture</Link>
                <Link href="/emails/nouveau" onClick={() => setQuick(false)} className="flex h-12 items-center gap-3 rounded-xl bg-surface-2 px-4 text-[14.5px] font-medium"><Mail size={18} className="text-ink-3" /> Envoyer un email</Link>
              </div>
            ) : (
              <div className="space-y-4">
                <div>{scopeSwitcher}</div>
                {NAV.map((g) => (
                  <div key={g.group}>
                    <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{g.group}</div>
                    <div className="grid gap-0.5">{g.items.map((i) => <NavLink key={i.href} {...i} onClick={() => setMore(false)} />)}</div>
                  </div>
                ))}
                <div className="grid gap-0.5 border-t border-line pt-3">
                  {NAV_BOTTOM.map((i) => <NavLink key={i.href} {...i} onClick={() => setMore(false)} />)}
                  {/* Le menu du compte (avec la déconnexion) n'est affiché qu'en version large. */}
                  <form action={logout}>
                    <button className="group flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-3/70 hover:text-ink">
                      <LogOut size={17} strokeWidth={1.8} className="text-ink-3 group-hover:text-ink-2" aria-hidden />
                      Se déconnecter
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
