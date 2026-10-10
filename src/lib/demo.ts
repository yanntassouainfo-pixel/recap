/**
 * Données de démonstration réalistes : un indépendant qui exerce plusieurs métiers via deux structures,
 * avec un espace personnel. Toutes les dates sont relatives à aujourd'hui pour rester pertinentes.
 * Les noms d'organisations et de personnes sont fictifs.
 */
import { eq } from "drizzle-orm";
import type { DB } from "./db";
import * as schema from "./db/schema";
import { newId } from "./ids";
import { addDays, addMonths, endOfMonth, startOfMonth, todayISO } from "./dates";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, DEFAULT_TEMPLATES } from "./setup";
import { simpleTextPdf } from "./pdf";
import { saveFile } from "./storage";
import { loadFinanceDataFrom } from "./finance/load";
import { invoiceStates, planForMonth } from "./finance/engine";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function createDemoData(db: DB, userId: string, today = todayISO()) {
  const r = rng(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const between = (min: number, max: number, step = 5000) => Math.round((min + r() * (max - min)) / step) * step;
  const start = addMonths(startOfMonth(today), -7, 1);

  db.update(schema.settings).set({
    baseCurrency: "XOF", country: "CI", mode: "multi_company", personalSpaceEnabled: true, cashSafetyThreshold: 1_000_000,
    onboardedAt: new Date().toISOString(),
  }).where(eq(schema.settings.userId, userId)).run();

  /* Catégories */
  const cat: Record<string, string> = {};
  for (const [name, nature] of DEFAULT_EXPENSE_CATEGORIES) {
    const id = newId("cat_");
    cat[name] = id;
    db.insert(schema.categories).values({ id, userId, kind: "expense", name, nature }).run();
  }
  for (const name of DEFAULT_INCOME_CATEGORIES) {
    const id = newId("cat_");
    cat[name] = id;
    db.insert(schema.categories).values({ id, userId, kind: "income", name }).run();
  }

  /* Structures */
  const pp = newId("cmp_");
  const studio = newId("cmp_");
  const perso = newId("cmp_");
  db.insert(schema.companies).values([
    {
      id: pp, userId, name: "Parole & Présence", legalName: "Parole & Présence — Entreprise individuelle", kind: "company",
      description: "Formations et coaching en prise de parole en public, éloquence et leadership.", email: "bonjour@parole-presence.ci",
      phone: "+225 07 00 00 00 01", address: "Rue des Jardins, Cocody, Abidjan", currency: "XOF", color: "#2a78d6",
      invoicePrefix: "PP", quotePrefix: "PP-DEV", paymentTermsDays: 30, taxId: "CC 2024 000 001 A",
      billingDetails: "Banque Atlantique — IBAN CI93 0000 0000 0000 0000 0000 01\nOrange Money : +225 07 00 00 00 01",
    },
    {
      id: studio, userId, name: "Studio Kora", legalName: "Studio Kora SARL", kind: "company",
      description: "Direction de création, conseil en communication et services numériques.", email: "contact@studiokora.ci",
      phone: "+225 05 00 00 00 02", address: "Boulevard Latrille, Abidjan", currency: "XOF", color: "#eb6834",
      invoicePrefix: "SK", quotePrefix: "SK-DEV", paymentTermsDays: 30, taxId: "CC 2023 000 777 B",
      billingDetails: "Ecobank — IBAN CI93 0000 0000 0000 0000 0000 02",
    },
    { id: perso, userId, name: "Finances personnelles", kind: "personal", currency: "XOF", color: "#7a6a58", invoicePrefix: "PERSO" },
  ]).run();
  db.insert(schema.brands).values([
    { id: newId("brd_"), userId, companyId: pp, name: "Parole & Présence", description: "Marque principale" },
    { id: newId("brd_"), userId, companyId: pp, name: "Leaders qui parlent", description: "Programme de coaching dirigeants" },
    { id: newId("brd_"), userId, companyId: studio, name: "Studio Kora", description: "Agence de création" },
  ]).run();

  const act = {
    formation: newId("act_"), coaching: newId("act_"), da: newId("act_"), digital: newId("act_"), conseil: newId("act_"),
  };
  db.insert(schema.activities).values([
    { id: act.formation, userId, companyId: pp, name: "Formation prise de parole", category: "Formation", color: "#2a78d6", monthlyRevenueTarget: 1_500_000, description: "Ateliers et séminaires en entreprise." },
    { id: act.coaching, userId, companyId: pp, name: "Coaching éloquence & leadership", category: "Coaching", color: "#1baf7a", monthlyRevenueTarget: 800_000, description: "Accompagnements individuels de dirigeants." },
    { id: act.da, userId, companyId: studio, name: "Direction de création", category: "Création", color: "#eb6834", monthlyRevenueTarget: 2_000_000, description: "Identités visuelles, campagnes, éditions." },
    { id: act.digital, userId, companyId: studio, name: "Services numériques", category: "Numérique", color: "#4a3aa7", description: "Sites, réseaux sociaux, contenus." },
    { id: act.conseil, userId, companyId: studio, name: "Conseil en communication", category: "Conseil", color: "#eda100", description: "Stratégie et accompagnement des marques." },
  ]).run();

  /* Comptes */
  const acc = { ppBank: newId("acc_"), ppMomo: newId("acc_"), skBank: newId("acc_"), skEur: newId("acc_"), persoBank: newId("acc_"), persoSave: newId("acc_") };
  db.insert(schema.accounts).values([
    { id: acc.ppBank, userId, companyId: pp, name: "Banque Atlantique — pro", type: "bank", institution: "Banque Atlantique", currency: "XOF", openingBalance: 450_000, openingDate: start },
    { id: acc.ppMomo, userId, companyId: pp, name: "Orange Money pro", type: "mobile_money", institution: "Orange Money", currency: "XOF", openingBalance: 40_000, openingDate: start },
    { id: acc.skBank, userId, companyId: studio, name: "Ecobank — Studio Kora", type: "bank", institution: "Ecobank", currency: "XOF", openingBalance: 1_500_000, openingDate: start },
    { id: acc.skEur, userId, companyId: studio, name: "Compte en euros", type: "payment", institution: "Wise", currency: "EUR", openingBalance: 25_000, openingDate: start },
    { id: acc.persoBank, userId, companyId: perso, name: "Compte courant personnel", type: "bank", institution: "SGBCI", currency: "XOF", openingBalance: 150_000, openingDate: start },
    { id: acc.persoSave, userId, companyId: perso, name: "Épargne de précaution", type: "bank", institution: "SGBCI", currency: "XOF", openingBalance: 600_000, openingDate: start },
  ]).run();

  db.insert(schema.exchangeRates).values([
    { id: newId("fx_"), userId, date: start, base: "USD", quote: "XOF", rate: 568, source: "Saisie manuelle" },
    { id: newId("fx_"), userId, date: addMonths(start, 4), base: "USD", quote: "XOF", rate: 561, source: "Saisie manuelle" },
  ]).run();

  /* Contacts */
  const people: [string, string, string, "client" | "prospect", string, string][] = [
    ["Aïcha Koné", "Banque Horizon", "a.kone@banquehorizon.example", "client", act.formation, pp],
    ["Marc Yao", "Groupe Savane", "marc.yao@groupesavane.example", "client", act.da, studio],
    ["Fatou Diallo", "Fondation Lumière", "f.diallo@fondationlumiere.example", "client", act.formation, pp],
    ["Jean-Baptiste Kouassi", "Akwaba Conseil", "jb@akwabaconseil.example", "client", act.coaching, pp],
    ["Mariam Traoré", "Nyota Tech", "mariam@nyota.example", "client", act.digital, studio],
    ["Koffi Mensah", "Hôtel Lagune Bleue", "k.mensah@lagunebleue.example", "client", act.da, studio],
    ["Claire Martin", "Maison Durance (Lyon)", "claire.martin@durance.example", "client", act.conseil, studio],
    ["Awa Ndiaye", "Indépendante", "awa.ndiaye@mail.example", "prospect", act.coaching, pp],
    ["Serge Bamba", "Cimenterie de l'Ouest", "s.bamba@cimouest.example", "prospect", act.formation, pp],
    ["Clarisse Ouattara", "Agence Baobab", "clarisse@baobab.example", "prospect", act.da, studio],
  ];
  const contactIds: string[] = [];
  for (const [name, org, email, type, activityId, companyId] of people) {
    const id = newId("ct_");
    contactIds.push(id);
    db.insert(schema.contacts).values({
      id, userId, name, organization: org, email, type, activityId, companyId, phone: "+225 07 " + Math.floor(10 + r() * 89) + " " + Math.floor(10 + r() * 89) + " " + Math.floor(10 + r() * 89) + " " + Math.floor(10 + r() * 89),
      source: pick(["Recommandation", "LinkedIn", "Site web", "Événement"]), createdAt: new Date(addDays(start, Math.floor(r() * 60)) + "T09:00:00Z").toISOString(),
      convertedAt: type === "client" ? addDays(start, 20) : null,
      needs: type === "prospect" ? (activityId === act.coaching ? "Prendre la parole avec assurance lors de conférences ; 8 séances souhaitées." : activityId === act.formation ? "Former 15 managers à la prise de parole en réunion." : "Refonte de l'identité visuelle avant un lancement.") : null,
    }).run();
  }
  const C = (i: number) => contactIds[i];

  /* Factures */
  let seq: Record<string, number> = { PP: 0, SK: 0 };
  const lineSets: Record<string, [string, number, number][]> = {
    [act.formation]: [["Atelier prise de parole — 1 journée", 1, 450_000], ["Séminaire « Convaincre en réunion » — 2 jours", 1, 900_000], ["Formation de formateurs — module 1", 1, 650_000]],
    [act.coaching]: [["Séance de coaching individuel", 4, 60_000], ["Programme Leaders qui parlent — 6 séances", 1, 420_000], ["Préparation d'une keynote", 1, 250_000]],
    [act.da]: [["Direction artistique campagne", 1, 1_800_000], ["Identité visuelle complète", 1, 2_400_000], ["Charte graphique & déclinaisons", 1, 1_200_000]],
    [act.digital]: [["Site vitrine — conception & intégration", 1, 850_000], ["Gestion réseaux sociaux — forfait mensuel", 1, 350_000], ["Production de contenus vidéo", 1, 600_000]],
    [act.conseil]: [["Atelier stratégie de marque", 1, 750_000], ["Audit de communication", 1, 500_000]],
  };
  const clientsByActivity: Record<string, number[]> = {
    [act.formation]: [0, 2, 0], [act.coaching]: [3, 3], [act.da]: [1, 5], [act.digital]: [4, 4, 5], [act.conseil]: [1, 6],
  };
  const perMonth: Record<string, number> = { [act.formation]: 1.6, [act.coaching]: 1.6, [act.da]: 0.75, [act.digital]: 0.9, [act.conseil]: 0.4 };

  const insertInvoice = (o: { companyId: string; activityId: string | null; contactId: string | null; issue: string; lines: [string, number, number][]; currency?: string; status?: string; counterpart?: string | null; title?: string; docType?: string; opportunityId?: string | null }) => {
    const id = newId("inv_");
    const prefix = o.companyId === pp ? "PP" : "SK";
    seq[prefix] = (seq[prefix] ?? 0) + 1;
    const number = o.docType === "quote" ? `${prefix}-DEV-${today.slice(0, 4)}-${String(seq[prefix]).padStart(3, "0")}` : `${prefix}-${today.slice(0, 4)}-${String(seq[prefix]).padStart(3, "0")}`;
    const total = o.lines.reduce((a, [, q, u]) => a + Math.round(q * u), 0);
    db.insert(schema.invoices).values({
      id, userId, companyId: o.companyId, activityId: o.activityId, contactId: o.contactId, docType: o.docType ?? "invoice", number,
      title: o.title ?? o.lines[0][0], issueDate: o.issue, dueDate: addDays(o.issue, 30), currency: o.currency ?? "XOF", total, subtotal: total, taxTotal: 0,
      status: o.status ?? "sent", sentAt: o.issue, counterpartCompanyId: o.counterpart ?? null, opportunityId: o.opportunityId ?? null,
      createdAt: new Date(o.issue + "T10:00:00Z").toISOString(),
    }).run();
    o.lines.forEach(([description, quantity, unitPrice], position) => db.insert(schema.invoiceLines).values({ id: newId("il_"), invoiceId: id, position, description, quantity, unitPrice }).run());
    if (o.contactId) {
      db.insert(schema.interactions).values({ id: newId("ix_"), userId, contactId: o.contactId, type: "invoice_issued", date: o.issue, title: `Facture ${number} émise`, refType: "invoice", refId: id }).run();
    }
    return { id, total, number };
  };
  const pay = (invoiceId: string, date: string, amount: number, accountId: string, contactId: string | null, number: string, method = "bank_transfer") => {
    if (date > today) return;
    db.insert(schema.payments).values({ id: newId("pay_"), userId, invoiceId, date, amount, accountId, method, reference: `VIR-${Math.floor(r() * 900000 + 100000)}` }).run();
    if (contactId) db.insert(schema.interactions).values({ id: newId("ix_"), userId, contactId, type: "payment_received", date, title: `Paiement reçu — ${number}`, refType: "invoice", refId: invoiceId }).run();
  };

  for (let m = 0; m <= 7; m++) {
    const monthStart = addMonths(start, m, 1);
    for (const [activityId, count] of Object.entries(perMonth)) {
      const n = Math.floor(count) + (r() < count % 1 ? 1 : 0) + (m >= 5 && activityId === act.da ? 0 : 0);
      for (let k = 0; k < n; k++) {
        const issue = addDays(monthStart, Math.floor(r() * 26));
        if (issue > today) continue;
        const companyId = [act.formation, act.coaching].includes(activityId) ? pp : studio;
        const contactIdx = pick(clientsByActivity[activityId]);
        const [label, q, unit] = pick(lineSets[activityId]);
        // les revenus de la formation progressent, ceux du digital baissent sur les derniers mois
        const factor = activityId === act.formation ? 0.85 + m * 0.05 : activityId === act.digital && m >= 6 ? 0.5 : 1;
        const inv = insertInvoice({ companyId, activityId, contactId: C(contactIdx), issue, lines: [[label, q, Math.round((unit * factor) / 5000) * 5000]] });
        const age = (Date.parse(today) - Date.parse(issue)) / 86400000;
        const account = companyId === pp ? (r() < 0.2 ? acc.ppMomo : acc.ppBank) : acc.skBank;
        const delay = activityId === act.coaching ? between(2, 12, 1) : activityId === act.da ? between(25, 55, 1) : between(10, 40, 1);
        if (age > delay) {
          if (r() < 0.12 && age < 120) {
            pay(inv.id, addDays(issue, delay), Math.round(inv.total * 0.5 / 5000) * 5000, account, C(contactIdx), inv.number); // partiel
          } else {
            pay(inv.id, addDays(issue, delay), inv.total, account, C(contactIdx), inv.number, account === acc.ppMomo ? "mobile_money" : "bank_transfer");
          }
        }
      }
    }
  }
  // Deux factures en retard chez Groupe Savane (relance groupée), une facture à venir importante
  const late1 = insertInvoice({ companyId: studio, activityId: act.da, contactId: C(1), issue: addDays(today, -58), lines: [["Direction artistique — campagne de rentrée", 1, 1_650_000]] });
  const late2 = insertInvoice({ companyId: studio, activityId: act.digital, contactId: C(1), issue: addDays(today, -44), lines: [["Déclinaisons digitales de la campagne", 1, 480_000]] });
  void late1; void late2;
  const bigDue = insertInvoice({ companyId: pp, activityId: act.formation, contactId: C(0), issue: addDays(today, -18), lines: [["Séminaire « Convaincre en réunion » — 2 jours", 1, 900_000], ["Supports et cahier d'exercices", 15, 12_000]] });
  pay(bigDue.id, addDays(today, -4), 400_000, acc.ppBank, C(0), bigDue.number);
  insertInvoice({ companyId: studio, activityId: act.da, contactId: C(5), issue: addDays(today, -6), lines: [["Identité visuelle — Hôtel Lagune Bleue", 1, 2_200_000]] });
  // Client européen en euros, encaissé sur le compte EUR
  const eur = insertInvoice({ companyId: studio, activityId: act.conseil, contactId: C(6), issue: addDays(today, -40), currency: "EUR", lines: [["Atelier stratégie de marque (à distance)", 1, 1_800_00]] });
  pay(eur.id, addDays(today, -15), 1_800_00, acc.skEur, C(6), eur.number);
  // Flux interne : le studio facture des supports à Parole & Présence (neutralisé en vue consolidée)
  const internal = insertInvoice({ companyId: studio, activityId: act.da, contactId: null, issue: addDays(today, -35), counterpart: pp, title: "Conception des supports de formation", lines: [["Conception des supports de formation (refacturation interne)", 1, 300_000]] });
  pay(internal.id, addDays(today, -20), 300_000, acc.skBank, null, internal.number);
  db.insert(schema.expenses).values({ id: newId("exp_"), userId, companyId: pp, activityId: act.formation, categoryId: cat["Prestataires & sous-traitance"], label: "Supports de formation — Studio Kora", supplier: "Studio Kora", amount: 300_000, currency: "XOF", date: addDays(today, -35), status: "paid", paidDate: addDays(today, -20), accountId: acc.ppBank, costType: "direct", counterpartCompanyId: studio }).run();
  // Brouillon et devis
  insertInvoice({ companyId: pp, activityId: act.coaching, contactId: C(3), issue: today, status: "draft", lines: [["Programme Leaders qui parlent — 6 séances", 1, 420_000]] });

  /* Recettes directes (sans facture) */
  for (let m = 0; m <= 7; m++) {
    const d = addDays(addMonths(start, m, 1), 12 + Math.floor(r() * 10));
    if (d > today) continue;
    db.insert(schema.incomes).values({ id: newId("inc_"), userId, companyId: pp, activityId: act.coaching, categoryId: cat["Prestations de services"], date: d, amount: between(60_000, 120_000, 10_000), currency: "XOF", description: "Séance de coaching ponctuelle", method: "mobile_money", accountId: acc.ppMomo }).run();
  }

  /* Règles de répartition des frais communs */
  const ruleStudio = newId("ar_");
  const rulePP = newId("ar_");
  db.insert(schema.allocationRules).values([
    { id: ruleStudio, userId, companyId: studio, name: "Frais du studio au prorata du CA", method: "revenue", shares: "[]" },
    { id: rulePP, userId, companyId: pp, name: "Frais Parole & Présence 70/30", method: "manual", shares: JSON.stringify([{ activityId: act.formation, percent: 70 }, { activityId: act.coaching, percent: 30 }]) },
  ]).run();

  /* Charges récurrentes */
  const recurring: { companyId: string; label: string; supplier: string; amount: number; currency?: string; frequency: string; day: number; category: string; accountId: string; rule?: string; activityId?: string }[] = [
    { companyId: studio, label: "Loyer du studio", supplier: "SCI Les Palmiers", amount: 250_000, frequency: "monthly", day: 5, category: "Loyer", accountId: acc.skBank, rule: ruleStudio },
    { companyId: studio, label: "Assistante de production (prestation)", supplier: "Prestataire indépendante", amount: 380_000, frequency: "monthly", day: 30, category: "Prestataires & sous-traitance", accountId: acc.skBank, rule: ruleStudio },
    { companyId: studio, label: "Électricité & eau", supplier: "CIE / SODECI", amount: 48_000, frequency: "monthly", day: 18, category: "Électricité & eau", accountId: acc.skBank, rule: ruleStudio },
    { companyId: studio, label: "Fibre & téléphonie", supplier: "Opérateur fibre", amount: 35_000, frequency: "monthly", day: 10, category: "Internet & téléphone", accountId: acc.skBank, rule: ruleStudio },
    { companyId: studio, label: "Suite créative", supplier: "Abonnement logiciel", amount: 62_99, currency: "EUR", frequency: "monthly", day: 22, category: "Abonnements logiciels", accountId: acc.skEur, activityId: act.da },
    { companyId: pp, label: "Outils en ligne (visio, agenda)", supplier: "Abonnements SaaS", amount: 28_000, frequency: "monthly", day: 3, category: "Abonnements logiciels", accountId: acc.ppBank, rule: rulePP },
    { companyId: pp, label: "Assurance responsabilité civile pro", supplier: "Assureur", amount: 95_000, frequency: "quarterly", day: 15, category: "Assurances", accountId: acc.ppBank, rule: rulePP },
    { companyId: pp, label: "Frais de tenue de compte", supplier: "Banque Atlantique", amount: 7_500, frequency: "monthly", day: 28, category: "Frais bancaires", accountId: acc.ppBank },
    { companyId: perso, label: "Loyer appartement", supplier: "Propriétaire", amount: 300_000, frequency: "monthly", day: 1, category: "Dépenses personnelles", accountId: acc.persoBank },
    { companyId: perso, label: "Scolarité des enfants", supplier: "Groupe scolaire", amount: 275_000, frequency: "monthly", day: 5, category: "Dépenses personnelles", accountId: acc.persoBank },
    { companyId: perso, label: "Soutien familial", supplier: "Famille", amount: 150_000, frequency: "monthly", day: 2, category: "Dépenses personnelles", accountId: acc.persoBank },
    { companyId: perso, label: "Abonnements streaming & mobile", supplier: "Divers", amount: 18_500, frequency: "monthly", day: 8, category: "Dépenses personnelles", accountId: acc.persoBank },
  ];
  for (const rc of recurring) {
    const id = newId("rec_");
    const startDate = `${start.slice(0, 8)}${String(rc.day).padStart(2, "0")}`;
    db.insert(schema.recurringExpenses).values({
      id, userId, companyId: rc.companyId, label: rc.label, supplier: rc.supplier, amount: rc.amount, currency: rc.currency ?? "XOF",
      frequency: rc.frequency, startDate, accountId: rc.accountId, categoryId: cat[rc.category], allocationRuleId: rc.rule ?? null,
      activityId: rc.activityId ?? null, remindDaysBefore: 3,
    }).run();
    // échéances passées confirmées (sauf la plus récente de l'électricité : à confirmer)
    const step = rc.frequency === "quarterly" ? 3 : 1;
    for (let i = 0; ; i += step) {
      const d = addMonths(startDate, i, rc.day);
      if (d >= today) break;
      if (rc.label === "Électricité & eau" && d > addDays(today, -25)) continue;
      const bump = rc.label === "Outils en ligne (visio, agenda)" && d >= startOfMonth(today) ? 1.35 : 1;
      db.insert(schema.expenses).values({
        id: newId("exp_"), userId, companyId: rc.companyId, label: rc.label, supplier: rc.supplier, amount: Math.round(rc.amount * bump), currency: rc.currency ?? "XOF",
        date: d, dueDate: d, status: "paid", paidDate: d, accountId: rc.accountId, categoryId: cat[rc.category], allocationRuleId: rc.rule ?? null,
        activityId: rc.activityId ?? null, costType: rc.activityId ? "direct" : "overhead", recurringId: id, occurrenceDate: d,
      }).run();
    }
  }

  /* Dépenses ponctuelles */
  const oneOff: { companyId: string; activityId?: string; label: string; supplier: string; min: number; max: number; category: string; costType: string; accountId: string; perMonth: number }[] = [
    { companyId: pp, activityId: act.formation, label: "Location de salle de formation", supplier: "Espace Ivoire Business", min: 90_000, max: 180_000, category: "Prestataires & sous-traitance", costType: "direct", accountId: acc.ppBank, perMonth: 1 },
    { companyId: pp, activityId: act.formation, label: "Impression des supports", supplier: "Imprimerie du Plateau", min: 25_000, max: 60_000, category: "Achats professionnels", costType: "direct", accountId: acc.ppMomo, perMonth: 1 },
    { companyId: pp, activityId: act.coaching, label: "Déplacement chez un client", supplier: "Taxi / VTC", min: 8_000, max: 20_000, category: "Déplacements", costType: "direct", accountId: acc.ppMomo, perMonth: 1.5 },
    { companyId: studio, activityId: act.da, label: "Shooting photo", supplier: "Photographe indépendant", min: 250_000, max: 450_000, category: "Prestataires & sous-traitance", costType: "direct", accountId: acc.skBank, perMonth: 0.6 },
    { companyId: studio, activityId: act.digital, label: "Développeur freelance", supplier: "Dev freelance", min: 180_000, max: 320_000, category: "Prestataires & sous-traitance", costType: "direct", accountId: acc.skBank, perMonth: 0.7 },
    { companyId: studio, label: "Publicité réseaux sociaux", supplier: "Régie publicitaire", min: 40_000, max: 90_000, category: "Communication & marketing", costType: "overhead", accountId: acc.skBank, perMonth: 0.8 },
    { companyId: studio, label: "Fournitures de bureau", supplier: "Librairie de France", min: 15_000, max: 45_000, category: "Achats professionnels", costType: "overhead", accountId: acc.skBank, perMonth: 0.6 },
    { companyId: perso, label: "Courses & marché", supplier: "Divers", min: 180_000, max: 260_000, category: "Dépenses personnelles", costType: "overhead", accountId: acc.persoBank, perMonth: 1 },
    { companyId: perso, label: "Transport", supplier: "Carburant / VTC", min: 35_000, max: 60_000, category: "Dépenses personnelles", costType: "overhead", accountId: acc.persoBank, perMonth: 1 },
  ];
  for (let m = 0; m <= 7; m++) {
    const monthStart = addMonths(start, m, 1);
    for (const o of oneOff) {
      const n = Math.floor(o.perMonth) + (r() < o.perMonth % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const d = addDays(monthStart, Math.floor(r() * 27));
        if (d >= today) continue;
        db.insert(schema.expenses).values({
          id: newId("exp_"), userId, companyId: o.companyId, activityId: o.activityId ?? null, label: o.label, supplier: o.supplier,
          amount: between(o.min, o.max), currency: "XOF", date: d, status: "paid", paidDate: d, accountId: o.accountId,
          categoryId: cat[o.category], costType: o.costType, allocationRuleId: !o.activityId && o.companyId === studio ? ruleStudio : null,
        }).run();
      }
    }
  }
  // Achat de matériel non affecté (reste « non affecté » plutôt que réparti arbitrairement)
  db.insert(schema.expenses).values({ id: newId("exp_"), userId, companyId: studio, label: "Ordinateur portable", supplier: "Revendeur informatique", amount: 1_150_000, currency: "XOF", date: addDays(today, -70), status: "paid", paidDate: addDays(today, -70), accountId: acc.skBank, categoryId: cat["Matériel"], costType: "overhead" }).run();
  // Échéances à venir (engagées, non payées)
  db.insert(schema.expenses).values([
    { id: newId("exp_"), userId, companyId: studio, label: "Impôt synthétique — échéance trimestrielle", supplier: "Direction générale des impôts", amount: 450_000, currency: "XOF", date: addDays(today, -10), dueDate: addDays(today, 12), status: "planned", accountId: acc.skBank, categoryId: cat["Impôts & taxes"], costType: "overhead" },
    { id: newId("exp_"), userId, companyId: studio, activityId: act.da, label: "Impression grand format — campagne", supplier: "Imprimerie Graphica", amount: 380_000, currency: "XOF", date: addDays(today, -3), dueDate: addDays(today, 20), status: "planned", accountId: acc.skBank, categoryId: cat["Prestataires & sous-traitance"], costType: "direct" },
    { id: newId("exp_"), userId, companyId: studio, label: "Matériel vidéo — solde à la livraison", supplier: "Revendeur audiovisuel", amount: 2_600_000, currency: "XOF", date: addDays(today, -12), dueDate: addDays(today, 16), status: "planned", accountId: acc.skBank, categoryId: cat["Matériel"], costType: "overhead", note: "Caméra, optiques et éclairage pour la production vidéo." },
    { id: newId("exp_"), userId, companyId: pp, label: "Patente & taxes locales", supplier: "Mairie", amount: 210_000, currency: "XOF", date: addDays(today, -2), dueDate: addDays(today, 34), status: "planned", accountId: acc.ppBank, categoryId: cat["Impôts & taxes"], costType: "overhead" },
  ]).run();

  /* Transferts : rémunération du dirigeant, épargne */
  for (let m = 0; m <= 7; m++) {
    const d = addDays(addMonths(start, m, 1), 26);
    if (d >= today) continue;
    db.insert(schema.transfers).values([
      { id: newId("trf_"), userId, fromAccountId: acc.ppBank, toAccountId: acc.persoBank, date: d, amount: 900_000, toAmount: 900_000, nature: "owner_draw", note: "Rémunération mensuelle" },
      { id: newId("trf_"), userId, fromAccountId: acc.skBank, toAccountId: acc.persoBank, date: d, amount: 450_000, toAmount: 450_000, nature: "owner_draw", note: "Rémunération de gérance" },
      { id: newId("trf_"), userId, fromAccountId: acc.ppMomo, toAccountId: acc.ppBank, date: addDays(d, -10), amount: 300_000, toAmount: 300_000, nature: "internal", note: "Rapatriement Orange Money" },
      { id: newId("trf_"), userId, fromAccountId: acc.persoBank, toAccountId: acc.persoSave, date: addDays(d, 1), amount: 150_000, toAmount: 150_000, nature: "internal", note: "Épargne mensuelle" },
    ]).run();
  }

  /* Opportunités */
  const opp = (contactIdx: number, activityId: string, companyId: string, title: string, amount: number, stage: string, probability: number, close: string) => {
    const id = newId("opp_");
    db.insert(schema.opportunities).values({ id, userId, contactId: C(contactIdx), activityId, companyId, title, amount, currency: "XOF", stage, probability, expectedCloseDate: close }).run();
    return id;
  };
  opp(7, act.coaching, pp, "Coaching prise de parole — 8 séances", 480_000, "proposal_sent", 60, addDays(today, 10));
  opp(8, act.formation, pp, "Formation de 15 managers", 2_400_000, "negotiation", 50, addDays(today, 25));
  opp(9, act.da, studio, "Refonte d'identité visuelle", 1_900_000, "lead", 25, addDays(today, 45));
  opp(4, act.digital, studio, "Refonte du site Nyota Tech", 950_000, "won", 100, addDays(today, -3));

  /* Historique commercial */
  const ix = (contactIdx: number, type: string, offset: number, title: string, details?: string) =>
    db.insert(schema.interactions).values({ id: newId("ix_"), userId, contactId: C(contactIdx), type, date: addDays(today, offset), title, details: details ?? null }).run();
  ix(7, "first_contact", -16, "Premier contact via le site web", "Souhaite gagner en aisance pour ses conférences.");
  ix(7, "meeting", -12, "Rendez-vous découverte (visio)");
  ix(7, "proposal_sent", -9, "Proposition de coaching transmise (enregistrée manuellement)");
  ix(8, "first_contact", -30, "Rencontre lors d'un salon RH");
  ix(8, "meeting", -21, "Réunion avec la DRH");
  ix(8, "proposal_sent", -14, "Proposition de formation transmise (enregistrée manuellement)");
  ix(8, "follow_up", -4, "Relance téléphonique — arbitrage budgétaire en cours");
  ix(9, "first_contact", -5, "Demande entrante : refonte d'identité");
  ix(4, "opportunity", -8, "Nouvelle opportunité : refonte du site");
  ix(4, "contract_signed", -3, "Accord signé pour la refonte du site");
  db.update(schema.contacts).set({ nextFollowUpAt: addDays(today, 2) }).where(eq(schema.contacts.id, C(7))).run();
  db.update(schema.contacts).set({ nextFollowUpAt: addDays(today, 5) }).where(eq(schema.contacts.id, C(8))).run();

  /* Objectifs */
  db.insert(schema.goals).values([
    { id: newId("goal_"), userId, type: "monthly_revenue", label: "Encaisser 4 M F CFA par mois", target: 4_000_000 },
    { id: newId("goal_"), userId, type: "min_cash", label: "Ne jamais descendre sous 1,5 M F CFA", target: 1_500_000 },
    { id: newId("goal_"), userId, type: "overdue_reduction", label: "Moins de 500 000 F CFA en retard", target: 500_000 },
    { id: newId("goal_"), userId, companyId: pp, activityId: act.formation, type: "margin_rate", label: "Marge formation ≥ 70 %", target: 70 },
  ]).run();

  /* Documents (vrais fichiers PDF générés) */
  const doc = (companyId: string, activityId: string | null, type: string, name: string, file: string, pdf: Buffer, versions: number = 1) => {
    const id = newId("doc_");
    db.insert(schema.documents).values({ id, userId, companyId, activityId, name, type, usage: "reusable", currentVersion: versions }).run();
    for (let v = 1; v <= versions; v++) {
      const stored = saveFile(userId, pdf, file.replace(".pdf", v > 1 ? `-v${v}.pdf` : ".pdf"));
      db.insert(schema.documentVersions).values({ id: newId("dv_"), documentId: id, version: v, fileName: file.replace(".pdf", v > 1 ? `-v${v}.pdf` : ".pdf"), storagePath: stored.storagePath, mimeType: "application/pdf", size: stored.size, sha256: stored.sha256, note: v > 1 ? "Clause d'annulation mise à jour" : "Version initiale", createdAt: new Date(addDays(today, -60 + v * 20) + "T09:00:00Z").toISOString() }).run();
    }
    return id;
  };
  const dPres = doc(pp, act.coaching, "presentation", "Dossier de présentation — Coaching", "dossier-presentation-coaching.pdf", simpleTextPdf("Parole & Présence", "Dossier de présentation — Coaching éloquence & leadership", [
    { heading: "Notre approche", body: "Un accompagnement sur mesure pour gagner en aisance, en clarté et en impact à l'oral : préparation, entraînement filmé, retours précis." },
    { heading: "Formats", body: "Séances individuelles de 1 h 30 · Programme « Leaders qui parlent » en 6 séances · Préparation d'une intervention clé." },
    { heading: "Modalités", body: "En présentiel à Abidjan ou à distance. Tarifs détaillés dans la proposition commerciale." },
  ]));
  const dProp = doc(pp, act.coaching, "proposal", "Proposition commerciale — Coaching", "proposition-coaching.pdf", simpleTextPdf("Proposition d'accompagnement", "Coaching en prise de parole en public", [
    { heading: "Objectifs", body: "Structurer son message, maîtriser le trac, captiver son auditoire." },
    { heading: "Déroulé", body: "8 séances de 1 h 30 sur 2 mois, exercices entre les séances, une séance de répétition générale avant l'intervention." },
    { heading: "Investissement", body: "480 000 F CFA — paiement en deux fois (50 % à la signature, 50 % à mi-parcours)." },
  ]));
  const dContrat = doc(pp, act.coaching, "contract", "Contrat d'accompagnement", "contrat-accompagnement.pdf", simpleTextPdf("Contrat d'accompagnement", "Coaching individuel", [
    { heading: "Article 1 — Objet", body: "Le présent contrat définit les conditions de l'accompagnement en prise de parole." },
    { heading: "Article 2 — Durée", body: "L'accompagnement se déroule sur la période définie dans la proposition acceptée." },
    { heading: "Article 3 — Annulation", body: "Toute séance annulée moins de 48 h à l'avance est due." },
  ]), 2);
  doc(pp, act.formation, "presentation", "Catalogue des formations", "catalogue-formations.pdf", simpleTextPdf("Catalogue des formations", "Parole & Présence", [{ heading: "Convaincre en réunion", body: "2 jours — managers et chefs de projet." }, { heading: "Prise de parole en public", body: "1 jour — tous publics." }]));
  doc(pp, null, "terms", "Conditions générales de vente", "cgv-parole-presence.pdf", simpleTextPdf("Conditions générales de vente", "Parole & Présence", [{ heading: "Paiement", body: "Factures payables à 30 jours. Tout retard peut entraîner la suspension des prestations." }]));
  doc(studio, null, "presentation", "Présentation du Studio Kora", "presentation-studio-kora.pdf", simpleTextPdf("Studio Kora", "Direction de création & services numériques", [{ heading: "Ce que nous faisons", body: "Identités visuelles, campagnes, sites et contenus pour les marques ambitieuses." }]));
  doc(studio, act.da, "proposal", "Proposition type — Identité visuelle", "proposition-identite-visuelle.pdf", simpleTextPdf("Proposition — Identité visuelle", "Studio Kora", [{ heading: "Phases", body: "Immersion, pistes créatives, déclinaisons, charte." }]));
  doc(studio, null, "admin", "Registre du commerce — Studio Kora", "rccm-studio-kora.pdf", simpleTextPdf("Extrait RCCM", "Studio Kora SARL", [{ heading: "Document administratif", body: "Document de démonstration." }]));

  /* Modèles d'emails + identités d'expédition */
  for (const t of DEFAULT_TEMPLATES) {
    const defaults = t.purpose === "proposal" ? [dPres, dProp, dContrat] : t.purpose === "contract" ? [dContrat] : t.purpose === "services" ? [dPres] : [];
    db.insert(schema.emailTemplates).values({ id: newId("tpl_"), userId, ...t, defaultDocumentIds: JSON.stringify(defaults) }).run();
  }
  db.insert(schema.emailTemplates).values({
    id: newId("tpl_"), userId, companyId: pp, activityId: act.coaching, purpose: "proposal", name: "Proposition coaching (Parole & Présence)",
    subject: "Votre accompagnement en prise de parole",
    body: "Bonjour {{prenom}},\n\nMerci pour notre échange de cette semaine. Comme promis, vous trouverez ci-joint :\n- le dossier de présentation de l'accompagnement,\n- la proposition détaillée,\n- le contrat d'accompagnement.\n\nJe vous propose d'en parler lors d'un court appel cette semaine.\n\nÀ très vite,\n{{signature}}",
    defaultDocumentIds: JSON.stringify([dPres, dProp, dContrat]),
  }).run();
  db.insert(schema.senderIdentities).values([
    { id: newId("snd_"), userId, companyId: pp, fromName: "Parole & Présence", fromEmail: "bonjour@parole-presence.ci", authorized: false },
    { id: newId("snd_"), userId, companyId: studio, fromName: "Studio Kora", fromEmail: "contact@studiokora.ci", authorized: false },
  ]).run();

  /* Photos du prévisionnel des mois passés (reconstituées) pour la comparaison prévu / réel */
  const all = new Set([pp, studio, perso]);
  const data = loadFinanceDataFrom(db, userId, { companyIds: all, label: "all" }, today);
  const states = invoiceStates(data);
  for (let i = 1; i <= 4; i++) {
    const month = addMonths(startOfMonth(today), -i, 1).slice(0, 7);
    const plan = planForMonth(data, month, states);
    db.insert(schema.forecastSnapshots).values({ id: newId("fs_"), userId, scope: "all", month, expectedIncome: plan.expectedIncome, expectedExpense: plan.expectedExpense, currency: "XOF", details: JSON.stringify({ ...plan.details, reconstructed: true }) }).onConflictDoNothing().run();
  }
  void endOfMonth;
}
