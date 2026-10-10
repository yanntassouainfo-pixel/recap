import Link from "next/link";
import { LoginForm } from "./form";

export const metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Bon retour</h1>
      <p className="mt-1.5 text-ink-2">Connectez-vous pour retrouver votre tableau de bord.</p>
      <LoginForm />
      <p className="mt-6 text-[13px] text-ink-3">
        Pas encore de compte ? <Link href="/inscription" className="font-medium text-ink underline-offset-4 hover:underline">Créer un compte</Link>
      </p>
    </>
  );
}
