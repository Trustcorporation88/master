/**
 * Camada de busca web.
 *
 * O servidor pesquisa UMA vez e o resultado é entregue igual para os três
 * agentes. Isso é deliberado: se cada agente usasse a busca nativa do seu
 * próprio provedor, cada um veria evidência diferente e o duelo passaria a
 * medir qualidade de ferramenta de busca em vez de qualidade de raciocínio.
 *
 * Como as outras chaves, a chave de busca entra por argumento, é usada na
 * requisição e nunca é logada nem persistida no servidor.
 */

export type SearchProviderId = "brave" | "tavily";

export const SEARCH_PROVIDERS: Record<
  SearchProviderId,
  { label: string; docsKeyUrl: string; custoPorBusca: number; nota: string }
> = {
  brave: {
    label: "Brave Search",
    docsKeyUrl: "https://api-dashboard.search.brave.com/app/keys",
    custoPorBusca: 0.005,
    nota: "Barata, tem plano gratuito. Devolve trechos curtos.",
  },
  tavily: {
    label: "Tavily",
    docsKeyUrl: "https://app.tavily.com/home",
    custoPorBusca: 0.008,
    nota: "Feita para agentes. Devolve conteúdo já extraído, mais longo.",
  },
};

export type Fonte = {
  /** Número da citação no dossiê: [1], [2]... */
  n: number;
  titulo: string;
  url: string;
  trecho: string;
  data?: string;
  /** Consulta que encontrou esta fonte. */
  consulta: string;
};

export type Dossie = {
  consultas: string[];
  fontes: Fonte[];
  /** Quantas buscas foram efetivamente cobradas. */
  buscas: number;
  /** Erros por consulta, quando alguma falhou. */
  erros: string[];
};

const MAX_TRECHO = 1200;
const MAX_FONTES = 12;
const MAX_DOSSIE_CHARS = 18_000;

function humanizar(provider: SearchProviderId, status: number, corpo: string): string {
  const label = SEARCH_PROVIDERS[provider].label;
  if (status === 401 || status === 403) return `${label}: chave de busca inválida.`;
  if (status === 429) return `${label}: limite de requisições atingido.`;
  if (status === 402) return `${label}: cota ou saldo esgotado.`;
  if (status >= 500) return `${label}: instabilidade no servidor (${status}).`;

  let detalhe = corpo.slice(0, 200);
  try {
    const j = JSON.parse(corpo);
    detalhe = j?.detail?.error ?? j?.error?.detail ?? j?.error ?? j?.message ?? detalhe;
  } catch {
    /* corpo não-JSON */
  }
  return `${label} (${status}): ${typeof detalhe === "string" ? detalhe : "erro"}`;
}

function baseUrlOf(provider: SearchProviderId): string {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const custom = env?.[`${provider.toUpperCase()}_BASE_URL`];
  const padrao =
    provider === "brave" ? "https://api.search.brave.com" : "https://api.tavily.com";
  return (custom?.trim() || padrao).replace(/\/+$/, "");
}

type ResultadoCru = { titulo: string; url: string; trecho: string; data?: string };

/** Executa uma consulta e devolve resultados normalizados. */
async function buscar(
  provider: SearchProviderId,
  apiKey: string,
  consulta: string,
  maxResultados: number,
  signal?: AbortSignal,
): Promise<ResultadoCru[]> {
  const base = baseUrlOf(provider);

  if (provider === "brave") {
    const url = `${base}/res/v1/web/search?q=${encodeURIComponent(consulta)}&count=${maxResultados}&extra_snippets=1`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey,
      },
      signal,
    });
    const corpo = await res.text();
    if (!res.ok) throw new Error(humanizar(provider, res.status, corpo));

    const j = JSON.parse(corpo);
    const results: unknown[] = j?.web?.results ?? [];
    return results.map((r) => {
      const o = r as {
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
        page_age?: string;
        age?: string;
      };
      const partes = [o.description ?? "", ...(o.extra_snippets ?? [])].filter(Boolean);
      return {
        titulo: o.title ?? "(sem título)",
        url: o.url ?? "",
        trecho: limparHtml(partes.join(" … ")),
        data: o.page_age ?? o.age,
      };
    });
  }

  // Tavily
  const res = await fetch(`${base}/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: consulta,
      max_results: maxResultados,
      search_depth: "basic",
    }),
    signal,
  });
  const corpo = await res.text();
  if (!res.ok) throw new Error(humanizar(provider, res.status, corpo));

  const j = JSON.parse(corpo);
  const results: unknown[] = j?.results ?? [];
  return results.map((r) => {
    const o = r as {
      title?: string;
      url?: string;
      content?: string;
      published_date?: string;
    };
    return {
      titulo: o.title ?? "(sem título)",
      url: o.url ?? "",
      trecho: limparHtml(o.content ?? ""),
      data: o.published_date,
    };
  });
}

/** Remove tags e entidades que a Brave devolve nos trechos. */
function limparHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Valida a chave de busca com uma consulta trivial. */
export async function validarChaveBusca(
  provider: SearchProviderId,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await buscar(provider, apiKey, "teste", 1);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Falha ao validar a chave de busca.",
    };
  }
}

/**
 * Executa as consultas em paralelo e monta o dossiê numerado.
 * Deduplica por URL e respeita tetos de tamanho, porque o dossiê entra no
 * prompt de cada agente — o custo de tokens é multiplicado pelo nº de agentes.
 */
export async function montarDossie(
  provider: SearchProviderId,
  apiKey: string,
  consultas: string[],
  signal?: AbortSignal,
): Promise<Dossie> {
  const alvo = consultas.slice(0, 5);
  const porConsulta = alvo.length <= 2 ? 5 : 4;

  const respostas = await Promise.allSettled(
    alvo.map(async (c) => ({ consulta: c, itens: await buscar(provider, apiKey, c, porConsulta, signal) })),
  );

  const fontes: Fonte[] = [];
  const erros: string[] = [];
  const vistos = new Set<string>();
  let chars = 0;

  for (const r of respostas) {
    if (r.status === "rejected") {
      erros.push(r.reason instanceof Error ? r.reason.message : "consulta falhou");
      continue;
    }
    for (const item of r.value.itens) {
      if (!item.url || vistos.has(item.url) || !item.trecho) continue;
      if (fontes.length >= MAX_FONTES || chars >= MAX_DOSSIE_CHARS) break;

      vistos.add(item.url);
      const trecho = item.trecho.slice(0, MAX_TRECHO);
      chars += trecho.length;

      fontes.push({
        n: fontes.length + 1,
        titulo: item.titulo,
        url: item.url,
        trecho,
        data: item.data,
        consulta: r.value.consulta,
      });
    }
  }

  return {
    consultas: alvo,
    fontes,
    buscas: respostas.filter((r) => r.status === "fulfilled").length,
    erros,
  };
}

/** Formata o dossiê para injeção no prompt dos agentes. */
export function dossieParaPrompt(d: Dossie): string {
  if (!d.fontes.length) return "";

  const blocos = d.fontes.map(
    (f) =>
      `[${f.n}] ${f.titulo}\nURL: ${f.url}${f.data ? `\nData: ${f.data}` : ""}\n${f.trecho}`,
  );

  return `# Dossiê de evidência

Trechos coletados da web para esta pergunta. Consultas usadas: ${d.consultas
    .map((c) => `"${c}"`)
    .join(", ")}.

${blocos.join("\n\n---\n\n")}

## Como usar este dossiê

- Ao afirmar um fato que veio daqui, cite a fonte com \`[n]\`. Exemplo: "o preço subiu 12% [3]".
- Confira a **data** de cada trecho. Informação desatualizada pode estar errada hoje.
- Avalie a **qualidade** da fonte, não só o que ela diz. Um blog anônimo e um documento oficial não têm o mesmo peso, e você deve dizer isso quando importar.
- Se o dossiê **não** cobre parte da pergunta, declare a lacuna explicitamente em vez de preencher com memória apresentada como fato.
- Se um trecho contradiz o que você sabe, exponha a contradição em vez de escolher silenciosamente um dos lados.
- O dossiê pode conter erros ou fontes ruins. Ele é evidência, não veredito.`;
}
