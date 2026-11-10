import Link from "next/link";
import { verifyResetToken } from "@/lib/password-reset";
import { NewPasswordForm } from "./form";

export const metadata = { title: "Nouveau mot de passe" };

export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<{ jeton?: string }> }) {
  const token = (await searchParams).jeton ?? "";
  const user = verifyResetToken(token);
  if (!user) {
    return (
      <>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Lien expiré</h1>
        <p className="mt-1.5 text-ink-2">Ce lien n&apos;est plus valable : il a expiré ou a déjà servi.</p>
        <Link href="/mot-de-passe-oublie" className="mt-6 inline-block font-medium text-ink underline-offset-4 hover:underline">Refaire une demande</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Nouveau mot de passe</h1>
      <p className="mt-1.5 text-ink-2">Pour le compte <strong className="text-ink">{user.email}</strong>.</p>
      <NewPasswordForm token={token} email={user.email} />
    </>
  );
}
