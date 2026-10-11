"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, FileText, Import, LogOut, Mail, Plus, Repeat, Search, Settings, Users, Wallet, Receipt, CreditCard, ArrowLeftRight } from "lucide-react";
import { buttonClass, Kbd } from "@/components/ui";
import { LogoMark } from "@/components/logo";
import { useQuick, type QuickKind } from "@/components/quick/provider";
import { CommandPalette } from "./command-palette";
import { logout } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/theme";

export function Topbar({ scopeLabel, userName }: { scopeLabel: string; userName: string }) {
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState<null | "new" | "user">(null);
  const { open } = useQuick();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, []);

  const quick = (k: QuickKind) => { setMenu(null); open(k); };
  const newItems: [string, React.ReactNode, () => void][] = [
    ["Ajouter un revenu", <Wallet key="i" size={15} />, () => quick("income")],
    ["Ajouter une dépense", <Receipt key="e" size={15} />, () => quick("expense")],
    ["Enregistrer un paiement", <CreditCard key="p" size={15} />, () => quick("payment")],
    ["Charge récurrente", <Repeat key="r" size={15} />, () => quick("recurring")],
    ["Client ou prospect", <Users key="c" size={15} />, () => quick("contact")],
    ["Transfert entre comptes", <ArrowLeftRight key="t" size={15} />, () => quick("transfer")],
  ];

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur-md" ref={ref}>
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden" aria-label="Accueil"><LogoMark size={24} /></Link>
          <span className="truncate text-[13px] font-medium text-ink-2 lg:hidden">{scopeLabel}</span>
          <button onClick={() => setPalette(true)} className="ml-auto flex h-9 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] text-ink-3 shadow-card transition hover:border-line-2 lg:ml-0 lg:w-[340px]" aria-label="Rechercher (⌘K)">
            <Search size={15} aria-hidden />
            <span className="hidden flex-1 text-left sm:inline">Rechercher ou agir…</span>
            <span className="hidden sm:inline"><Kbd>⌘K</Kbd></span>
          </button>
          <div className="relative hidden lg:ml-auto lg:block">
            <button className={buttonClass("primary", "md")} onClick={() => setMenu(menu === "new" ? null : "new")} aria-expanded={menu === "new"}>
              <Plus size={16} /> Nouveau <ChevronDown size={14} className="-mr-1 opacity-70" />
            </button>
            {menu === "new" && (
              <div className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-xl bg-surface p-1 shadow-pop animate-pop-in" role="menu">
                {newItems.map(([label, icon, fn]) => (
                  <button key={label} role="menuitem" onClick={fn} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-surface-3">
                    <span className="text-ink-3">{icon}</span>{label}
                  </button>
                ))}
                <div className="my-1 border-t border-line" />
                <Link role="menuitem" href="/revenus/nouveau" onClick={() => setMenu(null)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-surface-3"><FileText size={15} className="text-ink-3" />Créer une facture ou un devis</Link>
                <Link role="menuitem" href="/revenus/importer" onClick={() => setMenu(null)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-surface-3"><Import size={15} className="text-ink-3" />Importer une facture</Link>
                <Link role="menuitem" href="/emails/nouveau?template=proposal" onClick={() => setMenu(null)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-surface-3"><Mail size={15} className="text-ink-3" />Proposition commerciale</Link>
              </div>
            )}
          </div>
          <ThemeToggle />
          <div className="relative hidden lg:block">
            <button onClick={() => setMenu(menu === "user" ? null : "user")} className="flex size-9 items-center justify-center rounded-full bg-surface-3 text-[13px] font-semibold text-ink-2 hover:bg-line" aria-label="Compte">
              {userName.slice(0, 1).toUpperCase()}
            </button>
            {menu === "user" && (
              <div className="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl bg-surface p-1 shadow-pop animate-pop-in" role="menu">
                <div className="px-3 py-2 text-[12.5px] text-ink-3">{userName}</div>
                <Link href="/parametres" onClick={() => setMenu(null)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-surface-3"><Settings size={15} className="text-ink-3" />Paramètres</Link>
                <form action={logout}>
                  <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-surface-3"><LogOut size={15} className="text-ink-3" />Se déconnecter</button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </>
  );
}
