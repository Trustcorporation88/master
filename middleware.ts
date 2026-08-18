import { NextResponse, type NextRequest } from "next/server";

/**
 * Trava de acesso do site inteiro, incluindo as rotas de API.
 *
 * Publicar o duelo numa URL aberta não expõe as SUAS chaves — elas ficam no
 * navegador de cada visitante. O problema é outro: sem trava, qualquer pessoa
 * que descubra o endereço usa o seu servidor como ponte para as APIs de IA.
 *
 * A senha vem de DUELO_SENHA. Sem essa variável o site fica aberto, o que só
 * faz sentido rodando em localhost.
 */

export const config = {
  // Deixa passar apenas assets estáticos — todo o resto exige senha.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};

/** Comparação em tempo constante, para não vazar o tamanho da senha. */
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function pedirSenha(): NextResponse {
  return new NextResponse("Acesso restrito.", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="Duelo de Agentes", charset="UTF-8"',
      "cache-control": "no-store",
    },
  });
}

export function middleware(req: NextRequest) {
  const senha = process.env.DUELO_SENHA?.trim();

  // Sem senha configurada, não há trava (uso local).
  if (!senha) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return pedirSenha();

  let decodificado: string;
  try {
    decodificado = atob(header.slice(6).trim());
  } catch {
    return pedirSenha();
  }

  // Aceita qualquer usuário: o que vale é a senha.
  const fornecida = decodificado.slice(decodificado.indexOf(":") + 1);
  if (!iguais(fornecida, senha)) return pedirSenha();

  return NextResponse.next();
}
