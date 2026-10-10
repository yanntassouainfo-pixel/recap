import { eq } from "drizzle-orm";
import { Plus, Repeat } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSnapshot } from "@/lib/data";
import { addDays } from "@/lib/dates";
import { inScope, upcomingOutflows } from "@/lib/finance/engine";
import { PageHeader, Tabs, buttonClass } from "@/components/ui";
import { QuickButton } from "@/components/quick/provider";
import { AllExpensesView } from "@/components/expenses/all-view";
import { UpcomingView } from "@/components/expenses/upcoming-view";
import { RecurringView } from "@/components/expenses/recurring-view";
import { isStopped } from "@/components/expenses/logic";

export const metadata = { title: "Dépenses & charges" };

type View = "toutes" | "a-venir" | "recurrentes";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const { data } = await getSnapshot(user.id);
  // Un lien « confirmer » mène toujours aux échéances, quelle que soit la vue demandée.
  const view: View = sp.confirmer ? "a-venir" : sp.vue === "a-venir" || sp.vue === "recurrentes" ? sp.vue : "toutes";

  const upcomingCount = upcomingOutflows(data, addDays(data.today, 30)).length;
  const recurringCount = data.recurring.filter((r) => inScope(data, r.companyId) && !isStopped(r, data.today)).length;

  const descriptions: Record<View, string> = {
    toutes: "Combien je dépense, pour quoi, et qu'est-ce qui reste à payer ?",
    "a-venir": "Qu'est-ce que je vais devoir payer dans les semaines qui viennent ?",
    recurrentes: "Combien me coûtent chaque mois mes abonnements, loyers et autres charges fixes ?",
  };

  return (
    <>
      <PageHeader
        title="Dépenses & charges"
        description={descriptions[view]}
        actions={<>
          <QuickButton kind="recurring" className={buttonClass("secondary")}><Repeat size={15} /> Charge récurrente</QuickButton>
          <QuickButton kind="expense" className={buttonClass("primary")}><Plus size={15} /> Ajouter une dépense</QuickButton>
        </>}
      />
      <Tabs active={view} items={[
        { key: "toutes", label: "Toutes les dépenses", href: "/depenses" },
        { key: "a-venir", label: "À venir", href: "/depenses?vue=a-venir", count: upcomingCount },
        { key: "recurrentes", label: "Charges récurrentes", href: "/depenses?vue=recurrentes", count: recurringCount },
      ]} />
      {view === "toutes" && (
        <AllExpensesView data={data} sp={sp} rows={db.select().from(schema.expenses).where(eq(schema.expenses.userId, user.id)).all()} />
      )}
      {view === "a-venir" && <UpcomingView data={data} sp={sp} />}
      {view === "recurrentes" && <RecurringView data={data} />}
    </>
  );
}
