import { COOKIE, criarSessao, senhaCorreta, travaAtiva } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Troca a senha correta por um cookie de sessão assinado. */
export async function POST(req: Request) {
  if (!travaAtiva()) {
    return Response.json({ ok: true, aviso: "Nenhuma senha configurada." });
  }

  let body: { senha?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Requisição inválida." }, { status: 400 });
  }

  const senha = body.senha ?? "";

  // Atraso pequeno e fixo: encarece tentativa em massa sem punir o uso normal.
  await new Promise((r) => setTimeout(r, 400));

  if (!senhaCorreta(senha)) {
    return Response.json({ ok: false, error: "Senha incorreta." }, { status: 401 });
  }

  const sessao = await criarSessao();
  if (!sessao) {
    return Response.json({ ok: false, error: "Falha ao criar a sessão." }, { status: 500 });
  }

  const res = Response.json({ ok: true });
  res.headers.append(
    "set-cookie",
    [
      `${COOKIE}=${sessao.valor}`,
      "Path=/",
      `Max-Age=${sessao.maxAge}`,
      "HttpOnly",
      "SameSite=Lax",
      // Em produção o site é servido por HTTPS; em localhost o Secure impediria
      // o cookie de ser aceito.
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );

  return res;
}

/** Encerra a sessão. */
export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return res;
}
