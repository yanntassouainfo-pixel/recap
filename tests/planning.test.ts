import { describe, expect, it } from "vitest";
import {
  absorbVerdict, eventNature, gapPercent, groupEventsByWeek, parseGoalTarget, parseHorizon, parseMarginBase,
  parsePercent, parseScenario, parseSnapshotDetails, resolveProfitPeriod, simulateExpense, simulationHorizon,
  validateShares,
} from "@/lib/planning";
import type { ForecastEvent } from "@/lib/finance/engine";

const ev = (date: string, amount: number, kind: ForecastEvent["kind"] = "invoice", certainty: ForecastEvent["certainty"] = "contractual"): ForecastEvent =>
  ({ date, amount, label: `${kind} ${date}`, kind, certainty });

describe("paramètres d'URL", () => {
  it("horizon et scénario invalides retombent sur les valeurs par défaut", () => {
    expect(parseHorizon("30")).toBe(30);
    expect(parseHorizon("365")).toBe(365);
    expect(parseHorizon("45")).toBe(90);
    expect(parseHorizon(undefined)).toBe(90);
    expect(parseScenario("prudent")).toBe("prudent");
    expect(parseScenario("zzz")).toBe("central");
    expect(parseMarginBase("encaisse")).toBe("encaisse");
    expect(parseMarginBase("autre")).toBe("facture");
  });
});

describe("eventNature", () => {
  it("ne présente jamais une opportunité hypothétique comme certaine", () => {
    expect(eventNature({ kind: "opportunity", certainty: "hypothetical" })).toMatchObject({ label: "Opportunité non confirmée", certainty: "Hypothétique" });
    expect(eventNature({ kind: "opportunity", certainty: "contractual" }).label).toBe("Accord signé, non facturé");
    expect(eventNature({ kind: "overdue_invoice", certainty: "estimated" }).tone).toBe("bad");
  });
});

describe("groupEventsByWeek", () => {
  it("regroupe par semaine (lundi), ramène les dates passées à aujourd'hui et cumule le solde", () => {
    const today = "2026-10-10"; // samedi
    const groups = groupEventsByWeek([
      ev("2026-10-01", 500, "overdue_invoice"), // passé → aujourd'hui
      ev("2026-10-14", -200, "recurring"),
      ev("2026-10-12", 1000),
      ev("2026-10-30", -300, "planned"),
    ], 10_000, today);
    expect(groups.map((g) => g.weekStart)).toEqual(["2026-10-05", "2026-10-12", "2026-10-26"]);
    expect(groups[0]).toMatchObject({ weekEnd: "2026-10-11", inflow: 500, outflow: 0, endBalance: 10_500 });
    expect(groups[0].events[0].date).toBe(today);
    expect(groups[1]).toMatchObject({ inflow: 1000, outflow: 200, endBalance: 11_300 });
    expect(groups[2].endBalance).toBe(11_000);
  });

  it("liste vide → aucune semaine", () => {
    expect(groupEventsByWeek([], 100, "2026-10-10")).toEqual([]);
  });
});

describe("simulateExpense / absorbVerdict", () => {
  const points = [
    { date: "2026-10-10", balance: 1000 },
    { date: "2026-10-11", balance: 800 },
    { date: "2026-10-12", balance: 1200 },
  ];

  it("retire la dépense à partir de sa date et trouve le nouveau point bas", () => {
    const r = simulateExpense(points, 900, "2026-10-11", 0)!;
    expect(r.minBefore).toBe(800);
    expect(r.minAfter).toBe(-100);
    expect(r.minDate).toBe("2026-10-11");
    expect(r.firstNegative).toBe("2026-10-11");
    expect(r.endAfter).toBe(300);
  });

  it("une date passée est ramenée au premier point ; le seuil est détecté", () => {
    const r = simulateExpense(points, 100, "2026-01-01", 750)!;
    expect(r.minAfter).toBe(700);
    expect(r.firstNegative).toBeNull();
    expect(r.firstBelowThreshold).toBe("2026-10-11");
  });

  it("trajectoire vide → null", () => {
    expect(simulateExpense([], 100, "2026-10-10", 0)).toBeNull();
  });

  it("verdict : oui / prudence / non selon les scénarios central et prudent", () => {
    const base = { minBefore: 0, minDate: "2026-10-10", endAfter: 0, firstNegative: null, firstBelowThreshold: null };
    const at = (minAfter: number) => ({ ...base, minAfter });
    expect(absorbVerdict(at(500), at(300), 200)).toBe("yes");
    expect(absorbVerdict(at(500), at(100), 200)).toBe("caution");
    expect(absorbVerdict(at(100), at(50), 200)).toBe("no");
    expect(absorbVerdict(at(10), at(-1), 0)).toBe("caution");
  });

  it("horizon de simulation borné entre 60 et 365 jours", () => {
    expect(simulationHorizon("2026-10-10", "2026-10-15")).toBe(60);
    expect(simulationHorizon("2026-10-10", "2027-01-08")).toBe(120);
    expect(simulationHorizon("2026-10-10", "2028-01-01")).toBe(365);
    expect(simulationHorizon("2026-10-10", "2026-01-01")).toBe(60);
  });
});

describe("pourcentages et règles de répartition", () => {
  it("parsePercent accepte virgule, espaces et %", () => {
    expect(parsePercent("70,5 %")).toBe(70.5);
    expect(parsePercent("")).toBe(0);
    expect(parsePercent("abc")).toBeNull();
  });

  it("validateShares refuse une somme > 100 %, les doublons et les activités étrangères", () => {
    const allowed = ["a", "b"];
    expect(validateShares([{ activityId: "a", percent: 60 }, { activityId: "b", percent: 30 }], allowed)).toMatchObject({ ok: true, total: 90, unassigned: 10 });
    expect(validateShares([{ activityId: "a", percent: 60 }, { activityId: "b", percent: 50 }], allowed).ok).toBe(false);
    expect(validateShares([{ activityId: "a", percent: 10 }, { activityId: "a", percent: 10 }], allowed).ok).toBe(false);
    expect(validateShares([{ activityId: "z", percent: 10 }], allowed).ok).toBe(false);
    expect(validateShares([{ activityId: "a", percent: 0 }], allowed).ok).toBe(false);
    expect(validateShares([{ activityId: "a", percent: null }], allowed).ok).toBe(false);
  });
});

describe("objectifs", () => {
  const money = (s: string) => (/^-?\d+$/.test(s.trim()) ? Number(s) * 100 : null);
  it("valide montants et taux", () => {
    expect(parseGoalTarget("70", "percent", money)).toEqual({ value: 70 });
    expect(parseGoalTarget("150", "percent", money).error).toBeDefined();
    expect(parseGoalTarget("", "percent", money).error).toBeDefined();
    expect(parseGoalTarget("1500", "money", money)).toEqual({ value: 150_000 });
    expect(parseGoalTarget("-5", "money", money).error).toBeDefined();
    expect(parseGoalTarget("x", "money", money).error).toBeDefined();
  });
});

describe("périodes et écarts", () => {
  it("resolveProfitPeriod gère les clés connues, la période personnalisée et le repli", () => {
    const today = "2026-10-10";
    expect(resolveProfitPeriod("mois", today)).toMatchObject({ from: "2026-10-01", to: today });
    expect(resolveProfitPeriod("trimestre", today).from).toBe("2026-10-01");
    expect(resolveProfitPeriod("annee", today).from).toBe("2026-01-01");
    expect(resolveProfitPeriod("perso", today, { from: "2026-01-01", to: "2026-06-30" })).toMatchObject({ key: "perso", from: "2026-01-01", to: "2026-06-30" });
    expect(resolveProfitPeriod("perso", today, { from: "2026-06-30", to: "2026-01-01" }).key).toBe("90j");
    expect(resolveProfitPeriod(undefined, today)).toMatchObject({ key: "90j", from: "2026-07-13", to: today });
  });

  it("gapPercent : null si le prévu est nul", () => {
    expect(gapPercent(120, 100)).toBe(20);
    expect(gapPercent(-50, -100)).toBe(50);
    expect(gapPercent(10, 0)).toBeNull();
  });

  it("parseSnapshotDetails tolère un JSON invalide ou partiel", () => {
    expect(parseSnapshotDetails(null)).toEqual({ incomes: [], outflows: [], reconstructed: false });
    expect(parseSnapshotDetails("{oops")).toEqual({ incomes: [], outflows: [], reconstructed: false });
    expect(parseSnapshotDetails('{"incomes":[{"id":"1","label":"x","amount":5}],"reconstructed":true}')).toEqual({
      incomes: [{ id: "1", label: "x", amount: 5 }], outflows: [], reconstructed: true,
    });
  });
});
