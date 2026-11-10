// Exécuté une fois au démarrage du serveur Next. La condition doit rester sous cette forme (`=== "nodejs"` autour
// de l'import) pour que la version « edge » n'embarque pas better-sqlite3, qui n'y est pas disponible.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupScheduler } = await import("./lib/backup");
    startBackupScheduler();
  }
}
