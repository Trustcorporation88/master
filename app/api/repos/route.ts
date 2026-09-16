import {
  branchPadrao,
  githubConfigurado,
  listarBranches,
  listarRepos,
  montarPacoteRepo,
  podeListar,
} from "@/lib/github";
import { criarDocumentoTexto } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Resposta em fluxo, com sinal de vida.
 *
 * Importar um repositório lê dezenas de arquivos no GitHub. Sem byte nenhum
 * por ~100 s a borda da rede devolve HTML, e o cliente falha com
 * "Unexpected token '<'". O mesmo padrão da proposta de código.
 */
function fluxoComPing(
  trabalho: () => Promise<{ status: number; corpo: unknown }>,
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

      escrever(": inicio\n\n");
      const ping = setInterval(() => escrever(": ping\n\n"), 10_000);

      try {
        const { status, corpo } = await trabalho();
        escrever(`data: ${JSON.stringify({ status, corpo })}\n\n`);
      } catch (err) {
        console.error("[repos] falha inesperada:", err);
        escrever(
          `data: ${JSON.stringify({
            status: 500,
            corpo: { error: "Falha ao consultar o GitHub." },
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

/** Lista os repositórios disponíveis, ou as branches de um deles. */
export async function GET(req: Request) {
  if (!githubConfigurado()) {
    return Response.json({ configurado: false, repos: [] });
  }

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");

  // Com ?repo=owner/nome devolve as branches daquele repositório.
  if (repo) {
    const [owner, nome] = repo.split("/");
    if (!owner || !nome) {
      return Response.json({ error: "Repositório inválido." }, { status: 400 });
    }
    return fluxoComPing(async () => {
      try {
        // A branch padrão vem junto: sem ela, um repositório digitado à mão
        // ficaria sem branch selecionada e o botão de importar morto.
        const [branches, padrao] = await Promise.all([
          listarBranches(owner, nome),
          branchPadrao(owner, nome).catch(() => ""),
        ]);
        return { status: 200, corpo: { branches, branchPadrao: padrao } };
      } catch (err) {
        console.error("[repos] falha ao ler branches:", err);
        return {
          status: 502,
          corpo: {
            error: err instanceof Error ? err.message : "Falha ao consultar o GitHub.",
          },
        };
      }
    });
  }

  // Sem token não há lista da conta, mas a importação manual continua valendo.
  if (!podeListar()) {
    return Response.json({ configurado: true, repos: [], somentePublicos: true });
  }

  return fluxoComPing(async () => {
    try {
      return { status: 200, corpo: { configurado: true, repos: await listarRepos() } };
    } catch (err) {
      const morto = /inválido ou expirado/i.test(err instanceof Error ? err.message : "");
      console.error("[repos] falha ao listar a conta:", err);
      return {
        status: 200,
        corpo: {
          configurado: true,
          repos: [],
          somentePublicos: morto,
          aviso: err instanceof Error ? err.message : "Não foi possível listar os repositórios.",
        },
      };
    }
  });
}

/** Importa um repositório como documento de contexto. */
export async function POST(req: Request) {
  if (!githubConfigurado()) {
    return Response.json(
      { error: "O acesso ao GitHub não está configurado. Fale com o administrador." },
      { status: 503 },
    );
  }

  let body: { repo?: string; branch?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const [owner, nome] = String(body.repo ?? "").split("/");
  const branch = String(body.branch ?? "").trim();

  if (!owner || !nome || !branch) {
    return Response.json({ error: "Informe repositório e branch." }, { status: 400 });
  }

  return fluxoComPing(async () => {
    try {
      const pacote = await montarPacoteRepo(owner, nome, branch);

      // O nome carrega o commit: reimportar a mesma versão reaproveita o cache.
      const documento = await criarDocumentoTexto(pacote.chave, pacote.texto, {
        repoBranch: pacote.branch,
        repoCommit: pacote.commit,
        resumoEstrutura: `${pacote.arquivosIncluidos} de ${pacote.arquivosTotais} arquivos · branch ${pacote.branch}`,
        aviso:
          pacote.arquivosIncluidos < pacote.arquivosTotais
            ? "Dependências, binários e arquivos gerados ficaram de fora. A estrutura completa está incluída como mapa."
            : undefined,
      });

      return { status: 200, corpo: { documento } };
    } catch (err) {
      console.error("[repos] falha ao importar:", err);
      return {
        status: 502,
        corpo: {
          error: err instanceof Error ? err.message : "Não foi possível importar o repositório.",
        },
      };
    }
  });
}
