import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessaoValida } from "@/lib/auth";

/**
 * Protege o site inteiro, exceto a tela de login e a rota que a atende.
 *
 * As chaves de API ficam no servidor, então uma visita não autenticada gastaria
 * o dinheiro do dono. Sem DUELO_SENHA definida, `sessaoValida` libera tudo —
 * conveniência para desenvolvimento local, nunca para produção.
 */

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};

const LIVRES = ["/login", "/api/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (LIVRES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (await sessaoValida(req.cookies.get(COOKIE)?.value)) {
    return NextResponse.next();
  }

  // Chamadas de API respondem com status; navegação vai para o login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
