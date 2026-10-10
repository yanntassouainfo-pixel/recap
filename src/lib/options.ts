import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getAccounts, getActivities, getCategories, getContacts, getScope, getSettings, getSnapshot, visibleCompanies } from "./data";

export interface FormOptions {
  baseCurrency: string;
  mode: string;
  defaultCompanyId: string | null;
  companies: { id: string; name: string; kind: string; currency: string; color: string }[];
  activities: { id: string; companyId: string; name: string; color: string }[];
  accounts: { id: string; companyId: string; name: string; currency: string; type: string }[];
  categories: { id: string; kind: string; name: string }[];
  contacts: { id: string; name: string; organization: string | null; type: string; email: string | null }[];
  allocationRules: { id: string; companyId: string; name: string }[];
  openInvoices: { id: string; number: string; title: string | null; contactName: string | null; remaining: number; currency: string; companyId: string; dueDate: string; overdue: boolean }[];
  today: string;
}

export async function getFormOptions(userId: string): Promise<FormOptions> {
  const settings = getSettings(userId);
  const scope = await getScope(userId);
  const snapshot = await getSnapshot(userId);
  const companies = visibleCompanies(userId);
  const ids = new Set(companies.map((c) => c.id));
  const contacts = getContacts(userId).filter((c) => !c.archived);
  const contactsById = new Map(contacts.map((c) => [c.id, c]));
  return {
    baseCurrency: settings.baseCurrency,
    mode: settings.mode,
    defaultCompanyId: scope.company?.id ?? companies.find((c) => c.kind !== "personal")?.id ?? companies[0]?.id ?? null,
    companies: companies.map((c) => ({ id: c.id, name: c.name, kind: c.kind, currency: c.currency, color: c.color })),
    activities: getActivities(userId).filter((a) => !a.archived && ids.has(a.companyId)).map((a) => ({ id: a.id, companyId: a.companyId, name: a.name, color: a.color })),
    accounts: getAccounts(userId).filter((a) => !a.archived && ids.has(a.companyId)).map((a) => ({ id: a.id, companyId: a.companyId, name: a.name, currency: a.currency, type: a.type })),
    categories: getCategories(userId).map((c) => ({ id: c.id, kind: c.kind, name: c.name })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, organization: c.organization, type: c.type, email: c.email })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    allocationRules: db.select().from(schema.allocationRules).where(eq(schema.allocationRules.userId, userId)).all().map((r) => ({ id: r.id, companyId: r.companyId, name: r.name })),
    openInvoices: [...snapshot.states.values()]
      .filter((s) => s.remaining > 0 && s.status !== "draft" && s.status !== "cancelled")
      .sort((a, b) => (a.invoice.dueDate < b.invoice.dueDate ? -1 : 1))
      .map((s) => ({
        id: s.invoice.id, number: s.invoice.number, title: s.invoice.title, contactName: contactsById.get(s.invoice.contactId ?? "")?.name ?? null,
        remaining: s.remaining, currency: s.invoice.currency, companyId: s.invoice.companyId, dueDate: s.invoice.dueDate, overdue: s.status === "overdue",
      })),
    today: snapshot.data.today,
  };
}
