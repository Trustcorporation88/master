/**
 * Reconhecimento de texto em documento digitalizado.
 *
 * A escolha central aqui é usar **modelo de visão** em vez de Tesseract. Num
 * scan real — carimbo, tabela torta, papel amassado, manuscrito — o Tesseract
 * erra com frequência, e erro de OCR é traiçoeiro: ele não falha, ele entrega
 * texto plausível e errado, que envenena toda a análise adiante sem aviso.
 * Modelo de visão lê muito melhor, preserva estrutura de tabela e sabe dizer
 * quando não conseguiu ler um trecho.
 *
 * O preço disso é custo por página. Por isso há teto de páginas, e o resultado
 * é gravado junto do documento: uma vez reconhecido, nunca se paga de novo.
 *
 * Só servidor.
 */

import { createCanvas } from "@napi-rs/canvas";
import { readImages, type ProviderId } from "./providers";
import { agentesDoServidor } from "./serverConfig";

/** Teto de páginas por documento. Cada página é uma chamada cobrada. */
export const MAX_PAGINAS_OCR = Math.max(
  1,
  Math.min(200, Number(process.env.OCR_MAX_PAGINAS) || 30),
);

/** Quantas páginas são lidas ao mesmo tempo. */
const PARALELAS = 3;

/**
 * Escala de renderização.
 *
 * 2x sobre 72 dpi dá ~144 dpi: o suficiente para texto impresso comum, sem
 * inflar a imagem (e o custo em tokens) mais do que a leitura exige.
 */
const ESCALA = 2;

const SYSTEM_OCR = `Você transcreve documentos digitalizados com fidelidade absoluta.

Regras:
- Transcreva TODO o texto visível, na ordem de leitura natural.
- Preserve a estrutura: títulos, listas, e tabelas em markdown.
- Números, datas, valores e códigos são o mais importante: copie exatamente como aparecem, sem normalizar formato.
- NÃO resuma, NÃO interprete, NÃO corrija o conteúdo e NÃO complete o que está cortado.
- Onde não for possível ler com segurança, escreva [ilegível] no lugar. É melhor marcar a dúvida do que adivinhar — uma transcrição errada contamina tudo que vem depois.
- Se a página estiver em branco ou sem texto, responda exatamente: [sem texto]
- Não escreva comentários seus. Devolva apenas a transcrição.`;

/** Provedor com leitura de imagem. DeepSeek não faz, então fica fora. */
function leitorVisual(): { provider: ProviderId; apiKey: string; model: string } | null {
  const agentes = agentesDoServidor();
  const preferencia: ProviderId[] = ["anthropic", "openai"];

  for (const p of preferencia) {
    const a = agentes.find((x) => x.provider === p);
    if (a) {
      return {
        provider: a.provider,
        apiKey: a.apiKey,
        // Permite apontar um modelo mais barato só para transcrição.
        model: process.env.OCR_MODEL?.trim() || a.model,
      };
    }
  }
  return null;
}

export function ocrDisponivel(): boolean {
  return leitorVisual() !== null;
}

/* ------------------------------------------------------------------ */
/* Renderização de PDF em imagem                                       */
/* ------------------------------------------------------------------ */

/** Converte páginas do PDF em PNG. */
export async function renderizarPaginas(
  caminho: string,
  maxPaginas: number,
): Promise<{ imagens: Array<{ dados: Buffer; mime: string }>; totalPaginas: number }> {
  const { readFile } = await import("node:fs/promises");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(caminho)),
    verbosity: 0,
  }).promise;

  const imagens: Array<{ dados: Buffer; mime: string }> = [];
  const limite = Math.min(doc.numPages, maxPaginas);

  for (let i = 1; i <= limite; i++) {
    const pagina = await doc.getPage(i);
    const viewport = pagina.getViewport({ scale: ESCALA });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    // Fundo branco: PDF sem fundo definido renderiza transparente, e
    // transparência vira preto em muitos codificadores.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pagina.render({
      // O canvas do @napi-rs é compatível o suficiente para o pdfjs desenhar,
      // mas os tipos são de DOM: a conversão é intencional.
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    imagens.push({ dados: canvas.toBuffer("image/png"), mime: "image/png" });
  }

  return { imagens, totalPaginas: doc.numPages };
}

/* ------------------------------------------------------------------ */
/* Transcrição                                                         */
/* ------------------------------------------------------------------ */

export type ResultadoOcr = {
  texto: string;
  paginasLidas: number;
  totalPaginas: number;
  /** Páginas que falharam na leitura. */
  falhas: number;
};

type Imagem = { dados: Buffer; mime: string };

/** Transcreve um lote de imagens, em pequenos grupos paralelos. */
async function transcrever(
  imagens: Imagem[],
  rotulo: (i: number) => string,
  signal?: AbortSignal,
): Promise<{ textos: string[]; falhas: number }> {
  const leitor = leitorVisual();
  if (!leitor) throw new Error("Nenhum provedor com leitura de imagem está configurado.");

  const textos: string[] = new Array(imagens.length).fill("");
  let falhas = 0;

  for (let inicio = 0; inicio < imagens.length; inicio += PARALELAS) {
    const lote = imagens.slice(inicio, inicio + PARALELAS);

    await Promise.all(
      lote.map(async (img, k) => {
        const idx = inicio + k;
        try {
          const { text } = await readImages({
            provider: leitor.provider,
            apiKey: leitor.apiKey,
            model: leitor.model,
            system: SYSTEM_OCR,
            prompt: "Transcreva o documento desta imagem.",
            imagens: [img],
            signal,
          });

          const limpo = text.trim();
          textos[idx] =
            limpo && limpo !== "[sem texto]" ? `${rotulo(idx)}\n${limpo}` : "";
        } catch (err) {
          falhas++;
          console.error(
            `[ocr] falha na página ${idx + 1}:`,
            err instanceof Error ? err.message : err,
          );
          textos[idx] = `${rotulo(idx)}\n[não foi possível ler esta página]`;
        }
      }),
    );
  }

  return { textos, falhas };
}

/** Reconhece o texto de um PDF digitalizado. */
export async function ocrPdf(caminho: string, signal?: AbortSignal): Promise<ResultadoOcr> {
  const { imagens, totalPaginas } = await renderizarPaginas(caminho, MAX_PAGINAS_OCR);

  const { textos, falhas } = await transcrever(
    imagens,
    (i) => `[página ${i + 1}]`,
    signal,
  );

  return {
    texto: textos.filter(Boolean).join("\n\n"),
    paginasLidas: imagens.length,
    totalPaginas,
    falhas,
  };
}

/** Tipos de imagem que as APIs de visão aceitam. */
export const MIMES_IMAGEM: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Reconhece o texto de uma imagem enviada diretamente. */
export async function ocrImagem(
  caminho: string,
  nome: string,
  signal?: AbortSignal,
): Promise<ResultadoOcr> {
  const { readFile } = await import("node:fs/promises");
  const dados = await readFile(caminho);

  const ext = nome.toLowerCase().split(".").pop() ?? "";
  const mime = MIMES_IMAGEM[ext] ?? "image/png";

  const { textos, falhas } = await transcrever([{ dados, mime }], () => "", signal);

  return {
    texto: textos.filter(Boolean).join("\n\n"),
    paginasLidas: 1,
    totalPaginas: 1,
    falhas,
  };
}
