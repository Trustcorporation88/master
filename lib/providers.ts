/**
 * Camada unificada de providers.
 *
 * Substitui o modelo do Mysti (spawn de CLIs locais + parsing de stdout) por
 * chamadas HTTP diretas às APIs, mantendo uma interface única de streaming.
 *
 * Regra de ouro deste arquivo: a chave de API entra como argumento, é usada na
 * requisição e nunca é logada, persistida ou devolvida ao cliente.
 */

export type ProviderId = "anthropic" | "openai" | "deepseek";

export const PROVIDERS: Record<
  ProviderId,
  { label: string; baseUrl: string; docsKeyUrl: string; accent: string }
> = {
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    docsKeyUrl: "https://console.anthropic.com/settings/keys",
    accent: "#d97757",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com",
    docsKeyUrl: "https://platform.openai.com/api-keys",
    accent: "#10a37f",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    docsKeyUrl: "https://platform.deepseek.com/api_keys",
    accent: "#4d6bfe",
  },
};

/**
 * Endpoint efetivo do provedor.
 *
 * Permite apontar para um proxy corporativo, um gateway compatível ou um
 * servidor de teste, via ANTHROPIC_BASE_URL / OPENAI_BASE_URL / DEEPSEEK_BASE_URL.
 * Só é lido no servidor — o cliente nunca precisa saber o endpoint real.
 */
function baseUrlOf(provider: ProviderId): string {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const custom = env?.[`${provider.toUpperCase()}_BASE_URL`];
  return (custom?.trim() || PROVIDERS[provider].baseUrl).replace(/\/+$/, "");
}

/** Modelos usados quando a listagem dinâmica falha. Sempre editáveis na UI. */
export const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  anthropic: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-5.1", "gpt-5", "gpt-4.1"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

export type Usage = { inputTokens: number; outputTokens: number };

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "usage"; usage: Usage };

export type ChatRequest = {
  provider: ProviderId;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

class ProviderError extends Error {
  constructor(
    public provider: ProviderId,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Mensagens de erro legíveis, sem nunca ecoar a chave de volta. */
function humanizeError(provider: ProviderId, status: number, body: string): string {
  const label = PROVIDERS[provider].label;
  let detail = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message ?? parsed?.message ?? detail;
  } catch {
    /* corpo não é JSON, mantém o texto cru truncado */
  }
  if (status === 401 || status === 403) {
    return `${label}: chave de API inválida ou sem permissão para este modelo.`;
  }
  if (status === 402) return `${label}: saldo insuficiente na conta.`;
  if (status === 404) return `${label}: modelo não encontrado. Escolha outro na configuração.`;
  if (status === 429) return `${label}: limite de requisições atingido (rate limit). Tente de novo em instantes.`;
  if (status >= 500) return `${label}: instabilidade no servidor do provedor (${status}).`;
  return `${label} (${status}): ${detail}`;
}

/* ------------------------------------------------------------------ */
/* Listagem de modelos — evita depender de IDs hardcoded              */
/* ------------------------------------------------------------------ */

/**
 * Lista os modelos disponíveis para a chave informada.
 * Serve também como validação da chave: se autenticar, a chave é boa.
 */
export async function listModels(
  provider: ProviderId,
  apiKey: string,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const baseUrl = baseUrlOf(provider);
  const headers: Record<string, string> =
    provider === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${apiKey}` };

  try {
    const res = await fetch(`${baseUrl}/v1/models`, { headers });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: humanizeError(provider, res.status, body) };
    }
    const parsed = JSON.parse(body);
    const raw: unknown[] = parsed?.data ?? [];
    const models = raw
      .map((m) => (m as { id?: string })?.id)
      .filter((id): id is string => typeof id === "string");

    const filtered = filterChatModels(provider, models);
    return { ok: true, models: filtered.length ? filtered : FALLBACK_MODELS[provider] };
  } catch (err) {
    return {
      ok: false,
      error: `${PROVIDERS[provider].label}: falha de rede ao contatar a API (${
        err instanceof Error ? err.message : "erro desconhecido"
      }).`,
    };
  }
}

/** Remove modelos que não servem para chat (embeddings, áudio, imagem...). */
function filterChatModels(provider: ProviderId, models: string[]): string[] {
  const noise = /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|search|rerank|codex-mini/i;
  const keep =
    provider === "anthropic"
      ? (id: string) => id.startsWith("claude")
      : provider === "openai"
        ? (id: string) => /^(gpt|o\d)/i.test(id)
        : (id: string) => id.startsWith("deepseek");

  return models
    .filter((id) => keep(id) && !noise.test(id))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}

/* ------------------------------------------------------------------ */
/* Chat com streaming                                                  */
/* ------------------------------------------------------------------ */

/** Lê um corpo SSE linha a linha e entrega cada payload `data:`. */
async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Faz uma chamada de chat com streaming, normalizando as três APIs.
 * Emite chunks de texto conforme chegam e, ao final, o uso de tokens.
 */
export async function* streamChat(req: ChatRequest): AsyncGenerator<StreamChunk> {
  const { provider, apiKey, model, system, prompt } = req;
  const maxTokens = req.maxTokens ?? 4096;
  const baseUrl = baseUrlOf(provider);

  const isAnthropic = provider === "anthropic";
  const url = isAnthropic ? `${baseUrl}/v1/messages` : `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = isAnthropic
    ? {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }
    : {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      };

  const body = isAnthropic
    ? {
        model,
        max_tokens: maxTokens,
        stream: true,
        system,
        messages: [{ role: "user", content: prompt }],
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }
    : {
        model,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(provider, res.status, humanizeError(provider, res.status, text));
  }

  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  for await (const payload of sseLines(res.body)) {
    if (payload === "[DONE]") break;

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue; // keep-alives e fragmentos não-JSON
    }

    if (isAnthropic) {
      const type = evt.type as string;

      if (type === "content_block_delta") {
        const delta = evt.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === "text_delta" && delta.text) {
          yield { type: "text", text: delta.text };
        }
      } else if (type === "message_start") {
        const u = (evt.message as { usage?: Record<string, number> })?.usage;
        if (u) {
          usage.inputTokens =
            (u.input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0);
        }
      } else if (type === "message_delta") {
        const u = (evt.usage ?? {}) as Record<string, number>;
        if (u.output_tokens) usage.outputTokens = u.output_tokens;
      } else if (type === "error") {
        const msg = (evt.error as { message?: string })?.message ?? "erro no stream";
        throw new ProviderError(provider, 500, `${PROVIDERS[provider].label}: ${msg}`);
      }
    } else {
      // OpenAI e DeepSeek compartilham o formato chat.completions
      const choice = (evt.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const delta = choice?.delta as
        | { content?: string; reasoning_content?: string }
        | undefined;

      // DeepSeek reasoner emite reasoning_content antes da resposta final;
      // interessa só o conteúdo visível.
      if (delta?.content) yield { type: "text", text: delta.content };

      const u = evt.usage as Record<string, number> | undefined;
      if (u) {
        usage.inputTokens = u.prompt_tokens ?? usage.inputTokens;
        usage.outputTokens = u.completion_tokens ?? usage.outputTokens;
      }
    }
  }

  yield { type: "usage", usage };
}

/* ------------------------------------------------------------------ */
/* Leitura de imagem (usada no reconhecimento de documento digitalizado) */
/* ------------------------------------------------------------------ */

export type VisionRequest = {
  provider: ProviderId;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  /** Imagens com o tipo real: um JPEG rotulado como PNG é recusado pela API. */
  imagens: Array<{ dados: Buffer; mime: string }>;
  maxTokens?: number;
  signal?: AbortSignal;
};

/**
 * Envia imagens e devolve o texto lido.
 *
 * Sem streaming de propósito: o resultado é consumido inteiro pelo processo de
 * extração, não exibido ao usuário palavra por palavra.
 */
export async function readImages(req: VisionRequest): Promise<{ text: string; usage: Usage }> {
  const { provider, apiKey, model, system, prompt, imagens } = req;
  const baseUrl = baseUrlOf(provider);
  const isAnthropic = provider === "anthropic";

  const url = isAnthropic ? `${baseUrl}/v1/messages` : `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = isAnthropic
    ? { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", authorization: `Bearer ${apiKey}` };

  const body = isAnthropic
    ? {
        model,
        max_tokens: req.maxTokens ?? 8192,
        system,
        messages: [
          {
            role: "user",
            content: [
              ...imagens.map((img) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: img.mime,
                  data: img.dados.toString("base64"),
                },
              })),
              { type: "text", text: prompt },
            ],
          },
        ],
      }
    : {
        model,
        max_tokens: req.maxTokens ?? 8192,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              ...imagens.map((img) => ({
                type: "image_url",
                image_url: { url: `data:${img.mime};base64,${img.dados.toString("base64")}` },
              })),
              { type: "text", text: prompt },
            ],
          },
        ],
      };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new ProviderError(provider, res.status, humanizeError(provider, res.status, texto));
  }

  const j = await res.json();

  const text = isAnthropic
    ? ((j.content as Array<{ type: string; text?: string }>) ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
    : (j.choices?.[0]?.message?.content ?? "");

  const u = (isAnthropic ? j.usage : j.usage) ?? {};
  const usage: Usage = isAnthropic
    ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 }
    : { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 };

  return { text: String(text), usage };
}

/** Versão que acumula tudo — usada em fases internas sem streaming na UI. */
export async function completeChat(req: ChatRequest): Promise<{ text: string; usage: Usage }> {
  let text = "";
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for await (const chunk of streamChat(req)) {
    if (chunk.type === "text") text += chunk.text;
    else usage = chunk.usage;
  }
  return { text, usage };
}
