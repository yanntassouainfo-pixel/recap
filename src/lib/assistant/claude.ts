import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Snapshot } from "../finance/insights";
import { answer, type AssistantAnswer } from "./engine";
import { formatDate } from "../dates";

/**
 * Assistant IA (facultatif, actif si ANTHROPIC_API_KEY est défini).
 * Claude ne calcule rien : il appelle des outils qui renvoient les résultats du moteur déterministe,
 * puis rédige une réponse claire. En cas d'erreur ou de refus, on revient au moteur seul.
 */

const MODEL = "claude-opus-5-5";

const TOOLS: { name: string; description: string; question: string; amount?: boolean }[] = [
  { name: "argent_disponible", description: "Soldes actuels des comptes (argent réellement disponible), pro et perso.", question: "argent disponible" },
  { name: "gains_du_mois", description: "Encaissé, dépenses payées, solde net et facturé du mois en cours.", question: "combien ai-je gagné ce mois-ci" },
  { name: "principales_depenses", description: "Principaux postes et plus grosses dépenses payées du mois en cours.", question: "principales dépenses" },
  { name: "rentabilite_activites", description: "Facturé, coûts, marge et taux de marge par activité sur 90 jours.", question: "activité la plus rentable" },
  { name: "contribution_tresorerie", description: "Contribution nette de chaque activité à la trésorerie (encaissé − coûts) sur 90 jours.", question: "activité qui contribue le plus à ma trésorerie" },
  { name: "a_encaisser", description: "Factures non soldées : total, non échu, en retard, par client.", question: "combien dois-je encore encaisser" },
  { name: "factures_en_retard", description: "Liste détaillée des factures en retard.", question: "factures en retard" },
  { name: "simuler_depense", description: "Simule l'impact d'une dépense supplémentaire payée aujourd'hui sur le point bas de trésorerie à 60 jours.", question: "puis-je absorber une dépense de", amount: true },
  { name: "couverture_mois_prochain", description: "Montant à encaisser pour couvrir les charges du mois prochain.", question: "combien dois-je encaisser pour couvrir mes charges du mois prochain" },
  { name: "evolution_depenses", description: "Encaissé et dépenses par mois sur les trois derniers mois.", question: "évolution des dépenses depuis trois mois" },
  { name: "charges_recurrentes", description: "Charges récurrentes actives, équivalent mensuel et hausses constatées.", question: "abonnements et frais récurrents" },
  { name: "risques_30_jours", description: "Alertes et point bas de trésorerie sur 30 jours.", question: "risques financiers des 30 prochains jours" },
  { name: "prevision_fin_de_mois", description: "Trésorerie prévue en fin de mois selon trois scénarios et leurs hypothèses.", question: "situation à la fin du mois" },
];

function serialize(a: AssistantAnswer) {
  return JSON.stringify({ resume: a.text, faits: a.facts, estimations: a.estimates, hypotheses: a.hypotheses, tableau: a.table });
}

export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function askClaude(question: string, history: { role: "user" | "assistant"; content: string }[], s: Snapshot): Promise<AssistantAnswer | null> {
  if (!aiEnabled()) return null;
  const client = new Anthropic();
  const used: AssistantAnswer[] = [];
  const system = [
    "Tu es l'assistant de pilotage financier de Recap, pour un indépendant ou une petite entreprise. Réponds en français, simplement, sans jargon comptable.",
    `Aujourd'hui : ${formatDate(s.data.today, "long")}. Devise de référence : ${s.data.baseCurrency}. Vue : ${s.data.scopeLabel}.`,
    "Règles absolues : n'utilise QUE les chiffres renvoyés par les outils ; n'invente jamais de transaction, de revenu, de dépense ni de certitude. Si l'information manque, dis-le.",
    "Distingue clairement les faits (constatés), les estimations (prévisions) et les hypothèses. Une opportunité commerciale n'est jamais un revenu certain.",
    "Termine si possible par une action concrète et réaliste. Reste prudent sur les sujets fiscaux, juridiques ou comptables et recommande un professionnel si nécessaire.",
    "Réponse courte : 2 à 6 phrases, éventuellement une courte liste. Pas de tableau (l'interface affiche les données détaillées).",
  ].join("\n");
  const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.amount
      ? { type: "object", properties: { montant: { type: "string", description: `Montant de la dépense, ex. "500000" ou "1 500 €"` } }, required: ["montant"], additionalProperties: false }
      : { type: "object", properties: {}, additionalProperties: false },
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history.slice(-6), { role: "user", content: question }];

  try {
    for (let i = 0; i < 6; i++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        tools,
        messages,
      });
      if (res.stop_reason === "refusal") return null;
      messages.push({ role: "assistant", content: res.content });
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || calls.length === 0) {
        const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        if (!text) return null;
        const last = used.at(-1);
        return {
          intent: last?.intent ?? "claude", text, facts: [], estimates: [], hypotheses: [...new Set(used.flatMap((u) => u.hypotheses))].slice(0, 5),
          table: last?.table, actions: [...new Map(used.flatMap((u) => u.actions).map((x) => [x.href, x])).values()].slice(0, 3),
          learnMore: last?.learnMore, source: "claude",
        };
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = calls.map((c) => {
        const def = TOOLS.find((t) => t.name === c.name);
        if (!def) return { type: "tool_result", tool_use_id: c.id, content: "Outil inconnu.", is_error: true };
        const input = (c.input ?? {}) as { montant?: unknown };
        const q = def.amount ? `${def.question} ${typeof input.montant === "string" ? input.montant : ""}` : def.question;
        const a = answer(q, s);
        used.push(a);
        return { type: "tool_result", tool_use_id: c.id, content: serialize(a) };
      });
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("Assistant IA indisponible :", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return null;
  }
  return null;
}
