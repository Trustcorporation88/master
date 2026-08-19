import type { ProviderId, Usage } from "@/lib/providers";
import type { Fonte, SearchProviderId } from "@/lib/search";

/** As 5 estratégias portadas do BrainstormManager do Mysti (Apache-2.0). */
export type Strategy = "quick" | "debate" | "red-team" | "perspectives" | "delphi";

export const STRATEGY_INFO: Record<
  Strategy,
  { label: string; blurb: string; papeis: string; rounds: string }
> = {
  quick: {
    label: "Rápido",
    blurb: "Cada agente responde sozinho e o árbitro julga. Menor custo.",
    papeis: "Síntese direta",
    rounds: "1 rodada",
  },
  debate: {
    label: "Debate",
    blurb: "Os agentes criticam as respostas uns dos outros e depois se corrigem.",
    papeis: "Crítico × Defensor",
    rounds: "3 fases",
  },
  "red-team": {
    label: "Red Team",
    blurb: "Cada agente ataca a resposta do colega buscando falhas e casos-limite.",
    papeis: "Proponente × Desafiante",
    rounds: "3 fases",
  },
  perspectives: {
    label: "Perspectivas",
    blurb: "Cada agente assume uma lente diferente: risco, inovação e pragmatismo.",
    papeis: "Risco × Inovador × Pragmático",
    rounds: "2 fases",
  },
  delphi: {
    label: "Delphi",
    blurb: "Rodadas de refinamento com facilitador até haver consenso medido.",
    papeis: "Facilitador × Refinadores",
    rounds: "até 3 rodadas",
  },
};

export type AgentConfig = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  enabled: boolean;
};

export type BuscaConfig = {
  ativa: boolean;
  provider: SearchProviderId;
  apiKey: string;
};

export type DuelConfig = {
  query: string;
  strategy: Strategy;
  agents: AgentConfig[];
  busca?: BuscaConfig;
  /** Bloco pronto com os documentos anexados, montado antes da execução. */
  contextoDocumentos?: string;
  /**
   * Bloco com as perguntas e respostas anteriores da mesma conversa.
   *
   * Separado dos documentos de propósito: histórico é contexto, não evidência.
   * Ele não deve fazer o julgamento final passar a exigir citação de fonte.
   */
  contextoConversa?: string;
  /** Quem julga no fim. "rotate" escolhe um agente diferente do autor mais forte. */
  judge: ProviderId | "rotate";
  maxRounds: number;
  autoConverge: boolean;
};

export type ConvergenceMetrics = {
  agreementRatio: number;
  avgStability: number;
  overallConvergence: number;
  recommendation: "continue" | "converged" | "stalled";
};

export type Verdict = {
  winner: ProviderId | "empate" | "nenhum";
  confidence: "alta" | "media" | "baixa";
  scores: Array<{
    provider: ProviderId;
    correcao: number;
    completude: number;
    raciocinio: number;
    riscos: number;
    /** Só existe quando o duelo teve dossiê de evidência. */
    fundamentacao?: number;
    total: number;
    comentario: string;
  }>;
  resposta: string;
  ressalvas: string[];
};

/** Eventos enviados ao navegador via SSE. */
export type DuelEvent =
  | { type: "phase"; phase: string; label: string }
  | { type: "search_start" }
  | { type: "search_skip"; motivo: string }
  | { type: "search_done"; consultas: string[]; fontes: Fonte[]; buscas: number; erros: string[] }
  | { type: "search_error"; error: string }
  | { type: "agent_start"; provider: ProviderId; role: string; phase: string }
  | { type: "agent_delta"; provider: ProviderId; text: string }
  | { type: "agent_done"; provider: ProviderId; usage: Usage }
  | { type: "agent_error"; provider: ProviderId; error: string }
  | { type: "convergence"; round: number; metrics: ConvergenceMetrics }
  | { type: "judge_start"; provider: ProviderId }
  | { type: "judge_delta"; text: string }
  | { type: "verdict"; verdict: Verdict; raw: string }
  | { type: "cost"; totals: Array<{ provider: ProviderId; usage: Usage }> }
  | { type: "done" }
  | { type: "fatal"; error: string };
