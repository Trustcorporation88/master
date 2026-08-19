/**
 * Motor do duelo.
 *
 * Estrutura de fases e papéis portada do BrainstormManager do Mysti
 * (DeepMyst, Apache-2.0), com três mudanças de fundo:
 *  - 3 agentes concorrentes em vez de 2;
 *  - execução por HTTP/streaming em vez de subprocessos de CLI;
 *  - fase final de arbitragem com rubrica (não existe no original).
 */

import {
  completeChat,
  PROVIDERS,
  streamChat,
  type ProviderId,
  type Usage,
} from "@/lib/providers";
import { dossieParaPrompt, montarDossie } from "@/lib/search";
import { assessConvergence } from "./convergence";
import * as P from "./prompts";
import type {
  AgentConfig,
  ConvergenceMetrics,
  DuelConfig,
  DuelEvent,
  Verdict,
} from "./types";

/* ------------------------------------------------------------------ */
/* Fila assíncrona: permite intercalar o stream de vários agentes      */
/* ------------------------------------------------------------------ */

class EventQueue {
  private items: DuelEvent[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  push(evt: DuelEvent) {
    this.items.push(evt);
    this.waiters.shift()?.();
  }

  close() {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()?.();
  }

  async *drain(): AsyncGenerator<DuelEvent> {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

type AgentResult = { provider: ProviderId; content: string; error?: string };

/* ------------------------------------------------------------------ */

export async function* runDuel(
  config: DuelConfig,
  signal: AbortSignal,
): AsyncGenerator<DuelEvent> {
  const agents = config.agents.filter((a) => a.enabled && a.apiKey && a.model);

  if (agents.length < 2) {
    yield { type: "fatal", error: "É preciso ao menos 2 agentes configurados para haver duelo." };
    return;
  }

  const ids = agents.map((a) => a.provider);
  const totals = new Map<ProviderId, Usage>();
  const bump = (p: ProviderId, u: Usage) => {
    const cur = totals.get(p) ?? { inputTokens: 0, outputTokens: 0 };
    totals.set(p, {
      inputTokens: cur.inputTokens + u.inputTokens,
      outputTokens: cur.outputTokens + u.outputTokens,
    });
  };

  /** Roda um conjunto de agentes em paralelo, intercalando os deltas. */
  async function* fanOut(
    tasks: Array<{ agent: AgentConfig; system: string; prompt: string; role: string }>,
    phase: string,
  ): AsyncGenerator<DuelEvent, AgentResult[]> {
    const queue = new EventQueue();
    const results: AgentResult[] = [];

    const runs = tasks.map(async ({ agent, system, prompt, role }) => {
      queue.push({ type: "agent_start", provider: agent.provider, role, phase });
      let content = "";
      try {
        for await (const chunk of streamChat({
          provider: agent.provider,
          apiKey: agent.apiKey,
          model: agent.model,
          system,
          prompt,
          signal,
        })) {
          if (chunk.type === "text") {
            content += chunk.text;
            queue.push({ type: "agent_delta", provider: agent.provider, text: chunk.text });
          } else {
            bump(agent.provider, chunk.usage);
            queue.push({ type: "agent_done", provider: agent.provider, usage: chunk.usage });
          }
        }
        results.push({ provider: agent.provider, content });
      } catch (err) {
        const error = err instanceof Error ? err.message : "erro desconhecido";
        queue.push({ type: "agent_error", provider: agent.provider, error });
        results.push({ provider: agent.provider, content: "", error });
      }
    });

    const all = Promise.allSettled(runs).then(() => queue.close());
    for await (const evt of queue.drain()) yield evt;
    await all;

    // Preserva a ordem original dos agentes, não a de conclusão.
    return tasks
      .map((t) => results.find((r) => r.provider === t.agent.provider))
      .filter((r): r is AgentResult => Boolean(r));
  }

  /* ---------------- Fase 0: levantamento de evidência ---------------- */

  // Documentos do usuário entram como evidência desde a primeira fase. O
  // histórico da conversa entra junto, mas não conta como evidência: quem
  // pergunta em cima da resposta anterior não passou a citar fonte por isso.
  let dossie = [config.contextoConversa, config.contextoDocumentos]
    .filter(Boolean)
    .join("\n\n---\n\n");
  let temDossie = Boolean(config.contextoDocumentos);

  const transcript: string[] = [];
  const record = (titulo: string, itens: AgentResult[]) => {
    for (const r of itens) {
      if (r.content.trim()) {
        transcript.push(`## ${titulo} — ${PROVIDERS[r.provider].label}\n\n${r.content}`);
      }
    }
  };

  try {
    if (config.busca?.ativa && config.busca.apiKey) {
      yield { type: "phase", phase: "busca", label: "Levantando evidência" };
      yield { type: "search_start" };

      // Um agente transforma a pergunta em consultas — e pode concluir que
      // busca não ajuda nesta pergunta.
      const planejador = agents.find((a) => a.provider === pickJudge(config, ids)) ?? agents[0];

      try {
        const { text, usage } = await completeChat({
          provider: planejador.provider,
          apiKey: planejador.apiKey,
          model: planejador.model,
          system: P.SYSTEM_BASE,
          prompt: P.promptConsultas(config.query),
          maxTokens: 512,
          signal,
        });
        bump(planejador.provider, usage);

        const consultas = P.parseConsultas(text);

        if (consultas.length === 0) {
          yield {
            type: "search_skip",
            motivo: "Esta pergunta não depende de dados externos — o duelo segue sem busca.",
          };
        } else {
          const d = await montarDossie(
            config.busca.provider,
            config.busca.apiKey,
            consultas,
            signal,
          );

          if (d.fontes.length > 0) {
            // Preserva os documentos já presentes e acrescenta as fontes web.
            dossie = [dossie, dossieParaPrompt(d)].filter(Boolean).join("\n\n---\n\n");
            temDossie = true;
          }

          yield {
            type: "search_done",
            consultas: d.consultas,
            fontes: d.fontes,
            buscas: d.buscas,
            erros: d.erros,
          };

          if (d.fontes.length === 0) {
            yield {
              type: "search_skip",
              motivo: "As buscas não retornaram fontes utilizáveis — o duelo segue sem dossiê.",
            };
          }
        }
      } catch (err) {
        // Falha na busca não aborta o duelo: ele apenas roda sem evidência.
        yield {
          type: "search_error",
          error: err instanceof Error ? err.message : "falha ao levantar evidência",
        };
      }
    }

    /* ---------------- Fase 1: respostas independentes ---------------- */

    const perspectiveLenses: P.Lente[] = ["risco", "inovador", "pragmatico"];
    const isPerspectives = config.strategy === "perspectives";

    yield {
      type: "phase",
      phase: "independente",
      label: isPerspectives ? "Análise por lentes distintas" : "Respostas independentes",
    };

    let finais = yield* fanOut(
      agents.map((agent, i) => ({
        agent,
        system: P.SYSTEM_BASE,
        prompt: P.comDossie(
          isPerspectives
            ? P.promptPerspectiva(config.query, perspectiveLenses[i % 3])
            : P.promptIndependente(config.query),
          dossie,
        ),
        role: isPerspectives ? P.LENTE_LABEL[perspectiveLenses[i % 3]] : "Resposta inicial",
      })),
      "independente",
    );

    record("Resposta inicial", finais);

    const vivos = () => finais.filter((r) => !r.error && r.content.trim());
    if (vivos().length === 0) {
      yield { type: "fatal", error: "Todos os agentes falharam na primeira fase. Verifique as chaves e os modelos." };
      return;
    }

    /* ---------------- Fases intermediárias por estratégia ---------------- */

    if (config.strategy === "debate") {
      yield { type: "phase", phase: "critica", label: "Crítica cruzada" };
      const criticas = yield* fanOut(
        agents
          .filter((a) => vivos().some((v) => v.provider === a.provider))
          .map((agent) => ({
            agent,
            system: P.SYSTEM_BASE,
            prompt: P.comDossie(
              P.promptCritica(config.query, agent.provider, ids, vivos()),
              dossie,
            ),
            role: "Crítico",
          })),
        "critica",
      );
      record("Crítica", criticas);

      yield { type: "phase", phase: "refino", label: "Refinamento final" };
      const anterior = new Map(finais.map((r) => [r.provider, r.content]));
      const refinos = yield* fanOut(
        agents
          .filter((a) => vivos().some((v) => v.provider === a.provider))
          .map((agent) => ({
            agent,
            system: P.SYSTEM_BASE,
            prompt: P.comDossie(
              P.promptRefinamento(
                config.query,
                anterior.get(agent.provider) ?? "",
                criticas
                  .filter((c) => c.provider !== agent.provider && c.content.trim())
                  .map((c) => `### Crítica de ${PROVIDERS[c.provider].label}\n\n${c.content}`)
                  .join("\n\n---\n\n") || "(nenhuma crítica recebida)",
              ),
              dossie,
            ),
            role: "Defensor",
          })),
        "refino",
      );
      record("Refinamento", refinos);

      const metrics = assessConvergence(
        new Map(refinos.map((r) => [r.provider, r.content])),
        new Map(criticas.map((r) => [r.provider, r.content])),
        null,
        [],
      );
      yield { type: "convergence", round: 1, metrics };
      finais = mergeResults(finais, refinos);
    }

    if (config.strategy === "red-team") {
      // Ataque em ciclo: cada agente ataca a resposta do próximo.
      const ordem = vivos();
      yield { type: "phase", phase: "ataque", label: "Red Team: ataque cruzado" };

      const ataques = yield* fanOut(
        ordem.map((r, i) => {
          const alvo = ordem[(i + 1) % ordem.length];
          const atacante = agents.find((a) => a.provider === r.provider)!;
          return {
            agent: atacante,
            system: P.SYSTEM_BASE,
            prompt: P.comDossie(
              P.promptRedTeam(config.query, alvo.provider, alvo.content),
              dossie,
            ),
            role: `Desafiante → ${PROVIDERS[alvo.provider].label}`,
          };
        }),
        "ataque",
      );
      record("Ataque", ataques);

      yield { type: "phase", phase: "defesa", label: "Defesa e correção" };
      const anterior = new Map(finais.map((r) => [r.provider, r.content]));
      const defesas = yield* fanOut(
        ordem.map((r, i) => {
          // Quem atacou o agente r foi o anterior no ciclo.
          const atacanteIdx = (i - 1 + ordem.length) % ordem.length;
          const ataque = ataques.find((a) => a.provider === ordem[atacanteIdx].provider);
          return {
            agent: agents.find((a) => a.provider === r.provider)!,
            system: P.SYSTEM_BASE,
            prompt: P.comDossie(
              P.promptDefesa(
                config.query,
                anterior.get(r.provider) ?? "",
                ataque?.content?.trim() || "(nenhum ataque registrado)",
              ),
              dossie,
            ),
            role: "Proponente (defesa)",
          };
        }),
        "defesa",
      );
      record("Defesa", defesas);
      finais = mergeResults(finais, defesas);
    }

    if (isPerspectives) {
      yield { type: "phase", phase: "integracao", label: "Integração das perspectivas" };
      const comLente = vivos().map((r) => {
        const idx = agents.findIndex((a) => a.provider === r.provider);
        return { ...r, lente: perspectiveLenses[idx % 3] };
      });

      const integracoes = yield* fanOut(
        comLente.map((r) => ({
          agent: agents.find((a) => a.provider === r.provider)!,
          system: P.SYSTEM_BASE,
          prompt: P.comDossie(
            P.promptPerspectivaCruzada(config.query, r.provider, comLente),
            dossie,
          ),
          role: "Integrador",
        })),
        "integracao",
      );
      record("Integração", integracoes);
      finais = mergeResults(finais, integracoes);
    }

    if (config.strategy === "delphi") {
      const history: ConvergenceMetrics[] = [];
      const rounds: Array<Map<string, string>> = [
        new Map(finais.map((r) => [r.provider, r.content])),
      ];
      const facilitador = agents.find((a) => a.provider === pickJudge(config, ids)) ?? agents[0];

      for (let round = 1; round <= Math.max(1, config.maxRounds); round++) {
        yield { type: "phase", phase: `delphi-${round}`, label: `Delphi rodada ${round}: síntese` };

        const sinteseRes = yield* fanOut(
          [
            {
              agent: facilitador,
              system: P.SYSTEM_BASE,
              prompt: P.promptFacilitador(config.query, round, vivos()),
              role: "Facilitador",
            },
          ],
          `delphi-${round}-sintese`,
        );
        const sintese = sinteseRes[0]?.content ?? "";
        if (!sintese.trim()) break;
        transcript.push(`## Síntese do facilitador (rodada ${round})\n\n${sintese}`);

        yield { type: "phase", phase: `delphi-${round}-refino`, label: `Delphi rodada ${round}: refinamento` };
        const anterior = new Map(finais.map((r) => [r.provider, r.content]));
        const refinos = yield* fanOut(
          agents
            .filter((a) => vivos().some((v) => v.provider === a.provider))
            .map((agent) => ({
              agent,
              system: P.SYSTEM_BASE,
              prompt: P.comDossie(
                P.promptDelphiRefinar(
                  config.query,
                  anterior.get(agent.provider) ?? "",
                  sintese,
                  round,
                ),
                dossie,
              ),
              role: "Refinador",
            })),
          `delphi-${round}-refino`,
        );
        record(`Refinamento Delphi ${round}`, refinos);
        finais = mergeResults(finais, refinos);

        const atual = new Map(refinos.map((r) => [r.provider, r.content]));
        rounds.push(atual);

        const metrics = assessConvergence(
          atual,
          rounds[rounds.length - 2] ?? null,
          rounds[rounds.length - 3] ?? null,
          history,
        );

        // O facilitador declara a nota; ela tem prioridade sobre a heurística.
        const nota = sintese.match(/converg[êe]ncia:?\s*(\d+)\s*\/\s*10/i);
        if (nota) {
          metrics.overallConvergence = Number(nota[1]) / 10;
          if (metrics.overallConvergence >= 0.7) metrics.recommendation = "converged";
        }

        history.push(metrics);
        yield { type: "convergence", round, metrics };

        if (
          config.autoConverge &&
          (metrics.recommendation === "converged" || metrics.recommendation === "stalled")
        ) {
          break;
        }
      }
    }

    /* ---------------- Fase final: arbitragem ---------------- */

    const judgeId = pickJudge(config, ids);
    const judge = agents.find((a) => a.provider === judgeId) ?? agents[0];

    yield { type: "phase", phase: "veredito", label: "Arbitragem" };
    yield { type: "judge_start", provider: judge.provider };

    let raw = "";
    // Transmite apenas a resposta ao usuário; o bloco JSON de telemetria vem
    // depois dela e é cortado aqui, no servidor — nunca chega ao navegador.
    let enviado = 0;
    let cortado = false;
    const FENCE = "```json";

    try {
      for await (const chunk of streamChat({
        provider: judge.provider,
        apiKey: judge.apiKey,
        model: judge.model,
        system: P.SYSTEM_ARBITRO,
        prompt: P.promptArbitro(
          config.query,
          vivos(),
          transcript.join("\n\n---\n\n").slice(0, 60000),
          dossie,
        ),
        maxTokens: 8192,
        signal,
      })) {
        if (chunk.type === "text") {
          raw += chunk.text;
          if (cortado) continue;

          const idx = raw.indexOf(FENCE);
          if (idx !== -1) {
            cortado = true;
            if (idx > enviado) {
              yield { type: "judge_delta", text: raw.slice(enviado, idx) };
              enviado = idx;
            }
            continue;
          }

          // Retém a cauda do tamanho da cerca, para não emitir um fence parcial.
          const seguro = raw.length - FENCE.length;
          if (seguro > enviado) {
            yield { type: "judge_delta", text: raw.slice(enviado, seguro) };
            enviado = seguro;
          }
        } else {
          bump(judge.provider, chunk.usage);
        }
      }

      // Sem bloco JSON: o resto do texto ainda é resposta e deve ser entregue.
      if (!cortado && raw.length > enviado) {
        yield { type: "judge_delta", text: raw.slice(enviado) };
      }
    } catch (err) {
      yield {
        type: "fatal",
        error: `Falha na arbitragem: ${err instanceof Error ? err.message : "erro desconhecido"}`,
      };
      yield { type: "cost", totals: [...totals].map(([provider, usage]) => ({ provider, usage })) };
      return;
    }

    const verdict = parseVerdict(raw, vivos(), temDossie);
    yield { type: "verdict", verdict, raw };
    yield { type: "cost", totals: [...totals].map(([provider, usage]) => ({ provider, usage })) };
    yield { type: "done" };
  } catch (err) {
    if (signal.aborted) return;
    yield {
      type: "fatal",
      error: err instanceof Error ? err.message : "erro desconhecido no duelo",
    };
  }
}

/* ------------------------------------------------------------------ */

function mergeResults(base: AgentResult[], novos: AgentResult[]): AgentResult[] {
  return base.map((b) => {
    const n = novos.find((x) => x.provider === b.provider);
    return n && n.content.trim() ? n : b;
  });
}

/** Escolhe o árbitro. "rotate" usa um critério estável e independente da pergunta. */
function pickJudge(config: DuelConfig, ids: ProviderId[]): ProviderId {
  if (config.judge !== "rotate" && ids.includes(config.judge)) return config.judge;
  // Rotação determinística por dia, para não viciar sempre no mesmo provedor.
  const dia = Math.floor(Date.now() / 86_400_000);
  return ids[dia % ids.length];
}

/**
 * Extrai objetos JSON balanceados de um texto.
 *
 * Não dá para usar regex até o próximo ``` : o campo "resposta" costuma conter
 * blocos de código markdown, e o fence interno cortaria o JSON no meio. Aqui a
 * varredura conta chaves de verdade, ignorando as que estão dentro de strings.
 */
export function extractJsonObjects(raw: string): string[] {
  const out: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < raw.length; j++) {
      const c = raw[j];

      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }

      if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          out.push(raw.slice(i, j + 1));
          i = j; // não reprocessa objetos internos
          break;
        }
      }
    }
  }

  return out;
}

/**
 * Extrai o JSON do veredito; se falhar, degrada para o texto cru.
 *
 * Com dossiê, a fundamentação entra na nota e a correção cede peso a ela —
 * afirmação apoiada em fonte citada vale mais que afirmação só plausível.
 */
export function parseVerdict(
  raw: string,
  respostas: AgentResult[],
  temDossie = false,
): Verdict {
  // Prioriza objetos que carregam as chaves esperadas do veredito.
  const candidates = extractJsonObjects(raw).filter(
    (c) => c.includes('"resposta"') || c.includes('"winner"') || c.includes('"scores"'),
  );

  for (const block of candidates.reverse()) {
    try {
      const j = JSON.parse(block.trim());
      const scores = Array.isArray(j.scores)
        ? j.scores
            .filter((s: { provider?: string }) =>
              respostas.some((r) => r.provider === s.provider),
            )
            .map((s: Record<string, unknown>) => {
              const n = (k: string) => clamp(Number(s[k] ?? 0));
              const c = n("correcao"),
                co = n("completude"),
                ra = n("raciocinio"),
                ri = n("riscos");

              // Correção pesa mais: uma resposta errada não pode ganhar por ser bonita.
              const temNotaFund = temDossie && s.fundamentacao !== undefined;
              const fu = temNotaFund ? n("fundamentacao") : undefined;

              const total =
                fu !== undefined
                  ? c * 0.35 + co * 0.2 + ra * 0.2 + ri * 0.1 + fu * 0.15
                  : c * 0.4 + co * 0.25 + ra * 0.25 + ri * 0.1;

              return {
                provider: s.provider as ProviderId,
                correcao: c,
                completude: co,
                raciocinio: ra,
                riscos: ri,
                ...(fu !== undefined ? { fundamentacao: fu } : {}),
                total: Math.round(total * 10) / 10,
                comentario: String(s.comentario ?? ""),
              };
            })
        : [];

      return {
        winner: normalizeWinner(j.winner, respostas),
        confidence: ["alta", "media", "baixa"].includes(j.confidence) ? j.confidence : "media",
        scores,
        // A resposta ao usuário é o texto que precede o bloco JSON.
        resposta: stripJson(raw) || (typeof j.resposta === "string" ? j.resposta : ""),
        ressalvas: Array.isArray(j.ressalvas) ? j.ressalvas.map(String) : [],
      };
    } catch {
      continue;
    }
  }

  // Sem JSON válido: entrega o texto do árbitro em vez de perder o trabalho.
  return {
    winner: "nenhum",
    confidence: "baixa",
    scores: [],
    resposta: stripJson(raw),
    // Exibida ao usuário final: precisa dizer a consequência para ele, não o
    // detalhe interno. O que ele perde é a aferição da confiança, e a resposta
    // em si continua válida — por isso o texto trata do grau, não do mecanismo.
    ressalvas: [
      "O grau de confiança desta resposta não pôde ser aferido. O texto foi produzido normalmente, mas leia com atenção redobrada e confira os pontos decisivos.",
    ],
  };
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 0);

function normalizeWinner(w: unknown, respostas: AgentResult[]): Verdict["winner"] {
  const s = String(w ?? "").toLowerCase().trim();
  if (respostas.some((r) => r.provider === s)) return s as ProviderId;
  if (s.includes("empate")) return "empate";
  return "nenhum";
}

/** Devolve só o texto anterior ao bloco JSON de telemetria. */
function stripJson(raw: string): string {
  const idx = raw.indexOf("```json");
  const texto = idx === -1 ? raw : raw.slice(0, idx);
  return texto.trim();
}
