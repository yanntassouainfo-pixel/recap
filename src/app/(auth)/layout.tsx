import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/logo";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px] animate-fade-up">{children}</div>
        </div>
        <p className="text-[12px] text-ink-3">Recap ne remplace pas votre expert-comptable : c&apos;est un outil de pilotage de trésorerie.</p>
      </div>
      <aside className="relative hidden overflow-hidden bg-[#141413] lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_80%_0%,rgb(45_91_210/0.35),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-between p-14 text-[#f3f2ee]">
          <div className="max-w-md">
            <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-white/50">Chaque matin, en quelques secondes</p>
            <h2 className="mt-4 text-[34px] font-semibold leading-[1.15] tracking-[-0.025em]">
              Ce que vous gagnez, ce que vous dépensez, ce qu&apos;il vous reste — et ce qui arrive.
            </h2>
          </div>
          <div className="space-y-3">
            {[
              ["Argent disponible", "4 812 300 F CFA", "Soldes de vos comptes"],
              ["Encaissé ce mois-ci", "2 150 000 F CFA", "+18 % vs mois précédent"],
              ["Fin de mois prévue", "4 105 000 F CFA", "Scénario central · hypothèses visibles"],
            ].map(([k, v, s], i) => (
              <div key={k} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 backdrop-blur" style={{ marginLeft: i * 28 }}>
                <div>
                  <div className="text-[12.5px] text-white/55">{k}</div>
                  <div className="mt-0.5 text-[22px] font-semibold tabular tracking-[-0.02em]">{v}</div>
                </div>
                <div className="text-right text-[12px] text-white/45">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
