/**
 * Gera o PDF da página de impressão e converte as páginas em imagem.
 *
 * Existe porque "sai bonito na tela" não diz nada sobre o papel: margem,
 * quebra de página e fundo só aparecem no PDF de verdade. Aqui o PDF é gerado
 * pelo mesmo motor do navegador e as páginas viram PNG para inspeção.
 *
 * Uso: node scripts/pdf-check.mjs
 *   E2E_URL, E2E_SENHA, CONVERSA (id; padrão é a conversa mais recente)
 */

import { chromium } from "playwright";
import { createCanvas } from "@napi-rs/canvas";
import { writeFile } from "node:fs/promises";

const URL = process.env.E2E_URL ?? "http://localhost:3000";

const navegador = await chromium.launch();
const page = await navegador.newPage();

await page.goto(URL, { waitUntil: "networkidle" });
if (await page.locator('input[type="password"]').count()) {
  await page.fill('input[type="password"]', process.env.E2E_SENHA ?? "segredo123");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=O que você precisa saber?");
}

const { conversas } = await page.evaluate(async () => (await fetch("/api/conversas")).json());
const id = process.env.CONVERSA ?? conversas[0].id;

await page.goto(`${URL}/imprimir/${id}`, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(800);

const pdf = await page.pdf({ format: "A4", printBackground: true });
await writeFile("/tmp/saida.pdf", pdf);
console.log("PDF:", pdf.length, "bytes");
await navegador.close();

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
console.log("páginas:", doc.numPages);

/**
 * Verificação por medição de tinta.
 *
 * Duas falhas reais que passaram por revisão visual na tela e só apareceram no
 * papel: página quase em branco (porque a resposta inteira estava marcada como
 * indivisível e era empurrada adiante) e texto encostado na borda física.
 * Ambas são mensuráveis, então valem teste em vez de olho.
 */
const falhas = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas.push(msg);
};

const MARGEM_MINIMA_MM = 8;

for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const vp = p.getViewport({ scale: 1.4 });
  const largura = Math.ceil(vp.width);
  const altura = Math.ceil(vp.height);

  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largura, altura);
  await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;

  if (i <= 4) {
    await writeFile(`/tmp/pdf-p${i}.png`, canvas.toBuffer("image/png"));
  }

  const dados = ctx.getImageData(0, 0, largura, altura).data;
  const temTinta = (x, y) => {
    const k = (y * largura + x) * 4;
    // Fundo de tabela e filete de borda são claros; só conta tinta de verdade.
    return dados[k] < 235 || dados[k + 1] < 235 || dados[k + 2] < 235;
  };

  let ultimaLinha = 0;
  let pixels = 0;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if (temTinta(x, y)) {
        pixels++;
        ultimaLinha = y;
      }
    }
  }

  const preenchido = ultimaLinha / altura;
  const cobertura = pixels / (largura * altura);

  // A última página pode terminar no meio, as anteriores não.
  if (i < doc.numPages) {
    ok(
      preenchido > 0.75,
      `página ${i} aproveita a folha (texto vai até ${Math.round(preenchido * 100)}% da altura)`,
    );
  }
  ok(cobertura > 0.01, `página ${i} tem conteúdo (${(cobertura * 100).toFixed(1)}% de tinta)`);

  // Margem física: A4 tem 210 mm de largura, então 1 mm = largura/210.
  const mm = largura / 210;
  const faixa = Math.floor(MARGEM_MINIMA_MM * mm);
  let invadida = false;
  for (let y = 0; y < altura && !invadida; y++) {
    for (let x = 0; x < faixa; x++) {
      if (temTinta(x, y) || temTinta(largura - 1 - x, y)) {
        invadida = true;
        break;
      }
    }
  }
  ok(!invadida, `página ${i} respeita ${MARGEM_MINIMA_MM} mm de margem lateral`);
}

console.log(
  falhas.length ? `\n✗ ${falhas.length} verificação(ões) falharam` : "\n✓ o PDF está bem formado",
);
process.exit(falhas.length ? 1 : 0);
