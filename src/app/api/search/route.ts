import { NextResponse } from "next/server";
import { and, eq, like, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { DOCUMENT_TYPES } from "@/lib/documents";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export interface SearchHit { type: "contact" | "invoice" | "document" | "expense"; id: string; title: string; subtitle: string; href: string }

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const pattern = `%${q.replace(/[%_]/g, "")}%`;
  const u = user.id;
  const contacts = db.select().from(schema.contacts).where(and(eq(schema.contacts.userId, u), or(like(schema.contacts.name, pattern), like(schema.contacts.organization, pattern), like(schema.contacts.email, pattern)))).limit(6).all();
  const invoices = db.select().from(schema.invoices).where(and(eq(schema.invoices.userId, u), or(like(schema.invoices.number, pattern), like(schema.invoices.title, pattern)))).limit(6).all();
  const docs = db.select().from(schema.documents).where(and(eq(schema.documents.userId, u), eq(schema.documents.archived, false), or(like(schema.documents.name, pattern), like(schema.documents.tags, pattern), like(schema.documents.description, pattern)))).limit(6).all();
  const expenses = db.select().from(schema.expenses).where(and(eq(schema.expenses.userId, u), or(like(schema.expenses.label, pattern), like(schema.expenses.supplier, pattern)))).limit(5).all();
  const hits: SearchHit[] = [
    ...contacts.map((c) => ({ type: "contact" as const, id: c.id, title: c.name, subtitle: [c.type === "prospect" ? "Prospect" : c.type === "supplier" ? "Fournisseur" : "Client", c.organization].filter(Boolean).join(" · "), href: `/clients/${c.id}` })),
    ...invoices.map((i) => ({ type: "invoice" as const, id: i.id, title: `${i.docType === "quote" ? "Devis" : "Facture"} ${i.number}`, subtitle: `${i.title ?? ""} · ${formatMoney(i.total, i.currency)}`, href: `/revenus/${i.id}` })),
    ...docs.map((d) => ({ type: "document" as const, id: d.id, title: d.name, subtitle: `${DOCUMENT_TYPES[d.type] ?? d.type} · v${d.currentVersion}`, href: `/documents?doc=${d.id}` })),
    ...expenses.map((e) => ({ type: "expense" as const, id: e.id, title: e.label, subtitle: `${e.supplier ?? "Dépense"} · ${formatMoney(e.amount, e.currency)} · ${formatDate(e.date)}`, href: `/depenses?q=${encodeURIComponent(e.label)}` })),
  ];
  return NextResponse.json({ hits });
}
