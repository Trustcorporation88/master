import { runDuel } from "@/lib/duel/engine";
import { blocoDocumentos } from "@/lib/duel/prompts";
import { recortarPorRelevancia } from "@/lib/extract";
import { agentesDoServidor, buscaDoServidor } from "@/lib/serverConfig";
import { lerExtracao, lerMeta } from "@/lib/storage";
import type { DuelConfig, Strategy } from "@/lib/duel/types";
import type { Etapa, EventoPublico, Profundidade } from "@/lib/publicTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Executa a análise e transmite eventos por SSE.
 *
 * Contrato deliberadamente estreito: o cliente manda a pergunta e a
 * profundidade, nada mais. As chaves vêm do ambiente do servidor, e os eventos
 * internos são traduzidos para etapas de produto — o navegador nunca recebe
 * nome de fornecedor, de modelo, de estratégia, nem as respostas parciais.
 */

/**
 * Orçamento de caracteres para documentos anexados.
 *
 * Entra no prompt de CADA parecer, então o custo se multiplica pelo número de
 * fornecedores. 120 mil caracteres são cerca de 30 mil tokens por parecer — o
 * suficiente para um relatório inteiro, sem transformar uma pergunta em dezenas
 * de dólares.
 */
const ORCAMENTO_DOCUMENTOS = 120_000;

const ESTRATEGIA: Record<Profundidade, Strategy> = {
  rapida: "quick",
  equilibrada: "debate",
  profunda: "delphi",
};

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return Response.json({ error: "Escreva uma pergunta." }, { status: 400 });
  }
  if (query.length > 24_000) {
    return Response.json({ error: "Pergunta muito longa (máximo de 24.000 caracteres)." }, { status: 400 });
  }

  const profundidade = (
    ["rapida", "equilibrada", "profunda"].includes(String(body.profundidade))
      ? body.profundidade
      : "equilibrada"
  ) as Profundidade;

  const idsDocumentos = Array.isArray(body.documentos)
    ? body.documentos.filter((d): d is string => typeof d === "string").slice(0, 10)
    : [];

  const agents = agentesDoServidor();
  if (agents.length < 2) {
    return Response.json(
      { error: "O serviço não está configurado. Fale com o administrador." },
      { status: 503 },
    );
  }

  // Monta o contexto dos documentos antes de começar: se um arquivo não estiver
  // legível, é melhor avisar agora do que no meio da análise.
  const docsUsados: Array<{ nome: string; cobertura: number }> = [];
  let contextoDocumentos: string | undefined;

  if (idsDocumentos.length) {
    const orcamentoPorDoc = Math.floor(ORCAMENTO_DOCUMENTOS / idsDocumentos.length);
    const blocos: Parameters<typeof blocoDocumentos>[0] = [];
    let contador = 0;

    for (const id of idsDocumentos) {
      const meta = await lerMeta(id);
      if (!meta || meta.estado !== "pronto") continue;

      const extracao = await lerExtracao(id);
      if (!extracao?.trim()) continue;

      contador++;
      const { trechos, cobertura } = recortarPorRelevancia(
        extracao,
        query,
        orcamentoPorDoc,
        `A${contador}.`,
      );

      blocos.push({ nome: meta.nome, trechos, cobertura, observacao: meta.aviso });
      docsUsados.push({ nome: meta.nome, cobertura });
    }

    if (blocos.length) contextoDocumentos = blocoDocumentos(blocos);
  }

  const config: DuelConfig = {
    query,
    strategy: ESTRATEGIA[profundidade],
    agents,
    contextoDocumentos,
    busca: buscaDoServidor(),
    judge: "rotate",
    maxRounds: profundidade === "profunda" ? 3 : 2,
    autoConverge: true,
  };

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const enviar = (evt: EventoPublico) => {
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          /* cliente desconectou */
        }
      };

      const ping = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* ignora */
        }
      }, 15_000);

      let etapaAtual: Etapa | null = null;
      const etapa = (e: Etapa) => {
        if (etapaAtual !== e) {
          etapaAtual = e;
          enviar({ type: "etapa", etapa: e });
        }
      };

      try {
        etapa("interpretando");

        // Informa de saída quanto de cada documento entrou na análise.
        if (docsUsados.length) {
          enviar({
            type: "documentos",
            documentos: docsUsados.map((d) => ({
              nome: d.nome,
              cobertura: Math.round(d.cobertura * 100),
            })),
          });
        }

        for await (const evt of runDuel(config, controller.signal)) {
          switch (evt.type) {
            case "search_start":
              etapa("consultando");
              break;

            case "search_done":
              // Só o essencial: título, link e data. Trechos ficam no servidor.
              enviar({
                type: "fontes",
                fontes: evt.fontes.map((f) => ({
                  n: f.n,
                  titulo: f.titulo,
                  url: f.url,
                  data: f.data,
                })),
              });
              break;

            case "phase":
              // Traduz a fase interna para uma etapa de produto.
              if (evt.phase === "independente") etapa("analisando");
              else if (evt.phase === "veredito") etapa("consolidando");
              else if (evt.phase !== "busca") etapa("revisando");
              break;

            case "judge_delta":
              enviar({ type: "resposta_delta", texto: evt.text });
              break;

            case "verdict":
              etapa("concluido");
              enviar({
                type: "final",
                confianca: evt.verdict.confidence,
                ressalvas: evt.verdict.ressalvas,
              });
              break;

            case "fatal":
              enviar({
                type: "erro",
                texto: mensagemAmigavel(evt.error),
              });
              break;

            // Ignorados de propósito: revelariam o mecanismo ou não interessam
            // ao usuário (agent_start/delta/done/error, convergence, cost,
            // judge_start, search_skip, search_error, done).
          }
        }
      } catch (err) {
        console.error("[duelo] falha na execução:", err instanceof Error ? err.message : err);
        enviar({ type: "erro", texto: "Houve uma falha ao processar a análise. Tente novamente." });
      } finally {
        clearInterval(ping);
        try {
          ctrl.close();
        } catch {
          /* já fechado */
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Traduz erros técnicos em mensagens de produto.
 *
 * Mensagens cruas de provedor citariam fornecedor e modelo — exatamente o que
 * não deve aparecer. O detalhe fica no log do servidor.
 */
function mensagemAmigavel(erro: string): string {
  const e = erro.toLowerCase();

  if (e.includes("inválida") || e.includes("permissão")) {
    return "O serviço está com um problema de configuração. Fale com o administrador.";
  }
  if (e.includes("saldo") || e.includes("cota")) {
    return "O serviço atingiu o limite de uso. Fale com o administrador.";
  }
  if (e.includes("rate limit") || e.includes("limite de requisições")) {
    return "Muitas análises ao mesmo tempo. Tente novamente em alguns instantes.";
  }
  if (e.includes("falharam")) {
    return "Não foi possível concluir a análise agora. Tente novamente.";
  }
  return "Houve uma falha ao processar a análise. Tente novamente.";
}
