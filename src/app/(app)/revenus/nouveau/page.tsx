import { and, eq } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { minorToField } from "@/lib/invoices";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { InvoiceEditor, type EditorInitial } from "@/components/invoices/editor";
import { editorOptions } from "@/components/invoices/server";

export const metadata = { title: "Nouveau document" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const isQuote = one(sp.type) === "quote";
  const options = await editorOptions(user.id, isQuote ? "quote" : "invoice");

  if (!options.companies.length || !options.defaultCompanyId) {
    return (
      <>
        <PageHeader title={isQuote ? "Nouveau devis" : "Nouvelle facture"} eyebrow="Revenus & factures" />
        <Card>
          <EmptyState icon={<Building2 size={20} />} title="Aucune structure pour facturer"
            description="Une facture est toujours émise au nom d'une structure (nom, adresse, numérotation). Créez-en une d'abord."
            action={<ButtonLink href="/structures" variant="primary">Créer une structure</ButtonLink>} />
        </Card>
      </>
    );
  }

  // Préremplissage depuis un client ou une opportunité.
  let contactId = "";
  let opportunityId = "";
  let companyId = options.defaultCompanyId;
  let activityId = "";
  let title = "";
  let firstLine = { description: "", quantity: "1", unitPrice: "", taxRate: "" };
  let currency = options.companies.find((c) => c.id === companyId)!.currency;

  const contactParam = one(sp.contact);
  if (contactParam) {
    const c = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, contactParam), eq(schema.contacts.userId, user.id))).get();
    if (c) {
      contactId = c.id;
      if (c.companyId && options.companies.some((x) => x.id === c.companyId)) companyId = c.companyId;
      if (c.activityId && options.activities.some((a) => a.id === c.activityId && a.companyId === companyId)) activityId = c.activityId;
    }
  }
  const oppParam = one(sp.opportunity);
  if (oppParam) {
    const o = db.select().from(schema.opportunities).where(and(eq(schema.opportunities.id, oppParam), eq(schema.opportunities.userId, user.id))).get();
    if (o) {
      opportunityId = o.id;
      contactId = o.contactId;
      if (o.companyId && options.companies.some((x) => x.id === o.companyId)) companyId = o.companyId;
      if (o.activityId && options.activities.some((a) => a.id === o.activityId && a.companyId === companyId)) activityId = o.activityId;
      title = o.title;
      currency = o.currency;
      firstLine = { description: o.title, quantity: "1", unitPrice: o.amount > 0 ? minorToField(o.amount, o.currency) : "", taxRate: "" };
    }
  }
  if (!oppParam) currency = options.companies.find((c) => c.id === companyId)!.currency;

  const today = todayISO();
  const initial: EditorInitial = {
    docType: isQuote ? "quote" : "invoice",
    companyId, activityId, brandId: "", contactId, opportunityId, counterpartCompanyId: "",
    title, currency, issueDate: today, dueDate: "", notes: "", lines: [firstLine],
  };

  return (
    <>
      <PageHeader
        eyebrow="Revenus & factures"
        title={isQuote ? "Nouveau devis" : "Nouvelle facture"}
        description={isQuote ? "Chiffrez votre proposition. Une fois accepté, le devis devient une facture sans ressaisie." : "Renseignez les prestations : les totaux, la TVA et l'échéance se calculent automatiquement."}
      />
      <InvoiceEditor options={options} initial={initial} paid={0} paidCurrency={currency} />
    </>
  );
}
