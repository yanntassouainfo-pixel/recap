import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PdfDocument } from "@/lib/pdf";
import { safeFileName } from "@/lib/storage";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

/**
 * PDF de facture / devis à joindre à un email.
 * Utilise le générateur officiel `renderInvoicePdf` (src/lib/invoice-pdf.ts) ; en cas d'erreur de celui-ci,
 * un rendu de secours sobre (mêmes données, mise en page simplifiée) est utilisé.
 */
export async function renderInvoiceAttachment(userId: string, invoiceId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const official = await loadOfficialRenderer();
  if (official) {
    try {
      const r = await official(userId, invoiceId);
      if (r) return r;
    } catch (e) {
      console.error("renderInvoicePdf a échoué, rendu de secours utilisé", e);
    }
  }
  return fallbackInvoicePdf(userId, invoiceId);
}

type Renderer = (userId: string, invoiceId: string) => { buffer: Buffer; fileName: string } | null | Promise<{ buffer: Buffer; fileName: string } | null>;

async function loadOfficialRenderer(): Promise<Renderer | null> {
  return renderInvoicePdf;
}

/** Rendu de secours : en-tête structure, client, lignes, totaux, échéance, coordonnées de paiement. */
export function fallbackInvoicePdf(userId: string, invoiceId: string): { buffer: Buffer; fileName: string } | null {
  const inv = db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.userId, userId))).get();
  if (!inv) return null;
  const company = db.select().from(schema.companies).where(eq(schema.companies.id, inv.companyId)).get();
  const contact = inv.contactId ? db.select().from(schema.contacts).where(eq(schema.contacts.id, inv.contactId)).get() : undefined;
  const lines = db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id)).orderBy(asc(schema.invoiceLines.position)).all();
  const isQuote = inv.docType === "quote";
  const label = isQuote ? "Devis" : "Facture";
  const doc = new PdfDocument(`${label} ${inv.number}`);
  const p = doc.addPage();
  const m = (v: number) => formatMoney(v, inv.currency);
  p.rect(0, 0, p.width, 6, [0.18, 0.36, 0.82]);
  p.text(56, 70, company?.legalName || company?.name || "", { size: 15, bold: true });
  let y = 88;
  for (const l of [company?.address, company?.email, company?.phone, company?.taxId ? `N° contribuable : ${company.taxId}` : null].filter(Boolean) as string[]) {
    p.text(56, y, l, { size: 9.5, color: [0.4, 0.4, 0.38] });
    y += 13;
  }
  p.text(540, 70, `${label} ${inv.number}`, { size: 15, bold: true, align: "right" });
  p.text(540, 88, `Émis le ${formatDate(inv.issueDate, "long")}`, { size: 9.5, align: "right", color: [0.4, 0.4, 0.38] });
  p.text(540, 101, `${isQuote ? "Valable jusqu'au" : "Échéance"} ${formatDate(inv.dueDate, "long")}`, { size: 9.5, align: "right", color: [0.4, 0.4, 0.38] });

  y = Math.max(y, 120) + 20;
  p.text(56, y, isQuote ? "Destinataire" : "Facturé à", { size: 9, color: [0.45, 0.45, 0.42] });
  y += 15;
  if (contact) {
    p.text(56, y, contact.organization || contact.name, { size: 11, bold: true });
    y += 14;
    if (contact.organization) { p.text(56, y, contact.name, { size: 9.5 }); y += 13; }
    if (contact.address) { p.text(56, y, contact.address, { size: 9.5 }); y += 13; }
  }
  if (inv.title) { y += 10; p.text(56, y, inv.title, { size: 11, bold: true }); y += 6; }

  y += 22;
  p.rect(56, y - 12, 484, 20, [0.95, 0.95, 0.93]);
  p.text(64, y, "Description", { size: 9, bold: true });
  p.text(360, y, "Qté", { size: 9, bold: true, align: "right" });
  p.text(450, y, "Prix unitaire", { size: 9, bold: true, align: "right" });
  p.text(532, y, "Total HT", { size: 9, bold: true, align: "right" });
  y += 22;
  for (const l of lines) {
    const ht = Math.round(l.quantity * l.unitPrice);
    p.text(64, y, l.description.slice(0, 60), { size: 9.5 });
    p.text(360, y, String(l.quantity).replace(".", ","), { size: 9.5, align: "right" });
    p.text(450, y, m(l.unitPrice), { size: 9.5, align: "right" });
    p.text(532, y, m(ht), { size: 9.5, align: "right" });
    y += 18;
    if (y > 700) break;
  }
  y += 10;
  p.text(450, y, "Sous-total HT", { size: 9.5, align: "right" });
  p.text(532, y, m(inv.subtotal), { size: 9.5, align: "right" });
  y += 15;
  p.text(450, y, "Taxes", { size: 9.5, align: "right" });
  p.text(532, y, m(inv.taxTotal), { size: 9.5, align: "right" });
  y += 18;
  p.text(450, y, "Total TTC", { size: 11, bold: true, align: "right" });
  p.text(532, y, m(inv.total), { size: 11, bold: true, align: "right" });

  if (company?.billingDetails && !isQuote) {
    y += 40;
    p.text(56, y, "Coordonnées de paiement", { size: 9, bold: true });
    p.paragraph(56, y + 14, company.billingDetails, 484, { size: 9.5, color: [0.3, 0.3, 0.28] });
  }
  if (inv.notes) p.paragraph(56, 770, inv.notes, 484, { size: 8.5, color: [0.45, 0.45, 0.42] });
  return { buffer: doc.toBuffer(), fileName: `${label}-${safeFileName(inv.number)}.pdf` };
}
