import { listModels, PROVIDERS, type ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Valida uma chave e devolve os modelos disponíveis para ela.
 * A chave chega no corpo (nunca na URL, que costuma ser logada) e é descartada
 * ao fim da requisição.
 */
export async function POST(req: Request) {
  let body: { provider?: string; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
  }

  const provider = body.provider as ProviderId;
  const apiKey = body.apiKey?.trim();

  if (!provider || !(provider in PROVIDERS)) {
    return Response.json({ ok: false, error: "Provedor desconhecido." }, { status: 400 });
  }
  if (!apiKey) {
    return Response.json({ ok: false, error: "Chave de API vazia." }, { status: 400 });
  }

  const result = await listModels(provider, apiKey);
  return Response.json(result, {
    status: result.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  });
}
