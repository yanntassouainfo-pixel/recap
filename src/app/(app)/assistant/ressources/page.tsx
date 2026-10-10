import Link from "next/link";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSettings, getSnapshot } from "@/lib/data";
import { addDays } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { periodFlows, profitability } from "@/lib/finance/engine";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Centre de ressources" };

const COUNTRY_NOTE: Record<string, string> = {
  CI: "En Côte d'Ivoire, le régime d'imposition (micro-entreprise, synthétique, réel simplifié…) dépend de votre chiffre d'affaires : validez votre situation avec la DGI ou un comptable.",
  SN: "Au Sénégal, la contribution globale unique (CGU) ou le régime réel dépend de votre chiffre d'affaires : validez votre situation avec un professionnel.",
  FR: "En France, les obligations diffèrent fortement entre micro-entreprise, EI au réel et société : faites valider vos choix par un expert-comptable.",
};

export default async function ResourcesPage() {
  const user = await requireUser();
  const settings = getSettings(user.id);
  const s = await getSnapshot(user.id);
  const { data } = s;
  const cur = data.baseCurrency;
  const m = (v: number) => formatMoney(v, cur);
  const today = data.today;
  const p = profitability(data, addDays(today, -89), today, { states: s.states, movements: s.movements });
  const flows90 = periodFlows(s.movements, addDays(today, -89), today);
  const monthlyExpense = Math.round(flows90.expense / 3);
  const monthlyIncome = Math.round(flows90.income / 3);
  const fixedMonthly = Math.round(data.recurring.filter((r) => r.active && data.scopeCompanyIds.has(r.companyId) && r.currency === cur)
    .reduce((t, r) => t + r.amount * (r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 1 / 3 : 1 / 12), 0));
  const delays = p.activities.filter((a) => a.averageDaysToPay != null);
  const avgDelay = delays.length ? Math.round(delays.reduce((t, a) => t + (a.averageDaysToPay ?? 0), 0) / delays.length) : null;
  const best = p.activities.filter((a) => a.marginRate != null && a.invoiced > 0).sort((a, b) => (b.marginRate ?? 0) - (a.marginRate ?? 0))[0];

  const articles: { id: string; title: string; summary: string; body: string[]; yours?: string }[] = [
    {
      id: "tresorerie-vs-benefice",
      title: "Chiffre d'affaires, bénéfice et trésorerie : trois choses différentes",
      summary: "Facturer n'est pas encaisser, et avoir de l'argent sur son compte n'est pas être rentable.",
      body: [
        "Le chiffre d'affaires est ce que vous facturez. Le bénéfice est ce qu'il reste une fois toutes les charges déduites. La trésorerie est l'argent réellement disponible sur vos comptes à un instant donné.",
        "Une entreprise peut avoir de l'argent en banque tout en ayant des charges, des dettes ou des impôts à payer. À l'inverse, une prestation facturée augmente votre chiffre d'affaires sans avoir encore rempli votre compte.",
      ],
      yours: `Aujourd'hui : ${m(s.cash.total)} disponibles, ${m(s.receivables.total)} encore à encaisser, et ${m(s.upcoming30.reduce((t, u) => t + u.amountBase, 0))} de dépenses prévues sur 30 jours.`,
    },
    {
      id: "marge",
      title: "La marge : ce que vous gardez vraiment",
      summary: "Une activité qui rapporte beaucoup n'est pas forcément celle qui vous enrichit le plus.",
      body: [
        "La marge est la différence entre ce qu'une activité rapporte et ce qu'elle coûte. Le taux de marge exprime cette différence en pourcentage du chiffre d'affaires : 75 % signifie que vous gardez 75 francs sur 100 facturés.",
        "Comparez les activités sur leur taux de marge, mais aussi sur le temps qu'elles vous demandent : une marge élevée obtenue avec beaucoup d'heures peut être moins intéressante qu'il n'y paraît.",
      ],
      yours: best ? `Sur 90 jours, votre meilleur taux de marge est celui de « ${best.name} » : ${formatPercent(best.marginRate)}.` : undefined,
    },
    {
      id: "cout-reel",
      title: "Le coût réel d'une activité",
      summary: "Coûts directs, dépenses affectées et part des frais communs.",
      body: [
        "Le coût réel d'une activité additionne ses coûts directs (location de salle, sous-traitance, impression…), les autres dépenses qui lui sont propres, et une part raisonnable des frais communs (loyer, abonnements, assurances).",
        "Répartir les frais communs demande une règle explicite : un pourcentage décidé, ou le poids de chaque activité dans le chiffre d'affaires. Ce qui ne peut pas être réparti de façon fiable doit rester « non affecté » plutôt que réparti au hasard.",
      ],
      yours: p.unassignedCosts > 0 ? `${m(p.unassignedCosts)} de dépenses sont actuellement non affectées sur 90 jours.` : undefined,
    },
    {
      id: "delais-paiement",
      title: "L'importance des délais de paiement",
      summary: "Chaque jour de retard d'un client est un jour où vous financez son activité.",
      body: [
        "Des délais courts protègent votre trésorerie. Indiquez clairement l'échéance sur chaque facture, demandez un acompte pour les missions importantes et relancez dès le lendemain de l'échéance, avec courtoisie.",
        "Une relance groupée par client, avec la liste des factures concernées, est souvent plus efficace qu'une série de rappels isolés.",
      ],
      yours: `${avgDelay != null ? `Vos clients règlent en moyenne en ${avgDelay} jours après émission. ` : ""}${s.receivables.overdue > 0 ? `${m(s.receivables.overdue)} sont actuellement en retard.` : "Aucune facture n'est en retard."}`,
    },
    {
      id: "charges-fixes-variables",
      title: "Charges fixes et charges variables",
      summary: "Les charges fixes tombent chaque mois, que l'activité soit bonne ou non.",
      body: [
        "Les charges fixes (loyer, abonnements, assurances, salaires) reviennent indépendamment de votre volume d'activité. Les charges variables évoluent avec votre activité (déplacements, sous-traitance, matières).",
        "Plus la part des charges fixes est élevée, plus un mois creux met la trésorerie sous tension. Passez vos abonnements en revue au moins une fois par trimestre.",
      ],
      yours: fixedMonthly > 0 ? `Vos charges récurrentes représentent environ ${m(fixedMonthly)} par mois${monthlyIncome > 0 ? `, soit ${formatPercent((fixedMonthly / monthlyIncome) * 100)} de vos encaissements mensuels moyens` : ""}.` : undefined,
    },
    {
      id: "previsionnel",
      title: "Construire un prévisionnel utile",
      summary: "Anticiper plutôt que subir : partir du solde actuel, ajouter ce qui est attendu, retirer ce qui est engagé.",
      body: [
        "Un prévisionnel de trésorerie part de votre solde actuel, ajoute les encaissements attendus (factures envoyées, à leur échéance) et retire les décaissements prévus (charges récurrentes, échéances, impôts).",
        "Travaillez avec plusieurs scénarios : prudent (les clients paient en retard), central, optimiste (les opportunités se concrétisent). Comparez ensuite chaque mois le prévu et le réel pour comprendre les écarts.",
      ],
      yours: `Scénario central : point bas de ${m(s.forecastCentral90.min.balance)} dans les 90 prochains jours.`,
    },
    {
      id: "reserve",
      title: "Constituer une réserve financière",
      summary: "Une réserve de précaution absorbe les mois creux et les imprévus.",
      body: [
        "Une règle courante pour les indépendants est de viser l'équivalent de trois mois de dépenses de fonctionnement, mis de côté sur un compte séparé.",
        "Alimentez-la régulièrement, même modestement, plutôt qu'en une fois : un virement automatique après chaque encaissement important est une habitude efficace.",
      ],
      yours: monthlyExpense > 0 ? `Trois mois de vos dépenses moyennes représentent environ ${m(monthlyExpense * 3)}. Votre trésorerie actuelle couvre ${(s.cash.total / monthlyExpense).toFixed(1).replace(".", ",")} mois de dépenses.` : undefined,
    },
    {
      id: "budget",
      title: "Les principes d'une gestion budgétaire simple",
      summary: "Un budget n'est pas une contrainte : c'est une décision prise à l'avance.",
      body: [
        "Fixez un objectif de revenus mensuels et un plafond de dépenses, puis suivez l'écart chaque semaine plutôt qu'en fin de mois. Séparez strictement les comptes professionnels et personnels, et rémunérez-vous par des virements identifiés.",
      ],
    },
    {
      id: "erreurs-courantes",
      title: "Les erreurs courantes des indépendants",
      summary: "Celles qui coûtent le plus cher sont aussi les plus faciles à éviter.",
      body: [
        "Confondre l'argent en banque avec l'argent disponible (impôts et charges à venir) ; mélanger finances personnelles et professionnelles ; ne pas relancer les impayés ; sous-estimer les petites charges récurrentes ; facturer en retard ; ne pas mettre de côté pour les impôts.",
      ],
    },
  ];

  return (
    <div className="animate-fade-up">
      <Link href="/assistant" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft size={14} /> Assistant financier</Link>
      <PageHeader title="Centre de ressources" description="Des explications courtes et concrètes, accompagnées de ce que vos propres chiffres disent." />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Sommaire">
          <ul className="sticky top-24 space-y-0.5">
            {articles.map((a) => <li key={a.id}><a href={`#${a.id}`} className="block rounded-lg px-3 py-1.5 text-[13px] leading-snug text-ink-2 hover:bg-surface-3 hover:text-ink">{a.title}</a></li>)}
          </ul>
        </nav>
        <div className="max-w-3xl space-y-4">
          {articles.map((a) => (
            <Card key={a.id} id={a.id} className="scroll-mt-24 p-6">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{a.title}</h2>
              <p className="mt-1 text-[13.5px] font-medium text-ink-2">{a.summary}</p>
              {a.body.map((b) => <p key={b} className="mt-3 text-[14px] leading-relaxed text-ink-2">{b}</p>)}
              {a.yours && (
                <div className="mt-4 flex gap-3 rounded-xl bg-accent-soft/60 px-4 py-3 text-[13px] text-ink">
                  <Lightbulb size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span><span className="font-medium">Dans votre situation : </span>{a.yours}</span>
                </div>
              )}
            </Card>
          ))}
          <p className="text-[12px] text-ink-3">{COUNTRY_NOTE[settings.country] ?? "Les règles fiscales, juridiques et comptables dépendent de votre pays et de votre statut : faites valider vos décisions par un professionnel."} Recap est un outil de pilotage de trésorerie, distinct de la comptabilité officielle.</p>
        </div>
      </div>
    </div>
  );
}
