/**
 * Sessão por cookie assinado.
 *
 * Com as chaves de API no servidor, quem entra no site gasta o dinheiro do
 * dono — a trava deixa de ser conforto e passa a ser controle de custo. Por
 * isso a senha é obrigatória em produção.
 *
 * O cookie guarda apenas um prazo de validade e a assinatura HMAC dele. Não há
 * dado de usuário, e a senha nunca é gravada no cookie. Usa Web Crypto para
 * funcionar tanto no middleware quanto nas rotas.
 */

export const COOKIE = "duelo_sessao";
const DIAS_VALIDADE = 7;

function segredo(): string | null {
  const s = process.env.DUELO_SENHA?.trim();
  return s ? s : null;
}

async function assinar(payload: string, chave: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(chave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparação em tempo constante. */
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Confere a senha informada no login. */
export function senhaCorreta(fornecida: string): boolean {
  const esperada = segredo();
  if (!esperada) return false;
  return iguais(fornecida, esperada);
}

/** Gera o valor do cookie de sessão. */
export async function criarSessao(): Promise<{ valor: string; maxAge: number } | null> {
  const chave = segredo();
  if (!chave) return null;

  const maxAge = DIAS_VALIDADE * 24 * 60 * 60;
  const expira = Date.now() + maxAge * 1000;
  const payload = String(expira);
  const assinatura = await assinar(payload, chave);

  return { valor: `${payload}.${assinatura}`, maxAge };
}

/** Valida o cookie: assinatura correta e prazo não vencido. */
export async function sessaoValida(cookie: string | undefined): Promise<boolean> {
  const chave = segredo();
  if (!chave) return true; // sem senha configurada, não há trava (uso local)
  if (!cookie) return false;

  const ponto = cookie.lastIndexOf(".");
  if (ponto <= 0) return false;

  const payload = cookie.slice(0, ponto);
  const assinatura = cookie.slice(ponto + 1);

  const expira = Number(payload);
  if (!Number.isFinite(expira) || expira < Date.now()) return false;

  return iguais(assinatura, await assinar(payload, chave));
}

/** Há senha configurada neste ambiente? */
export function travaAtiva(): boolean {
  return segredo() !== null;
}
