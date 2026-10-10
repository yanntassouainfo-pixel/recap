import { describe, expect, it } from "vitest";
import { answer, extractAmount } from "@/lib/assistant/engine";
import { buildSnapshot } from "@/lib/finance/insights";
import { emptyData, expense, invoice } from "./fixtures";

const snap = () => buildSnapshot(emptyData({
  contacts: [{ id: "k", name: "Client K", type: "client", organization: null }],
  invoices: [invoice({ contactId: "k", dueDate: "2026-09-20", total: 250_000 }), invoice({ dueDate: "2026-11-01", total: 100_000 })],
  expenses: [expense({ amount: 30_000, date: "2026-10-02", paidDate: "2026-10-02" })],
}));

describe("assistant — moteur déterministe", () => {
  it("extrait les montants des questions", () => {
    expect(extractAmount("Puis-je absorber une dépense de 500 000 F ?", "XOF")).toBe(500_000);
    expect(extractAmount("une dépense de 1,5 M", "XOF")).toBe(1_500_000);
    expect(extractAmount("acheter pour 800 €", "EUR")).toBe(80_000);
    expect(extractAmount("une dépense de 2,5 k€", "EUR")).toBe(250_000);
    expect(extractAmount("acheter pour 2 M", "XOF")).toBe(2_000_000);
  });
  it("répond avec les chiffres du moteur pour les factures en retard", () => {
    const a = answer("Quelles factures sont en retard ?", snap());
    expect(a.intent).toBe("overdue");
    expect(a.table?.rows).toHaveLength(1);
    expect(a.text).toContain("250");
  });
  it("sépare non échu et en retard pour « combien dois-je encore encaisser »", () => {
    const a = answer("Combien dois-je encore encaisser ?", snap());
    expect(a.intent).toBe("receivables");
    expect(a.hypotheses.join(" ")).toContain("opportunités");
  });
  it("simule une dépense supplémentaire sans rien enregistrer", () => {
    const a = answer("Puis-je absorber une dépense supplémentaire de 500 000 F ?", snap());
    expect(a.intent).toBe("absorb");
    expect(a.text).toMatch(/^(Oui|Possible|Pas sans risque)/);
  });
  it("demande le montant s'il manque", () => {
    expect(answer("Puis-je absorber une dépense ?", snap()).text).toContain("montant");
  });
  it("distingue encaissé et facturé pour « combien ai-je gagné »", () => {
    const a = answer("Combien ai-je réellement gagné ce mois-ci ?", snap());
    expect(a.intent).toBe("earned");
    expect(a.facts.join(" ")).toContain("Facturé");
  });
  it("répond honnêtement quand la question n'est pas comprise", () => {
    expect(answer("Quelle est la capitale du Pérou ?", snap()).intent).toBe("unknown");
  });
});
