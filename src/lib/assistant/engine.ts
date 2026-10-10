/**
 * Assistant financier — moteur de réponses déterministe.
 * Chaque réponse est construite à partir des calculs du moteur financier : aucun chiffre n'est inventé.
 * Les faits, les estimations et les hypothèses sont séparés.
 */
import { addDays, addMonths, daysBetween, endOfMonth, formatDate, formatMonth, monthKey, startOfMonth } from "../dates";
import { formatMoney, formatPercent, parseAmount, toMajor, toMinor } from "../money";
import {
  bucketize, expensesByCategory, forecast, periodFlows, pctChange, profitability, upcomingOutflows,
} from "../finance/engine";
import { canAbsorb, computeAlerts, coverageNeed, type Snapshot } from "../finance/insights";

export interface AssistantAnswer {
  intent: string;
  text: string;
  facts: string[];
  estimates: string[];
  hypotheses: string[];
  table?: { headers: string[]; rows: string[][] };
  actions: { label: string; href: string }[];
  learnMore?: string;
  source: "moteur" | "claude";
}

export const SUGGESTED_QUESTIONS = [
  "Combien ai-je réellement gagné ce mois-ci ?",
  "Quelles sont mes trois principales dépenses ?",
  "Quelle activité est la plus rentable ?",
  "Combien dois-je encore encaisser ?",
  "Quelles factures sont en retard ?",
  "Puis-je absorber une dépense supplémentaire de 500 000 F ?",
  "Combien dois-je encaisser pour couvrir mes charges du mois prochain ?",
  "Comment mes dépenses ont-elles évolué depuis trois mois ?",
  "Quelle activité contribue le plus à ma trésorerie ?",
  "Quels abonnements ou frais récurrents devrais-je examiner ?",
  "Quels sont les risques financiers des 30 prochains jours ?",
  "Quelle sera ma situation à la fin du mois ?",
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ");

function has(q: string, ...words: string[]) {
  return words.some((w) => q.includes(w));
}

/** Extrait un montant d'une question (« 500 000 F », « 1,5 M », « 800 € »). */
export function extractAmount(question: string, currency: string): number | null {
  const q = question.replace(/ | /g, " ");
  const m = q.match(/(\d[\d\s.,]*)\s*(k|m|millions?|mille)?\s*(f|fcfa|cfa|xof|€|eur|euros?|\$|usd)?/i);
  if (!m) return null;
  const candidates = [...q.matchAll(/(\d[\d\s.,]*\d|\d)\s*(k|m\b|millions?|mille)?/gi)];
  let best: number | null = null;
  for (const c of candidates) {
    const mult = (c[2] ?? "").toLowerCase();
    const factor = mult === "k" || mult === "mille" ? 1000 : mult === "m" || mult.startsWith("million") ? 1_000_000 : 1;
    let v: number | null;
    if (factor === 1) {
      v = parseAmount(c[1].trim(), currency);
    } else {
      // « 1,5 M » : garder la partie décimale avant d'appliquer le multiplicateur (sinon arrondie en XOF)
      const cents = parseAmount(c[1].trim(), "EUR");
      v = cents == null ? null : toMinor(toMajor(cents, "EUR") * factor, currency);
    }
    if (v == null) continue;
    if (best == null || v > best) best = v;
  }
  return best;
}

export function answer(question: string, s: Snapshot): AssistantAnswer {
  const q = norm(question);
  const { data } = s;
  const cur = data.baseCurrency;
  const m = (v: number) => formatMoney(v, cur);
  const today = data.today;
  const base = (intent: string): AssistantAnswer => ({ intent, text: "", facts: [], estimates: [], hypotheses: [], actions: [], source: "moteur" });

  // ── Puis-je absorber une dépense ?
  if (has(q, "absorber", "me permettre", "puis-je depenser", "puis je depenser", "payer une depense", "depense supplementaire", "acheter")) {
    const amount = extractAmount(question, cur);
    const a = base("absorb");
    if (!amount) {
      a.text = "Indiquez le montant de la dépense envisagée, par exemple : « Puis-je absorber une dépense de 500 000 F ? »";
      return a;
    }
    const r = canAbsorb(s, amount, 60);
    a.text = r.ok && r.okPrudent
      ? `Oui, selon les données enregistrées. Après une dépense de ${m(amount)} aujourd'hui, votre point bas sur 60 jours resterait à ${m(r.minAfter)} (scénario central) et ${m(r.minAfterPrudent)} (scénario prudent).`
      : r.ok
        ? `Possible, avec prudence. Dans le scénario central, votre point bas resterait à ${m(r.minAfter)}, mais dans le scénario prudent il descendrait à ${m(r.minAfterPrudent)}${r.threshold ? `, sous votre seuil de ${m(r.threshold)}` : ""}.`
        : `Pas sans risque. Après une dépense de ${m(amount)}, votre trésorerie descendrait à ${m(r.minAfter)} vers le ${formatDate(r.minDate)} dans le scénario central${r.threshold ? ` (seuil de sécurité : ${m(r.threshold)})` : ""}.`;
    a.facts.push(`Argent disponible aujourd'hui : ${m(s.cash.total)}`);
    a.estimates.push(`Point bas prévu sans cette dépense : ${m(r.minAfter + amount)} (central)`);
    a.hypotheses.push("Dépense payée aujourd'hui, en une fois.", "Scénarios prudent et central sur 60 jours (hypothèses détaillées dans le prévisionnel).");
    if (s.data.scopeCompanyIds.size > 1) a.hypotheses.push("Vue consolidée : vérifiez que la structure qui paiera dispose elle-même des fonds.");
    a.actions.push({ label: "Ouvrir le simulateur du prévisionnel", href: "/previsionnel" });
    a.learnMore = "previsionnel";
    return a;
  }

  // ── Couvrir les charges du mois prochain
  if (has(q, "couvrir", "mois prochain")) {
    const from = addMonths(startOfMonth(today), 1, 1);
    const to = endOfMonth(from);
    const c = coverageNeed(s, from, to);
    const a = base("coverage");
    a.text = c.need > 0
      ? `Pour couvrir vos charges de ${formatMonth(monthKey(from), true)}, il vous manque environ ${m(c.need)} au-delà de votre trésorerie actuelle et des factures déjà attendues.`
      : `Vos charges prévues pour ${formatMonth(monthKey(from), true)} (${m(c.outflows)}) sont couvertes par votre trésorerie actuelle et les factures attendues, sans nouvel encaissement nécessaire — à condition que vos clients paient à l'échéance.`;
    a.facts.push(`Charges prévues jusqu'au ${formatDate(to)} : ${m(c.outflows)} (${c.items.length} échéance${c.items.length > 1 ? "s" : ""})`, `Argent disponible : ${m(c.cash)}`);
    a.estimates.push(`Factures attendues d'ici là : ${m(c.expectedIn)}`);
    a.hypotheses.push("Toutes les factures attendues sont encaissées à leur échéance.", "Les charges récurrentes et dépenses prévues sont payées à 100 %.");
    a.table = { headers: ["Échéance", "Libellé", "Montant"], rows: c.items.slice(0, 8).map((u) => [formatDate(u.originalDate), u.label, formatMoney(u.amount, u.currency)]) };
    a.actions.push({ label: "Voir les échéances", href: "/depenses?vue=a-venir" });
    return a;
  }

  // ── Risques des 30 prochains jours
  if (has(q, "risque", "danger", "surveiller", "inquiet", "probleme")) {
    const alerts = computeAlerts(s);
    const f30 = forecast(data, 30, "central", { movements: s.movements, states: s.states });
    const fp = forecast(data, 30, "prudent", { movements: s.movements, states: s.states });
    const a = base("risks");
    a.text = alerts.filter((x) => x.severity !== "info").length === 0
      ? "Aucun risque majeur n'est détecté sur les 30 prochains jours selon les données enregistrées."
      : `${alerts.filter((x) => x.severity !== "info").length} point(s) d'attention sur les 30 prochains jours. Le plus important : ${alerts[0].title.toLowerCase()}.`;
    for (const al of alerts.slice(0, 6)) a.facts.push(`${al.title} — ${al.message}`);
    a.estimates.push(`Point bas sur 30 jours : ${m(f30.min.balance)} le ${formatDate(f30.min.date)} (central), ${m(fp.min.balance)} (prudent)`);
    a.hypotheses.push(...f30.hypotheses.slice(1, 4));
    for (const al of alerts.slice(0, 3)) if (al.action) a.actions.push(al.action);
    return a;
  }

  // ── Factures en retard
  if (has(q, "retard", "impaye")) {
    const items = s.receivables.items.filter((i) => i.status === "overdue");
    const a = base("overdue");
    a.text = items.length === 0 ? "Aucune facture n'est en retard. Bravo." : `${items.length} facture${items.length > 1 ? "s sont" : " est"} en retard, pour un total de ${m(s.receivables.overdue)}.`;
    a.table = { headers: ["Facture", "Client", "Échéance", "Retard", "Restant dû"], rows: items.map((i) => [i.invoice.number, data.contacts.find((c) => c.id === i.invoice.contactId)?.name ?? "—", formatDate(i.invoice.dueDate), `${i.daysOverdue} j`, formatMoney(i.remaining, i.invoice.currency)]) };
    if (items[0]) a.actions.push({ label: `Relancer pour ${items[0].invoice.number}`, href: `/emails/nouveau?invoice=${items[0].invoice.id}&template=invoice_reminder` });
    a.actions.push({ label: "Voir les factures en retard", href: "/revenus?statut=overdue" });
    a.learnMore = "delais-paiement";
    return a;
  }

  // ── Combien encaisser encore
  if (has(q, "encaisser", "me doit", "doivent", "creance", "attendu")) {
    const r = s.receivables;
    const a = base("receivables");
    a.text = r.total === 0 ? "Personne ne vous doit d'argent actuellement : aucune facture envoyée n'est en attente de paiement." : `Vous devez encore encaisser ${m(r.total)} : ${m(r.notDue)} non échus et ${m(r.overdue)} en retard.`;
    a.facts.push(`${r.items.length} facture${r.items.length > 1 ? "s" : ""} non soldée${r.items.length > 1 ? "s" : ""}`);
    a.table = { headers: ["Client", "Factures", "Restant dû", "Dont en retard"], rows: r.byContact.slice(0, 8).map((c) => [c.name, String(c.count), m(c.total), c.overdue ? m(c.overdue) : "—"]) };
    a.hypotheses.push("Les opportunités commerciales non facturées ne sont pas comptées : ce ne sont pas des revenus certains.");
    a.actions.push({ label: "Voir les factures à encaisser", href: "/revenus?statut=open" });
    return a;
  }

  // ── Activité la plus rentable / contribution à la trésorerie
  if (has(q, "rentable", "marge", "activite", "contribue", "rapporte", "valeur")) {
    const p = profitability(data, addDays(today, -89), today, { states: s.states, movements: s.movements });
    const rows = p.activities.filter((x) => x.invoiced > 0 || x.collected > 0);
    const a = base(has(q, "contribue", "tresorerie") ? "cash-contribution" : "profitability");
    if (rows.length === 0) {
      a.text = "Je ne peux pas encore comparer vos activités : aucune facture ni recette n'est associée à une activité sur les 90 derniers jours.";
      a.actions.push({ label: "Organiser mes activités", href: "/structures" });
      return a;
    }
    if (a.intent === "cash-contribution") {
      const sorted = rows.slice().sort((x, y) => y.cashMargin - x.cashMargin);
      a.text = `Sur 90 jours, ${sorted[0].name} est l'activité qui contribue le plus à votre trésorerie : ${m(sorted[0].collected)} encaissés pour ${m(sorted[0].totalCosts)} de coûts, soit ${m(sorted[0].cashMargin)} de contribution nette.`;
      a.table = { headers: ["Activité", "Encaissé", "Coûts", "Contribution"], rows: sorted.map((x) => [x.name, m(x.collected), m(x.totalCosts), m(x.cashMargin)]) };
    } else {
      const byMargin = rows.filter((x) => x.marginRate != null).sort((x, y) => (y.marginRate ?? 0) - (x.marginRate ?? 0));
      const byRev = rows.slice().sort((x, y) => y.invoiced - x.invoiced);
      a.text = byMargin[0] && byRev[0] && byMargin[0].activityId !== byRev[0].activityId
        ? `${byRev[0].name} génère le plus de chiffre d'affaires (${m(byRev[0].invoiced)}), mais ${byMargin[0].name} est la plus rentable avec un taux de marge de ${formatPercent(byMargin[0].marginRate)}, contre ${formatPercent(byRev[0].marginRate)}.`
        : `${byRev[0].name} est à la fois l'activité qui génère le plus de revenus (${m(byRev[0].invoiced)}) et la plus rentable (marge ${formatPercent(byRev[0].marginRate)}).`;
      a.table = { headers: ["Activité", "Facturé", "Coûts", "Marge", "Taux"], rows: byRev.map((x) => [x.name, m(x.invoiced), m(x.totalCosts), m(x.margin), formatPercent(x.marginRate)]) };
      a.facts.push("Avant de décider quelle activité développer, comparez aussi le temps que vous consacrez à chacune : la marge ne tient pas compte de votre temps.");
    }
    a.hypotheses.push("Période : 90 derniers jours.", "Coûts = coûts directs + dépenses affectées + frais communs répartis selon vos règles.", p.unassignedCosts > 0 ? `${m(p.unassignedCosts)} de dépenses non affectées ne sont pas réparties (non comptées dans les marges).` : "Toutes les dépenses de la période sont affectées.");
    a.actions.push({ label: "Analyser la rentabilité", href: "/rentabilite" });
    a.learnMore = "marge";
    return a;
  }

  // ── Évolution des dépenses
  if (has(q, "evolu", "trois mois", "3 mois", "tendance", "augment")) {
    const from = addMonths(startOfMonth(today), -3, 1);
    const buckets = bucketize(s.movements, from, today, "month");
    const a = base("expense-trend");
    const complete = buckets.slice(0, -1);
    const first = complete[0];
    const last = complete.at(-1);
    a.text = first && last
      ? `Vos dépenses payées sont passées de ${m(first.expense)} en ${formatMonth(first.key, true)} à ${m(last.expense)} en ${formatMonth(last.key, true)} (${formatPercent(pctChange(last.expense, first.expense) ?? 0)}).`
      : "Pas assez d'historique pour mesurer une évolution.";
    a.table = { headers: ["Mois", "Encaissé", "Dépenses payées", "Solde net"], rows: buckets.map((b) => [formatMonth(b.key, true) + (b.key === monthKey(today) ? " (en cours)" : ""), m(b.income), m(b.expense), formatMoney(b.net, cur, { sign: true })]) };
    const cats = expensesByCategory(data, s.movements, from, today).slice(0, 3);
    if (cats.length) a.facts.push(`Principaux postes sur la période : ${cats.map((c) => `${c.name} (${m(c.amount)})`).join(", ")}`);
    a.hypotheses.push("Les transferts internes et rémunérations du dirigeant ne sont pas comptés comme des dépenses.");
    a.actions.push({ label: "Voir les dépenses", href: "/depenses" });
    a.learnMore = "charges-fixes-variables";
    return a;
  }

  // ── Abonnements / récurrents
  if (has(q, "abonnement", "recurrent", "fixe", "examiner")) {
    const recs = data.recurring.filter((r) => r.active && data.scopeCompanyIds.has(r.companyId));
    const monthly = (r: (typeof recs)[number]) => (r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 1 / 3 : 1 / 12) * r.amount;
    const a = base("recurring");
    const totalBase = recs.reduce((t, r) => t + (r.currency === cur ? monthly(r) : 0), 0);
    a.text = recs.length === 0 ? "Aucune charge récurrente n'est enregistrée." : `Vous avez ${recs.length} charge${recs.length > 1 ? "s" : ""} récurrente${recs.length > 1 ? "s" : ""} active${recs.length > 1 ? "s" : ""}, soit environ ${m(Math.round(totalBase))} par mois. Commencez par examiner les plus coûteuses et celles dont le montant réel a augmenté.`;
    // hausses constatées : dernier paiement vs montant prévu
    const increases: string[] = [];
    for (const r of recs) {
      const paid = data.expenses.filter((e) => e.recurringId === r.id && e.status === "paid").sort((x, y) => (x.date < y.date ? 1 : -1));
      if (paid[0] && paid[1] && paid[0].amount > paid[1].amount) increases.push(`${r.label} : ${formatMoney(paid[1].amount, r.currency)} → ${formatMoney(paid[0].amount, r.currency)} (+${formatPercent(((paid[0].amount - paid[1].amount) / paid[1].amount) * 100)})`);
    }
    if (increases.length) a.facts.push("Hausses constatées sur le dernier paiement :", ...increases);
    a.table = { headers: ["Charge", "Fréquence", "Montant", "≈ par mois"], rows: recs.slice().sort((x, y) => monthly(y) - monthly(x)).map((r) => [r.label, r.frequency === "monthly" ? "Mensuelle" : r.frequency === "quarterly" ? "Trimestrielle" : "Annuelle", formatMoney(r.amount, r.currency), formatMoney(Math.round(monthly(r)), r.currency)]) };
    a.actions.push({ label: "Gérer les charges récurrentes", href: "/depenses?vue=recurrentes" });
    a.learnMore = "charges-fixes-variables";
    return a;
  }

  // ── Principales dépenses
  if (has(q, "principales depenses", "plus grosses", "postes", "ou part", "depense le plus", "dépenses principales", "principales")) {
    const from = startOfMonth(today);
    const cats = expensesByCategory(data, s.movements, from, today);
    const top = s.movements.filter((x) => x.kind === "expense" && !x.internal && x.date >= from && x.amountBase != null).sort((x, y) => x.amountBase! - y.amountBase!).slice(0, 3);
    const a = base("top-expenses");
    a.text = cats.length === 0 ? "Aucune dépense payée ce mois-ci pour l'instant." : `Ce mois-ci, vos trois principaux postes de dépenses sont : ${cats.slice(0, 3).map((c) => `${c.name} (${m(c.amount)})`).join(", ")}.`;
    if (top.length) a.facts.push(`Plus grosses dépenses individuelles : ${top.map((x) => `${x.label} (${m(-x.amountBase!)})`).join(" ; ")}`);
    a.table = { headers: ["Catégorie", "Montant"], rows: cats.slice(0, 8).map((c) => [c.name, m(c.amount)]) };
    a.actions.push({ label: "Voir les dépenses du mois", href: "/depenses" });
    return a;
  }

  // ── Fin de mois / prévision
  if (has(q, "fin du mois", "fin de mois", "prevision", "previsionnel", "restera", "situation")) {
    const h = Math.max(1, daysBetween(today, endOfMonth(today)));
    const fs = (["prudent", "central", "optimist"] as const).map((sc) => forecast(data, h, sc, { movements: s.movements, states: s.states }));
    const a = base("end-of-month");
    a.text = `À la fin du mois, votre trésorerie devrait se situer autour de ${m(fs[1].end)} (scénario central), entre ${m(fs[0].end)} (prudent) et ${m(fs[2].end)} (optimiste). C'est une estimation, pas une certitude.`;
    a.facts.push(`Argent disponible aujourd'hui : ${m(s.cash.total)}`);
    a.estimates.push(`Entrées prévues d'ici la fin du mois : ${m(fs[1].totalIn)}`, `Sorties prévues : ${m(fs[1].totalOut)}`);
    a.hypotheses.push(...fs[1].hypotheses);
    a.actions.push({ label: "Ouvrir le prévisionnel", href: "/previsionnel" });
    a.learnMore = "previsionnel";
    return a;
  }

  // ── Argent disponible
  if (has(q, "disponible", "solde", "combien j ai", "combien ai-je sur", "tresorerie", "compte")) {
    const a = base("cash");
    a.text = `Vous disposez de ${m(s.cash.total)} sur vos comptes${s.cash.personal ? `, dont ${m(s.cash.pro)} côté professionnel et ${m(s.cash.personal)} côté personnel` : ""}.`;
    a.table = { headers: ["Compte", "Solde"], rows: s.cash.accounts.map((x) => [x.account.name, formatMoney(x.balance, x.account.currency)]) };
    a.facts.push("Ce montant n'est ni votre bénéfice, ni l'argent qu'on vous doit : des charges ou impôts peuvent encore être à payer.");
    a.learnMore = "tresorerie-vs-benefice";
    return a;
  }

  // ── Gagné ce mois (par défaut pour « gagné », « revenu », « chiffre »)
  if (has(q, "gagne", "revenu", "chiffre d affaires", "encaisse", "benefice", "ce mois")) {
    const from = startOfMonth(today);
    const f = periodFlows(s.movements, from, today);
    const invoiced = [...s.states.values()].filter((x) => x.status !== "draft" && x.status !== "cancelled" && x.invoice.issueDate >= from).reduce((t, x) => t + x.invoice.total * (x.invoice.currency === cur ? 1 : 0), 0);
    const a = base("earned");
    a.text = `Ce mois-ci, vous avez réellement encaissé ${m(f.income)} et payé ${m(f.expense)} de dépenses : votre solde net est de ${formatMoney(f.net, cur, { sign: true })}.`;
    a.facts.push(`Facturé ce mois-ci (pas forcément encaissé) : ${m(invoiced)}`);
    if (f.transfersOut) a.facts.push(`Transferts sortants (rémunération, épargne…) non comptés comme dépenses : ${m(f.transfersOut)}`);
    a.hypotheses.push("« Gagné » s'entend ici comme encaissé moins dépensé (vision trésorerie), pas comme un bénéfice comptable : des charges et impôts peuvent rester à payer.");
    a.actions.push({ label: "Voir les transactions du mois", href: `/transactions?du=${from}&au=${today}` });
    a.learnMore = "tresorerie-vs-benefice";
    return a;
  }

  const a = base("unknown");
  a.text = "Je n'ai pas compris la question. Je peux vous répondre sur vos encaissements, dépenses, factures en retard, prévisions, rentabilité par activité, charges récurrentes ou la capacité à absorber une dépense. Essayez l'une des questions suggérées.";
  return a;
}

/** Données factuelles compactes pour l'assistant IA (outils). */
export function upcomingSummary(s: Snapshot, days: number) {
  return upcomingOutflows(s.data, addDays(s.data.today, days)).map((u) => ({ date: u.originalDate, label: u.label, amount: formatMoney(u.amount, u.currency), late: u.late }));
}
