/**
 * Teste da conversa: continuidade, histórico gravado e exportação.
 *
 * Uso: node scripts/e2e-conversa.mjs
 *   E2E_URL    endereço do app (padrão http://localhost:3000)
 *   E2E_SENHA  senha de acesso
 */

import { chromium } from "playwright";

const URL = process.env.E2E_URL ?? "http://localhost:3000";
const SENHA = process.env.E2E_SENHA ?? "segredo123";

const falhas = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas.push(msg);
};

const navegador = await chromium.launch();
const page = await navegador.newPage({ viewport: { width: 1280, height: 1000 } });
const erros = [];
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
page.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.fill('input[type="password"]', SENHA);
await page.click('button[type="submit"]');
await page.waitForSelector("text=O que você precisa saber?", { timeout: 15000 });
erros.length = 0;

/* ---------------- Primeira pergunta ---------------- */

await page.fill("textarea", "Qual a capital do Brasil?");
await page.click("text=Analisar");
await page.waitForSelector("text=Resposta", { timeout: 120000 });
await page.waitForSelector("text=/Confiança/i", { timeout: 120000 });
await page.waitForTimeout(1500);
ok(true, "primeira resposta concluída");

/* ---------------- Segunda pergunta, em cima da primeira ---------------- */

// O botão troca de rótulo quando a conversa já tem um turno: é o sinal visível
// de que o próximo envio continua, em vez de recomeçar.
ok((await page.locator('text="Perguntar"').count()) > 0, "botão passa a ser Perguntar");

await page.fill("textarea", "E quantos habitantes ela tem?");
await page.click('text="Perguntar"');
await page.waitForTimeout(2000);
await page.waitForFunction(
  () => document.querySelectorAll("article").length >= 2,
  { timeout: 120000 },
);
await page.waitForTimeout(2000);

const respostas = await page.locator("article").count();
ok(respostas >= 2, `as duas respostas continuam na tela (${respostas})`);

const texto = await page.evaluate(() => document.body.innerText);
ok(texto.includes("capital do Brasil"), "a primeira pergunta não foi apagada");
ok(texto.includes("quantos habitantes"), "a segunda pergunta aparece");

await page.screenshot({ path: "/tmp/c1-conversa.png", fullPage: true });

/* ---------------- O servidor recebeu o histórico ---------------- */

const enviado = await page.evaluate(async () => {
  const r = await fetch("/api/conversas");
  return r.json();
});
// Execuções anteriores deixam conversas gravadas: o que importa é que a mais
// recente seja a desta execução, com os dois turnos.
ok(enviado.conversas?.length >= 1, `conversa gravada (${enviado.conversas?.length} no total)`);
ok(enviado.conversas?.[0]?.turnos === 2, `a mais recente tem dois turnos (${enviado.conversas?.[0]?.turnos})`);

const id = enviado.conversas[0].id;
const inteira = await page.evaluate(
  async (i) => (await fetch(`/api/conversas?id=${i}`)).json(),
  id,
);
ok(
  inteira.conversa?.turnos?.[0]?.resposta?.length > 0,
  "a resposta gravada tem conteúdo",
);
ok(
  inteira.conversa?.turnos?.[1]?.pergunta === "E quantos habitantes ela tem?",
  "o segundo turno gravou a pergunta certa",
);

/* ---------------- Persistência ao recarregar ---------------- */

await page.reload({ waitUntil: "networkidle" });
const depois = await page.evaluate(() => document.body.innerText);
ok(!depois.includes("capital do Brasil"), "a tela começa limpa após recarregar");
ok(depois.includes("Histórico"), "o histórico está acessível no cabeçalho");

await page.click("text=/Histórico/");
await page.waitForTimeout(400);
ok((await page.locator("text=/Qual a capital do Brasil/").count()) > 0, "conversa listada no histórico");
await page.screenshot({ path: "/tmp/c2-historico.png" });

await page.click("text=/Qual a capital do Brasil/");
await page.waitForTimeout(1200);
const reaberta = await page.evaluate(() => document.body.innerText);
ok(reaberta.includes("quantos habitantes"), "conversa reabre com os dois turnos");
await page.screenshot({ path: "/tmp/c3-reaberta.png", fullPage: true });

/* ---------------- Exportação ---------------- */

const planilha = await page.evaluate(async (i) => {
  const r = await fetch(`/api/exportar?id=${i}`);
  const b = await r.blob();
  return { status: r.status, tipo: r.headers.get("content-type"), bytes: b.size };
}, id);
ok(planilha.status === 200, `planilha responde 200 (${planilha.status})`);
ok(/spreadsheetml/.test(planilha.tipo ?? ""), `tipo de planilha correto (${planilha.tipo})`);
ok(planilha.bytes > 3000, `planilha tem conteúdo (${planilha.bytes} bytes)`);

// Recorte por turno: exportar a conversa inteira quando se quer uma resposta só
// entrega junto o assunto anterior. Aconteceu em uso real.
const soUmTurno = await page.evaluate(async (i) => {
  const r = await fetch(`/api/exportar?id=${i}&turno=2`);
  const b = await r.blob();
  const inexistente = await fetch(`/api/exportar?id=${i}&turno=9`);
  return { status: r.status, bytes: b.size, forade: inexistente.status };
}, id);
ok(soUmTurno.status === 200, `planilha de um turno responde 200 (${soUmTurno.status})`);
ok(soUmTurno.bytes > 3000, `planilha de um turno tem conteúdo (${soUmTurno.bytes} bytes)`);
ok(soUmTurno.forade === 404, `turno inexistente é recusado (${soUmTurno.forade})`);

// Lê o texto renderizado, não o HTML cru: o React separa "Pergunta" e o número
// em nós diferentes, e a busca no HTML dava falso negativo.
await page.goto(`${URL}/imprimir/${id}?turno=2`, { waitUntil: "networkidle" });
const visto = await page.evaluate(() => document.body.innerText);
ok(visto.includes("habitantes"), "impressão de um turno traz a resposta pedida");
// Contar os blocos é o teste honesto: a linha de referência cita a conversa de
// origem de propósito, então procurar o texto da pergunta anterior dá falso
// positivo.
// Cada resposta impressa declara seu grau de confiança uma vez, então contar
// essa marca conta respostas — sem casar com a linha de referência do recorte.
const respostasNaFolha = (visto.match(/Confian[çc]a (alta|m[ée]dia|baixa)/gi) ?? []).length;
ok(respostasNaFolha === 1, `impressão de um turno traz uma resposta só (${respostasNaFolha})`);
ok(visto.includes("Pergunta 2"), "impressão de um turno mantém a numeração original");
ok(visto.includes("de 2 da conversa"), "impressão de um turno diz de onde foi recortada");

const impressao = await page.evaluate(async (i) => {
  const r = await fetch(`/imprimir/${i}`);
  const t = await r.text();
  return { status: r.status, temPergunta: t.includes("capital"), tamanho: t.length };
}, id);
ok(impressao.status === 200, `página de impressão responde 200 (${impressao.status})`);
ok(impressao.temPergunta, "página de impressão contém a conversa");

// A versão de impressão abre na mesma aba: criar contexto novo perderia a
// sessão, e o objetivo aqui é só conferir o desenho da página.
await page.goto(`${URL}/imprimir/${id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/c4-impressao.png", fullPage: true });
ok(
  (await page.locator("text=/Pergunta 1/").count()) > 0,
  "versão para PDF traz os turnos numerados",
);

await page.goto(URL, { waitUntil: "networkidle" });
await page.click("text=/Histórico/");
await page.waitForTimeout(400);
await page.click("text=/Qual a capital do Brasil/");
await page.waitForTimeout(1000);

/* ---------------- Nova conversa ---------------- */

await page.click('text="Nova"');
await page.waitForTimeout(500);
const limpa = await page.evaluate(() => document.body.innerText);
ok(!limpa.includes("quantos habitantes"), "Nova limpa a tela");
ok(limpa.includes("O que você precisa saber?"), "volta à tela inicial");

/* ---------------- O mecanismo continua escondido ---------------- */

const PROIBIDO = ["claude", "gpt-5", "deepseek-chat", "duelo", "árbitro", "veredito", "dossiê", "estratégia", "delphi", "Brave"];
const contem = (t, termo) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${termo}([^\\p{L}\\p{N}]|$)`, "iu").test(t);

const html = await (await fetch(`${URL}/`, {
  headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") },
})).text();
const vazando = PROIBIDO.filter((t) => contem(html, t));
ok(vazando.length === 0, `nada do mecanismo no HTML${vazando.length ? `: ${vazando}` : ""}`);

// A sondagem de turno inexistente devolve 404 de propósito; não é defeito.
const errosReais = erros.filter((e) => !/404/.test(e));
console.log(
  errosReais.length ? `\n✗ erros de console:\n${errosReais.join("\n")}` : "\n✓ nenhum erro de console",
);
console.log(falhas.length ? `\n✗ ${falhas.length} verificação(ões) falharam` : "\n✓ todas passaram");

await navegador.close();
process.exit(falhas.length ? 1 : 0);
