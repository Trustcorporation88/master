/**
 * Teste de ponta a ponta da interface, contra o servidor de APIs simulado.
 *
 * Uso: node scripts/e2e.mjs
 *   E2E_URL    endereço do app (padrão http://localhost:3000)
 *   E2E_SENHA  senha de acesso, se DUELO_SENHA estiver definida no app
 */

import { chromium } from "playwright";

const URL = process.env.E2E_URL ?? "http://localhost:3000";
const SENHA = process.env.E2E_SENHA;

const erros = [];
const falhas = [];

const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas.push(msg);
};

const navegador = await chromium.launch();
const page = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
page.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));

/* ---------------- Login ---------------- */

await page.goto(URL, { waitUntil: "networkidle" });

if (SENHA) {
  ok(page.url().includes("/login"), "visita sem sessão é redirecionada ao login");
  await page.screenshot({ path: "/tmp/p1-login.png" });

  await page.fill('input[type="password"]', "senha-errada");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Senha incorreta", { timeout: 10000 });
  ok(true, "senha errada é rejeitada");

  await page.fill('input[type="password"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=O que você precisa saber?", { timeout: 15000 });
  ok(true, "senha correta entra no app");
}

// Erros anteriores ao login (redirecionamentos 401 esperados) não contam.
erros.length = 0;

await page.screenshot({ path: "/tmp/p2-inicio.png" });

/* ---------------- Documentos ---------------- */

await page.click("text=Documentos");
await page.waitForTimeout(400);

// Envia planilha, PDF e markdown de uma vez.
await page.setInputFiles('input[type="file"]', [
  "/tmp/amostras/vendas.xlsx",
  "/tmp/amostras/relatorio.pdf",
  "/tmp/amostras/notas.md",
]);

await page.waitForSelector("text=/2 abas, 5.001 linhas/", { timeout: 90000 });
ok(true, "planilha processada com perfil de linhas");
await page.waitForSelector("text=/5 p[áa]ginas/", { timeout: 60000 });
ok(true, "PDF processado com contagem de páginas");

const marcados = await page.locator('input[type="checkbox"]:checked').count();
ok(marcados >= 3, `documentos marcados para uso (${marcados})`);
await page.screenshot({ path: "/tmp/p6-documentos.png", fullPage: true });

// Recusa de formato
await page.evaluate(async () => {
  const r = await fetch("/api/documentos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ acao: "preparar", nome: "virus.exe", mime: "application/x-msdownload", bytes: 10 }),
  });
  window.__fmt = r.status;
});
ok((await page.evaluate(() => window.__fmt)) === 415, "formato não aceito é recusado");

// Recusa de tamanho
await page.evaluate(async () => {
  const r = await fetch("/api/documentos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ acao: "preparar", nome: "grande.pdf", mime: "application/pdf", bytes: 200 * 1024 * 1024 }),
  });
  window.__tam = r.status;
});
ok((await page.evaluate(() => window.__tam)) === 413, "arquivo acima de 100 MB é recusado");

/* ---------------- Análise ---------------- */

await page.fill("textarea", "Qual a capital do Brasil e por que foi construída?");
await page.click("text=Analisar");

// Com APIs reais o progresso fica visível por dezenas de segundos; contra o
// servidor simulado a resposta chega quase junto. Vale qualquer um dos dois.
const progresso = await Promise.race([
  page.waitForSelector("text=Em andamento", { timeout: 20000 }).then(() => "progresso"),
  page.waitForSelector("text=Resposta", { timeout: 20000 }).then(() => "resposta"),
]).catch(() => null);
ok(progresso !== null, `retorno visual imediato após enviar (${progresso})`);
await page.screenshot({ path: "/tmp/p3-progresso.png" });

await page.waitForSelector("text=Resposta", { timeout: 120000 });
await page.waitForSelector("text=/Confiança (alta|média|baixa)/i", { timeout: 120000 });
await page.waitForTimeout(1500);
ok(true, "resposta final renderizada");

const checks = {
  "grau de confiança": await page.locator("text=/Confiança/i").count(),
  "fontes consultadas": await page.locator("text=/fontes? consultadas?/").count(),
  "pontos a verificar": await page.locator("text=Pontos a verificar").count(),
  "botão copiar": await page.locator("text=Copiar").count(),
  "pergunta ecoada": await page.locator("text=/capital do Brasil/").count(),
};
for (const [k, v] of Object.entries(checks)) ok(v > 0, `${k} (${v})`);

await page.click("text=ver");
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/p4-resposta.png", fullPage: true });

/* ---------------- O mecanismo não pode vazar ---------------- */

const PROIBIDO = [
  "Anthropic",
  "OpenAI",
  "DeepSeek",
  "claude",
  "gpt-5",
  "deepseek-chat",
  "duelo",
  "árbitro",
  "arbitro",
  "agente",
  "Brave",
  "Tavily",
  "brainstorm",
  "Mysti",
  "estratégia",
  "veredito",
  "dossiê",
  "red-team",
  "delphi",
];

/** Casa palavra inteira: "agente" não deve casar dentro de "onDragEnter". */
const contem = (texto, termo) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu").test(
    texto,
  );

const textoVisivel = await page.evaluate(() => document.body.innerText);
const vazandoNaTela = PROIBIDO.filter((t) => contem(textoVisivel, t));
ok(vazandoNaTela.length === 0, `nada do mecanismo na tela${vazandoNaTela.length ? `: ${vazandoNaTela}` : ""}`);

// HTML servido pelo servidor.
const html = await (await fetch(`${URL}/`, {
  headers: SENHA ? { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } : {},
})).text();
const vazandoNoHtml = PROIBIDO.filter((t) => contem(html, t));
ok(vazandoNoHtml.length === 0, `nada do mecanismo no HTML${vazandoNoHtml.length ? `: ${vazandoNoHtml}` : ""}`);

// Todo o JavaScript que o navegador carregou.
const scripts = await page.evaluate(() =>
  [...document.querySelectorAll("script[src]")].map((s) => s.src),
);
let vazandoNoJs = [];
for (const src of scripts) {
  const js = await (await fetch(src)).text();
  for (const t of PROIBIDO) {
    if (contem(js, t) && !vazandoNoJs.includes(t)) vazandoNoJs.push(t);
  }
}
ok(
  vazandoNoJs.length === 0,
  `nada do mecanismo nos ${scripts.length} arquivos JS${vazandoNoJs.length ? `: ${vazandoNoJs}` : ""}`,
);

// A API não deve aceitar chave vinda do cliente.
const respostaApi = await page.evaluate(async () => {
  const r = await fetch("/api/duel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "teste",
      agents: [{ provider: "anthropic", apiKey: "sk-injetada", model: "x" }],
    }),
  });
  return r.status;
});
ok(respostaApi === 200, `API responde ignorando chave injetada pelo cliente (status ${respostaApi})`);

/* ---------------- Sessão e responsivo ---------------- */

if (SENHA) {
  await page.goto(`${URL}/`, { waitUntil: "networkidle" });
  ok(!page.url().includes("/login"), "sessão persiste entre navegações");
}

const cabecalhos = (await (await fetch(URL)).headers);
for (const h of ["content-security-policy", "x-frame-options", "referrer-policy"]) {
  ok(Boolean(cabecalhos.get(h)), `cabeçalho ${h}`);
}

await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/p5-mobile.png", fullPage: true });
ok(true, "captura mobile");

// As sondagens de recusa (415 e 413) produzem erro de rede no console de
// propósito; não são defeitos.
const errosReais = erros.filter((e) => !/(415|413)/.test(e));
console.log(
  errosReais.length ? `\n✗ erros de console:\n${errosReais.join("\n")}` : "\n✓ nenhum erro de console inesperado",
);
console.log(falhas.length ? `\n✗ ${falhas.length} verificação(ões) falharam` : "\n✓ todas as verificações passaram");

await navegador.close();
process.exit(falhas.length ? 1 : 0);
