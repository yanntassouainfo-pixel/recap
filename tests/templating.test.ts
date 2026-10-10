import { describe, expect, it } from "vitest";
import {
  buildSignature, buildTemplateVars, firstNameOf, formatBytes, interactionTypeForPurpose, isValidEmail, parseAddressList,
  renderTemplate, unresolvedVariables,
} from "@/lib/templating";
import { contactFinance, contactFinances, followUpUrgency, pipelineTotals } from "@/components/crm/finance";
import { emptyData, invoice } from "./fixtures";

describe("remplissage des modèles", () => {
  it("remplace les variables connues", () => {
    const r = renderTemplate("Bonjour {{prenom}}, facture {{ facture }} de {{montant}}.", { prenom: "Awa", facture: "FAC-12", montant: "150 000 F CFA" });
    expect(r.text).toBe("Bonjour Awa, facture FAC-12 de 150 000 F CFA.");
    expect(r.missing).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("laisse visibles et signale les variables sans valeur — jamais de valeur inventée", () => {
    const r = renderTemplate("Facture {{facture}} due le {{echeance}}", { facture: null, echeance: "  " });
    expect(r.text).toBe("Facture {{facture}} due le {{echeance}}");
    expect(r.missing.sort()).toEqual(["echeance", "facture"]);
  });

  it("signale les variables inconnues sans les toucher", () => {
    const r = renderTemplate("Bonjour {{prénom}} {{societe}}", { prenom: "Awa" });
    expect(r.text).toBe("Bonjour Awa {{societe}}");
    expect(r.unknown).toEqual(["societe"]);
  });

  it("accepte la variante accentuée et les majuscules", () => {
    expect(renderTemplate("{{Activité}}", { activite: "Coaching" }).text).toBe("Coaching");
  });

  it("repère les variables restantes après édition", () => {
    expect(unresolvedVariables("Bonjour {{prenom}}, {{facture}} et {{prenom}}").sort()).toEqual(["facture", "prenom"]);
    expect(unresolvedVariables("Rien à remplir")).toEqual([]);
  });

  it("construit les variables depuis le contexte", () => {
    const v = buildTemplateVars({
      contact: { name: "Awa Koné", organization: null },
      activityName: "Coaching",
      invoice: { number: "PP-2026-004", amountLabel: "480 000 F CFA", dueDateLabel: "30 octobre 2026" },
      sender: { fromName: "Parole & Présence", companyName: "Parole & Présence SARL", email: "bonjour@pp.ci", phone: "+225 07 00 00 00", website: null },
    });
    expect(v.prenom).toBe("Awa");
    expect(v.nom).toBe("Awa Koné");
    expect(v.entreprise).toBe("Awa Koné"); // pas d'organisation → le nom
    expect(v.facture).toBe("PP-2026-004");
    expect(v.signature).toBe("Parole & Présence\nParole & Présence SARL\nbonjour@pp.ci · +225 07 00 00 00");
  });

  it("ne découpe pas les civilités", () => {
    expect(firstNameOf("M. Kouassi")).toBe("M. Kouassi");
    expect(firstNameOf("Mme Diallo")).toBe("Mme Diallo");
    expect(firstNameOf("Fatou")).toBe("Fatou");
    expect(firstNameOf("")).toBeNull();
  });

  it("signature sans doublon quand le nom d'expéditeur est celui de la structure", () => {
    expect(buildSignature({ fromName: "Studio Kora", companyName: "Studio Kora" })).toBe("Studio Kora");
  });
});

describe("adresses", () => {
  it("valide et dédoublonne les listes", () => {
    const r = parseAddressList("a@x.ci, B@x.ci; a@x.ci\npas-une-adresse, c@y");
    expect(r.valid).toEqual(["a@x.ci", "b@x.ci"]);
    expect(r.invalid).toEqual(["pas-une-adresse", "c@y"]);
    expect(isValidEmail("contact@studiokora.ci")).toBe(true);
    expect(isValidEmail("contact@studiokora")).toBe(false);
    expect(parseAddressList(null)).toEqual({ valid: [], invalid: [] });
  });
});

describe("événement inscrit après envoi", () => {
  it("dépend de l'objet du modèle", () => {
    expect(interactionTypeForPurpose("proposal")).toBe("proposal_sent");
    expect(interactionTypeForPurpose("contract")).toBe("contract_sent");
    expect(interactionTypeForPurpose("quote")).toBe("quote_sent");
    expect(interactionTypeForPurpose("invoice_reminder")).toBe("follow_up");
    expect(interactionTypeForPurpose("thanks")).toBe("email_sent");
    expect(interactionTypeForPurpose(null)).toBe("email_sent");
  });
  it("formate les tailles", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(2048)).toBe("2 Ko");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3,5 Mo");
  });
});

describe("chiffres par contact", () => {
  it("distingue facturé, encaissé, restant dû et retard", () => {
    const i1 = invoice({ contactId: "k1", total: 300_000, issueDate: "2026-08-01", dueDate: "2026-09-01" }); // en retard
    const i2 = invoice({ contactId: "k1", total: 200_000, issueDate: "2026-09-20", dueDate: "2026-10-20" }); // payée
    const i3 = invoice({ contactId: "k1", total: 999_000, status: "draft" }); // brouillon : ignoré
    const i4 = invoice({ contactId: "k2", total: 50_000 });
    const data = emptyData({
      invoices: [i1, i2, i3, i4],
      payments: [
        { id: "p1", invoiceId: i1.id, date: "2026-09-05", amount: 100_000, fees: 0, accountId: "a1", method: "bank_transfer", reference: null },
        { id: "p2", invoiceId: i2.id, date: "2026-10-01", amount: 200_000, fees: 0, accountId: "a1", method: "bank_transfer", reference: null },
      ],
      incomes: [{ id: "r1", companyId: "c1", activityId: null, contactId: "k1", categoryId: null, date: "2026-10-02", amount: 25_000, currency: "XOF", description: "Vente", accountId: "a1", method: "cash" }],
    });
    const f = contactFinance(data, "k1");
    expect(f.invoiced).toBe(500_000);
    expect(f.collected).toBe(325_000);
    expect(f.remaining).toBe(200_000);
    expect(f.overdue).toBe(200_000);
    expect(f.overdueCount).toBe(1);
    expect(f.invoiceCount).toBe(2);
    expect(f.lastPaymentDate).toBe("2026-10-02");
    expect(f.states).toHaveLength(3); // le brouillon reste listé, sans compter dans les totaux
    expect(contactFinances(data).get("k2")?.remaining).toBe(50_000);
  });

  it("convertit les devises et exclut les factures internes", () => {
    const eur = invoice({ contactId: "k1", total: 10_000, currency: "EUR", dueDate: "2026-12-01" }); // 100 € → 65 596 F CFA
    const internal = invoice({ contactId: "k1", total: 1_000_000, counterpartCompanyId: "c1" });
    const usd = invoice({ contactId: "k1", total: 5_000, currency: "USD", dueDate: "2026-12-01" }); // aucun taux USD
    const f = contactFinance(emptyData({ invoices: [eur, internal, usd] }), "k1");
    expect(f.invoiced).toBe(65_596);
    expect(f.missingRate).toBe(true);
    expect(f.invoiceCount).toBe(2);
  });

  it("totalise le pipeline et la valeur pondérée", () => {
    const t = pipelineTotals(emptyData(), [
      { stage: "negotiation", amount: 1_000_000, currency: "XOF", probability: 70 },
      { stage: "negotiation", amount: 500_000, currency: "XOF", probability: 50 },
      { stage: "lead", amount: 100_000, currency: "XOF", probability: 20 },
    ]);
    expect(t.get("negotiation")).toMatchObject({ count: 2, amount: 1_500_000, weighted: 950_000 });
    expect(t.get("lead")?.weighted).toBe(20_000);
  });

  it("classe les relances", () => {
    expect(followUpUrgency("2026-10-01", "2026-10-10")).toBe("late");
    expect(followUpUrgency("2026-10-10", "2026-10-10")).toBe("today");
    expect(followUpUrgency("2026-10-17", "2026-10-10")).toBe("soon");
    expect(followUpUrgency("2026-10-18", "2026-10-10")).toBeNull();
    expect(followUpUrgency(null, "2026-10-10")).toBeNull();
  });
});
