import { describe, expect, it } from "vitest";
import { extractFromText, findAmounts, findDates, parseLocaleNumber, suggestCategory, extractInvoice, ExtractionError } from "@/lib/extract";

describe("parseLocaleNumber", () => {
  it("lit les formats français et anglais", () => {
    expect(parseLocaleNumber("1 250 000")).toBe(1250000);
    expect(parseLocaleNumber("1 250 000")).toBe(1250000);
    expect(parseLocaleNumber("1.250,50")).toBe(1250.5);
    expect(parseLocaleNumber("1,250.50")).toBe(1250.5);
    expect(parseLocaleNumber("1250,5")).toBe(1250.5);
    expect(parseLocaleNumber("1.250.000")).toBe(1250000);
    expect(parseLocaleNumber("12,99")).toBe(12.99);
    expect(parseLocaleNumber("abc")).toBeNull();
  });

  it("ignore pourcentages et fragments de dates", () => {
    const a = findAmounts("TVA 18 % : 180 000 F CFA le 12/03/2026");
    expect(a.map((x) => x.value)).toEqual([180000]);
  });
});

describe("findDates", () => {
  it("reconnaît plusieurs formats", () => {
    expect(findDates("Le 05/03/2026").map((d) => d.date)).toEqual(["2026-03-05"]);
    expect(findDates("Émise le 12 mars 2026").map((d) => d.date)).toEqual(["2026-03-12"]);
    expect(findDates("2026-09-30").map((d) => d.date)).toEqual(["2026-09-30"]);
    expect(findDates("1er févr. 2026").map((d) => d.date)).toEqual(["2026-02-01"]);
    expect(findDates("31/02/2026")).toEqual([]);
  });
});

const FACTURE_CFA = `IMPRIMERIE DU PLATEAU SARL
Rue du Commerce, Abidjan
RCCM CI-ABJ-2019-B-1234
FACTURE N° IP-2026-0457
Date de facture : 14/09/2026
Facturé à : Studio Kora
Désignation Qté PU Montant
Impression flyers A5 5000 150 750 000
Kakémonos 2 250 000 500 000
Total HT 1 250 000 F CFA
TVA 18 % 225 000 F CFA
Total TTC 1 475 000 F CFA
Échéance : 14/10/2026
Paiement par virement`;

const FACTURE_EUR = `Cloudnest SAS
12 rue des Lilas, 75011 Paris
Facture n° CN-88213
Date d'émission : 2 octobre 2026
Client : Parole & Présence
Abonnement logiciel — offre Pro (octobre)
Total HT 1.042,08 €
TVA (20 %) 208,42 €
Net à payer 1.250,50 €
À payer avant le 16/10/2026`;

describe("extractFromText", () => {
  it("facture en francs CFA avec espaces comme séparateurs de milliers", () => {
    const r = extractFromText(FACTURE_CFA);
    expect(r.total).toEqual({ value: 1475000, confidence: "high" });
    expect(r.subtotal.value).toBe(1250000);
    expect(r.tax.value).toBe(225000);
    expect(r.currency.value).toBe("XOF");
    expect(r.number.value).toBe("IP-2026-0457");
    expect(r.issueDate.value).toBe("2026-09-14");
    expect(r.dueDate.value).toBe("2026-10-14");
    expect(r.issuer.value).toBe("IMPRIMERIE DU PLATEAU SARL");
    expect(r.recipient.value).toBe("Studio Kora");
    expect(r.category.value).toBe("Communication & marketing");
  });

  it("facture en euros au format « 1.250,50 € »", () => {
    const r = extractFromText(FACTURE_EUR);
    expect(r.total.value).toBe(1250.5);
    expect(r.total.confidence).toBe("high");
    expect(r.subtotal.value).toBe(1042.08);
    expect(r.tax.value).toBe(208.42);
    expect(r.currency.value).toBe("EUR");
    expect(r.number.value).toBe("CN-88213");
    expect(r.issueDate.value).toBe("2026-10-02");
    expect(r.dueDate.value).toBe("2026-10-16");
    expect(r.issuer.value).toBe("Cloudnest SAS");
    expect(r.recipient.value).toBe("Parole & Présence");
    expect(r.category.value).toBe("Abonnements logiciels");
  });

  it("montant « 1 250 000 F CFA » sur une ligne Total simple", () => {
    const r = extractFromText("Reçu\nPrestation de nettoyage\nTotal : 1 250 000 F CFA\nFait à Dakar le 3 août 2026");
    expect(r.total.value).toBe(1250000);
    expect(r.total.confidence).toBe("medium");
    expect(r.currency.value).toBe("XOF");
    expect(r.issueDate.value).toBe("2026-08-03");
  });

  it("dollars et échéance calculée à partir du délai", () => {
    const r = extractFromText("Invoice #INV-2041\nInvoice date: 2026-09-01\nAmount due: $1,250.50\nPayment terms: paiement à 30 jours");
    expect(r.total.value).toBe(1250.5);
    expect(r.currency.value).toBe("USD");
    expect(r.number.value).toBe("INV-2041");
    expect(r.issueDate.value).toBe("2026-09-01");
    expect(r.dueDate).toEqual({ value: "2026-10-01", confidence: "low" });
  });

  it("texte vide : rien n'est inventé", () => {
    const r = extractFromText("");
    expect(r.total.value).toBeNull();
    expect(r.total.confidence).toBe("none");
  });

  it("suggère une catégorie par mots-clés", () => {
    expect(suggestCategory("Facture CIE — consommation électricité 450 kWh").value).toBe("Électricité & eau");
    expect(suggestCategory("Rien de particulier").value).toBeNull();
  });

  it("« TVA non applicable » donne une TVA nulle, sans capter le total de la ligne suivante", () => {
    const r = extractFromText("Total HT 555 000 F CFA\nTVA Non applicable\nTotal TTC 555 000 F CFA");
    expect(r.tax).toEqual({ value: 0, confidence: "high" });
    expect(r.total.value).toBe(555000);
    expect(r.subtotal.confidence).toBe("high");
  });
});

describe("extractInvoice", () => {
  it("refuse les formats non pris en charge", async () => {
    await expect(extractInvoice(Buffer.from("x"), "text/plain", { direction: "expense" })).rejects.toBeInstanceOf(ExtractionError);
  });

  it("image sans clé API : écran de vérification vide", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await extractInvoice(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png", { direction: "expense" });
    expect(r.method).toBe("none");
    expect(r.fields.total.value).toBeNull();
    expect(r.warnings[0]).toMatch(/images/);
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });

  it("PDF illisible : erreur explicite", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(extractInvoice(Buffer.from("pas un pdf"), "application/pdf", { direction: "income" })).rejects.toMatchObject({ code: "unreadable_pdf" });
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });
});
