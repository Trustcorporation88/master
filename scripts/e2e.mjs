/**
 * Teste de ponta a ponta da interface, contra o servidor de APIs simulado.
 * Uso: node scripts/e2e.mjs
 */

import { chromium } from "playwright";

const URL = process.env.E2E_URL ?? "http://localhost:3000";
const erros = [];

// Com E2E_SENHA, testa também a trava de acesso (Basic Auth) do deploy.
const senha = process.env.E2E_SENHA;
const page = await (await chromium.launch()).newPage({
  viewport: { width: 1500, height: 1000 },
  ...(senha ? { httpCredentials: { username: "duelo", password: senha } } : {}),
});
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
page.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });

// O painel de chaves deve abrir sozinho na primeira visita.
await page.waitForSelector("text=Chaves de API", { timeout: 10000 });
console.log("✓ painel de chaves abre automaticamente");
await page.screenshot({ path: "/tmp/s1-chaves.png" });

// Preenche as três chaves e verifica cada uma (o mock aceita qualquer valor).
const inputs = await page.locator('input[type="password"]').all();
console.log(`  campos de chave encontrados: ${inputs.length}`);
for (const [i, input] of inputs.entries()) {
  await input.fill(`sk-teste-${i}`);
  await input.blur();
}
await page.waitForTimeout(2500);

const badges = await page.locator("text=/\\d+ modelos/").count();
console.log(`✓ ${badges} provedores validados com listagem de modelos`);
await page.screenshot({ path: "/tmp/s2-validado.png" });

// Configura a busca web e confere que ela liga sozinha ao validar.
const buscaInput = page.locator('input[placeholder="BSA..."]');
await buscaInput.fill("BSA-teste");
await buscaInput.blur();
await page.waitForSelector("text=chave válida", { timeout: 15000 });
const ligada = await page.locator('input[type="checkbox"]:checked').count();
console.log(`✓ chave de busca validada (checkboxes marcados: ${ligada})`);
await page.screenshot({ path: "/tmp/s2b-busca.png", fullPage: true });

await page.click("text=Fechar");

// Faz a pergunta e inicia o duelo.
await page.fill("textarea", "Qual a capital do Brasil e por que foi construída?");
await page.selectOption("select >> nth=0", "debate");
await page.screenshot({ path: "/tmp/s3-pronto.png" });

await page.click("text=Iniciar duelo");
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/s4-duelo.png" });
console.log("✓ duelo em andamento capturado");

// Espera o veredito.
await page.waitForSelector("text=Veredito", { timeout: 90000 });
await page.waitForSelector("text=/vencedor:|empate|nenhuma resposta/", { timeout: 90000 });
await page.waitForTimeout(1200);
console.log("✓ veredito renderizado");

await page.click("text=ver notas");
await page.click("text=ver fontes");
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/s5-veredito.png", fullPage: true });

// Confere elementos-chave do resultado.
const checks = {
  "coluna Anthropic": await page.locator("text=Anthropic").count(),
  "selo vence": await page.locator("text=vence").count(),
  "tabela de notas": await page.locator("text=Correção").count(),
  "ressalvas": await page.locator("text=Ressalvas").count(),
  "custo estimado": await page.locator("text=/~\\$/").count(),
  "convergência": await page.locator("text=/convergência \\d+%/").count(),
  "bloco de código": await page.locator("pre code").count(),
  "botão exportar": await page.locator("text=Exportar .md").count(),
  "histórico recente": await page.locator("text=Recentes").count(),
  "dossiê de fontes": await page.locator("text=/\\d+ fontes no dossiê/").count(),
  "coluna fundamentação": await page.locator("text=Fundamentação").count(),
  "custo de busca": await page.locator("text=/busca \\$/").count(),
};
for (const [k, v] of Object.entries(checks)) {
  console.log(`${v > 0 ? "✓" : "✗"} ${k}: ${v}`);
}

// Recarrega para checar a persistência das chaves no localStorage.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const painelReabriu = await page.locator("text=Chaves de API").count();
console.log(`${painelReabriu === 0 ? "✓" : "✗"} chaves persistiram (painel não reabriu)`);

// Verifica os cabeçalhos de segurança.
const resp = await page.goto(URL, { waitUntil: "domcontentloaded" });
const h = resp.headers();
for (const k of ["content-security-policy", "x-frame-options", "referrer-policy"]) {
  console.log(`${h[k] ? "✓" : "✗"} header ${k}`);
}
await page.waitForTimeout(1200);

// Responsivo.
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/s6-mobile.png", fullPage: true });
console.log("✓ captura mobile");

console.log(erros.length ? `\n✗ erros no console:\n${erros.join("\n")}` : "\n✓ nenhum erro de console");
process.exit(0);
