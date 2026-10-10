import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Notice, PageHeader } from "@/components/ui";
import { InvoiceEditor, type EditorInitial } from "@/components/invoices/editor";
import { editorOptions, linesAsRaw } from "@/components/invoices/server";

export const metadata = { title: "Modifier le document" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const inv = db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.userId, user.id))).get();
  if (!inv) notFound();
  if (inv.status === "cancelled") redirect(`/revenus/${inv.id}`);
  const options = await editorOptions(user.id, inv.docType === "quote" ? "quote" : "invoice");
  // La structure émettrice doit rester sélectionnable même si elle est hors de la liste habituelle.
  if (!options.companies.some((c) => c.id === inv.companyId)) {
    const c = db.select().from(schema.companies).where(eq(schema.companies.id, inv.companyId)).get();
    if (c) options.companies.unshift({ id: c.id, name: c.name, currency: c.currency, paymentTermsDays: c.paymentTermsDays, prefix: inv.docType === "quote" ? c.quotePrefix : c.invoicePrefix, kind: c.kind });
  }
  if (inv.contactId && !options.contacts.some((c) => c.id === inv.contactId)) {
    const c = db.select().from(schema.contacts).where(eq(schema.contacts.id, inv.contactId)).get();
    if (c) options.contacts.unshift({ id: c.id, name: c.name, organization: c.organization });
  }
  const paid = inv.docType === "invoice" ? db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id)).all().reduce((a, p) => a + p.amount, 0) : 0;
  const isQuote = inv.docType === "quote";

  const initial: EditorInitial = {
    id: inv.id, docType: isQuote ? "quote" : "invoice", number: inv.number, status: inv.status,
    companyId: inv.companyId, activityId: inv.activityId ?? "", brandId: inv.brandId ?? "", contactId: inv.contactId ?? "",
    opportunityId: inv.opportunityId ?? "", counterpartCompanyId: inv.counterpartCompanyId ?? "", title: inv.title ?? "",
    currency: inv.currency, issueDate: inv.issueDate, dueDate: inv.dueDate, notes: inv.notes ?? "", lines: linesAsRaw(inv.id, inv.currency),
  };

  return (
    <>
      <PageHeader eyebrow="Revenus & factures" title={`Modifier ${isQuote ? "le devis" : "la facture"} ${inv.number}`}
        description="Chaque modification est conservée dans l'historique du document." />
      {inv.status !== "draft" && (
        <div className="mb-5">
          <Notice tone="warn" title={isQuote ? "Ce devis a déjà été envoyé" : "Cette facture a déjà été envoyée"}>
            Si votre client l&apos;a reçue, prévenez-le de la correction{paid > 0 ? ` — ${formatMoney(paid, inv.currency)} déjà encaissés : la devise est verrouillée et le total ne peut pas descendre en dessous` : ""}.
          </Notice>
        </div>
      )}
      <InvoiceEditor options={options} initial={initial} paid={paid} paidCurrency={inv.currency} />
    </>
  );
}
