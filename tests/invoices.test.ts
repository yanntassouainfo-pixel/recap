import { describe, expect, it } from "vitest";
import {
  computeTotals, lineAmount, matchesStatusFilter, nextNumber, normName, parseLines, quoteDisplayStatus, sameParty,
} from "@/lib/invoices";

describe("numérotation", () => {
  it("démarre à 001 pour une nouvelle année ou un nouveau préfixe", () => {
    expect(nextNumber("FAC", 2026, [])).toBe("FAC-2026-001");
    expect(nextNumber("FAC", "2026", ["FAC-2025-014", "DEV-2026-003"])).toBe("FAC-2026-001");
  });

  it("prend le plus grand numéro existant de l'année, même hors ordre", () => {
    expect(nextNumber("FAC", 2026, ["FAC-2026-002", "FAC-2026-010", "FAC-2026-007"])).toBe("FAC-2026-011");
  });

  it("ignore les numéros non conformes et dépasse 999 sans tronquer", () => {
    expect(nextNumber("FAC", 2026, ["FAC-2026-ABC", "FAC-2026-", "AUTRE-1"])).toBe("FAC-2026-001");
    expect(nextNumber("FAC", 2026, ["FAC-2026-999"])).toBe("FAC-2026-1000");
  });

  it("utilise FAC si le préfixe est vide", () => {
    expect(nextNumber("", 2026, [])).toBe("FAC-2026-001");
    expect(nextNumber("DEV", 2026, ["DEV-2026-004"])).toBe("DEV-2026-005");
  });
});

describe("recalcul des totaux", () => {
  it("additionne les lignes et la TVA par taux", () => {
    const t = computeTotals([
      { description: "Formation", quantity: 2, unitPrice: 150000, taxRate: 18 },
      { description: "Support", quantity: 1, unitPrice: 50000, taxRate: 18 },
      { description: "Frais", quantity: 1, unitPrice: 10000, taxRate: 0 },
    ]);
    expect(t.subtotal).toBe(360000);
    expect(t.taxes).toEqual([{ rate: 18, base: 350000, amount: 63000 }]);
    expect(t.taxTotal).toBe(63000);
    expect(t.total).toBe(423000);
  });

  it("XOF : arrondi au franc près (0 décimale)", () => {
    // 3 × 333,33 F n'existe pas : les montants XOF sont des francs entiers ; la TVA 18 % de 1 001 F = 180,18 → 180
    const t = computeTotals([{ description: "x", quantity: 1, unitPrice: 1001, taxRate: 18 }]);
    expect(t.taxTotal).toBe(180);
    expect(t.total).toBe(1181);
    // Quantité fractionnaire : 1,5 × 1 001 F = 1 501,5 → 1 502
    expect(lineAmount(1.5, 1001)).toBe(1502);
  });

  it("EUR : arrondi au centime près (2 décimales)", () => {
    // 1,5 × 33,33 € = 49,995 € → 50,00 € (5000 centimes) ; TVA 20 % = 10,00 €
    const t = computeTotals([{ description: "x", quantity: 1.5, unitPrice: 3333, taxRate: 20 }]);
    expect(t.subtotal).toBe(5000);
    expect(t.taxTotal).toBe(1000);
    // 5,5 % de 19,99 € = 1,09945 € → 1,10 €
    expect(computeTotals([{ description: "y", quantity: 1, unitPrice: 1999, taxRate: 5.5 }]).taxTotal).toBe(110);
  });

  it("la TVA est arrondie une seule fois par taux, pas ligne par ligne", () => {
    const lines = Array.from({ length: 3 }, () => ({ description: "l", quantity: 1, unitPrice: 1003, taxRate: 18 }));
    // Par ligne : 180,54 → 181 × 3 = 543 ; par taux : 3009 × 18 % = 541,62 → 542
    expect(computeTotals(lines).taxTotal).toBe(542);
  });

  it("aucune ligne → total nul", () => {
    expect(computeTotals([])).toMatchObject({ subtotal: 0, taxTotal: 0, total: 0, taxes: [] });
  });
});

describe("saisie des lignes", () => {
  it("convertit les prix saisis dans les unités mineures de la devise", () => {
    const xof = parseLines([{ description: "Coaching", quantity: "2", unitPrice: "150 000", taxRate: "" }], "XOF");
    expect(xof.errors).toEqual([]);
    expect(xof.lines[0]).toEqual({ description: "Coaching", quantity: 2, unitPrice: 150000, taxRate: 0 });
    const eur = parseLines([{ description: "Audit", quantity: "1,5", unitPrice: "1 250,50", taxRate: "20" }], "EUR");
    expect(eur.lines[0]).toEqual({ description: "Audit", quantity: 1.5, unitPrice: 125050, taxRate: 20 });
  });

  it("ignore les lignes vides et signale les erreurs ligne par ligne", () => {
    const r = parseLines([
      { description: "", quantity: "1", unitPrice: "", taxRate: "" },
      { description: "Sans prix", quantity: "1", unitPrice: "abc", taxRate: "" },
      { description: "Quantité nulle", quantity: "0", unitPrice: "10", taxRate: "" },
      { description: "TVA folle", quantity: "1", unitPrice: "10", taxRate: "150" },
    ], "EUR");
    expect(r.lines).toEqual([]);
    expect(r.errors).toEqual([
      "Ligne 2 : prix unitaire invalide.",
      "Ligne 3 : quantité invalide.",
      "Ligne 4 : taux de TVA invalide (entre 0 et 100).",
    ]);
  });

  it("exige au moins une ligne", () => {
    expect(parseLines([], "XOF").errors).toEqual(["Ajoutez au moins une ligne."]);
  });
});

describe("statuts", () => {
  const s = (status: string, paid: number, remaining: number) => ({ status, paid, remaining });

  it("« à encaisser » = envoyées non soldées (en attente, partielles, en retard)", () => {
    expect(matchesStatusFilter("open", s("pending", 0, 100))).toBe(true);
    expect(matchesStatusFilter("open", s("partial", 50, 50))).toBe(true);
    expect(matchesStatusFilter("open", s("overdue", 0, 100))).toBe(true);
    expect(matchesStatusFilter("open", s("draft", 0, 100))).toBe(false);
    expect(matchesStatusFilter("open", s("paid", 100, 0))).toBe(false);
  });

  it("« partiellement payées » inclut une facture en retard partiellement réglée", () => {
    expect(matchesStatusFilter("partial", s("overdue", 30, 70))).toBe(true);
    expect(matchesStatusFilter("partial", s("pending", 0, 100))).toBe(false);
  });

  it("un devis envoyé dont la validité est dépassée est « expiré »", () => {
    expect(quoteDisplayStatus({ status: "sent", dueDate: "2026-09-30" }, "2026-10-10")).toBe("expired");
    expect(quoteDisplayStatus({ status: "sent", dueDate: "2026-10-30" }, "2026-10-10")).toBe("sent");
    expect(quoteDisplayStatus({ status: "accepted", dueDate: "2026-09-30" }, "2026-10-10")).toBe("accepted");
  });
});

describe("rapprochement des noms (doublons)", () => {
  it("ignore accents, ponctuation et formes juridiques", () => {
    expect(normName("Société Ivoirienne SARL")).toBe("societeivoirienne");
    expect(sameParty("ORANGE CI S.A.", "Orange CI")).toBe(true);
    expect(sameParty("Kouassi Conseil", "kouassi-conseil sarl")).toBe(true);
    expect(sameParty("Alpha", "Beta")).toBe(false);
    expect(sameParty("", "Beta")).toBe(false);
  });
});

describe("PDF de facture", () => {
  it("produit un PDF non vide commençant par %PDF", async () => {
    process.env.DATABASE_FILE = ":memory:";
    const { buildInvoicePdf } = await import("@/lib/invoice-pdf");
    const buf = buildInvoicePdf({
      docType: "invoice", number: "FAC-2026-001", title: "Accompagnement digital", issueDate: "2026-10-01", dueDate: "2026-10-31",
      currency: "XOF", status: "sent", notes: "Merci pour votre confiance.",
      company: { name: "Studio Akwaba", legalName: "Studio Akwaba SARL", address: "Cocody, Abidjan", email: "contact@akwaba.ci", phone: "+225 07 00 00 00", website: null, taxId: "CI-ABJ-2024-B-1234", billingDetails: "Orange Money : 07 00 00 00 00", color: "#2a78d6" },
      brandName: null,
      client: { name: "Aminata Koné", organization: "Boutique Koné", address: "Plateau, Abidjan", email: "aminata@example.com", phone: null },
      lines: Array.from({ length: 40 }, (_, i) => ({ description: `Prestation n° ${i + 1} — atelier « réseaux sociaux »`, quantity: 1, unitPrice: 25000, taxRate: i % 2 ? 18 : 0 })),
      paid: 300000,
    });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.subarray(-6).toString("latin1")).toContain("%%EOF");
  });

  it("produit aussi un devis", async () => {
    process.env.DATABASE_FILE = ":memory:";
    const { buildInvoicePdf } = await import("@/lib/invoice-pdf");
    const buf = buildInvoicePdf({
      docType: "quote", number: "DEV-2026-003", title: null, issueDate: "2026-10-01", dueDate: "2026-10-31", currency: "EUR", status: "draft", notes: null,
      company: { name: "Recap Conseil", legalName: null, address: null, email: null, phone: null, website: null, taxId: null, billingDetails: null, color: "zzz" },
      brandName: "Recap Academy", client: null, lines: [{ description: "Audit", quantity: 1.5, unitPrice: 125050, taxRate: 20 }], paid: 0,
    });
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
