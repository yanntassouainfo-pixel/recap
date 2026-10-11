import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { CloudUpload, Download, Landmark, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, visibleCompanies } from "@/lib/data";
import { formatDate, todayISO } from "@/lib/dates";
import { CURRENCIES } from "@/lib/money";
import { FIXED_PEGS } from "@/lib/finance/fx";
import { Badge, Card, CardHeader, Notice, PageHeader, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { CategoryDialog, DeleteAccountForm, PasswordForm, PreferencesForm, ProfileForm, RateForm, SenderDialog, TestSmtpButton } from "@/components/settings/forms";
import { ConfirmActionButton } from "@/components/action-dialog";
import { ThemeChoice } from "@/components/theme";
import { BackupNowButton, RestoreButton } from "@/components/settings/backups";
import { backupLocationLabel, BACKUPS_KEPT, lastBackupError, listBackups } from "@/lib/backup";
import { deleteRate, deleteSender, revokeOtherSessions } from "@/app/actions/settings";

export const metadata = { title: "Paramètres" };

const SECTIONS = [
  ["preferences", "Préférences financières"],
  ["apparence", "Apparence"],
  ["devises", "Devises & taux"],
  ["categories", "Catégories"],
  ["emails", "Emails"],
  ["banque", "Connexion bancaire"],
  ["securite", "Compte & sécurité"],
  ["sauvegardes", "Sauvegardes"],
  ["donnees", "Mes données"],
];

const ACTION_LABELS: Record<string, string> = {
  create: "Création", update: "Modification", delete: "Suppression", cancel: "Annulation", login: "Connexion", signup: "Inscription",
  mark_paid: "Paiement confirmé", confirm_occurrence: "Échéance confirmée", skip_occurrence: "Échéance ignorée", archive: "Archivage",
  unarchive: "Réactivation", send: "Envoi", password_change: "Mot de passe modifié", data_export: "Export des données", stage: "Étape modifiée",
  convert: "Conversion en client", onboarding: "Configuration initiale", demo_loaded: "Données d'exemple chargées", revoke_sessions: "Sessions révoquées",
  stop: "Arrêt", resume: "Reprise",
};
const ENTITY_LABELS: Record<string, string> = {
  income: "Recette", expense: "Dépense", payment: "Paiement", invoice: "Facture", transfer: "Transfert", contact: "Contact", company: "Structure",
  activity: "Activité", account: "Compte", settings: "Paramètres", user: "Compte utilisateur", recurring_expense: "Charge récurrente",
  exchange_rate: "Taux de change", sender_identity: "Adresse d'expédition", opportunity: "Opportunité", brand: "Enseigne", document: "Document", email: "Email",
  goal: "Objectif", allocation_rule: "Règle de répartition",
};

const BACKUP_KIND = { auto: "Automatique", manuelle: "Manuelle", "avant-restauration": "Avant restauration" } as const;
const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);

export default async function SettingsPage() {
  const user = await requireUser();
  const backups = listBackups();
  const lastBackup = backups[0];
  const backupError = lastBackupError();
  const canRestore = db.select({ id: schema.users.id }).from(schema.users).limit(2).all().length === 1;
  const settings = getSettings(user.id);
  const today = todayISO();
  const rates = db.select().from(schema.exchangeRates).where(eq(schema.exchangeRates.userId, user.id)).orderBy(desc(schema.exchangeRates.date)).all();
  const categories = db.select().from(schema.categories).where(eq(schema.categories.userId, user.id)).all().sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const companies = visibleCompanies(user.id).filter((c) => c.kind !== "personal");
  const senders = db.select().from(schema.senderIdentities).where(eq(schema.senderIdentities.userId, user.id)).all();
  const sessions = db.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id)).orderBy(desc(schema.sessions.createdAt)).all();
  const token = (await cookies()).get("recap_session")?.value ?? "";
  const currentSession = createHash("sha256").update(token).digest("hex");
  const logs = db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, user.id)).orderBy(desc(schema.auditLog.at)).limit(40).all();
  const smtpConfigured = !!process.env.SMTP_HOST;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Paramètres" description="Vos préférences financières, devises, adresses d'envoi, sécurité et données." />
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Sections des paramètres">
          <ul className="sticky top-24 space-y-0.5">
            {SECTIONS.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink">{label}</a></li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <Card id="preferences" className="scroll-mt-24">
            <CardHeader title="Préférences financières" description="Mode d'utilisation, devise de référence, espace personnel et seuil d'alerte." />
            <div className="px-5 pb-5"><PreferencesForm settings={settings} /></div>
          </Card>

          <Card id="apparence" className="scroll-mt-24">
            <CardHeader title="Apparence" description="Mode clair pour un environnement lumineux, mode sombre, ou automatique pour suivre le réglage de votre Mac." />
            <div className="px-5 pb-5"><ThemeChoice /></div>
          </Card>

          <Card id="devises" className="scroll-mt-24">
            <CardHeader title="Devises & taux de change" description="Les montants d'origine sont toujours conservés ; les conversions utilisent le taux le plus récent à la date de l'opération."
              action={<RateForm baseCurrency={settings.baseCurrency} today={today} />} />
            <div className="px-5 pb-2">
              <Notice tone="info">Les parités fixes du franc CFA (1 € = 655,957 F CFA) sont appliquées automatiquement. Pour le dollar ou d&apos;autres devises, ajoutez des taux datés : sans taux, les montants concernés sont exclus des totaux et signalés.</Notice>
            </div>
            <Table>
              <thead><tr><Th>Date</Th><Th>Taux</Th><Th>Source</Th><Th /></tr></thead>
              <tbody>
                {FIXED_PEGS.map((p) => (
                  <tr key={p.quote}><Td className="text-ink-3">Permanent</Td><Td className="tabular">1 {p.base} = {p.rate} {p.quote}</Td><Td><Badge>{p.source}</Badge></Td><Td /></tr>
                ))}
                {rates.map((r) => (
                  <tr key={r.id}>
                    <Td>{formatDate(r.date)}</Td>
                    <Td className="tabular">1 {r.base} = {r.rate.toLocaleString("fr-FR", { maximumFractionDigits: 6 })} {r.quote}</Td>
                    <Td className="text-ink-2">{r.source}</Td>
                    <Td align="right"><ConfirmActionButton run={deleteRate.bind(null, r.id)} confirm="Supprimer ce taux ? Les conversions utiliseront le taux disponible le plus proche." className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-bad" done="Taux supprimé."><Trash2 size={14} aria-label="Supprimer" /></ConfirmActionButton></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="px-5 py-3 text-[12px] text-ink-3">Devises prises en charge : {Object.values(CURRENCIES).map((c) => c.code).join(", ")}.</p>
          </Card>

          <Card id="categories" className="scroll-mt-24">
            <CardHeader title="Catégories" description="Pour comprendre où part l'argent. Les charges fixes reviennent quel que soit votre niveau d'activité." />
            <div className="grid gap-6 px-5 pb-5 md:grid-cols-2">
              {(["expense", "income"] as const).map((kind) => (
                <div key={kind}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold">{kind === "expense" ? "Dépenses" : "Revenus"}</h3>
                    <CategoryDialog kind={kind} />
                  </div>
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {categories.filter((c) => c.kind === kind).map((c) => (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                        <span className="flex-1">{c.name}</span>
                        {kind === "expense" && <Badge tone={c.nature === "fixed" ? "info" : "neutral"}>{c.nature === "fixed" ? "Fixe" : "Variable"}</Badge>}
                        <CategoryDialog category={c} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card id="emails" className="scroll-mt-24">
            <CardHeader title="Emails" description="Serveur d'envoi et adresses autorisées pour chaque structure." action={<SenderDialog companies={companies.map((c) => ({ id: c.id, name: c.name, email: c.email }))} />} />
            <div className="space-y-4 px-5 pb-5">
              <div className={cx("flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center", smtpConfigured ? "bg-good-soft/60" : "bg-warn-soft/70")}>
                <div className="flex-1 text-[13px]">
                  <div className="font-medium text-ink">{smtpConfigured ? `Serveur d'envoi configuré : ${process.env.SMTP_HOST}` : "Envoi d'emails non configuré"}</div>
                  <p className="text-ink-2">{smtpConfigured
                    ? "Un email n'est marqué « envoyé » qu'après confirmation technique du serveur."
                    : "Renseignez SMTP_HOST, SMTP_PORT, SMTP_USER et SMTP_PASS dans le fichier .env.local du serveur puis redémarrez. En attendant, vos emails sont enregistrés comme brouillons."}</p>
                </div>
                {smtpConfigured && <TestSmtpButton />}
              </div>
              {senders.length === 0 ? (
                <p className="text-[13px] text-ink-3">Aucune adresse d&apos;expédition. Ajoutez-en une par structure.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {senders.map((s) => {
                    const c = companies.find((x) => x.id === s.companyId);
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold text-white" style={{ background: c?.color ?? "var(--ink-3)" }}>{(c?.name ?? "?").slice(0, 1)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-medium">{s.fromName} &lt;{s.fromEmail}&gt;</div>
                          <div className="text-[12px] text-ink-3">{c?.name ?? "Structure archivée"}{s.replyTo ? ` · réponse à ${s.replyTo}` : ""}</div>
                        </div>
                        <Badge tone={s.authorized ? "good" : "warn"} dot>{s.authorized ? "Autorisée" : "Non autorisée"}</Badge>
                        <SenderDialog companies={companies.map((x) => ({ id: x.id, name: x.name, email: x.email }))} sender={s} />
                        <ConfirmActionButton run={deleteSender.bind(null, s.id)} confirm={`Supprimer l'adresse ${s.fromEmail} ?`} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-bad" done="Adresse supprimée."><Trash2 size={14} aria-label="Supprimer" /></ConfirmActionButton>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card id="banque" className="scroll-mt-24">
            <CardHeader title="Connexion bancaire" description="Récupérer automatiquement vos transactions et soldes." />
            <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2"><Landmark size={20} /></div>
              <div className="space-y-2 text-[13px] text-ink-2">
                <div className="flex items-center gap-2"><span className="font-medium text-ink">Connexion bancaire indisponible pour le moment</span><Badge>Phase 4</Badge></div>
                <p>La disponibilité dépend de votre banque, des prestataires agréés et de votre pays : aucune connexion universelle n&apos;existe. Recap est prêt à l&apos;accueillir (comptes synchronisés, transactions importées, rapprochement avec vos factures et dépenses), via des prestataires autorisés uniquement.</p>
                <p className="flex items-start gap-2"><Lock size={14} className="mt-0.5 shrink-0" /> Recap ne vous demandera jamais votre mot de passe bancaire.</p>
                <p>En attendant, vos soldes sont calculés à partir des soldes de référence de vos comptes et des opérations que vous enregistrez.</p>
              </div>
            </div>
          </Card>

          <Card id="securite" className="scroll-mt-24">
            <CardHeader title="Compte & sécurité" />
            <div className="space-y-6 px-5 pb-5">
              <ProfileForm name={user.name} email={user.email} />
              <div className="border-t border-line pt-5"><PasswordForm /></div>
              <div className="border-t border-line pt-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[13px] font-semibold"><ShieldCheck size={15} className="text-ink-3" /> Sessions actives</h3>
                  {sessions.length > 1 && <ConfirmActionButton run={revokeOtherSessions} confirm="Déconnecter tous les autres appareils ?" className={buttonClass("secondary", "sm")} done="Autres sessions déconnectées.">Déconnecter les autres appareils</ConfirmActionButton>}
                </div>
                <ul className="divide-y divide-line rounded-xl border border-line text-[12.5px]">
                  {sessions.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="truncate text-ink-2">{s.userAgent?.replace(/\(.*?\)/g, "").slice(0, 70) || "Appareil inconnu"}</span>
                      <span className="shrink-0 text-ink-3">{s.id === currentSession ? <Badge tone="good">Cet appareil</Badge> : `depuis le ${formatDate(s.createdAt.slice(0, 10))}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-line pt-5">
                <h3 className="mb-2 text-[13px] font-semibold">Journal des opérations sensibles</h3>
                <p className="mb-3 text-[12.5px] text-ink-3">Chaque création, modification ou suppression d&apos;une facture, d&apos;un paiement, d&apos;une dépense ou d&apos;un paramètre est tracée avec l&apos;état avant / après.</p>
                <div className="max-h-[320px] overflow-y-auto rounded-xl border border-line">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id} className="border-b border-line last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 text-ink-3 tabular">{new Date(l.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                          <td className="px-3 py-2">{ENTITY_LABELS[l.entity] ?? l.entity}</td>
                          <td className="px-3 py-2 text-ink-2">{ACTION_LABELS[l.action] ?? l.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Card>

          <Card id="sauvegardes" className="scroll-mt-24">
            <CardHeader title="Sauvegardes" description="Une copie complète de vos données est faite automatiquement chaque jour."
              action={<BackupNowButton />} />
            <div className="space-y-4 px-5 pb-5">
              <div className={cx("flex items-start gap-3 rounded-xl p-4", backupError ? "bg-bad-soft/70" : lastBackup ? "bg-good-soft/60" : "bg-warn-soft/70")}>
                <CloudUpload size={18} className={cx("mt-0.5 shrink-0", backupError ? "text-bad" : lastBackup ? "text-good" : "text-warn")} aria-hidden />
                <div className="text-[13px]">
                  <div className="font-medium text-ink">
                    {backupError ? "La dernière sauvegarde automatique a échoué" : lastBackup ? `Dernière sauvegarde : ${formatDateTime(lastBackup.createdAt)}` : "Aucune sauvegarde pour l'instant"}
                  </div>
                  <div className="mt-0.5 text-ink-2">
                    {backupError ? backupError : lastBackup ? `Emplacement : ${backupLocationLabel()}` : "La première sera faite dans quelques secondes, ou dès maintenant avec « Sauvegarder maintenant »."}
                  </div>
                  <div className="mt-0.5 text-ink-3">Base de données et documents envoyés · les {BACKUPS_KEPT} dernières sauvegardes sont conservées.</div>
                </div>
              </div>
              {backups.length > 0 && (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {backups.slice(0, 8).map((b) => (
                    <li key={b.name} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <span className="flex-1 text-ink">{formatDateTime(b.createdAt)}</span>
                      <Badge tone={b.kind === "auto" ? "neutral" : b.kind === "manuelle" ? "info" : "warn"}>{BACKUP_KIND[b.kind]}</Badge>
                      <span className="hidden w-16 text-right text-ink-3 tabular sm:inline">{formatSize(b.size)}</span>
                      {canRestore && <RestoreButton name={b.name} label={formatDateTime(b.createdAt)} />}
                    </li>
                  ))}
                </ul>
              )}
              {!canRestore && backups.length > 0 && (
                <p className="text-[12.5px] text-ink-3">La restauration depuis l&apos;application est réservée à une installation à un seul utilisateur.</p>
              )}
            </div>
          </Card>

          <Card id="donnees" className="scroll-mt-24">
            <CardHeader title="Mes données" description="Vos données vous appartiennent." />
            <div className="space-y-5 px-5 pb-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[13px] text-ink-2">Exporter l&apos;ensemble de vos données (structures, comptes, factures, paiements, dépenses, contacts, documents, emails, journal) au format JSON.</p>
                <a href="/api/account/export" className={buttonClass("secondary", "sm")}><Download size={14} /> Exporter mes données</a>
              </div>
              <div className="border-t border-line pt-5">
                <h3 className="mb-1 text-[13px] font-semibold text-bad">Supprimer mon compte</h3>
                <p className="mb-3 text-[12.5px] text-ink-3">Suppression définitive de votre compte et de toutes vos données, conformément aux règles applicables.</p>
                <DeleteAccountForm email={user.email} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
