"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button, ButtonLink, Card, EmptyState } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <Card>
      <EmptyState
        title="Les dépenses n'ont pas pu être affichées"
        description={<>Une erreur est survenue pendant le calcul. Vos données n&apos;ont pas été modifiées.{error.digest ? <> Référence : <code className="text-[12px]">{error.digest}</code></> : null}</>}
        action={<>
          <Button variant="primary" size="sm" onClick={() => reset()}><RotateCcw size={14} /> Réessayer</Button>
          <ButtonLink href="/depenses" size="sm">Retirer les filtres</ButtonLink>
        </>}
      />
    </Card>
  );
}
