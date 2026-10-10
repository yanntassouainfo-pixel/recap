import Link from "next/link";
import { SignupForm } from "./form";

export const metadata = { title: "Créer un compte" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Créez votre espace</h1>
      <p className="mt-1.5 text-ink-2">Deux minutes pour configurer l&apos;essentiel. Vous pourrez tout ajuster ensuite.</p>
      <SignupForm />
      <p className="mt-6 text-[13px] text-ink-3">
        Déjà inscrit ? <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">Se connecter</Link>
      </p>
    </>
  );
}
