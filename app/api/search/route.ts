import { SEARCH_PROVIDERS, validarChaveBusca, type SearchProviderId } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Valida uma chave de busca fazendo uma consulta trivial.
 * A chave chega no corpo e é descartada ao fim da requisição.
 */
export async function POST(req: Request) {
  let body: { provider?: string; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
  }

  const provider = body.provider as SearchProviderId;
  const apiKey = body.apiKey?.trim();

  if (!provider || !(provider in SEARCH_PROVIDERS)) {
    return Response.json({ ok: false, error: "Provedor de busca desconhecido." }, { status: 400 });
  }
  if (!apiKey) {
    return Response.json({ ok: false, error: "Chave de busca vazia." }, { status: 400 });
  }

  const result = await validarChaveBusca(provider, apiKey);
  return Response.json(result, {
    status: result.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  });
}
