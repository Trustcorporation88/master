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

/** Lista os repositórios disponíveis, ou as branches de um deles. */
export async function GET(req: Request) {
  if (!githubConfigurado()) {
    return Response.json({ configurado: false, repos: [] });
  }

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");

  try {
    // Com ?repo=owner/nome devolve as branches daquele repositório.
    if (repo) {
      const [owner, nome] = repo.split("/");
      if (!owner || !nome) {
        return Response.json({ error: "Repositório inválido." }, { status: 400 });
      }
      // A branch padrão vem junto: sem ela, um repositório digitado à mão
      // ficaria sem branch selecionada e o botão de importar morto.
      const [branches, padrao] = await Promise.all([
        listarBranches(owner, nome),
        branchPadrao(owner, nome).catch(() => ""),
      ]);
      return Response.json({ branches, branchPadrao: padrao });
    }

    // Sem token não há lista da conta, mas a importação manual continua valendo.
    if (!podeListar()) {
      return Response.json({ configurado: true, repos: [], somentePublicos: true });
    }

    return Response.json({ configurado: true, repos: await listarRepos() });
  } catch (err) {
    console.error("[repos] falha ao listar:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Falha ao consultar o GitHub." },
      { status: 502 },
    );
  }
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

  try {
    const pacote = await montarPacoteRepo(owner, nome, branch);

    // O nome carrega o commit: reimportar a mesma versão reaproveita o cache.
    const documento = await criarDocumentoTexto(pacote.chave, pacote.texto, {
      resumoEstrutura: `${pacote.arquivosIncluidos} de ${pacote.arquivosTotais} arquivos · branch ${pacote.branch}`,
      aviso:
        pacote.arquivosIncluidos < pacote.arquivosTotais
          ? "Dependências, binários e arquivos gerados ficaram de fora. A estrutura completa está incluída como mapa."
          : undefined,
    });

    return Response.json({ documento });
  } catch (err) {
    console.error("[repos] falha ao importar:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Não foi possível importar o repositório." },
      { status: 502 },
    );
  }
}
