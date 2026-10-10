import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser, audit } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { todayISO } from "@/lib/dates";

/** Export complet des données de l'utilisateur (portabilité). Les fichiers restent téléchargeables depuis la bibliothèque. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = user.id;
  const by = <T extends { userId: unknown }>(t: T) => eq((t as unknown as { userId: typeof schema.companies.userId }).userId, u);
  const invoices = db.select().from(schema.invoices).where(by(schema.invoices)).all();
  const documents = db.select().from(schema.documents).where(by(schema.documents)).all();
  const emails = db.select().from(schema.emails).where(by(schema.emails)).all();
  const payload = {
    exportedAt: new Date().toISOString(),
    format: "recap-export-v1",
    note: "Montants en unités mineures de leur devise (ex. centimes pour EUR, francs pour XOF).",
    user: { email: user.email, name: user.name },
    settings: db.select().from(schema.settings).where(eq(schema.settings.userId, u)).get(),
    companies: db.select().from(schema.companies).where(by(schema.companies)).all(),
    brands: db.select().from(schema.brands).where(by(schema.brands)).all(),
    activities: db.select().from(schema.activities).where(by(schema.activities)).all(),
    accounts: db.select().from(schema.accounts).where(by(schema.accounts)).all(),
    exchangeRates: db.select().from(schema.exchangeRates).where(by(schema.exchangeRates)).all(),
    categories: db.select().from(schema.categories).where(by(schema.categories)).all(),
    contacts: db.select().from(schema.contacts).where(by(schema.contacts)).all(),
    opportunities: db.select().from(schema.opportunities).where(by(schema.opportunities)).all(),
    interactions: db.select().from(schema.interactions).where(by(schema.interactions)).all(),
    invoices,
    invoiceLines: invoices.length ? db.select().from(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, invoices.map((i) => i.id))).all() : [],
    payments: db.select().from(schema.payments).where(by(schema.payments)).all(),
    incomes: db.select().from(schema.incomes).where(by(schema.incomes)).all(),
    expenses: db.select().from(schema.expenses).where(by(schema.expenses)).all(),
    recurringExpenses: db.select().from(schema.recurringExpenses).where(by(schema.recurringExpenses)).all(),
    allocationRules: db.select().from(schema.allocationRules).where(by(schema.allocationRules)).all(),
    transfers: db.select().from(schema.transfers).where(by(schema.transfers)).all(),
    goals: db.select().from(schema.goals).where(by(schema.goals)).all(),
    documents,
    documentVersions: documents.length ? db.select().from(schema.documentVersions).where(inArray(schema.documentVersions.documentId, documents.map((d) => d.id))).all() : [],
    emailTemplates: db.select().from(schema.emailTemplates).where(by(schema.emailTemplates)).all(),
    senderIdentities: db.select().from(schema.senderIdentities).where(by(schema.senderIdentities)).all(),
    emails,
    emailAttachments: emails.length ? db.select().from(schema.emailAttachments).where(inArray(schema.emailAttachments.emailId, emails.map((e) => e.id))).all() : [],
    auditLog: db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, u)).all(),
  };
  audit(u, "user", u, "data_export");
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="recap-export-${todayISO()}.json"`,
      "cache-control": "no-store",
    },
  });
}
