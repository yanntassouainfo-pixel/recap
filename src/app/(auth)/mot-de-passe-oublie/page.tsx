import Link from "next/link";
import { isMailerConfigured } from "@/lib/mailer";
import { ForgotForm } from "./form";

export const metadata = { title: "Mot de passe oublié" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const sp = await searchParams;
  const mail = isMailerConfigured();
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Mot de passe oublié</h1>
      <p className="mt-1.5 text-ink-2">Choisissez un nouveau mot de passe : vos données restent intactes.</p>
      {sp.erreur === "plusieurs-comptes" && (
        <p className="mt-6 rounded-xl bg-warn-soft/70 p-4 text-[13px] text-ink">Cette installation contient plusieurs comptes : utilisez la demande par email ou la commande ci-dessous.</p>
      )}

      <section className="mt-8 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-[14px] font-semibold">Vous utilisez l&apos;app Recap sur Mac ?</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Dans la barre de menus, ouvrez <strong>Recap › Réinitialiser le mot de passe…</strong> : vous choisissez directement un
          nouveau mot de passe, sans email.
        </p>
      </section>

      {mail ? (
        <ForgotForm />
      ) : (
        <section className="mt-4 rounded-xl border border-line bg-surface p-4 text-[13px] text-ink-2">
          <h2 className="text-[14px] font-semibold text-ink">Autre installation (serveur, développement)</h2>
          <p className="mt-1">L&apos;envoi d&apos;emails n&apos;est pas configuré. Depuis le dossier du projet, la commande suivante affiche un lien de réinitialisation :</p>
          <code className="mt-2 block rounded-lg bg-surface-3 px-3 py-2 font-mono text-[12px] text-ink">npm run reset-password -- votre@email</code>
        </section>
      )}

      <p className="mt-6 text-[13px] text-ink-3">
        Vous l&apos;avez retrouvé ? <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">Se connecter</Link>
      </p>
    </>
  );
}
