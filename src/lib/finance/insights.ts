/**
 * Alertes, objectifs et recommandations — tous dérivés de calculs déterministes.
 * Chaque message cite ses chiffres et ses hypothèses ; rien n'est présenté comme une certitude.
 */
import { addDays, daysBetween, endOfMonth, formatDate, relativeDays, startOfMonth, type ISODate } from "../dates";
import { formatMoney, formatPercent } from "../money";
import {
  availableCash, cashMovements, expensesByCategory, forecast, invoiceStates, periodFlows, pctChange, profitability,
  receivables, upcomingOutflows, type AvailableCash, type ForecastResult, type GoalProgress, type Receivables,
  type UpcomingOutflow,
} from "./engine";
import type { CashMovement, FinanceData, InvoiceState } from "./types";

export type Severity = "critical" | "warning" | "info";

export interface Alert {
  key: string;
  severity: Severity;
  title: string;
  message: string;
  hypothesis?: string;
  action?: { label: string; href: string };
  learnMore?: string; // slug d'une ressource pédagogique
}

export interface Snapshot {
  data: FinanceData;
  movements: CashMovement[];
  states: Map<string, InvoiceState>;
  cash: AvailableCash;
  receivables: Receivables;
  upcoming30: UpcomingOutflow[];
  forecastCentral90: ForecastResult;
}

export function buildSnapshot(data: FinanceData): Snapshot {
  const movements = cashMovements(data);
  const states = invoiceStates(data);
  const cash = availableCash(data, movements);
  return {
    data, movements, states, cash,
    receivables: receivables(data, states),
    upcoming30: upcomingOutflows(data, addDays(data.today, 30)),
    forecastCentral90: forecast(data, 90, "central", { movements, states }),
  };
}

const money = (data: FinanceData, v: number) => formatMoney(v, data.baseCurrency);

export function computeAlerts(s: Snapshot): Alert[] {
  const { data } = s;
  const alerts: Alert[] = [];
  const f = s.forecastCentral90;

  // 1. Trésorerie prévisionnelle négative
  if (f.firstNegative) {
    const days = daysBetween(data.today, f.firstNegative);
    const expectedBefore = f.events.filter((e) => e.amount > 0 && e.date <= f.firstNegative!).length;
    alerts.push({
      key: `cash-negative:${f.firstNegative}`,
      severity: days <= 30 ? "critical" : "warning",
      title: days === 0 ? "Trésorerie insuffisante dès aujourd'hui" : `Trésorerie négative possible dans ${days} jours`,
      message: `Selon les encaissements et dépenses actuellement renseignés, votre trésorerie pourrait devenir négative le ${formatDate(f.firstNegative, "long")} (point bas : ${money(data, f.min.balance)} le ${formatDate(f.min.date)}). ${expectedBefore > 0 ? `${expectedBefore} paiement${expectedBefore > 1 ? "s sont attendus" : " est attendu"} avant cette date.` : "Aucun encaissement n'est attendu avant cette date."}`,
      hypothesis: "Scénario central : factures encaissées à échéance, factures en retard à 50 %, charges récurrentes à 100 %.",
      action: { label: "Voir le prévisionnel", href: "/previsionnel" },
      learnMore: "previsionnel",
    });
  } else if (f.firstBelowThreshold) {
    const days = daysBetween(data.today, f.firstBelowThreshold);
    alerts.push({
      key: `cash-threshold:${f.firstBelowThreshold}`,
      severity: "warning",
      title: `Trésorerie sous votre seuil de sécurité dans ${days} jours`,
      message: `Votre solde prévisionnel passerait sous ${money(data, data.cashSafetyThreshold)} le ${formatDate(f.firstBelowThreshold, "long")}, avec un point bas de ${money(data, f.min.balance)}.`,
      hypothesis: "Scénario central, sur 90 jours.",
      action: { label: "Voir le prévisionnel", href: "/previsionnel" },
      learnMore: "reserve",
    });
  }

  // 1 bis. En vue consolidée, une structure peut manquer de trésorerie alors que le total reste positif :
  // l'argent d'une entreprise n'est pas automatiquement disponible pour une autre (ni pour vous).
  if (data.scopeCompanyIds.size > 1) {
    for (const c of data.companies) {
      if (!data.scopeCompanyIds.has(c.id)) continue;
      const sub = { ...data, scopeCompanyIds: new Set([c.id]) };
      const fc = forecast(sub, 60, "central");
      if (!fc.firstNegative) continue;
      const days = daysBetween(data.today, fc.firstNegative);
      alerts.push({
        key: `company-negative:${c.id}:${fc.firstNegative}`,
        severity: days <= 30 ? "critical" : "warning",
        title: `${c.kind === "personal" ? "Espace personnel" : c.name} : trésorerie négative possible dans ${days} jour${days > 1 ? "s" : ""}`,
        message: `Même si la vue consolidée reste positive, les comptes de ${c.kind === "personal" ? "votre espace personnel" : c.name} pourraient passer à ${money(data, fc.min.balance)} le ${formatDate(fc.min.date)}. Les soldes ne se compensent pas automatiquement entre structures.`,
        hypothesis: "Scénario central, 60 jours, comptes de cette structure uniquement.",
        action: { label: "Voir les échéances", href: "/depenses?vue=a-venir" },
        learnMore: "tresorerie-vs-benefice",
      });
    }
  }

  // 2. Factures en retard — regroupées par client si plusieurs
  for (const c of s.receivables.byContact) {
    if (c.overdueCount >= 2) {
      alerts.push({
        key: `client-overdue:${c.contactId}`,
        severity: "warning",
        title: `${c.overdueCount} factures impayées chez ${c.name}${c.organization ? ` (${c.organization})` : ""}`,
        message: `${money(data, c.overdue)} sont en retard chez ce client. Une relance groupée est souvent plus efficace que des relances isolées.`,
        action: c.contactId ? { label: "Relancer le client", href: `/emails/nouveau?contact=${c.contactId}&template=invoice_reminder` } : { label: "Voir les factures", href: "/revenus?statut=overdue" },
        learnMore: "delais-paiement",
      });
    }
  }
  const groupedContacts = new Set(s.receivables.byContact.filter((c) => c.overdueCount >= 2).map((c) => c.contactId));
  for (const it of s.receivables.items) {
    if (it.status !== "overdue" || groupedContacts.has(it.invoice.contactId)) continue;
    const contact = data.contacts.find((c) => c.id === it.invoice.contactId);
    alerts.push({
      key: `invoice-overdue:${it.invoice.id}`,
      severity: it.daysOverdue > 30 ? "critical" : "warning",
      title: `Facture ${it.invoice.number} en retard de ${it.daysOverdue} jour${it.daysOverdue > 1 ? "s" : ""}`,
      message: `${money(data, it.remainingBase)} restent dus${contact ? ` par ${contact.name}` : ""}, échéance du ${formatDate(it.invoice.dueDate)}.`,
      action: { label: "Relancer", href: `/emails/nouveau?invoice=${it.invoice.id}&template=invoice_reminder` },
      learnMore: "delais-paiement",
    });
  }

  // 3. Échéances proches
  for (const u of s.upcoming30) {
    const days = daysBetween(data.today, u.originalDate);
    if (u.late) {
      alerts.push({
        key: `outflow-late:${u.key}`,
        severity: "warning",
        title: `${u.label} : paiement à confirmer`,
        message: `Échéance du ${formatDate(u.originalDate)} (${formatMoney(u.amount, u.currency)}) non confirmée. Tant qu'elle n'est pas confirmée, elle reste comptée comme une dépense à venir — jamais comme un décaissement effectué.`,
        action: { label: "Confirmer le paiement", href: `/depenses?confirmer=${encodeURIComponent(u.key)}` },
      });
    } else if (days <= Math.max(u.remindDaysBefore ?? 3, u.amountBase >= s.cash.total * 0.2 ? 7 : 0)) {
      alerts.push({
        key: `outflow-soon:${u.key}`,
        severity: "info",
        title: `Échéance ${relativeDays(u.originalDate, data.today)} : ${u.label}`,
        message: `${formatMoney(u.amount, u.currency)} à régler le ${formatDate(u.originalDate, "long")}${u.supplier ? ` à ${u.supplier}` : ""}.`,
        action: { label: "Voir les échéances", href: "/depenses?vue=a-venir" },
      });
    }
  }

  // 4. Dépenses qui augmentent plus vite que les revenus (30 derniers jours vs 30 précédents)
  const cur = periodFlows(s.movements, addDays(data.today, -29), data.today);
  const prev = periodFlows(s.movements, addDays(data.today, -59), addDays(data.today, -30));
  const expGrowth = pctChange(cur.expense, prev.expense);
  const incGrowth = pctChange(cur.income, prev.income);
  if (expGrowth != null && prev.expense > 0 && expGrowth > 15 && expGrowth - (incGrowth ?? 0) > 10) {
    alerts.push({
      key: `expense-growth:${data.today.slice(0, 7)}`,
      severity: "warning",
      title: "Vos dépenses augmentent plus vite que vos revenus",
      message: `Sur les 30 derniers jours : dépenses ${formatPercent(expGrowth, 0)} (${money(data, cur.expense)}), revenus encaissés ${incGrowth == null ? "sans base de comparaison" : formatPercent(incGrowth, 0)} (${money(data, cur.income)}), par rapport aux 30 jours précédents.`,
      action: { label: "Analyser les dépenses", href: "/depenses" },
      learnMore: "charges-fixes-variables",
    });
  }

  // 5. Baisse significative des revenus d'une activité
  if (data.activities.length > 1) {
    const now = profitability(data, addDays(data.today, -59), data.today, { states: s.states, movements: s.movements });
    for (const a of now.activities) {
      if (a.previousInvoiced > 0 && a.growth != null && a.growth <= -40) {
        alerts.push({
          key: `activity-drop:${a.activityId}:${data.today.slice(0, 7)}`,
          severity: "info",
          title: `Baisse des revenus : ${a.name}`,
          message: `Facturé sur les 60 derniers jours : ${money(data, a.invoiced)}, contre ${money(data, a.previousInvoiced)} sur les 60 jours précédents (${formatPercent(a.growth, 0)}).`,
          action: { label: "Comparer les activités", href: "/rentabilite" },
        });
      }
    }
  }

  // 6. Qualité des données
  if (s.cash.missingRates.length) {
    alerts.push({
      key: "missing-rates",
      severity: "warning",
      title: "Taux de change manquant",
      message: `Impossible de convertir le solde de : ${s.cash.missingRates.join(", ")}. Ces montants sont exclus des totaux tant qu'un taux daté n'est pas renseigné.`,
      action: { label: "Ajouter un taux", href: "/parametres#devises" },
    });
  }
  if (!s.cash.hasAccounts) {
    alerts.push({
      key: "no-accounts",
      severity: "info",
      title: "Renseignez au moins un compte",
      message: "Sans compte (banque, caisse, mobile money), l'argent disponible ne peut pas être calculé. Le prévisionnel part alors de zéro.",
      action: { label: "Ajouter un compte", href: "/structures#comptes" },
    });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function goalsProgress(s: Snapshot): GoalProgress[] {
  const { data } = s;
  const monthFrom = startOfMonth(data.today);
  const flows = periodFlows(s.movements, monthFrom, data.today);
  const out: GoalProgress[] = [];
  for (const g of data.goals) {
    if (!g.active) continue;
    if (g.companyId && !data.scopeCompanyIds.has(g.companyId)) continue;
    let current = 0;
    let lowerIsBetter = false;
    let unit: GoalProgress["unit"] = "money";
    switch (g.type) {
      case "monthly_revenue": {
        current = g.activityId
          ? s.movements.filter((m) => m.kind === "income" && !m.internal && m.activityId === g.activityId && m.date >= monthFrom).reduce((a, m) => a + (m.amountBase ?? 0), 0)
          : flows.income;
        break;
      }
      case "expense_cap": current = flows.expense; lowerIsBetter = true; break;
      case "min_cash": current = Math.min(s.cash.total, s.forecastCentral90.min.balance); break;
      case "reserve": current = s.cash.total; break;
      case "overdue_reduction": current = s.receivables.overdue; lowerIsBetter = true; break;
      case "margin_rate": {
        unit = "percent";
        // taux de marge mesuré sur les 90 derniers jours (un mois isolé est trop volatil)
        const p = profitability(data, addDays(data.today, -89), data.today, { states: s.states, movements: s.movements });
        const row = g.activityId ? p.activities.find((a) => a.activityId === g.activityId) : null;
        const rate = row ? row.marginRate : p.totals.invoiced > 0 ? (p.totals.margin / p.totals.invoiced) * 100 : null;
        current = Math.round(rate ?? 0);
        break;
      }
    }
    const target = g.target;
    let progress = lowerIsBetter ? (current <= target ? 1 : target / Math.max(current, 1)) : target > 0 ? Math.max(0, current / target) : 1;
    progress = Math.min(1, progress);
    const reached = lowerIsBetter ? current <= target : current >= target;
    const fmt = (v: number) => (unit === "percent" ? formatPercent(v) : money(data, v));
    let message: string;
    if (reached) message = lowerIsBetter ? `Objectif respecté : ${fmt(current)} pour une limite de ${fmt(target)}.` : `Objectif atteint : ${fmt(current)} sur ${fmt(target)}.`;
    else if (lowerIsBetter) message = `Dépassement de ${fmt(current - target)} par rapport à la limite de ${fmt(target)}.`;
    else if (unit === "percent") message = `Taux actuel ${fmt(current)} sur 90 jours : ${target - current} point${target - current > 1 ? "s" : ""} sous l'objectif.`;
    else message = `Il vous manque ${fmt(target - current)} selon les opérations enregistrées.`;
    if (g.type === "min_cash" && !reached) message = `Le point bas prévu sur 90 jours (${fmt(current)}) est sous votre minimum de ${fmt(target)}.`;
    const monthElapsed = (Number(data.today.slice(8, 10)) / Number(endOfMonth(data.today).slice(8, 10)));
    const status: GoalProgress["status"] = reached && !lowerIsBetter ? "reached" : reached ? "on_track"
      : g.type === "monthly_revenue" ? (progress >= monthElapsed * 0.9 ? "on_track" : "at_risk") : "at_risk";
    out.push({ goalId: g.id, label: g.label, type: g.type, target, current, progress, status, message, unit, lowerIsBetter });
  }
  return out;
}

export interface Recommendation {
  key: string;
  topic: "tresorerie" | "rentabilite" | "depenses" | "objectifs" | "encaissements";
  title: string;
  body: string;
  facts: string[];
  action?: { label: string; href: string };
  learnMore?: string;
}

export function computeRecommendations(s: Snapshot): Recommendation[] {
  const { data } = s;
  const recs: Recommendation[] = [];
  const f = s.forecastCentral90;
  const m = (v: number) => money(data, v);

  // Trésorerie : baisse prévue + factures importantes impayées
  const in21 = f.points[Math.min(21, f.points.length - 1)];
  if (in21 && in21.balance < f.start) {
    const big = s.receivables.items.slice().sort((a, b) => b.remainingBase - a.remainingBase).slice(0, 2);
    recs.push({
      key: "cash-decline",
      topic: "tresorerie",
      title: "Votre trésorerie prévisionnelle baisse sur les trois prochaines semaines",
      body: big.length
        ? `${big.length === 1 ? "Une facture importante est" : `${big.length} factures importantes sont`} encore impayée${big.length > 1 ? "s" : ""}. Vous pourriez commencer par relancer ${big.length > 1 ? "ces clients" : "ce client"}.`
        : "Aucune facture n'est en attente : envisagez de facturer les prestations réalisées ou de décaler une dépense non urgente.",
      facts: [`Solde actuel : ${m(f.start)}`, `Solde prévu dans 21 jours : ${m(in21.balance)} (scénario central)`, ...big.map((b) => `${b.invoice.number} : ${m(b.remainingBase)} restant dû, échéance ${formatDate(b.invoice.dueDate)}`)],
      action: big[0] ? { label: "Préparer une relance", href: `/emails/nouveau?invoice=${big[0].invoice.id}&template=invoice_reminder` } : { label: "Créer une facture", href: "/revenus/nouveau" },
      learnMore: "previsionnel",
    });
  }

  // Rentabilité : marge vs volume
  const p = profitability(data, addDays(data.today, -89), data.today, { states: s.states, movements: s.movements });
  const withRev = p.activities.filter((a) => a.invoiced > 0 && a.marginRate != null);
  if (withRev.length >= 2) {
    const byRevenue = withRev.slice().sort((a, b) => b.invoiced - a.invoiced)[0];
    const byMargin = withRev.slice().sort((a, b) => (b.marginRate ?? 0) - (a.marginRate ?? 0))[0];
    if (byRevenue.activityId !== byMargin.activityId) {
      recs.push({
        key: "margin-vs-volume",
        topic: "rentabilite",
        title: `${byMargin.name} affiche une meilleure marge que ${byRevenue.name}`,
        body: `${byRevenue.name} génère le plus de chiffre d'affaires, mais ${byMargin.name} conserve une part plus importante de chaque franc facturé. Vérifiez toutefois le temps consacré à chaque activité avant de décider laquelle développer.`,
        facts: [
          `${byRevenue.name} : ${m(byRevenue.invoiced)} facturés, marge ${formatPercent(byRevenue.marginRate)}`,
          `${byMargin.name} : ${m(byMargin.invoiced)} facturés, marge ${formatPercent(byMargin.marginRate)}`,
          "Période : 90 derniers jours, base facturée, coûts directs + dépenses affectées + frais communs répartis.",
        ],
        action: { label: "Comparer les activités", href: "/rentabilite" },
        learnMore: "marge",
      });
    }
  }

  // Dépenses : abonnements / catégorie en hausse
  const curFrom = startOfMonth(data.today);
  const prevFrom = startOfMonth(addDays(curFrom, -1));
  const elapsed = daysBetween(curFrom, data.today);
  const cur = expensesByCategory(data, s.movements, curFrom, data.today);
  const prev = expensesByCategory(data, s.movements, prevFrom, addDays(prevFrom, elapsed));
  for (const c of cur) {
    const before = prev.find((x) => x.name === c.name)?.amount ?? 0;
    const g = pctChange(c.amount, before);
    if (before > 0 && g != null && g >= 15 && c.amount - before >= Math.max(1, s.cash.total * 0.01)) {
      recs.push({
        key: `category-up:${c.name}`,
        topic: "depenses",
        title: `Vos dépenses « ${c.name} » ont augmenté de ${formatPercent(g)}`,
        body: "Par rapport à la même période du mois précédent. Examinez les opérations concernées pour repérer un abonnement en doublon ou une hausse de tarif.",
        facts: [`Ce mois-ci à date : ${m(c.amount)}`, `Mois précédent à date : ${m(before)}`],
        action: { label: "Voir les dépenses", href: `/depenses?q=${encodeURIComponent(c.name)}` },
        learnMore: "charges-fixes-variables",
      });
      break;
    }
  }

  // Récurrences : poids des charges fixes
  const monthlyRecurring = data.recurring.filter((r) => r.active && data.scopeCompanyIds.has(r.companyId))
    .reduce((acc, r) => acc + (r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 1 / 3 : 1 / 12) * (r.currency === data.baseCurrency ? r.amount : 0), 0);
  const avgIncome = periodFlows(s.movements, addDays(data.today, -89), data.today).income / 3;
  if (monthlyRecurring > 0 && avgIncome > 0 && monthlyRecurring / avgIncome > 0.4) {
    recs.push({
      key: "fixed-costs-weight",
      topic: "depenses",
      title: "Vos charges fixes pèsent lourd par rapport à vos revenus",
      body: "Plus les charges fixes sont élevées, plus un mois creux met la trésorerie sous tension. Passez en revue vos abonnements et engagements récurrents.",
      facts: [`Charges récurrentes : ≈ ${m(Math.round(monthlyRecurring))} / mois`, `Revenus encaissés : ≈ ${m(Math.round(avgIncome))} / mois (moyenne 90 jours)`, `Soit ${formatPercent((monthlyRecurring / avgIncome) * 100)} des revenus`],
      action: { label: "Voir les charges récurrentes", href: "/depenses?vue=recurrentes" },
      learnMore: "charges-fixes-variables",
    });
  }

  // Objectifs
  for (const g of goalsProgress(s)) {
    if (g.status === "at_risk" && !g.lowerIsBetter && g.unit === "money") {
      recs.push({
        key: `goal:${g.goalId}`,
        topic: "objectifs",
        title: `Objectif « ${g.label} »`,
        body: g.message,
        facts: [`Actuel : ${m(g.current)}`, `Cible : ${m(g.target)}`],
        action: { label: "Voir les objectifs", href: "/previsionnel#objectifs" },
        learnMore: "reserve",
      });
    }
  }

  // Encaissements : délai moyen
  if (s.receivables.overdue > 0 && s.receivables.overdue >= s.receivables.total * 0.3) {
    recs.push({
      key: "overdue-share",
      topic: "encaissements",
      title: "Une part importante de vos créances est en retard",
      body: "Relancer dès le lendemain de l'échéance, demander un acompte à la commande et raccourcir vos délais de paiement réduisent durablement les retards.",
      facts: [`En retard : ${m(s.receivables.overdue)}`, `Total à encaisser : ${m(s.receivables.total)}`],
      action: { label: "Voir les factures en retard", href: "/revenus?statut=overdue" },
      learnMore: "delais-paiement",
    });
  }
  return recs;
}

/** Combien faut-il encaisser pour couvrir les charges d'une période ? */
export function coverageNeed(s: Snapshot, from: ISODate, to: ISODate) {
  const outflows = upcomingOutflows(s.data, to, { includeLate: true }).filter((u) => u.originalDate >= from || u.late);
  const out = outflows.reduce((a, u) => a + u.amountBase, 0);
  const expectedIn = s.receivables.items.filter((i) => i.invoice.dueDate <= to).reduce((a, i) => a + i.remainingBase, 0);
  const need = Math.max(0, out - s.cash.total - expectedIn);
  return { outflows: out, expectedIn, cash: s.cash.total, need, items: outflows };
}

/** Peut-on absorber une dépense supplémentaire ? Simulation sur le scénario central. */
export function canAbsorb(s: Snapshot, amount: number, horizonDays = 60) {
  const f = forecast(s.data, horizonDays, "central", { movements: s.movements, states: s.states });
  const prudent = forecast(s.data, horizonDays, "prudent", { movements: s.movements, states: s.states });
  const minAfter = f.min.balance - amount;
  const minAfterPrudent = prudent.min.balance - amount;
  const threshold = s.data.cashSafetyThreshold;
  return {
    ok: minAfter >= threshold,
    okPrudent: minAfterPrudent >= threshold,
    minAfter, minAfterPrudent, minDate: f.min.date, threshold, horizonDays, start: f.start,
  };
}
