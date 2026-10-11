"use server";

import { revalidatePath } from "next/cache";
import { requireUser, audit } from "@/lib/auth";
import { restoreBackup, runBackup } from "@/lib/backup";

type Result = { ok?: string; error?: string };

export async function backupNow(): Promise<Result> {
  await requireUser();
  try {
    await runBackup("manuelle");
    revalidatePath("/parametres");
    return { ok: "Sauvegarde effectuée." };
  } catch (e) {
    return { error: `La sauvegarde a échoué : ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function restoreFromBackup(name: string): Promise<Result> {
  const user = await requireUser();
  try {
    await restoreBackup(String(name), user.id);
    audit(user.id, "backup", String(name), "restore");
    revalidatePath("/", "layout");
    return { ok: "Données restaurées. L'état précédent a été sauvegardé juste avant." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "La restauration a échoué." };
  }
}
