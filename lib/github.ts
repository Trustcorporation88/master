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
  return Boolean(process.env.GITHUB_TOKEN?.trim()) || process.env.GITHUB_PUBLICO === "true";
}

/** Só com token dá para listar os repositórios da conta. */
export function podeListar(): boolean {
  return Boolean(process.env.GITHUB_TOKEN?.trim());
}

/**
 * Filtro opcional de repositórios.
 *
 * Vazio = todos os que o token enxerga. Existe para permitir restringir depois
 * sem mudar código: o site tem senha compartilhada, então quem entra vê tudo
 * que estiver acessível aqui.
 */
function permitido(nomeCompleto: string): boolean {
  const lista = process.env.GITHUB_REPOS?.trim();
  if (!lista) return true;
  return lista
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(nomeCompleto.toLowerCase());
}

async function api<T>(caminho: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const base = process.env.GITHUB_BASE_URL?.trim() || API;

  // Sem token ainda dá para ler repositório público; listar os do usuário, não.
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "master-analise",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${base}${caminho}`, { headers });

  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    // Mensagens de produto: o detalhe técnico fica no log.
    if (res.status === 401) throw new Error("Token do GitHub inválido ou expirado.");
    if (res.status === 403 && corpo.includes("rate limit")) {
      throw new Error("Limite de requisições do GitHub atingido. Tente em alguns minutos.");
    }
    if (res.status === 403) throw new Error("O token não tem permissão para este repositório.");
    if (res.status === 404) throw new Error("Repositório ou branch não encontrado.");
    throw new Error(`GitHub respondeu ${res.status}.`);
  }

  return res.json() as Promise<T>;
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

export async function listarRepos(): Promise<RepoResumo[]> {
  const paginas = 3; // até 300 repositórios, ordenados por atividade recente
  const todos: RepoResumo[] = [];

  for (let p = 1; p <= paginas; p++) {
    const lote = await api<
      Array<{
        full_name: string;
        private: boolean;
        default_branch: string;
        updated_at: string;
        description: string | null;
      }>
    >(`/user/repos?per_page=100&page=${p}&sort=updated&affiliation=owner,collaborator,organization_member`);

    todos.push(
      ...lote.map((r) => ({
        nomeCompleto: r.full_name,
        privado: r.private,
        branchPadrao: r.default_branch,
        atualizadoEm: r.updated_at,
        descricao: r.description ?? undefined,
      })),
    );

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

  // Sequencial de propósito: evita rajada contra o limite de requisições.
  for (const arq of candidatos) {
    if (usado >= ORCAMENTO_PACOTE) break;

    try {
      const blob = await api<{ content: string; encoding: string }>(
        `/repos/${owner}/${repo}/git/blobs/${arq.sha}`,
      );
      if (blob.encoding !== "base64") continue;

      const conteudo = Buffer.from(blob.content, "base64").toString("utf-8");

      // Heurística de binário que escapou pela extensão.
      if (conteudo.includes(" ")) continue;

      const bloco = `### ${arq.path}\n\n\`\`\`\n${conteudo}\n\`\`\`\n`;
      if (usado + bloco.length > ORCAMENTO_PACOTE) continue;

      partes.push(bloco);
      usado += bloco.length;
      incluidos++;
    } catch (err) {
      console.error(`[github] falha ao ler ${arq.path}:`, err instanceof Error ? err.message : err);
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
