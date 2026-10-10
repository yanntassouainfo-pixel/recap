import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { ArrowLeft, Download, FileText, Mail, Paperclip, Pencil, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { formatDate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { invoiceState } from "@/lib/finance/engine";
import { computeTotals, PAYMENT_METHOD_LABELS, QUOTE_STATUS, quoteDisplayStatus } from "@/lib/invoices";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, InvoiceStatusBadge, Money, Notice, PageHeader, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import {
  CancelInvoiceButton, ConvertQuoteButton, DeleteDraftButton, DeletePaymentButton, DuplicateButton, MarkSentButton, QuoteDecisionButtons,
} from "@/components/invoices/buttons";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const inv = db.select({ number: schema.invoices.number, docType: schema.invoices.docType }).from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.userId, user.id))).get();
  return { title: inv ? `${inv.docType === "quote" ? "Devis" : "Facture"} ${inv.number}` : "Document introuvable" };
}

const FIELD_LABELS: Record<string, string> = {
  status: "Statut", total: "Total", issueDate: "Date d'émission", dueDate: "Échéance", currency: "Devise", title: "Objet",
  contactId: "Client", companyId: "Structure", activityId: "Activité", number: "Numéro", notes: "Notes", counterpartCompanyId: "Structure facturée",
};
const STATUS_WORD: Record<string, string> = { draft: "Brouillon", sent: "Envoyé", cancelled: "Annulé", accepted: "Accepté", declined: "Refusé" };
const ACTION_LABELS: Record<string, string> = { create: "Création", update: "Modification", send: "Marqué comme envoyé", cancel: "Annulation", delete: "Suppression", convert: "Transformé en facture" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const inv = db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.userId, user.id))).get();
  if (!inv) notFound();

  const isQuote = inv.docType === "quote";
  const today = todayISO();
  const company = db.select().from(schema.companies).where(eq(schema.companies.id, inv.companyId)).get()!;
  const lines = db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id)).orderBy(asc(schema.invoiceLines.position)).all();
  const payments = db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id)).orderBy(asc(schema.payments.date)).all();
  const contact = inv.contactId ? db.select().from(schema.contacts).where(eq(schema.contacts.id, inv.contactId)).get() : undefined;
  const counterpart = inv.counterpartCompanyId ? db.select().from(schema.companies).where(eq(schema.companies.id, inv.counterpartCompanyId)).get() : undefined;
  const activity = inv.activityId ? db.select().from(schema.activities).where(eq(schema.activities.id, inv.activityId)).get() : undefined;
  const brand = inv.brandId ? db.select().from(schema.brands).where(eq(schema.brands.id, inv.brandId)).get() : undefined;
  const accounts = new Map(db.select().from(schema.accounts).where(eq(schema.accounts.userId, user.id)).all().map((a) => [a.id, a]));
  const convertedFrom = inv.convertedFromId ? db.select().from(schema.invoices).where(and(eq(schema.invoices.id, inv.convertedFromId), eq(schema.invoices.userId, user.id))).get() : undefined;
  const convertedTo = isQuote ? db.select().from(schema.invoices).where(and(eq(schema.invoices.userId, user.id), eq(schema.invoices.convertedFromId, inv.id))).all() : [];

  const state = invoiceState(inv, payments, today);
  const status = isQuote ? quoteDisplayStatus(inv, today) : state.status;
  const totals = computeTotals(lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate })));
  const m = (v: number) => formatMoney(v, inv.currency);
  const canPay = !isQuote && inv.status !== "cancelled" && state.remaining > 0;
  const emailTemplate = !isQuote && state.status === "overdue" ? "invoice_reminder" : isQuote ? "quote" : "invoice";

  const history = db.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.userId, user.id), or(
      and(eq(schema.auditLog.entity, "invoice"), eq(schema.auditLog.entityId, inv.id)),
      payments.length ? and(eq(schema.auditLog.entity, "payment"), inArray(schema.auditLog.entityId, payments.map((p) => p.id))) : undefined,
    )))
    .orderBy(desc(schema.auditLog.at)).limit(50).all();
  // Les paiements supprimés ne sont plus dans la table : on retrouve leur trace par la facture référencée.
  const deletedPayments = db.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.userId, user.id), eq(schema.auditLog.entity, "payment"), eq(schema.auditLog.action, "delete"))).all()
    .filter((h) => { try { return JSON.parse(h.before ?? "{}").invoiceId === inv.id; } catch { return false; } });
  const timeline = [...history, ...deletedPayments].sort((a, b) => (a.at < b.at ? 1 : -1));

  const clientName = contact ? contact.name : counterpart ? counterpart.name : "Client non renseigné";
  const docLabel = isQuote ? "Devis" : "Facture";

  return (
    <>
      <Link href={`/revenus${isQuote ? "?onglet=devis" : ""}`} className="mb-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-3 hover:text-ink"><ArrowLeft size={14} aria-hidden /> {isQuote ? "Devis" : "Factures"}</Link>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">{docLabel}{inv.source === "imported" && <Badge>Importée</Badge>}</span>}
        title={<span className="inline-flex flex-wrap items-center gap-3">{inv.number}
          {isQuote
            ? <Badge tone={QUOTE_STATUS[status].tone} dot>{QUOTE_STATUS[status].label}</Badge>
            : <InvoiceStatusBadge status={status} paid={state.paid > 0} />}
        </span>}
        description={inv.title ?? `${docLabel} pour ${clientName}`}
        actions={
          <>
            <a href={`/api/invoices/${inv.id}/pdf`} className={buttonClass("secondary", "sm")}><Download size={14} aria-hidden /> Télécharger le PDF</a>
            {inv.status !== "cancelled" && (
              <ButtonLink size="sm" href={`/emails/nouveau?invoice=${inv.id}&template=${emailTemplate}`}>
                <Mail size={14} aria-hidden /> {emailTemplate === "invoice_reminder" ? "Relancer par email" : "Envoyer par email"}
              </ButtonLink>
            )}
            {inv.status !== "cancelled" && <ButtonLink size="sm" href={`/revenus/${inv.id}/modifier`}><Pencil size={14} aria-hidden /> Modifier</ButtonLink>}
            <DuplicateButton id={inv.id} />
            {canPay && (
              <QuickButton kind="payment" preset={{ invoiceId: inv.id }} className={buttonClass("primary", "sm")}><Wallet size={14} aria-hidden /> Enregistrer un paiement</QuickButton>
            )}
          </>
        }
      />

      {inv.status === "cancelled" && <div className="mb-5"><Notice tone="info" title={`${docLabel} annulé${isQuote ? "" : "e"}`}>Ce document reste consultable mais n&apos;est plus compté dans vos montants à encaisser.</Notice></div>}
      {inv.status === "draft" && (
        <div className="mb-5">
          <Notice tone="info" title="Brouillon" action={<div className="flex flex-wrap gap-2"><MarkSentButton id={inv.id} isQuote={isQuote} className={buttonClass("primary", "sm")} />{!payments.length && <DeleteDraftButton id={inv.id} number={inv.number} />}</div>}>
            {isQuote ? "Ce devis n'a pas encore été envoyé." : "Tant qu'elle est en brouillon, cette facture ne compte pas dans vos montants à encaisser. Marquez-la comme envoyée dès que le client l'a reçue."}
          </Notice>
        </div>
      )}
      {isQuote && inv.status !== "cancelled" && inv.status !== "draft" && (
        <div className="mb-5">
          <Notice tone={status === "accepted" ? "good" : status === "expired" ? "warn" : "info"}
            title={status === "accepted" ? "Devis accepté" : status === "declined" ? "Devis refusé" : status === "expired" ? "Devis expiré" : "En attente de la réponse du client"}
            action={<div className="flex flex-wrap gap-2">
              <QuoteDecisionButtons id={inv.id} status={inv.status} />
              {inv.status !== "declined" && !convertedTo.some((c) => c.status !== "cancelled") && <ConvertQuoteButton id={inv.id} />}
            </div>}>
            {convertedTo.length > 0
              ? <>Facture créée : {convertedTo.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link className="font-medium text-accent hover:underline underline-offset-4" href={`/revenus/${c.id}`}>{c.number}</Link></span>)}.</>
              : status === "expired" ? `Valable jusqu'au ${formatDate(inv.dueDate)}. Relancez le client ou dupliquez le devis avec une nouvelle date.` : "Indiquez la réponse du client ; un devis accepté se transforme en facture sans ressaisie."}
          </Notice>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-5">
          {/* Aperçu lisible */}
          <Card className="overflow-hidden">
            <div className="h-1" style={{ background: company.color }} aria-hidden />
            <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-7">
              <div>
                <div className="text-[15px] font-semibold text-ink">{company.legalName || company.name}</div>
                {brand && <div className="text-[12.5px] text-ink-3">Enseigne {brand.name}</div>}
                <address className="mt-1 whitespace-pre-line text-[12.5px] not-italic leading-relaxed text-ink-2">
                  {[company.address, company.email, company.phone, company.taxId ? `Identifiant fiscal : ${company.taxId}` : null].filter(Boolean).join("\n")}
                </address>
              </div>
              <div className="sm:text-right">
                <div className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">{isQuote ? "Devis pour" : "Facturé à"}</div>
                <div className="mt-1 text-[14px] font-medium text-ink">{contact ? contact.name : counterpart ? counterpart.legalName || counterpart.name : "—"}</div>
                <address className="mt-0.5 whitespace-pre-line text-[12.5px] not-italic leading-relaxed text-ink-2">
                  {[contact?.organization, contact?.address ?? counterpart?.address, contact?.email ?? counterpart?.email].filter(Boolean).join("\n")}
                </address>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 border-y border-line bg-surface-2 px-5 py-3 text-[12.5px] sm:grid-cols-4 sm:px-7">
              <div><dt className="text-ink-3">Numéro</dt><dd className="font-medium text-ink">{inv.number}</dd></div>
              <div><dt className="text-ink-3">Émis{isQuote ? "" : "e"} le</dt><dd className="text-ink">{formatDate(inv.issueDate)}</dd></div>
              <div><dt className="text-ink-3">{isQuote ? "Valable jusqu'au" : "Échéance"}</dt><dd className="text-ink">{formatDate(inv.dueDate)}</dd></div>
              <div><dt className="text-ink-3">Devise</dt><dd className="text-ink">{inv.currency}</dd></div>
            </dl>
            <div className="hidden md:block">
              <Table>
                <thead><tr><Th className="pl-7">Désignation</Th><Th align="right">Qté</Th><Th align="right">Prix unit. HT</Th><Th align="right">TVA</Th><Th align="right" className="pr-7">Montant HT</Th></tr></thead>
                <tbody>
                  {totals.lines.map((l, i) => (
                    <tr key={i}>
                      <Td className="pl-7 text-ink">{l.description}</Td>
                      <Td align="right" className="tabular">{String(Math.round(l.quantity * 1000) / 1000).replace(".", ",")}</Td>
                      <Td align="right"><Money value={l.unitPrice} currency={inv.currency} /></Td>
                      <Td align="right" className="text-ink-3">{l.taxRate ? `${String(l.taxRate).replace(".", ",")} %` : "—"}</Td>
                      <Td align="right" className="pr-7"><Money value={l.amount} currency={inv.currency} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {totals.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 px-5 py-3 text-[13px]">
                  <div className="min-w-0"><div className="text-ink">{l.description}</div><div className="text-[12px] text-ink-3">{String(l.quantity).replace(".", ",")} × {m(l.unitPrice)}{l.taxRate ? ` · TVA ${String(l.taxRate).replace(".", ",")} %` : ""}</div></div>
                  <Money value={l.amount} currency={inv.currency} className="shrink-0" />
                </li>
              ))}
            </ul>
            <div className="flex justify-end px-5 py-4 sm:px-7">
              <dl className="w-full max-w-xs space-y-1.5 text-[13px]">
                <div className="flex justify-between"><dt className="text-ink-3">Total HT</dt><dd className="tabular">{m(inv.subtotal)}</dd></div>
                {totals.taxes.map((t) => <div key={t.rate} className="flex justify-between"><dt className="text-ink-3">TVA {String(t.rate).replace(".", ",")} %</dt><dd className="tabular">{m(t.amount)}</dd></div>)}
                <div className="flex justify-between border-t border-line pt-2 text-[15px] font-semibold text-ink"><dt>Total TTC</dt><dd className="tabular">{m(inv.total)}</dd></div>
                {!isQuote && state.paid > 0 && <>
                  <div className="flex justify-between text-ink-3"><dt>Déjà réglé</dt><dd className="tabular">− {m(state.paid)}</dd></div>
                  <div className="flex justify-between font-medium text-ink"><dt>Reste à payer</dt><dd className="tabular">{m(state.remaining)}</dd></div>
                </>}
              </dl>
            </div>
            {(company.billingDetails || inv.notes) && (
              <div className="grid gap-4 border-t border-line px-5 py-4 text-[12.5px] sm:grid-cols-2 sm:px-7">
                {company.billingDetails && <div><div className="font-medium text-ink-2">Coordonnées de paiement</div><p className="mt-1 whitespace-pre-line text-ink-3">{company.billingDetails}</p></div>}
                {inv.notes && <div><div className="font-medium text-ink-2">Mentions</div><p className="mt-1 whitespace-pre-line text-ink-3">{inv.notes}</p></div>}
              </div>
            )}
          </Card>

          {!isQuote && (
            <Card>
              <CardHeader title="Paiements reçus" description={payments.length ? `${payments.length} paiement${payments.length > 1 ? "s" : ""} · ${m(state.paid)} encaissés` : undefined}
                action={canPay ? <QuickButton kind="payment" preset={{ invoiceId: inv.id }} className={buttonClass("secondary", "sm")}>Enregistrer un paiement</QuickButton> : undefined} />
              {payments.length === 0 ? (
                <EmptyState compact icon={<Wallet size={20} />} title="Aucun paiement enregistré"
                  description={inv.status === "cancelled" ? "Facture annulée." : "Dès que le client paie, enregistrez le montant reçu : le restant dû et votre trésorerie se mettent à jour."} />
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table>
                      <thead><tr><Th>Date</Th><Th align="right">Montant</Th><Th>Mode</Th><Th>Compte</Th><Th>Référence</Th><Th align="right">Frais</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <Td className="whitespace-nowrap">{formatDate(p.date)}</Td>
                            <Td align="right"><Money value={p.amount} currency={inv.currency} className="font-medium" /></Td>
                            <Td>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</Td>
                            <Td>{p.accountId ? accounts.get(p.accountId)?.name ?? "—" : <span className="text-ink-3">Non précisé</span>}</Td>
                            <Td className="text-ink-3">{p.reference ?? "—"}</Td>
                            <Td align="right">{p.fees ? <Money value={p.fees} currency={inv.currency} /> : <span className="text-ink-3">—</span>}</Td>
                            <Td align="right"><DeletePaymentButton id={p.id} label={`de ${m(p.amount)} du ${formatDate(p.date)}`} /></Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  <ul className="divide-y divide-line md:hidden">
                    {payments.map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div><div className="text-[13.5px] font-medium text-ink">{m(p.amount)}</div>
                          <div className="text-[12px] text-ink-3">{formatDate(p.date)} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}{p.accountId ? ` · ${accounts.get(p.accountId)?.name ?? ""}` : ""}{p.fees ? ` · frais ${m(p.fees)}` : ""}</div></div>
                        <DeletePaymentButton id={p.id} label={`de ${m(p.amount)} du ${formatDate(p.date)}`} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Historique" description="Création, modifications, envois et paiements de ce document." />
            {timeline.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-3">Aucune modification enregistrée.</p>
            ) : (
              <ol className="px-5 pb-5">
                {timeline.map((h) => (
                  <li key={h.id} className="relative border-l border-line pb-4 pl-4 last:pb-0">
                    <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-ink-3" aria-hidden />
                    <div className="text-[13px] text-ink">{h.entity === "payment" ? (h.action === "delete" ? "Paiement supprimé" : "Paiement enregistré") : ACTION_LABELS[h.action] ?? h.action}
                      <span className="ml-2 text-[12px] text-ink-3">{new Date(h.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
                    </div>
                    <HistoryDetail entity={h.entity} action={h.action} before={h.before} after={h.after} currency={inv.currency} />
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="grid content-start gap-5">
          <Card className="p-5">
            <div className="text-[12.5px] font-medium text-ink-2">{isQuote ? "Montant du devis" : inv.status === "draft" || inv.status === "cancelled" ? "Montant" : "Restant dû"}</div>
            <div className={cx("mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular", !isQuote && state.status === "overdue" && "text-bad", inv.status === "cancelled" && "text-ink-3 line-through")}>
              {m(isQuote || inv.status === "draft" || inv.status === "cancelled" ? inv.total : state.remaining)}
            </div>
            {!isQuote && inv.status !== "draft" && inv.status !== "cancelled" && <div className="mt-1.5 text-[12.5px] text-ink-3">sur {m(inv.total)} facturés · {m(state.paid)} encaissés</div>}
            <dl className="mt-5 space-y-2.5 text-[13px]">
              <Row label={isQuote ? "Valable jusqu'au" : "Échéance"}>
                {formatDate(inv.dueDate)}
                {!isQuote && state.status === "overdue" && <span className="ml-1.5 text-bad">· {state.daysOverdue} j de retard</span>}
              </Row>
              <Row label="Client">
                {contact ? <Link href={`/clients/${contact.id}`} className="font-medium text-accent hover:underline underline-offset-4">{contact.name}</Link>
                  : counterpart ? <span>{counterpart.name} <Badge className="ml-1">Interne</Badge></span> : <span className="text-ink-3">Non renseigné</span>}
              </Row>
              <Row label="Activité">{activity ? activity.name : <span className="text-ink-3">Non affectée</span>}</Row>
              <Row label="Structure">{company.name}</Row>
              {inv.sentAt && <Row label={`Envoyé${isQuote ? "" : "e"} le`}>{formatDate(inv.sentAt)}</Row>}
              {convertedFrom && <Row label="Issue du devis"><Link href={`/revenus/${convertedFrom.id}`} className="font-medium text-accent hover:underline underline-offset-4">{convertedFrom.number}</Link></Row>}
              {inv.documentId && <Row label="Original"><a href={`/api/documents/${inv.documentId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline underline-offset-4"><Paperclip size={13} aria-hidden /> Fichier importé</a></Row>}
            </dl>
          </Card>

          {inv.status !== "cancelled" && (
            <Card className="p-5">
              <div className="text-[12.5px] font-medium text-ink-2">Autres actions</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`/api/invoices/${inv.id}/pdf`} className={buttonClass("ghost", "sm")}><FileText size={14} aria-hidden /> PDF</a>
                {inv.status === "draft" && <MarkSentButton id={inv.id} isQuote={isQuote} />}
                {(isQuote || payments.length === 0) && <CancelInvoiceButton id={inv.id} isQuote={isQuote} number={inv.number} />}
              </div>
              {!isQuote && payments.length > 0 && <p className="mt-3 text-[12px] text-ink-3">Une facture qui a reçu des paiements ne peut être ni supprimée ni annulée.</p>}
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-3">{label}</dt><dd className="text-right text-ink">{children}</dd></div>;
}

function HistoryDetail({ entity, action, before, after, currency }: { entity: string; action: string; before: string | null; after: string | null; currency: string }) {
  let b: Record<string, unknown> = {};
  let a: Record<string, unknown> = {};
  try { b = before ? JSON.parse(before) : {}; a = after ? JSON.parse(after) : {}; } catch { return null; }
  if (entity === "payment") {
    const p = (action === "delete" ? b : a) as { amount?: number; date?: string };
    return p.amount != null ? <p className="text-[12px] text-ink-3">{formatMoney(p.amount, currency)} le {formatDate(p.date)}</p> : null;
  }
  if (action !== "update") return null;
  const fmt = (k: string, v: unknown) => {
    if (v == null || v === "") return "—";
    if (k === "total") return formatMoney(Number(v), currency);
    if (k === "status") return STATUS_WORD[String(v)] ?? String(v);
    if (k === "issueDate" || k === "dueDate") return formatDate(String(v));
    if (k.endsWith("Id")) return "modifié";
    return String(v).slice(0, 60);
  };
  const changes = Object.keys(FIELD_LABELS).filter((k) => k in a && JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
  const linesChanged = Array.isArray(a.lines) && Array.isArray(b.lines) && JSON.stringify(a.lines) !== JSON.stringify(b.lines);
  if (!changes.length && !linesChanged) return <p className="text-[12px] text-ink-3">Aucun changement de contenu.</p>;
  return (
    <ul className="mt-0.5 space-y-0.5 text-[12px] text-ink-3">
      {changes.map((k) => <li key={k}>{FIELD_LABELS[k]} : {k.endsWith("Id") ? "modifié" : <>{fmt(k, b[k])} → <span className="text-ink-2">{fmt(k, a[k])}</span></>}</li>)}
      {linesChanged && <li>Lignes modifiées</li>}
    </ul>
  );
}
