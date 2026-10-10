import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { Logo } from "@/components/logo";
import { OnboardingForm } from "./form";

export const metadata = { title: "Bienvenue" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (getSettings(user.id).onboardedAt) redirect("/");
  return (
    <div className="min-h-dvh px-5 py-8 sm:px-10">
      <Logo />
      <div className="mx-auto mt-10 max-w-[640px] animate-fade-up">
        <p className="text-[13px] font-medium text-ink-3">Bienvenue, {user.name.split(" ")[0]}</p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.025em]">Configurons l&apos;essentiel</h1>
        <p className="mt-2 text-ink-2">Trois questions pour que votre tableau de bord ait du sens dès aujourd&apos;hui. Tout reste modifiable.</p>
        <OnboardingForm />
      </div>
    </div>
  );
}
