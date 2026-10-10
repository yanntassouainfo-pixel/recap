/**
 * PDF d'une facture ou d'un devis (A4, sobre) à partir de `PdfDocument`.
 * `renderInvoicePdf` est aussi utilisé par le module Emails pour joindre la facture.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { PdfDocument, type PdfPage } from "./pdf";
import { formatMoney } from "./money";
import { formatDate, daysBetween } from "./dates";
import { computeTotals } from "./invoices";
import { safeFileName } from "./storage";

type RGB = [number, number, number];

export interface InvoicePdfData {
  docType: string;
  number: string;
  title: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  status: string;
  notes: string | null;
  company: {
    name: string; legalName: string | null; address: string | null; email: string | null; phone: string | null;
    website: string | null; taxId: string | null; billingDetails: string | null; color: string;
  };
  brandName: string | null;
  client: { name: string; organization: string | null; address: string | null; email: string | null; phone: string | null } | null;
  lines: { description: string; quantity: number; unitPrice: number; taxRate: number }[];
  /** Montant déjà encaissé (factures uniquement). */
  paid: number;
}

const INK: RGB = [0.1, 0.1, 0.09];
const INK2: RGB = [0.33, 0.33, 0.31];
const INK3: RGB = [0.52, 0.52, 0.49];
const LINE: RGB = [0.86, 0.85, 0.82];
const SURFACE: RGB = [0.965, 0.96, 0.95];

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.16, 0.47, 0.84];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000) as RGB;
}

const clean = (s: string) => s.replace(/[  ]/g, " ");
const money = (v: number, c: string) => clean(formatMoney(v, c));
const qty = (q: number) => clean(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(q));
const rate = (r: number) => `${clean(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(r))} %`;

const LEFT = 50;
const RIGHT = 545;
const COL = { desc: 58, descWidth: 238, qty: 345, unit: 425, tax: 470, amount: 537 };

function tableHeader(page: PdfPage, y: number) {
  page.rect(LEFT, y - 13, RIGHT - LEFT, 22, SURFACE);
  const o = { size: 8, bold: true, color: INK3 };
  page.text(COL.desc, y + 1, "DÉSIGNATION", o);
  page.text(COL.qty, y + 1, "QTÉ", { ...o, align: "right" });
  page.text(COL.unit, y + 1, "PRIX UNIT. HT", { ...o, align: "right" });
  page.text(COL.tax, y + 1, "TVA", { ...o, align: "right" });
  page.text(COL.amount, y + 1, "MONTANT HT", { ...o, align: "right" });
  return y + 24;
}

/** Construit le PDF à partir de données déjà chargées (pur, testable). */
export function buildInvoicePdf(d: InvoicePdfData): Buffer {
  const isQuote = d.docType === "quote";
  const label = isQuote ? "DEVIS" : "FACTURE";
  const accent = hexToRgb(d.company.color);
  const totals = computeTotals(d.lines);
  const cur = d.currency;
  const doc = new PdfDocument(`${isQuote ? "Devis" : "Facture"} ${d.number}`);
  let page = doc.addPage();

  /* En-tête */
  page.rect(0, 0, page.width, 5, accent);
  page.text(LEFT, 64, d.company.name, { size: 16, bold: true, color: INK });
  let y = 80;
  const small = { size: 8.5, color: INK2 };
  if (d.brandName && d.brandName !== d.company.name) { page.text(LEFT, y, `Enseigne : ${d.brandName}`, small); y += 12; }
  if (d.company.legalName && d.company.legalName !== d.company.name) { page.text(LEFT, y, d.company.legalName, small); y += 12; }
  if (d.company.address) y = page.paragraph(LEFT, y, d.company.address, 240, { ...small, lineHeight: 12 });
  const contact = [d.company.email, d.company.phone].filter(Boolean).join("  ·  ");
  if (contact) { page.text(LEFT, y, contact, small); y += 12; }
  if (d.company.website) { page.text(LEFT, y, d.company.website, small); y += 12; }
  if (d.company.taxId) { page.text(LEFT, y, `Identifiant fiscal : ${d.company.taxId}`, small); y += 12; }

  page.text(RIGHT, 66, label, { size: 22, bold: true, color: INK, align: "right" });
  page.text(RIGHT, 84, `N° ${d.number}`, { size: 10.5, color: INK2, align: "right" });
  const meta: [string, string][] = [
    ["Date d'émission", formatDate(d.issueDate, "long")],
    [isQuote ? "Valable jusqu'au" : "Échéance", formatDate(d.dueDate, "long")],
  ];
  let my = 108;
  for (const [k, v] of meta) {
    page.text(RIGHT - 120, my, k, { size: 8.5, color: INK3, align: "right" });
    page.text(RIGHT, my, v, { size: 9, bold: true, color: INK, align: "right" });
    my += 14;
  }
  if (d.status === "draft") page.text(RIGHT, my + 4, "BROUILLON — document non émis", { size: 8, bold: true, color: [0.72, 0.45, 0.05], align: "right" });
  if (d.status === "cancelled") page.text(RIGHT, my + 4, isQuote ? "DEVIS ANNULÉ" : "FACTURE ANNULÉE", { size: 8, bold: true, color: [0.75, 0.15, 0.12], align: "right" });

  /* Client & objet */
  y = Math.max(y, my + 10) + 22;
  page.line(LEFT, y - 12, RIGHT, y - 12, { color: LINE });
  const blockTop = y + 6;
  page.text(LEFT, blockTop, isQuote ? "DESTINATAIRE" : "FACTURÉ À", { size: 7.5, bold: true, color: INK3 });
  let cy = blockTop + 16;
  if (d.client) {
    page.text(LEFT, cy, d.client.organization || d.client.name, { size: 11, bold: true, color: INK }); cy += 14;
    if (d.client.organization && d.client.name !== d.client.organization) { page.text(LEFT, cy, `À l'attention de ${d.client.name}`, small); cy += 12; }
    if (d.client.address) cy = page.paragraph(LEFT, cy, d.client.address, 230, { ...small, lineHeight: 12 });
    const cc = [d.client.email, d.client.phone].filter(Boolean).join("  ·  ");
    if (cc) { page.text(LEFT, cy, cc, small); cy += 12; }
  } else {
    page.text(LEFT, cy, "Client non renseigné", { size: 10, color: INK3 }); cy += 14;
  }
  let oy = blockTop + 16;
  if (d.title) {
    page.text(310, blockTop, "OBJET", { size: 7.5, bold: true, color: INK3 });
    oy = page.paragraph(310, oy, d.title, 235, { size: 10, color: INK, lineHeight: 13 });
  }

  /* Lignes */
  y = Math.max(cy, oy) + 26;
  y = tableHeader(page, y);
  for (const l of totals.lines) {
    const est = Math.max(1, Math.ceil(l.description.length / 44)) * 12.5;
    if (y + est > 735) {
      page = doc.addPage();
      page.rect(0, 0, page.width, 5, accent);
      y = tableHeader(page, 60);
    }
    const startY = y;
    const endY = page.paragraph(COL.desc, y, l.description, COL.descWidth, { size: 9.5, color: INK, lineHeight: 12.5 });
    page.text(COL.qty, startY, qty(l.quantity), { size: 9.5, color: INK2, align: "right" });
    page.text(COL.unit, startY, money(l.unitPrice, cur), { size: 9.5, color: INK2, align: "right" });
    page.text(COL.tax, startY, l.taxRate ? rate(l.taxRate) : "—", { size: 9.5, color: INK3, align: "right" });
    page.text(COL.amount, startY, money(l.amount, cur), { size: 9.5, color: INK, align: "right" });
    y = endY + 4;
    page.line(LEFT, y - 6, RIGHT, y - 6, { color: LINE, width: 0.4 });
    y += 6;
  }

  /* Totaux */
  const rows: { label: string; value: string; strong?: boolean; big?: boolean }[] = [{ label: "Total HT", value: money(totals.subtotal, cur) }];
  for (const t of totals.taxes) rows.push({ label: `TVA ${rate(t.rate)}`, value: money(t.amount, cur) });
  if (!totals.taxes.length) rows.push({ label: "TVA", value: "Non applicable" });
  rows.push({ label: isQuote ? "Total TTC" : "Total TTC", value: money(totals.total, cur), strong: true, big: true });
  if (!isQuote && d.paid > 0) {
    rows.push({ label: "Déjà réglé", value: `− ${money(d.paid, cur)}` });
    rows.push({ label: "Restant dû", value: money(Math.max(0, totals.total - d.paid), cur), strong: true });
  }
  const needed = rows.length * 18 + 40;
  if (y + needed > 760) { page = doc.addPage(); page.rect(0, 0, page.width, 5, accent); y = 70; }
  let ty = y + 10;
  const totalsTop = ty;
  for (const r of rows) {
    if (r.big) {
      page.rect(330, ty - 13, RIGHT - 330, 22, SURFACE);
      page.text(340, ty + 1, r.label, { size: 10, bold: true, color: INK });
      page.text(RIGHT - 8, ty + 1, r.value, { size: 11, bold: true, color: INK, align: "right" });
      ty += 26;
    } else {
      page.text(340, ty, r.label, { size: 9, color: r.strong ? INK : INK2, bold: r.strong });
      page.text(RIGHT - 8, ty, r.value, { size: 9.5, color: INK, bold: r.strong, align: "right" });
      ty += 17;
    }
  }

  /* Coordonnées de paiement, notes, mentions (colonne de gauche puis pleine largeur) */
  let ly = totalsTop;
  if (d.company.billingDetails && !isQuote) {
    page.text(LEFT, ly, "COORDONNÉES DE PAIEMENT", { size: 7.5, bold: true, color: INK3 });
    ly = page.paragraph(LEFT, ly + 14, d.company.billingDetails, 255, { size: 9, color: INK, lineHeight: 12.5 });
  }
  y = Math.max(ly, ty) + 18;
  const ensure = (h: number) => { if (y + h > 780) { page = doc.addPage(); page.rect(0, 0, page.width, 5, accent); y = 70; } };
  if (d.notes) {
    ensure(50);
    page.text(LEFT, y, "NOTES", { size: 7.5, bold: true, color: INK3 });
    y = page.paragraph(LEFT, y + 14, d.notes, RIGHT - LEFT, { size: 9, color: INK2, lineHeight: 12.5 }) + 8;
  }
  ensure(40);
  const terms = Math.max(0, daysBetween(d.issueDate, d.dueDate));
  const mentions = isQuote
    ? `Devis valable jusqu'au ${formatDate(d.dueDate, "long")}. Pour l'accepter, retournez-le daté et signé avec la mention « Bon pour accord ».`
    : `${terms === 0 ? "Paiement à réception." : `Paiement à ${terms} jours à compter de la date d'émission, soit au plus tard le ${formatDate(d.dueDate, "long")}.`} Merci de rappeler le numéro ${d.number} dans votre règlement.`;
  page.line(LEFT, y, RIGHT, y, { color: LINE, width: 0.4 });
  y = page.paragraph(LEFT, y + 14, mentions, RIGHT - LEFT, { size: 8, color: INK3, lineHeight: 11 });

  /* Pied de page numéroté */
  const footer = [d.company.legalName || d.company.name, d.company.taxId].filter(Boolean).join(" · ");
  doc.pages.forEach((p, i) => {
    p.text(LEFT, 815, footer, { size: 7.5, color: INK3 });
    p.text(RIGHT, 815, `${label === "DEVIS" ? "Devis" : "Facture"} ${d.number} — page ${i + 1}/${doc.pages.length}`, { size: 7.5, color: INK3, align: "right" });
  });
  return doc.toBuffer();
}

/** Charge la facture (en vérifiant la propriété) et produit le PDF. null si introuvable. */
export function renderInvoicePdf(userId: string, invoiceId: string): { buffer: Buffer; fileName: string } | null {
  const inv = db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.userId, userId))).get();
  if (!inv) return null;
  const company = db.select().from(schema.companies).where(and(eq(schema.companies.id, inv.companyId), eq(schema.companies.userId, userId))).get();
  if (!company) return null;
  const lines = db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id)).orderBy(asc(schema.invoiceLines.position)).all();
  const contact = inv.contactId ? db.select().from(schema.contacts).where(and(eq(schema.contacts.id, inv.contactId), eq(schema.contacts.userId, userId))).get() : undefined;
  const counterpart = inv.counterpartCompanyId ? db.select().from(schema.companies).where(and(eq(schema.companies.id, inv.counterpartCompanyId), eq(schema.companies.userId, userId))).get() : undefined;
  const brand = inv.brandId ? db.select().from(schema.brands).where(and(eq(schema.brands.id, inv.brandId), eq(schema.brands.userId, userId))).get() : undefined;
  const paid = inv.docType === "invoice"
    ? db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id)).all().reduce((a, p) => a + p.amount, 0)
    : 0;
  const client = contact
    ? { name: contact.name, organization: contact.organization, address: contact.address, email: contact.email, phone: contact.phone }
    : counterpart
      ? { name: counterpart.legalName || counterpart.name, organization: null, address: counterpart.address, email: counterpart.email, phone: counterpart.phone }
      : null;
  const buffer = buildInvoicePdf({
    docType: inv.docType, number: inv.number, title: inv.title, issueDate: inv.issueDate, dueDate: inv.dueDate, currency: inv.currency,
    status: inv.status, notes: inv.notes,
    company: {
      name: company.name, legalName: company.legalName, address: company.address, email: company.email, phone: company.phone,
      website: company.website, taxId: company.taxId, billingDetails: company.billingDetails, color: company.color,
    },
    brandName: brand?.name ?? null, client,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    paid,
  });
  const fileName = `${safeFileName(`${inv.docType === "quote" ? "Devis" : "Facture"}-${inv.number}`)}.pdf`;
  return { buffer, fileName };
}
