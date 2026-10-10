import { ArrowLeft, Building2 } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getFormOptions } from "@/lib/options";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/invoices/import-wizard";

export const metadata = { title: "Importer une facture" };

type SP = Record<string, string | string[] | undefined>;

export default async function ImportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const type = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const direction = type === "depense" ? "expense" : "income";
  const o = await getFormOptions(user.id);
  const aiEnabled = !!process.env.ANTHROPIC_API_KEY;

  return (
    <>
      <Link href="/revenus" className="mb-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-3 hover:text-ink"><ArrowLeft size={14} aria-hidden /> Revenus & factures</Link>
      <PageHeader
        title="Importer une facture"
        description={`Déposez un PDF ou une photo : Recap propose les informations, vous les vérifiez avant tout enregistrement. ${aiEnabled ? "Extraction assistée activée (PDF et images)." : "Lecture automatique des PDF ; pour les images, la saisie se fait à partir de l'aperçu."}`}
      />
      {o.companies.length === 0 ? (
        <Card>
          <EmptyState icon={<Building2 size={20} />} title="Aucune structure"
            description="Créez d'abord la structure à laquelle rattacher vos factures."
            action={<ButtonLink href="/structures" variant="primary">Créer une structure</ButtonLink>} />
        </Card>
      ) : (
        <ImportWizard
          initialDirection={direction}
          options={{
            defaultCompanyId: o.defaultCompanyId, today: o.today,
            companies: o.companies.map((c) => ({ id: c.id, name: c.name, currency: c.currency, kind: c.kind })),
            activities: o.activities.map((a) => ({ id: a.id, companyId: a.companyId, name: a.name })),
            accounts: o.accounts.map((a) => ({ id: a.id, companyId: a.companyId, name: a.name, currency: a.currency })),
            categories: o.categories,
            contacts: o.contacts.filter((c) => c.type !== "supplier").map((c) => ({ id: c.id, name: c.name, organization: c.organization })),
          }}
        />
      )}
    </>
  );
}
