/**
 * Leitura de repositórios do GitHub.
 *
 * Um repositório não é um documento: é uma árvore com centenas de arquivos, dos
 * quais a maioria não interessa à pergunta (dependências, build, binários). Por
 * isso o que se monta aqui é um **pacote de contexto**: a árvore de diretórios
 * como mapa, mais o conteúdo dos arquivos de código e documentação, filtrados e
 * ordenados por relevância provável.
 *
 * O pacote depois passa pelo mesmo recorte por relevância dos documentos, então
 * o custo de uma pergunta sobre um repositório grande fica no mesmo patamar de
 * uma pergunta sobre um PDF longo.
 *
 * Só servidor.
 */

const API = "https://api.github.com";

/**
 * Token limpo, como o GitHub espera.
 *
 * No Railway é comum colar o valor com aspas, quebra de linha ou o prefixo
 * "Bearer "/"token " junto. Qualquer um desses produz 401 "Bad credentials"
 * — e um token inválido é pior do que token nenhum: o GitHub recusa até
 * repositório público, que sem Authorization seria lido normalmente.
 */
function tokenBruto(): string | undefined {
  let t = process.env.GITHUB_TOKEN?.trim();
  if (!t) return undefined;
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/^(Bearer|token)\s+/i, "").replace(/\s+/g, "");
  return t || undefined;
}

/** Token efetivo: some depois de um 401, para não repetir credencial ruim. */
let tokenRejeitado = false;

function tokenGithub(): string | undefined {
  if (tokenRejeitado) return undefined;
  return tokenBruto();
}

function listaExplicita(): string[] {
  return (process.env.GITHUB_REPOS?.trim() ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.includes("/"));
}

/** Pastas que nunca entram: geradas, instaladas ou irrelevantes. */
const PASTAS_IGNORADAS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "target", "vendor",
  "__pycache__", ".venv", "venv", "coverage", ".turbo", ".cache", "tmp",
  ".idea", ".vscode", "Pods", "DerivedData", ".gradle", "bin", "obj",
]);

/** Arquivos que ocupam muito e informam pouco. */
const ARQUIVOS_IGNORADOS = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "poetry.lock", "Cargo.lock", "composer.lock", "Gemfile.lock",
  "go.sum", "flake.lock",
]);

/** Extensões binárias ou de mídia: não há texto a analisar. */
const EXTENSOES_BINARIAS = new Set([
  "png","jpg","jpeg","gif","webp","svg","ico","bmp","tiff","avif",
  "pdf","zip","tar","gz","bz2","7z","rar","jar","war",
  "mp3","mp4","wav","avi","mov","mkv","webm","flac","ogg",
  "woff","woff2","ttf","otf","eot",
  "exe","dll","so","dylib","bin","dat","db","sqlite","pyc","class","o","a",
  "psd","ai","sketch","fig","xcuserstate",
]);

/**
 * Peso por tipo de arquivo.
 *
 * Código e documentação primeiro; configuração depois. Isso importa quando o
 * repositório não cabe inteiro: o que sobrevive ao corte deve ser o que
 * explica o sistema.
 */
const PRIORIDADE: Array<{ teste: RegExp; peso: number }> = [
  { teste: /^readme(\.md)?$/i, peso: 100 },
  { teste: /\.(md|mdx|rst|txt)$/i, peso: 40 },
  { teste: /\.(ts|tsx|js|jsx|mjs|cjs)$/i, peso: 30 },
  { teste: /\.(py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|ex|exs|scala|dart)$/i, peso: 30 },
  { teste: /\.(sql|prisma|graphql)$/i, peso: 25 },
  { teste: /\.(json|ya?ml|toml|ini|env\.example)$/i, peso: 12 },
  { teste: /\.(css|scss|sass|less|html)$/i, peso: 10 },
];

const TAMANHO_MAX_ARQUIVO = 120_000; // bytes; acima disso é gerado ou dado
const MAX_ARQUIVOS = 120;
const ORCAMENTO_PACOTE = 400_000; // caracteres; o recorte por relevância corta depois

/**
 * A funcionalidade está disponível?
 *
 * Com token, lê repositórios privados e lista os do usuário. Sem token, ainda
 * dá para importar repositório público informando `owner/nome` — daí a opção
 * GITHUB_PUBLICO, útil para quem só analisa código aberto.
 */
export function githubConfigurado(): boolean {
  return Boolean(tokenBruto()) || process.env.GITHUB_PUBLICO === "true";
}

/** Só com token dá para listar os repositórios da conta. */
export function podeListar(): boolean {
  return Boolean(tokenBruto());
}

/** Erro de credencial ou de permissão — a UI ainda pode oferecer importação manual. */
export function ehErroDeToken(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /token do github|não tem permissão|sso da organização/i.test(err.message);
}

/**
 * Filtro opcional de repositórios.
 *
 * Vazio = todos os que o token enxerga. Existe para permitir restringir depois
 * sem mudar código: o site tem senha compartilhada, então quem entra vê tudo
 * que estiver acessível aqui.
 */
function permitido(nomeCompleto: string): boolean {
  const lista = listaExplicita();
  if (!lista.length) return true;
  return lista.map((s) => s.toLowerCase()).includes(nomeCompleto.toLowerCase());
}

function erroGithub(status: number, corpo: string): Error {
  let msg = "";
  try {
    msg = String((JSON.parse(corpo) as { message?: string }).message ?? "");
  } catch {
    msg = corpo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  }

  if (status === 401) return new Error("Token do GitHub inválido ou expirado.");
  if (status === 403 && /rate limit|secondary rate/i.test(corpo)) {
    return new Error("Limite de requisições do GitHub atingido. Tente em alguns minutos.");
  }
  if (status === 403 && /saml/i.test(corpo)) {
    return new Error("O token precisa ser autorizado no SSO da organização GitHub.");
  }
  if (status === 403 && /not accessible by personal access token/i.test(msg)) {
    return new Error(
      "O token não tem permissão para esta operação. Para ler o repositório, conceda Contents: Read. Para listar a conta, defina GITHUB_REPOS (dono/nome) ou conceda Metadata.",
    );
  }
  if (status === 403) return new Error("O token não tem permissão para este repositório.");
  if (status === 404) return new Error("Repositório, branch ou arquivo não encontrado.");
  if (status === 422) {
    return new Error("O GitHub recusou a operação (branch já existe, ou nada mudou).");
  }
  return new Error(msg ? `GitHub: ${msg}` : `GitHub respondeu ${status}.`);
}

async function api<T>(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown } = {},
): Promise<T> {
  const token = tokenGithub();
  const base = (process.env.GITHUB_BASE_URL?.trim() || API).replace(/\/+$/, "");

  // Sem token ainda dá para ler repositório público; listar os do usuário, não.
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "master-analise",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opcoes.corpo) headers["content-type"] = "application/json";

  const res = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? "GET",
    headers,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });

  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    // Token inválido recusa até o que é público. Para leitura, tenta de novo
    // sem Authorization — e esquece o token pelo resto do processo.
    const leitura = (opcoes.metodo ?? "GET") === "GET" && !opcoes.corpo;
    if (res.status === 401 && token && leitura) {
      tokenRejeitado = true;
      console.error("[github] token recusado (401); seguindo sem autenticação para leitura pública");
      return api<T>(caminho, opcoes);
    }
    throw erroGithub(res.status, corpo);
  }

  const texto = await res.text();
  if (!texto) return {} as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error("O GitHub devolveu uma resposta que não pôde ser lida.");
  }
}

/* ------------------------------------------------------------------ */
/* Listagens                                                           */
/* ------------------------------------------------------------------ */

export type RepoResumo = {
  nomeCompleto: string;
  privado: boolean;
  branchPadrao: string;
  atualizadoEm: string;
  descricao?: string;
};

type RepoApi = {
  full_name: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
  description: string | null;
};

function resumoDe(r: RepoApi): RepoResumo {
  return {
    nomeCompleto: r.full_name,
    privado: r.private,
    branchPadrao: r.default_branch,
    atualizadoEm: r.updated_at,
    descricao: r.description ?? undefined,
  };
}

/**
 * Token fine-grained limitado a repositórios escolhidos costuma falhar em
 * `/user/repos` (precisa de Metadata na conta inteira). Quando GITHUB_REPOS
 * está definido, cada um é lido em `/repos/dono/nome`, que é o endpoint que
 * Contents: Read alcança.
 */
export async function listarRepos(): Promise<RepoResumo[]> {
  const explicitos = listaExplicita();
  if (explicitos.length) {
    const out: RepoResumo[] = [];
    for (const nome of explicitos) {
      const [owner, repo] = nome.split("/");
      if (!owner || !repo) continue;
      try {
        out.push(resumoDe(await api<RepoApi>(`/repos/${owner}/${repo}`)));
      } catch (err) {
        console.error(`[github] não foi possível ler ${nome}:`, err instanceof Error ? err.message : err);
      }
    }
    return out;
  }

  const paginas = 3; // até 300 repositórios, ordenados por atividade recente
  const todos: RepoResumo[] = [];

  for (let p = 1; p <= paginas; p++) {
    const lote = await api<RepoApi[]>(
      `/user/repos?per_page=100&page=${p}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );

    todos.push(...lote.map(resumoDe));
    if (lote.length < 100) break;
  }

  return todos.filter((r) => permitido(r.nomeCompleto));
}

/** Branch padrão do repositório, para pré-selecionar sem o usuário adivinhar. */
export async function branchPadrao(owner: string, repo: string): Promise<string> {
  const info = await api<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  return info.default_branch;
}

export async function listarBranches(owner: string, repo: string): Promise<string[]> {
  const lote = await api<Array<{ name: string }>>(
    `/repos/${owner}/${repo}/branches?per_page=100`,
  );
  return lote.map((b) => b.name);
}

/* ------------------------------------------------------------------ */
/* Montagem do pacote                                                  */
/* ------------------------------------------------------------------ */

type ItemArvore = { path: string; type: string; sha: string; size?: number };

function ignorar(caminho: string, tamanho?: number): boolean {
  const partes = caminho.split("/");
  if (partes.some((p) => PASTAS_IGNORADAS.has(p))) return true;

  const nome = partes[partes.length - 1];
  if (ARQUIVOS_IGNORADOS.has(nome)) return true;
  if (nome.startsWith(".") && !/^\.(env\.example|gitignore|nvmrc)$/.test(nome)) return true;

  const ext = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  if (EXTENSOES_BINARIAS.has(ext)) return true;

  if (tamanho !== undefined && tamanho > TAMANHO_MAX_ARQUIVO) return true;

  return false;
}

function peso(caminho: string): number {
  const nome = caminho.split("/").pop() ?? "";
  for (const p of PRIORIDADE) if (p.teste.test(nome)) return p.peso;
  return 5;
}

/**
 * Conteúdo de um blob.
 *
 * A API Git (`/git/blobs`) é a via rápida. Se o token fine-grained recusar
 * (Contents às vezes libera `/contents` e não o banco git), cai na API de
 * contents, que é a mesma permissão documentada no GitHub.
 */
async function lerArquivo(
  owner: string,
  repo: string,
  arq: ItemArvore,
): Promise<string | null> {
  try {
    const blob = await api<{ content?: string; encoding?: string }>(
      `/repos/${owner}/${repo}/git/blobs/${arq.sha}`,
    );
    if (blob.encoding === "base64" && blob.content) {
      return Buffer.from(blob.content, "base64").toString("utf-8");
    }
  } catch {
    /* tenta contents abaixo */
  }

  const caminho = arq.path.split("/").map(encodeURIComponent).join("/");
  const info = await api<{ content?: string; encoding?: string }>(
    `/repos/${owner}/${repo}/contents/${caminho}`,
  );
  if (info.encoding === "base64" && info.content) {
    return Buffer.from(info.content, "base64").toString("utf-8");
  }
  return null;
}

export type PacoteRepo = {
  /** Identificação estável: muda quando o commit muda. */
  chave: string;
  nomeCompleto: string;
  branch: string;
  commit: string;
  texto: string;
  arquivosIncluidos: number;
  arquivosTotais: number;
};

/** Monta o pacote de contexto de um repositório numa branch. */
export async function montarPacoteRepo(
  owner: string,
  repo: string,
  branch: string,
): Promise<PacoteRepo> {
  const nomeCompleto = `${owner}/${repo}`;
  if (!permitido(nomeCompleto)) throw new Error("Repositório não disponível.");

  const info = await api<{ commit: { sha: string } }>(
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
  );
  const commit = info.commit.sha;

  const arvore = await api<{ tree: ItemArvore[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`,
  );

  const arquivos = arvore.tree.filter((i) => i.type === "blob");
  const candidatos = arquivos
    .filter((i) => !ignorar(i.path, i.size))
    .sort((a, b) => peso(b.path) - peso(a.path) || (a.size ?? 0) - (b.size ?? 0))
    .slice(0, MAX_ARQUIVOS);

  // Mapa do repositório: barato em tokens e muito útil para o modelo se situar.
  const partes: string[] = [
    `# Repositório ${nomeCompleto}`,
    "",
    `Branch: ${branch} · commit ${commit.slice(0, 7)}`,
    `Arquivos no repositório: ${arquivos.length}`,
    "",
    "## Estrutura",
    "",
    "```",
    ...arquivos
      .filter((i) => !i.path.split("/").some((p) => PASTAS_IGNORADAS.has(p)))
      .map((i) => i.path)
      .slice(0, 600),
    "```",
    "",
    "## Arquivos",
    "",
  ];

  let usado = partes.join("\n").length;
  let incluidos = 0;

  // Lotes pequenos: um arquivo por vez deixava a importação calada por minutos
  // (e a borda da rede cortava com HTML, que o cliente lia como "token").
  const CONCORRENCIA = 8;
  for (let i = 0; i < candidatos.length && usado < ORCAMENTO_PACOTE; i += CONCORRENCIA) {
    const lote = candidatos.slice(i, i + CONCORRENCIA);
    const lidos = await Promise.all(
      lote.map(async (arq) => {
        try {
          return await lerArquivo(owner, repo, arq);
        } catch (err) {
          console.error(`[github] falha ao ler ${arq.path}:`, err instanceof Error ? err.message : err);
          return null;
        }
      }),
    );

    for (let j = 0; j < lidos.length; j++) {
      const conteudo = lidos[j];
      if (conteudo == null) continue;
      if (conteudo.includes("\0")) continue;
      const bloco = `### ${lote[j].path}\n\n\`\`\`\n${conteudo}\n\`\`\`\n`;
      if (usado + bloco.length > ORCAMENTO_PACOTE) continue;
      partes.push(bloco);
      usado += bloco.length;
      incluidos++;
    }
  }

  return {
    chave: `${nomeCompleto}@${commit.slice(0, 7)}`,
    nomeCompleto,
    branch,
    commit,
    texto: partes.join("\n"),
    arquivosIncluidos: incluidos,
    arquivosTotais: arquivos.length,
  };
}

/* ------------------------------------------------------------------ */
/* Escrita: branch, commit e pull request                              */
/* ------------------------------------------------------------------ */

/**
 * Caminhos que o sistema nunca escreve.
 *
 * `.github/workflows` é a trava mais importante: alterar um workflow é
 * execução de código no CI, com acesso aos segredos do repositório. Uma
 * proposta gerada por IA jamais deve poder fazer isso sozinha.
 */
const CAMINHOS_BLOQUEADOS: Array<{ teste: RegExp; motivo: string }> = [
  { teste: /^\.github\/workflows\//i, motivo: "workflows de CI executam código com acesso a segredos" },
  { teste: /(^|\/)\.env($|\.)(?!example)/i, motivo: "arquivos de ambiente guardam credenciais" },
  { teste: /(^|\/)\.git\//i, motivo: "diretório interno do git" },
  { teste: /\.\./, motivo: "caminho relativo para fora do repositório" },
  { teste: /^\//, motivo: "caminho absoluto" },
];

export const MAX_ARQUIVOS_PR = 10;
export const MAX_BYTES_ARQUIVO_PR = 100_000;

export function validarCaminho(caminho: string): string | null {
  const limpo = caminho.trim();
  if (!limpo) return "caminho vazio";
  for (const b of CAMINHOS_BLOQUEADOS) {
    if (b.teste.test(limpo)) return b.motivo;
  }
  return null;
}

/** O repositório tem workflow que roda em pull request? */
export async function temValidacaoDePr(owner: string, repo: string): Promise<boolean> {
  try {
    const itens = await api<Array<{ name: string; path: string }>>(
      `/repos/${owner}/${repo}/contents/.github/workflows`,
    );

    for (const item of itens.slice(0, 10)) {
      const arq = await api<{ content?: string; encoding?: string }>(
        `/repos/${owner}/${repo}/contents/${item.path}`,
      );
      if (arq.encoding !== "base64" || !arq.content) continue;
      const yaml = Buffer.from(arq.content, "base64").toString("utf-8");
      // Basta o gatilho de pull_request para haver checagem antes do merge.
      if (/^\s*(on:.*pull_request|\s+pull_request:)/m.test(yaml)) return true;
    }
  } catch {
    // Sem pasta de workflows, não há validação.
  }
  return false;
}

export type ArquivoProposto = { caminho: string; conteudo: string };

export type ResultadoPr = {
  url: string;
  numero: number;
  branch: string;
};

/**
 * Cria uma branch, grava os arquivos e abre um pull request.
 *
 * Nunca escreve na branch base: toda alteração chega como PR, revisável e
 * reversível com um clique.
 */
export async function abrirPullRequest(args: {
  owner: string;
  repo: string;
  base: string;
  titulo: string;
  descricao: string;
  arquivos: ArquivoProposto[];
}): Promise<ResultadoPr> {
  const { owner, repo, base, titulo, descricao, arquivos } = args;

  if (!arquivos.length) throw new Error("Nenhuma alteração proposta.");
  if (arquivos.length > MAX_ARQUIVOS_PR) {
    throw new Error(`A proposta altera ${arquivos.length} arquivos; o limite é ${MAX_ARQUIVOS_PR}.`);
  }

  for (const a of arquivos) {
    const problema = validarCaminho(a.caminho);
    if (problema) throw new Error(`Caminho recusado (${a.caminho}): ${problema}.`);
    if (Buffer.byteLength(a.conteudo, "utf-8") > MAX_BYTES_ARQUIVO_PR) {
      throw new Error(`Arquivo grande demais para a proposta: ${a.caminho}.`);
    }
  }

  // Ponto de partida: o topo da branch base.
  const ref = await api<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  const shaBase = ref.object.sha;

  const branch = `analise/${Date.now().toString(36)}`;
  await api(`/repos/${owner}/${repo}/git/refs`, {
    metodo: "POST",
    corpo: { ref: `refs/heads/${branch}`, sha: shaBase },
  });

  for (const arq of arquivos) {
    // Arquivo existente exige o sha da versão anterior; novo, não.
    let shaAtual: string | undefined;
    try {
      const atual = await api<{ sha?: string }>(
        `/repos/${owner}/${repo}/contents/${arq.caminho}?ref=${encodeURIComponent(base)}`,
      );
      shaAtual = atual.sha;
    } catch {
      shaAtual = undefined;
    }

    await api(`/repos/${owner}/${repo}/contents/${arq.caminho}`, {
      metodo: "PUT",
      corpo: {
        message: `${titulo} — ${arq.caminho}`,
        content: Buffer.from(arq.conteudo, "utf-8").toString("base64"),
        branch,
        ...(shaAtual ? { sha: shaAtual } : {}),
      },
    });
  }

  const pr = await api<{ html_url: string; number: number }>(
    `/repos/${owner}/${repo}/pulls`,
    { metodo: "POST", corpo: { title: titulo, head: branch, base, body: descricao } },
  );

  return { url: pr.html_url, numero: pr.number, branch };
}
