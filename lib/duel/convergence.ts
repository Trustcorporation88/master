/**
 * Detecção de convergência.
 *
 * Porte do `_assessConvergence` / `_calculateTextSimilarity` do
 * BrainstormManager.ts do Mysti (DeepMyst, Apache-2.0), com dois ajustes:
 *  - padrões de concordância/discordância também em português;
 *  - suporte a N agentes em vez de exatamente 2.
 */

import type { ConvergenceMetrics } from "./types";

const AGREE = [
  /\bagree\b/g, /\bconcede\b/g, /\bvalid point\b/g, /\bcorrect\b/g, /\baccept\b/g,
  /\bconcordo\b/g, /\bconcordamos\b/g, /\bde acordo\b/g, /\bcorreto\b/g,
  /\bponto v[áa]lido\b/g, /\baceito\b/g, /\bfaz sentido\b/g, /\breconhe[çc]o\b/g,
];

const DISAGREE = [
  /\bdisagree\b/g, /\bhowever\b/g, /\bincorrect\b/g, /\bwrong\b/g, /\breject\b/g,
  /\bmaintain\b/g, /\bdiscordo\b/g, /\bentretanto\b/g, /\bpor[ée]m\b/g,
  /\bincorreto\b/g, /\berrado\b/g, /\bequivocad[oa]\b/g, /\brejeito\b/g,
  /\bmantenho\b/g, /\bdiscord[âa]ncia\b/g,
];

/** Similaridade de Jaccard sobre palavras — mede estabilidade de posição. */
export function textSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );

  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;

  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    const m = text.match(new RegExp(p.source, p.flags));
    if (m) n += m.length;
  }
  return n;
}

/**
 * Avalia a convergência de uma rodada.
 *
 * @param current      contribuições desta rodada, por agente
 * @param previous     contribuições da rodada anterior (estabilidade)
 * @param twoAgo       contribuições de duas rodadas atrás (oscilação)
 * @param history      métricas das rodadas anteriores (estagnação)
 */
export function assessConvergence(
  current: Map<string, string>,
  previous: Map<string, string> | null,
  twoAgo: Map<string, string> | null,
  history: ConvergenceMetrics[],
): ConvergenceMetrics {
  let agreementCount = 0;
  let disagreementCount = 0;
  let hasEmpty = false;
  const stability: number[] = [];

  for (const [agentId, contribution] of current.entries()) {
    if (!contribution.trim()) {
      hasEmpty = true;
      continue;
    }
    const lower = contribution.toLowerCase();
    agreementCount += countMatches(lower, AGREE);
    disagreementCount += countMatches(lower, DISAGREE);

    const prev = previous?.get(agentId);
    if (prev?.trim()) stability.push(textSimilarity(prev, contribution));
  }

  const total = agreementCount + disagreementCount;
  // Contribuição vazia gera razão neutra, para não fingir consenso.
  const agreementRatio = hasEmpty ? 0.5 : total > 0 ? agreementCount / total : 0.5;
  const avgStability =
    stability.length > 0 ? stability.reduce((a, b) => a + b, 0) / stability.length : 0.5;

  const overallConvergence = agreementRatio * 0.6 + avgStability * 0.4;

  let recommendation: ConvergenceMetrics["recommendation"] = "continue";

  if (!hasEmpty && agreementRatio >= 0.7 && avgStability >= 0.8) {
    recommendation = "converged";
  } else if (history.length >= 2) {
    const prevMetrics = history[history.length - 1];
    // Estagnação: não melhorou e as posições continuam instáveis.
    if (prevMetrics.overallConvergence >= overallConvergence && avgStability < 0.3) {
      recommendation = "stalled";
    }
    // Oscilação: a rodada N repete a N-2 mas difere da N-1 — está andando em círculos.
    if (recommendation === "continue" && twoAgo && previous) {
      let oscillating = current.size > 0;
      for (const [agentId, contribution] of current.entries()) {
        const old = twoAgo.get(agentId);
        const mid = previous.get(agentId);
        if (!old?.trim() || !mid?.trim()) {
          oscillating = false;
          break;
        }
        if (!(textSimilarity(old, contribution) > 0.7 && textSimilarity(mid, contribution) < 0.5)) {
          oscillating = false;
          break;
        }
      }
      if (oscillating) recommendation = "stalled";
    }
  }

  return { agreementRatio, avgStability, overallConvergence, recommendation };
}
