/**
 * Leitura de URLs citadas na pergunta.
 *
 * Os modelos não saem da API do fornecedor. Quem abre a página é o servidor,
 * no momento da análise, e o texto entra no dossiê como evidência. Sem isso,
 * qualquer pergunta sobre um site vira "não consigo acessar a URL".
 *
 * Só servidor.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Fonte } from "./search";

const TETO_MS = 12_000;
const TETO_BYTES = 1_500_000;
const TETO_TEXTO = 12_000;
const MAX_URLS = 4;
const MAX_REDIRECTS = 5;

export type PaginasLidas = {
  fontes: Fonte[];
  erros: string[];
};

const COM_ESQUEMA = /https?:\/\/[^\s<>"'`)\]]+/gi;
const SEM_ESQUEMA =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:railway\.app|vercel\.app|netlify\.app|github\.io|herokuapp\.com|fly\.dev|[a-z]{2,24})(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/gi;

function limparUrl(bruta: string): string {
  return bruta.replace(/[.,;:!?)\]>'"]+$/g, "").trim();
}

/** URLs explícitas e endereços nus (ex.: foo.up.railway.app) na pergunta. */
export function extrairUrls(pergunta: string): string[] {
  const achadas: string[] = [];
  const vistos = new Set<string>();

  const empilhar = (bruta: string) => {
    const limpa = limparUrl(bruta);
    if (!limpa) return;
    let href = limpa;
    if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
    try {
      const u = new URL(href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      const chave = u.href.replace(/\/$/, "").toLowerCase();
      if (vistos.has(chave)) return;
      vistos.add(chave);
      achadas.push(u.href);
    } catch {
      /* não é URL */
    }
  };

  for (const m of pergunta.matchAll(COM_ESQUEMA)) empilhar(m[0]);
  for (const m of pergunta.matchAll(SEM_ESQUEMA)) {
    const idx = m.index ?? 0;
    if (idx > 0 && pergunta[idx - 1] === "@") continue; // e-mail
    empilhar(m[0]);
  }

  return achadas.slice(0, MAX_URLS);
}

function ipv4De(ip: string): string | null {
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return isIP(ip) === 4 ? ip : null;
}

function ipPrivado(ip: string): boolean {
  const v4 = ipv4De(ip);
  if (v4) {
    const p = v4.split(".").map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true;
  if (low.startsWith("fc") || low.startsWith("fd")) return true;
  if (low.startsWith("fe80")) return true;
  return false;
}

async function destinoPublico(hostname: string): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("endereço local");
  }
  if (isIP(host)) {
    if (ipPrivado(host) && process.env.NODE_ENV === "production") {
      throw new Error("endereço privado");
    }
    return host;
  }
  const regs = await lookup(host, { all: true });
  if (!regs.length) throw new Error("host sem DNS");
  const bloqueado = regs.filter((r) => ipPrivado(r.address));
  if (bloqueado.length === regs.length && process.env.NODE_ENV === "production") {
    throw new Error("resolve para rede privada");
  }
  return host;
}

function htmlParaTexto(html: string): { titulo: string; texto: string } {
  const titulo =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i)?.[1] ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] ||
    "";

  const descricao =
    html.match(/name=["']description["'][^>]*content=["']([^"']+)/i)?.[1] ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i)?.[1] ||
    "";

  let corpo = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");

  corpo = corpo
    .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|section|article|br)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const partes = [descricao, corpo].filter(Boolean).join("\n\n");
  return { titulo: titulo.slice(0, 180), texto: partes.slice(0, TETO_TEXTO) };
}

async function baixar(url: string, signal: AbortSignal): Promise<{
  final: string;
  status: number;
  tipo: string;
  corpo: string;
}> {
  let atual = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(atual);
    await destinoPublico(parsed.hostname);

    const ctrl = AbortSignal.any
      ? AbortSignal.any([signal, AbortSignal.timeout(TETO_MS)])
      : AbortSignal.timeout(TETO_MS);

    const res = await fetch(atual, {
      method: "GET",
      redirect: "manual",
      signal: ctrl,
      headers: {
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "master-analise/1.0 (+leitura de páginas citadas pelo usuário)",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`redirect sem Location (${res.status})`);
      atual = new URL(loc, atual).href;
      continue;
    }

    const tipo = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    const corpo = buf.subarray(0, TETO_BYTES).toString("utf-8");
    return { final: atual, status: res.status, tipo, corpo };
  }

  throw new Error("muitos redirecionamentos");
}

async function lerUma(url: string, signal: AbortSignal): Promise<Omit<Fonte, "n">> {
  const { final, status, tipo, corpo } = await baixar(url, signal);
  let titulo = final;
  let trecho = "";

  if (/html/i.test(tipo) || /^\s*</.test(corpo)) {
    const extraido = htmlParaTexto(corpo);
    titulo = extraido.titulo || titulo;
    trecho = extraido.texto;
    const cascoCliente =
      (trecho.length < 400 && /id=["'](?:root|app|__next)["']/i.test(corpo)) ||
      (trecho.length < 80 && /type=["']module["']/i.test(corpo));
    if (cascoCliente || trecho.length < 80) {
      trecho = [
        `HTTP ${status} · ${tipo || "sem content-type"}.`,
        "A página respondeu, mas quase todo o conteúdo é montado no navegador (aplicativo cliente). O servidor não executa JavaScript — o que segue é o casco HTML, o título e o texto estático.",
        extraido.titulo ? `Título: ${extraido.titulo}.` : "",
        extraido.texto,
      ]
        .filter(Boolean)
        .join(" ");
    }
  } else if (/json/i.test(tipo)) {
    trecho = corpo.slice(0, TETO_TEXTO);
    titulo = `JSON ${new URL(final).pathname}`;
  } else {
    trecho = corpo.replace(/\0/g, "").slice(0, TETO_TEXTO);
  }

  if (!trecho.trim()) {
    trecho = `HTTP ${status}. A URL respondeu, mas sem texto extraível (${tipo || "tipo desconhecido"}).`;
  }

  return {
    titulo: titulo || final,
    url: final,
    trecho: `Lida agora pelo servidor (HTTP ${status}).\n${trecho}`,
    consulta: url,
  };
}

/**
 * Abre as páginas citadas na pergunta. Falha de uma URL não impede as outras.
 */
export async function lerPaginasDaPergunta(
  pergunta: string,
  signal?: AbortSignal,
): Promise<PaginasLidas> {
  const urls = extrairUrls(pergunta);
  if (!urls.length) return { fontes: [], erros: [] };

  const ctrl = signal ?? new AbortController().signal;
  const erros: string[] = [];
  const fontes: Fonte[] = [];

  const resultados = await Promise.allSettled(urls.map((u) => lerUma(u, ctrl)));
  for (let i = 0; i < resultados.length; i++) {
    const r = resultados[i];
    if (r.status === "fulfilled") {
      fontes.push({ n: fontes.length + 1, ...r.value });
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : "falha ao ler";
      erros.push(`${urls[i]}: ${msg}`);
      console.error("[paginas] falha ao ler", urls[i], msg);
    }
  }

  return { fontes, erros };
}

export function dossiePaginas(p: PaginasLidas): string {
  if (!p.fontes.length && !p.erros.length) return "";

  const blocos = p.fontes.map(
    (f) => `[${f.n}] ${f.titulo}\nURL: ${f.url}\n${f.trecho}`,
  );

  const falhas = p.erros.length
    ? `\n\nNão foi possível ler: ${p.erros.join("; ")}.`
    : "";

  return `# Páginas lidas agora pelo servidor

O servidor abriu (ou tentou abrir) estas URLs no momento da pergunta. Isso **é** acesso ao site — não diga que você não consegue verificar a URL, nem que modelos de linguagem não fazem HTTP. Use o conteúdo abaixo como evidência direta do que a página apresenta hoje. Cite com [n].${falhas}

${blocos.join("\n\n---\n\n")}`.trim();
}

/** Renumerar fontes depois de juntar páginas lidas e busca. */
export function mesclarFontes(a: Fonte[], b: Fonte[]): Fonte[] {
  const out: Fonte[] = [];
  const vistos = new Set<string>();
  for (const f of [...a, ...b]) {
    const chave = f.url.replace(/\/$/, "").toLowerCase();
    if (!f.url || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ ...f, n: out.length + 1 });
  }
  return out;
}
