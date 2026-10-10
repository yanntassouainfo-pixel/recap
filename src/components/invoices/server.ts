import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getScope, visibleCompanies } from "@/lib/data";
import { minorToField, quantityToField, rateToField, type RawLine } from "@/lib/invoices";
import type { EditorOptions } from "./editor";

/** Options de l'éditeur : structures visibles (hors espace personnel), activités, enseignes, clients. */
export async function editorOptions(userId: string, docType: "invoice" | "quote" = "invoice"): Promise<EditorOptions & { defaultCompanyId: string | null }> {
  const scope = await getScope(userId);
  const companies = visibleCompanies(userId).filter((c) => c.kind !== "personal");
  const ids = new Set(companies.map((c) => c.id));
  const activities = db.select().from(schema.activities).where(eq(schema.activities.userId, userId)).all().filter((a) => !a.archived && ids.has(a.companyId));
  const brands = db.select().from(schema.brands).where(eq(schema.brands.userId, userId)).all().filter((b) => ids.has(b.companyId));
  const contacts = db.select().from(schema.contacts).where(and(eq(schema.contacts.userId, userId), eq(schema.contacts.archived, false))).all()
    .filter((c) => c.type !== "supplier").sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const inScope = companies.find((c) => scope.companyIds.has(c.id) && (scope.company ? c.id === scope.company.id : true));
  return {
    defaultCompanyId: (scope.company && ids.has(scope.company.id) ? scope.company.id : inScope?.id) ?? companies[0]?.id ?? null,
    companies: companies.map((c) => ({ id: c.id, name: c.name, currency: c.currency, paymentTermsDays: c.paymentTermsDays, prefix: docType === "quote" ? c.quotePrefix : c.invoicePrefix, kind: c.kind })),
    activities: activities.map((a) => ({ id: a.id, companyId: a.companyId, name: a.name })),
    brands: brands.map((b) => ({ id: b.id, companyId: b.companyId, name: b.name })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, organization: c.organization })),
  };
}

/** Lignes d'un document existant, au format de saisie. */
export function linesAsRaw(invoiceId: string, currency: string): RawLine[] {
  return db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).orderBy(asc(schema.invoiceLines.position)).all()
    .map((l) => ({ description: l.description, quantity: quantityToField(l.quantity), unitPrice: minorToField(l.unitPrice, currency), taxRate: rateToField(l.taxRate) }));
}
