"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { backupNow, restoreFromBackup } from "@/app/actions/backup";

export function BackupNowButton() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <button type="button" disabled={pending} className={buttonClass("secondary", "sm")}
      onClick={() => start(async () => {
        const r = await backupNow();
        if (r.error) toast(r.error, "bad"); else { toast(r.ok ?? "Sauvegarde effectuée."); router.refresh(); }
      })}>
      {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Save size={14} aria-hidden />}
      Sauvegarder maintenant
    </button>
  );
}

export function RestoreButton({ name, label }: { name: string; label: string }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <button type="button" disabled={pending || busy} className={buttonClass("ghost", "sm")} aria-label={`Restaurer la sauvegarde du ${label}`}
      onClick={() => {
        if (!window.confirm(`Revenir aux données du ${label} ?\n\nTout ce qui a été saisi depuis sera remplacé. L'état actuel est sauvegardé juste avant, vous pourrez donc y revenir.`)) return;
        setBusy(true);
        start(async () => {
          const r = await restoreFromBackup(name);
          setBusy(false);
          if (r.error) toast(r.error, "bad"); else { toast(r.ok ?? "Données restaurées."); router.refresh(); }
        });
      }}>
      {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
      Restaurer
    </button>
  );
}
