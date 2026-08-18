import { runDuel } from "@/lib/duel/engine";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { SEARCH_PROVIDERS, type SearchProviderId } from "@/lib/search";
import type { AgentConfig, BuscaConfig, DuelConfig, Strategy } from "@/lib/duel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const STRATEGIES: Strategy[] = ["quick", "debate", "red-team", "perspectives", "delphi"];

/**
 * Executa o duelo e transmite os eventos por SSE.
 *
 * As chaves vêm no corpo do POST, são usadas em memória e não são gravadas em
 * lugar algum — nem em log, nem em disco, nem devolvidas ao cliente.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return Response.json({ error: "A pergunta não pode estar vazia." }, { status: 400 });
  }
  if (query.length > 24_000) {
    return Response.json({ error: "Pergunta muito longa (máx. 24.000 caracteres)." }, { status: 400 });
  }

  const rawAgents = Array.isArray(body.agents) ? body.agents : [];
  const agents: AgentConfig[] = rawAgents
    .map((a) => a as Record<string, unknown>)
    .filter((a) => typeof a.provider === "string" && a.provider in PROVIDERS)
    .map((a) => ({
      provider: a.provider as ProviderId,
      model: String(a.model ?? "").trim(),
      apiKey: String(a.apiKey ?? "").trim(),
      enabled: a.enabled !== false,
    }))
    .filter((a) => a.enabled && a.apiKey && a.model);

  if (agents.length < 2) {
    return Response.json(
      { error: "Configure ao menos 2 agentes com chave e modelo para haver duelo." },
      { status: 400 },
    );
  }

  const strategy = STRATEGIES.includes(body.strategy as Strategy)
    ? (body.strategy as Strategy)
    : "quick";

  const judgeRaw = String(body.judge ?? "rotate");
  const judge: DuelConfig["judge"] =
    judgeRaw in PROVIDERS ? (judgeRaw as ProviderId) : "rotate";

  // Busca é opcional: sem chave válida, o duelo roda exatamente como antes.
  const rawBusca = (body.busca ?? {}) as Record<string, unknown>;
  const buscaProvider = String(rawBusca.provider ?? "");
  const buscaKey = String(rawBusca.apiKey ?? "").trim();

  const busca: BuscaConfig | undefined =
    rawBusca.ativa === true && buscaKey && buscaProvider in SEARCH_PROVIDERS
      ? {
          ativa: true,
          provider: buscaProvider as SearchProviderId,
          apiKey: buscaKey,
        }
      : undefined;

  const config: DuelConfig = {
    query,
    strategy,
    agents,
    busca,
    judge,
    maxRounds: Math.min(5, Math.max(1, Number(body.maxRounds) || 3)),
    autoConverge: body.autoConverge !== false,
  };

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (data: unknown) => {
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* cliente desconectou */
        }
      };

      // Mantém a conexão viva em proxies que cortam streams silenciosos.
      const ping = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* ignora */
        }
      }, 15_000);

      try {
        for await (const evt of runDuel(config, controller.signal)) {
          send(evt);
        }
      } catch (err) {
        send({
          type: "fatal",
          error: err instanceof Error ? err.message : "erro inesperado no servidor",
        });
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
