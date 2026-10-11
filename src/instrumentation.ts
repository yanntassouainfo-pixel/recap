// Exécuté une fois au démarrage du serveur Next (runtime Node uniquement).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackupScheduler } = await import("./lib/backup");
  startBackupScheduler();
}
