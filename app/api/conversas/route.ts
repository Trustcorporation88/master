import { lerConversa, listarConversas, removerConversa } from "@/lib/conversas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conversas gravadas.
 *
 * `GET` sem parâmetro lista; com `?id=` devolve a conversa inteira, que é o que
 * a interface usa para reabrir uma análise antiga com as respostas, as fontes e
 * as ressalvas no lugar.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");

  try {
    if (id) {
      const conversa = await lerConversa(id);
      if (!conversa) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
      return Response.json({ conversa }, { headers: { "cache-control": "no-store" } });
    }

    return Response.json(
      { conversas: await listarConversas() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[conversas] falha ao ler:", err);
    return Response.json({ error: "Não foi possível carregar as conversas." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Informe a conversa." }, { status: 400 });

  try {
    await removerConversa(id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[conversas] falha ao remover:", err);
    return Response.json({ error: "Não foi possível remover." }, { status: 500 });
  }
}
