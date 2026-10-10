import Link from "next/link";
import { eq } from "drizzle-orm";
import { Archive, ArchiveRestore, Building2, Landmark, Smartphone, Tag, User, Wallet, CreditCard, Banknote } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/data";
import { loadFinanceDataFrom } from "@/lib/finance/load";
import { accountBalances, cashMovements, profitability } from "@/lib/finance/engine";
import { addDays, formatDate, todayISO } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { ACCOUNT_TYPES, MODES } from "@/lib/labels";
import { Badge, Card, EmptyState, Notice, PageHeader, cx } from "@/components/ui";
import { AccountDialog, ActivityDialog, BrandDialog, CompanyDialog } from "@/components/structures/forms";
import { ConfirmActionButton } from "@/components/action-dialog";
import { archiveAccount, archiveActivity, archiveCompany, deleteBrand } from "@/app/actions/structures";

export const metadata = { title: "Entreprises & activités" };

const ACCOUNT_ICON = { bank: Landmark, cash: Banknote, mobile_money: Smartphone, card: CreditCard, payment: Wallet } as const;

export default async function StructuresPage({ searchParams }: { searchParams: Promise<{ archives?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const settings = getSettings(user.id);
  const today = todayISO();
  const companies = db.select().from(schema.companies).where(eq(schema.companies.userId, user.id)).all()
    .filter((c) => c.kind !== "personal" || settings.personalSpaceEnabled);
  const showArchived = sp.archives === "1";
  const activities = db.select().from(schema.activities).where(eq(schema.activities.userId, user.id)).all();
  const brands = db.select().from(schema.brands).where(eq(schema.brands.userId, user.id)).all();
  const allIds = new Set(companies.map((c) => c.id));
  const data = loadFinanceDataFrom(db, user.id, { companyIds: allIds, label: "all" }, today);
  const movements = cashMovements(data);
  const balances = new Map(accountBalances({ ...data, accounts: data.accounts.map((a) => ({ ...a, archived: false })) }, movements).map((b) => [b.account.id, b]));
  const profit = profitability(data, addDays(today, -89), today, { movements });
  const profitByActivity = new Map(profit.activities.map((a) => [a.activityId, a]));
  const accounts = db.select().from(schema.accounts).where(eq(schema.accounts.userId, user.id)).all();
  const companyOptions = companies.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, kind: c.kind, currency: c.currency }));
  const pros = companies.filter((c) => c.kind !== "personal");
  const visible = companies.filter((c) => showArchived || !c.archived);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Entreprises & activités"
        description="Comment votre univers professionnel est organisé : structures juridiques, enseignes commerciales, activités analysées et comptes."
        actions={<><AccountDialog companies={companyOptions} today={today} /><CompanyDialog variant="primary" /></>}
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {[
          { icon: Building2, title: "Structure", text: "L'entité juridique ou commerciale à laquelle appartiennent les opérations (entreprise individuelle, SARL…)." },
          { icon: Tag, title: "Enseigne", text: "Le nom commercial sous lequel vous exercez. Facultatif : utile si une structure porte plusieurs marques." },
          { icon: Wallet, title: "Activité", text: "Le métier ou la ligne de revenus à analyser : formation, coaching, conseil… La base de l'analyse de rentabilité." },
        ].map((x) => (
          <div key={x.title} className="flex gap-3 rounded-2xl bg-surface-3/60 p-4">
            <x.icon size={18} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
            <div><div className="text-[13.5px] font-semibold">{x.title}</div><p className="text-[12.5px] leading-relaxed text-ink-2">{x.text}</p></div>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        Mode actuel : <Badge tone="accent">{MODES[settings.mode]?.label}</Badge>
        <span className="text-ink-3">— {MODES[settings.mode]?.description}</span>
        <Link href="/parametres#mode" className="font-medium text-accent hover:underline underline-offset-4">Changer</Link>
      </div>

      {pros.length === 0 && (
        <Card className="mb-6"><EmptyState icon={<Building2 size={20} />} title="Aucune structure" description="Créez votre première structure pour enregistrer vos revenus, dépenses et factures." action={<CompanyDialog variant="primary" />} /></Card>
      )}

      <div className="space-y-5">
        {visible.map((c) => {
          const acts = activities.filter((a) => a.companyId === c.id && (showArchived || !a.archived));
          const accs = accounts.filter((a) => a.companyId === c.id && (showArchived || !a.archived));
          const brs = brands.filter((b) => b.companyId === c.id);
          const total = accs.filter((a) => !a.archived).reduce((s, a) => s + (balances.get(a.id)?.balanceBase ?? 0), 0);
          const personal = c.kind === "personal";
          return (
            <Card key={c.id} className={cx(c.archived && "opacity-70")}>
              <div className="flex flex-col gap-4 border-b border-line p-5 sm:flex-row sm:items-start">
                {c.logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/documents/${c.logoPath}?inline=1`} alt="" className="size-12 rounded-xl object-contain bg-surface-2" />
                ) : (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl text-[18px] font-semibold text-white" style={{ background: personal ? "var(--ink-3)" : c.color }}>
                    {personal ? <User size={20} /> : c.name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{personal ? "Espace personnel" : c.name}</h2>
                    {personal && <Badge>Séparé de vos structures</Badge>}
                    {c.archived && <Badge tone="warn">Archivée</Badge>}
                    <Badge>{c.currency}</Badge>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-3">{personal ? "Revenus personnels, loyer, dépenses courantes, épargne. Les transferts depuis vos structures sont des rémunérations, pas des revenus nouveaux." : [c.legalName, c.description].filter(Boolean).join(" · ") || "Aucune description"}</p>
                  {!personal && (
                    <p className="mt-1 text-[12.5px] text-ink-3">
                      {[c.email, c.phone, c.address].filter(Boolean).join(" · ") || "Coordonnées à compléter pour vos factures"} · Factures {c.invoicePrefix}-AAAA-NNN · paiement à {c.paymentTermsDays} j
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 sm:flex-col sm:items-end">
                  <div className="text-right">
                    <div className="text-[11.5px] text-ink-3">Disponible</div>
                    <div className={cx("text-[17px] font-semibold tabular", total < 0 && "text-bad")}>{formatMoney(total, settings.baseCurrency)}</div>
                  </div>
                  {!personal && (
                    <div className="ml-auto flex items-center gap-0.5 sm:ml-0 sm:mt-2">
                      <CompanyDialog variant="icon" company={c} />
                      <ConfirmActionButton run={archiveCompany.bind(null, c.id, !c.archived)} confirm={c.archived ? undefined : `Archiver « ${c.name} » ? Ses données sont conservées mais elle n'apparaît plus dans les vues.`}
                        className="rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink" done={c.archived ? "Structure réactivée." : "Structure archivée."}>
                        {c.archived ? <ArchiveRestore size={15} aria-label="Réactiver" /> : <Archive size={15} aria-label="Archiver" />}
                      </ConfirmActionButton>
                    </div>
                  )}
                </div>
              </div>

              <div className={cx("grid gap-0", !personal && "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]")}>
                {!personal && (
                  <div className="border-b border-line p-5 lg:border-b-0 lg:border-r">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-[13.5px] font-semibold">Activités <span className="font-normal text-ink-3">· marge sur 90 jours</span></h3>
                      <div className="flex gap-1"><BrandDialog companyId={c.id} /><ActivityDialog companyId={c.id} currency={c.currency} brands={brs} /></div>
                    </div>
                    {brs.length > 0 && (
                      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                        <span className="text-ink-3">Enseignes :</span>
                        {brs.map((b) => (
                          <span key={b.id} className="inline-flex items-center gap-1 rounded-full bg-surface-3 py-0.5 pl-2.5 pr-1 text-ink-2">
                            {b.name}
                            <BrandDialog companyId={c.id} brand={b} />
                            <ConfirmActionButton run={deleteBrand.bind(null, b.id)} confirm={`Supprimer l'enseigne « ${b.name} » ? Les activités et factures associées sont conservées.`} className="rounded-full px-1 text-ink-3 hover:text-bad" done="Enseigne supprimée.">×</ConfirmActionButton>
                          </span>
                        ))}
                      </div>
                    )}
                    {acts.length === 0 ? (
                      <p className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-3">Aucune activité. Créez-en une pour analyser la rentabilité de vos métiers.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {acts.map((a) => {
                          const p = profitByActivity.get(a.id);
                          return (
                            <li key={a.id} className={cx("flex items-center gap-3 py-2.5", a.archived && "opacity-60")}>
                              <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13.5px] font-medium">{a.name} {a.archived && <Badge tone="warn">Archivée</Badge>}</div>
                                <div className="text-[12px] text-ink-3">
                                  {[a.category, brs.find((b) => b.id === a.brandId)?.name].filter(Boolean).join(" · ") || "—"}
                                  {a.monthlyRevenueTarget ? ` · objectif ${formatMoney(a.monthlyRevenueTarget, c.currency)}/mois` : ""}
                                </div>
                              </div>
                              <div className="hidden text-right sm:block">
                                <div className="text-[13px] tabular">{p ? formatMoney(p.invoiced, settings.baseCurrency) : "—"}</div>
                                <div className="text-[11.5px] text-ink-3">marge {formatPercent(p?.marginRate)}</div>
                              </div>
                              <ActivityDialog companyId={c.id} currency={c.currency} brands={brs} activity={a} />
                              <ConfirmActionButton run={archiveActivity.bind(null, a.id, !a.archived)} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" done={a.archived ? "Activité réactivée." : "Activité archivée."}
                                confirm={a.archived ? undefined : `Archiver « ${a.name} » ? Son historique est conservé.`}>
                                {a.archived ? <ArchiveRestore size={14} aria-label="Réactiver" /> : <Archive size={14} aria-label="Archiver" />}
                              </ConfirmActionButton>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
                <div className="p-5" id={c === visible[0] ? "comptes" : undefined}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[13.5px] font-semibold">Comptes</h3>
                    <AccountDialog companies={companyOptions} defaultCompanyId={c.id} today={today} />
                  </div>
                  {accs.length === 0 ? (
                    <p className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-3">Aucun compte : l&apos;argent disponible de cette structure ne peut pas être calculé.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {accs.map((a) => {
                        const b = balances.get(a.id);
                        const Icon = ACCOUNT_ICON[a.type as keyof typeof ACCOUNT_ICON] ?? Wallet;
                        return (
                          <li key={a.id} className={cx("flex items-center gap-3 py-2.5", a.archived && "opacity-60")}>
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2"><Icon size={15} aria-hidden /></span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] font-medium">{a.name}</div>
                              <div className="text-[11.5px] text-ink-3">{ACCOUNT_TYPES[a.type] ?? a.type}{a.institution ? ` · ${a.institution}` : ""} · depuis le {formatDate(a.openingDate)}{a.source === "manual" ? " · saisie manuelle" : ""}</div>
                            </div>
                            <div className={cx("text-right text-[13.5px] font-medium tabular", (b?.balance ?? 0) < 0 && "text-bad")}>{b ? formatMoney(b.balance, a.currency) : "—"}</div>
                            <AccountDialog companies={companyOptions} account={a} today={today} />
                            <ConfirmActionButton run={archiveAccount.bind(null, a.id, !a.archived)} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" done={a.archived ? "Compte réactivé." : "Compte archivé."}
                              confirm={a.archived ? undefined : `Archiver « ${a.name} » ? Il ne sera plus compté dans l'argent disponible.`}>
                              {a.archived ? <ArchiveRestore size={14} aria-label="Réactiver" /> : <Archive size={14} aria-label="Archiver" />}
                            </ConfirmActionButton>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!settings.personalSpaceEnabled && (
        <div className="mt-6"><Notice title="Espace personnel désactivé" action={<Link href="/parametres#mode" className="text-[13px] font-medium text-accent">Activer</Link>}>Activez-le pour suivre vos finances personnelles à part, et voir comment vos revenus professionnels y contribuent.</Notice></div>
      )}
      <div className="mt-6 text-center">
        <Link href={showArchived ? "/structures" : "/structures?archives=1"} className="text-[12.5px] text-ink-3 hover:text-ink">{showArchived ? "Masquer les éléments archivés" : "Afficher les éléments archivés"}</Link>
      </div>
    </div>
  );
}
