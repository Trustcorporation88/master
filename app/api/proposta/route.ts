import { completeChat } from "@/lib/providers";
import { extractJsonObjects } from "@/lib/duel/engine";
import { promptProposta, SYSTEM_PROPOSTA } from "@/lib/duel/prompts";
import {
  abrirPullRequest,
  githubConfigurado,
  MAX_ARQUIVOS_PR,
  temValidacaoDePr,
  validarCaminho,
  type ArquivoProposto,
} from "@/lib/github";
import { agentesDoServidor } from "@/lib/serverConfig";
import { lerExtracao, lerMeta } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Teto de tempo para escrever o código.
 *
 * Sem isto, uma chamada que travou no provedor deixava o botão em
 * "Preparando..." indefinidamente: o sinal de vida mantinha a conexão aberta
 * para sempre, e quem esperava não tinha como saber se havia falhado. Melhor
 * desistir com mensagem clara do que esperar sem fim.
 */
const TETO_GERACAO_MS = 4 * 60 * 1000;

/**
 * Resposta em fluxo, com sinal de vida.
 *
 * Escrever o código e abrir o pull request levam mais de 100 segundos com
 * frequência, e uma requisição que fica calada esse tempo é cortada pela borda
 * da rede (o Cloudflare devolve uma página HTML de erro, que o cliente tenta
 * ler como JSON e falha com "Unexpected token '<'").
 *
 * A análise nunca sofreu disso porque transmite texto continuamente. Aqui não há
 * o que transmitir no meio, então vão comentários de SSE a cada 10 segundos —
 * bytes que mantêm a conexão viva sem afetar o conteúdo. O resultado real vai no
 * último quadro.
 */
function fluxoComPing(
  trabalho: () => Promise<{ status: number; corpo: unknown }>,
  rotulo: string,
): Response {
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const escrever = (texto: string) => {
        try {
          ctrl.enqueue(enc.encode(texto));
        } catch {
          /* cliente desconectou */
        }
      };

      // O primeiro byte sai imediatamente: é ele que impede o corte por
      // demora até a primeira resposta.
      escrever(": inicio\n\n");
      const ping = setInterval(() => escrever(": ping\n\n"), 10_000);

      try {
        const { status, corpo } = await trabalho();
        escrever(`data: ${JSON.stringify({ status, corpo })}\n\n`);
      } catch (err) {
        console.error(`[proposta] falha em ${rotulo}:`, err);
        escrever(
          `data: ${JSON.stringify({
            status: 500,
            corpo: { error: "Falha inesperada ao preparar a proposta." },
          })}\n\n`,
        );
      } finally {
        clearInterval(ping);
        try {
          ctrl.close();
        } catch {
          /* já fechado */
        }
      }
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

type Proposta = {
  possivel: boolean;
  titulo: string;
  descricao: string;
  arquivos: ArquivoProposto[];
  riscos: string[];
  faltando: string[];
};

/** Extrai a proposta do texto do modelo, validando o que importa. */
function lerProposta(bruto: string): Proposta | null {
  const blocos = extractJsonObjects(bruto).filter((b) => b.includes('"possivel"'));

  for (const bloco of blocos.reverse()) {
    try {
      const j = JSON.parse(bloco);
      const arquivos = Array.isArray(j.arquivos)
        ? j.arquivos
            .filter(
              (a: unknown): a is ArquivoProposto =>
                typeof (a as ArquivoProposto)?.caminho === "string" &&
                typeof (a as ArquivoProposto)?.conteudo === "string",
            )
            .slice(0, MAX_ARQUIVOS_PR)
        : [];

      return {
        possivel: j.possivel !== false && arquivos.length > 0,
        titulo: String(j.titulo ?? "Alterações propostas pela análise").slice(0, 120),
        descricao: String(j.descricao ?? ""),
        arquivos,
        riscos: Array.isArray(j.riscos) ? j.riscos.map(String) : [],
        faltando: Array.isArray(j.faltando) ? j.faltando.map(String) : [],
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Identifica o repositório a partir do documento importado. */
async function repoDoDocumento(id: string) {
  const meta = await lerMeta(id);
  if (!meta || meta.tipo !== "repositorio") return null;

  // O nome tem o formato dono/repo@commit.
  const [nomeCompleto] = meta.nome.split("@");
  const [owner, repo] = nomeCompleto.split("/");
  if (!owner || !repo) return null;

  const branch = meta.repoBranch ?? "main";
  return { meta, owner, repo, branch };
}

export async function POST(req: Request) {
  if (!githubConfigurado()) {
    return Response.json({ error: "GitHub não configurado." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const acao = String(body.acao ?? "gerar");
  const documentoId = String(body.documentoId ?? "");

  const alvo = await repoDoDocumento(documentoId);
  if (!alvo) {
    return Response.json({ error: "Documento de repositório não encontrado." }, { status: 404 });
  }

  /* ---------------- Gerar a proposta ---------------- */

  if (acao === "gerar") {
    const pergunta = String(body.pergunta ?? "").trim();
    const resposta = String(body.resposta ?? "").trim();

    if (!pergunta || !resposta) {
      return Response.json({ error: "Faltam a pergunta e a resposta." }, { status: 400 });
    }

    const contexto = await lerExtracao(documentoId);
    if (!contexto) {
      return Response.json({ error: "Conteúdo do repositório indisponível." }, { status: 404 });
    }

    // Um único modelo escreve o código; a decisão do que fazer já veio da
    // análise cruzada. Repetir o duelo aqui multiplicaria custo sem ganho.
    const agente = agentesDoServidor()[0];
    if (!agente) {
      return Response.json({ error: "Serviço não configurado." }, { status: 503 });
    }

    return fluxoComPing(async () => {
      const limite = new AbortController();
      const relogio = setTimeout(() => limite.abort(), TETO_GERACAO_MS);

      let text: string;
      try {
        ({ text } = await completeChat({
          provider: agente.provider,
          apiKey: agente.apiKey,
          model: agente.model,
          system: SYSTEM_PROPOSTA,
          prompt: promptProposta(pergunta, resposta, contexto.slice(0, 200_000)),
          maxTokens: 16_000,
          signal: limite.signal,
        }));
      } catch (err) {
        const abortou = limite.signal.aborted;
        console.error("[proposta] falha ao gerar:", err);
        return {
          status: abortou ? 504 : 502,
          corpo: {
            error: abortou
              ? "A geração do código passou de 4 minutos e foi interrompida. " +
                "Tente com uma pergunta mais específica sobre um arquivo, em vez do repositório inteiro."
              : "Falha ao preparar a proposta.",
          },
        };
      } finally {
        clearTimeout(relogio);
      }

      const proposta = lerProposta(text);
      if (!proposta) {
        return {
          status: 422,
          corpo: { error: "Não foi possível montar uma proposta a partir desta análise." },
        };
      }

      // Recusa caminhos perigosos antes mesmo de mostrar ao usuário.
      const recusados = proposta.arquivos
        .map((a) => ({ caminho: a.caminho, motivo: validarCaminho(a.caminho) }))
        .filter((r) => r.motivo);

      const arquivos = proposta.arquivos.filter(
        (a) => !recusados.some((r) => r.caminho === a.caminho),
      );

      return {
        status: 200,
        corpo: {
          proposta: { ...proposta, arquivos, possivel: proposta.possivel && arquivos.length > 0 },
          recusados,
          repo: `${alvo.owner}/${alvo.repo}`,
          base: alvo.branch,
          temValidacaoDePr: await temValidacaoDePr(alvo.owner, alvo.repo),
        },
      };
    }, "gerar");
  }

  /* ---------------- Abrir o pull request ---------------- */

  if (acao === "aplicar") {
    const p = body.proposta as Proposta | undefined;
    if (!p?.arquivos?.length) {
      return Response.json({ error: "Proposta vazia." }, { status: 400 });
    }

    const rodape = [
      "",
      "---",
      "",
      "**Gerado por análise automatizada.** O código foi escrito a partir da leitura do",
      "repositório, mas **não foi compilado nem testado** por quem o escreveu. Revise antes de",
      "mesclar.",
      "",
      p.riscos.length ? `**Riscos apontados:**\n${p.riscos.map((r) => `- ${r}`).join("\n")}` : "",
      p.faltando.length
        ? `\n**Arquivos que faltaram no contexto:**\n${p.faltando.map((f) => `- ${f}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return fluxoComPing(async () => {
      try {
        const resultado = await abrirPullRequest({
          owner: alvo.owner,
          repo: alvo.repo,
          base: alvo.branch,
          titulo: p.titulo,
          descricao: `${p.descricao}\n${rodape}`,
          arquivos: p.arquivos,
        });

        return { status: 200, corpo: { pr: resultado } };
      } catch (err) {
        // O motivo vindo do GitHub é útil ao usuário (permissão, branch
        // existente), então sobe em vez de virar mensagem genérica.
        console.error("[proposta] falha ao abrir PR:", err);
        return {
          status: 502,
          corpo: {
            error: err instanceof Error ? err.message : "Não foi possível abrir o pull request.",
          },
        };
      }
    }, "aplicar");
  }

  return Response.json({ error: "Ação desconhecida." }, { status: 400 });
}
