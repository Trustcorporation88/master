/**
 * Extração de conteúdo de documentos.
 *
 * O ponto central deste arquivo é uma restrição física: nenhum modelo de IA lê
 * 100 MB. Cem megabytes de texto são cerca de 25 milhões de tokens, e a leitura
 * disponível fica entre 200 mil e 1 milhão — além de ser cobrada uma vez por
 * parecer. Então extrair não é despejar: é reduzir com honestidade e dizer ao
 * usuário quanto do documento realmente entrou na análise.
 *
 * Estratégias por tipo:
 *  - Planilha: perfil estrutural (colunas, tipos, estatísticas) + amostra de
 *    linhas. Somas e contagens são calculadas aqui, em código, porque LLM não
 *    é planilha e erra aritmética em escala.
 *  - PDF / DOCX / texto: extração linear, depois recorte por relevância.
 *
 * Só servidor. Nunca importe daqui em componente de cliente.
 */

import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { MAX_PAGINAS_OCR, MIMES_IMAGEM, ocrDisponivel, ocrImagem, ocrPdf } from "./ocr";

/**
 * Converte serial de data do Excel em Date.
 *
 * O leitor em streaming entrega células de data como número. Sem esta conversão
 * a coluna seria classificada como numérica e ganharia soma e média — "soma das
 * datas" é um número sem significado que induziria a análise a erro.
 */
function serialParaData(serial: number): Date {
  // Época do Excel: 1899-12-30, o que já absorve o bug do ano 1900.
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
}

/** O formato numérico da célula indica data? */
function formatoEhData(numFmt: string | undefined): boolean {
  if (!numFmt) return false;
  // Remove trechos entre aspas e códigos de cor, que podem conter letras soltas.
  const limpo = numFmt.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /(yy|mm?\/|dd|mmm|hh:)/i.test(limpo) && !/^[#0.,%\s]+$/.test(limpo);
}

export type TipoDoc = "planilha" | "pdf" | "docx" | "texto" | "imagem" | "desconhecido";

/** O reconhecimento de imagem está ligado neste ambiente? */
function ocrAtivo(): boolean {
  return process.env.OCR_ATIVO !== "false" && ocrDisponivel();
}

export type Extracao = {
  tipo: TipoDoc;
  /** Texto pronto para análise (pode ser perfil + amostra, no caso de planilha). */
  texto: string;
  /** Quantos caracteres o documento tinha antes de qualquer corte. */
  caracteresOriginais: number;
  /** Aviso a mostrar ao usuário, quando houver algo relevante. */
  aviso?: string;
  /** Páginas/planilhas/linhas, para exibir na interface. */
  resumoEstrutura: string;
};

/** Teto por documento. Acima disso, entra a seleção por relevância. */
export const LIMITE_CARACTERES = 240_000;

export function tipoPorNome(nome: string, mime?: string): TipoDoc {
  const ext = nome.toLowerCase().split(".").pop() ?? "";

  if (["xlsx", "xlsm", "csv"].includes(ext)) return "planilha";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (["md", "markdown", "txt", "json", "log", "yaml", "yml", "tsv"].includes(ext)) return "texto";
  if (ext in MIMES_IMAGEM) return "imagem";

  if (mime?.includes("spreadsheet") || mime === "text/csv") return "planilha";
  if (mime === "application/pdf") return "pdf";
  if (mime?.includes("wordprocessingml")) return "docx";
  if (mime?.startsWith("text/") || mime === "application/json") return "texto";
  if (mime?.startsWith("image/")) return "imagem";

  return "desconhecido";
}

/* ------------------------------------------------------------------ */
/* Planilha                                                            */
/* ------------------------------------------------------------------ */

type PerfilColuna = {
  nome: string;
  tipo: "numero" | "data" | "texto" | "misto" | "vazio";
  preenchidas: number;
  distintos: number;
  min?: number | string;
  max?: number | string;
  soma?: number;
  media?: number;
  exemplos: string[];
};

const MAX_LINHAS_AMOSTRA = 15;
const MAX_DISTINTOS_RASTREADOS = 500;

/**
 * Lê a planilha em streaming e devolve perfil + amostra.
 *
 * Uma planilha de 200 mil linhas não vira 200 mil linhas de prompt: vira a
 * descrição precisa do que ela contém. Perguntas de total e média são
 * respondidas pelos números calculados aqui, não por leitura de linha.
 */
async function extrairPlanilha(caminho: string, nome: string): Promise<Extracao> {
  const ehCsv = nome.toLowerCase().endsWith(".csv");
  const partes: string[] = [];
  const avisos: string[] = [];
  let totalLinhas = 0;
  let totalAbas = 0;

  const processarAba = (
    tituloAba: string,
    cabecalhos: string[],
    colunas: Map<number, PerfilColuna>,
    amostra: string[][],
    linhas: number,
  ) => {
    totalAbas++;
    totalLinhas += linhas;

    partes.push(`### Planilha: ${tituloAba}`);
    partes.push(`Linhas de dados: ${linhas.toLocaleString("pt-BR")}`);
    partes.push(`Colunas: ${cabecalhos.length}`);
    partes.push("");
    partes.push(`#### Perfil das colunas`);
    partes.push("");
    partes.push("| Coluna | Tipo | Preenchidas | Distintos | Mínimo | Máximo | Soma | Média |");
    partes.push("|---|---|---|---|---|---|---|---|");

    for (const [, c] of [...colunas.entries()].sort((a, b) => a[0] - b[0])) {
      const n = (v: unknown) =>
        typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : (v ?? "—");
      partes.push(
        `| ${c.nome} | ${c.tipo} | ${c.preenchidas.toLocaleString("pt-BR")} | ${
          c.distintos >= MAX_DISTINTOS_RASTREADOS ? `${MAX_DISTINTOS_RASTREADOS}+` : c.distintos
        } | ${n(c.min)} | ${n(c.max)} | ${n(c.soma)} | ${n(c.media)} |`,
      );
    }

    if (amostra.length) {
      partes.push("");
      partes.push(`#### Amostra (${amostra.length} primeiras linhas)`);
      partes.push("");
      partes.push(`| ${cabecalhos.join(" | ")} |`);
      partes.push(`|${cabecalhos.map(() => "---").join("|")}|`);
      for (const linha of amostra) {
        partes.push(`| ${cabecalhos.map((_, i) => linha[i] ?? "").join(" | ")} |`);
      }
    }
    partes.push("");
  };

  const classificar = (valores: unknown[]): PerfilColuna["tipo"] => {
    let num = 0, data = 0, txt = 0;
    for (const v of valores) {
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "number") num++;
      else if (v instanceof Date) data++;
      else txt++;
    }
    if (num && !data && !txt) return "numero";
    if (data && !num && !txt) return "data";
    if (txt && !num && !data) return "texto";
    if (!num && !data && !txt) return "vazio";
    return "misto";
  };

  const analisarAba = (tituloAba: string, linhasBrutas: unknown[][]) => {
    if (!linhasBrutas.length) return;

    const cabecalhos = (linhasBrutas[0] ?? []).map((h, i) =>
      String(h ?? `Coluna ${i + 1}`).trim() || `Coluna ${i + 1}`,
    );
    const dados = linhasBrutas.slice(1);

    const colunas = new Map<number, PerfilColuna>();
    const distintos = new Map<number, Set<string>>();

    cabecalhos.forEach((nomeCol, i) => {
      colunas.set(i, {
        nome: nomeCol,
        tipo: "vazio",
        preenchidas: 0,
        distintos: 0,
        exemplos: [],
      });
      distintos.set(i, new Set());
    });

    const amostraTipos = new Map<number, unknown[]>();

    for (const linha of dados) {
      cabecalhos.forEach((_, i) => {
        const v = linha[i];
        const c = colunas.get(i)!;
        if (v === null || v === undefined || v === "") return;

        c.preenchidas++;

        const set = distintos.get(i)!;
        if (set.size < MAX_DISTINTOS_RASTREADOS) set.add(String(v));

        if (!amostraTipos.has(i)) amostraTipos.set(i, []);
        const at = amostraTipos.get(i)!;
        if (at.length < 200) at.push(v);

        if (typeof v === "number") {
          c.soma = (c.soma ?? 0) + v;
          c.min = c.min === undefined ? v : Math.min(Number(c.min), v);
          c.max = c.max === undefined ? v : Math.max(Number(c.max), v);
        } else if (v instanceof Date) {
          const iso = v.toISOString().slice(0, 10);
          if (c.min === undefined || iso < String(c.min)) c.min = iso;
          if (c.max === undefined || iso > String(c.max)) c.max = iso;
        }
      });
    }

    cabecalhos.forEach((_, i) => {
      const c = colunas.get(i)!;
      c.distintos = distintos.get(i)!.size;
      c.tipo = classificar(amostraTipos.get(i) ?? []);
      if (c.tipo === "numero" && c.soma !== undefined && c.preenchidas > 0) {
        c.media = c.soma / c.preenchidas;
      }
    });

    const amostra = dados.slice(0, MAX_LINHAS_AMOSTRA).map((l) =>
      cabecalhos.map((_, i) => {
        const v = l[i];
        if (v === null || v === undefined) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v).slice(0, 80);
      }),
    );

    processarAba(tituloAba, cabecalhos, colunas, amostra, dados.length);
  };

  if (ehCsv) {
    const { readFile } = await import("node:fs/promises");
    const bruto = await readFile(caminho, "utf-8");
    const linhas = bruto.split(/\r?\n/).filter((l) => l.trim());
    const sep = (linhas[0]?.match(/;/g)?.length ?? 0) > (linhas[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
    const matriz = linhas.map((l) =>
      l.split(sep).map((c) => {
        const t = c.trim().replace(/^"|"$/g, "");
        const n = Number(t.replace(",", "."));
        return t !== "" && !Number.isNaN(n) ? n : t;
      }),
    );
    analisarAba(nome, matriz);
  } else {
    // Streaming: não carrega a planilha inteira na memória de uma vez.
    const wb = new ExcelJS.stream.xlsx.WorkbookReader(caminho, {
      entries: "emit",
      sharedStrings: "cache",
      // Necessário para enxergar o formato da célula e reconhecer datas.
      styles: "cache",
      worksheets: "emit",
    });

    for await (const worksheet of wb) {
      const linhas: unknown[][] = [];
      for await (const row of worksheet) {
        const valores: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          let v = cell.value as unknown;

          // Célula pode vir como fórmula com resultado, ou texto rico.
          if (v && typeof v === "object") {
            const o = v as { result?: unknown; richText?: Array<{ text?: string }>; text?: string };
            if (o.result !== undefined) v = o.result;
            else if (Array.isArray(o.richText)) v = o.richText.map((r) => r.text ?? "").join("");
            else if (o.text !== undefined) v = o.text;
          }

          if (typeof v === "number" && formatoEhData(cell.numFmt)) {
            v = serialParaData(v);
          }

          valores[col - 1] = v ?? null;
        });
        linhas.push(valores);
        if (linhas.length > 250_000) {
          avisos.push("A planilha excede 250 mil linhas; o perfil considera as primeiras 250 mil.");
          break;
        }
      }
      analisarAba((worksheet as { name?: string }).name ?? `Aba ${totalAbas + 1}`, linhas);
    }
  }

  const texto = partes.join("\n");

  return {
    tipo: "planilha",
    texto,
    caracteresOriginais: texto.length,
    aviso: avisos.length
      ? avisos.join(" ")
      : "Planilhas são analisadas por perfil estatístico e amostra — somas, médias e contagens vêm calculadas do arquivo inteiro, não estimadas.",
    resumoEstrutura: `${totalAbas} ${totalAbas === 1 ? "aba" : "abas"}, ${totalLinhas.toLocaleString("pt-BR")} linhas`,
  };
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

async function extrairPdf(caminho: string): Promise<Extracao> {
  const { readFile } = await import("node:fs/promises");
  // Build legado: é o que funciona em Node, sem APIs de navegador.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const dados = new Uint8Array(await readFile(caminho));
  const doc = await pdfjs.getDocument({
    data: dados,
    // Só queremos texto: sem isso o pdfjs enche o log com avisos de fonte.
    verbosity: 0,
  }).promise;

  const paginas: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    const texto = conteudo.items
      .map((item) => (item as { str?: string }).str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (texto) paginas.push(`[página ${i}] ${texto}`);
  }

  const texto = paginas.join("\n\n");

  // PDF digitalizado é imagem: tem páginas mas quase nenhum texto extraível.
  const semTexto = texto.length < doc.numPages * 40;
  const estrutura = `${doc.numPages} ${doc.numPages === 1 ? "página" : "páginas"}`;

  if (!semTexto) {
    return { tipo: "pdf", texto, caracteresOriginais: texto.length, resumoEstrutura: estrutura };
  }

  // Sem camada de texto: reconhecimento por imagem.
  if (!ocrAtivo()) {
    return {
      tipo: "pdf",
      texto,
      caracteresOriginais: texto.length,
      aviso:
        "Este PDF é digitalizado (imagem de papel) e o reconhecimento de imagem está desligado neste ambiente. Envie uma versão com texto.",
      resumoEstrutura: estrutura,
    };
  }

  const r = await ocrPdf(caminho);

  const avisos = [
    `Documento digitalizado: o conteúdo foi lido por reconhecimento de imagem${
      r.paginasLidas < r.totalPaginas
        ? `, nas ${r.paginasLidas} primeiras de ${r.totalPaginas} páginas (teto de ${MAX_PAGINAS_OCR})`
        : ""
    }. Confira números e datas críticos no original.`,
  ];
  if (r.falhas > 0) {
    avisos.push(`${r.falhas} página(s) não puderam ser lidas.`);
  }

  return {
    tipo: "pdf",
    texto: r.texto,
    caracteresOriginais: r.texto.length,
    aviso: avisos.join(" "),
    resumoEstrutura: `${estrutura} · ${r.paginasLidas} reconhecida(s) por imagem`,
  };
}

/* ------------------------------------------------------------------ */
/* Imagem                                                              */
/* ------------------------------------------------------------------ */

async function extrairImagem(caminho: string, nome: string): Promise<Extracao> {
  if (!ocrAtivo()) {
    return {
      tipo: "imagem",
      texto: "",
      caracteresOriginais: 0,
      aviso: "O reconhecimento de imagem está desligado neste ambiente.",
      resumoEstrutura: "imagem",
    };
  }

  const r = await ocrImagem(caminho, nome);

  return {
    tipo: "imagem",
    texto: r.texto,
    caracteresOriginais: r.texto.length,
    aviso:
      r.falhas > 0
        ? "Não foi possível ler o texto desta imagem."
        : "Imagem lida por reconhecimento de texto. Confira números e datas críticos no original.",
    resumoEstrutura: "1 imagem reconhecida",
  };
}

/* ------------------------------------------------------------------ */
/* DOCX e texto                                                        */
/* ------------------------------------------------------------------ */

async function extrairDocx(caminho: string): Promise<Extracao> {
  const { value } = await mammoth.extractRawText({ path: caminho });
  const texto = value.replace(/\n{3,}/g, "\n\n").trim();
  return {
    tipo: "docx",
    texto,
    caracteresOriginais: texto.length,
    resumoEstrutura: `${texto.split(/\s+/).length.toLocaleString("pt-BR")} palavras`,
  };
}

async function extrairTexto(caminho: string): Promise<Extracao> {
  const { readFile } = await import("node:fs/promises");
  const texto = (await readFile(caminho, "utf-8")).trim();
  return {
    tipo: "texto",
    texto,
    caracteresOriginais: texto.length,
    resumoEstrutura: `${texto.split(/\r?\n/).length.toLocaleString("pt-BR")} linhas`,
  };
}

/* ------------------------------------------------------------------ */

export async function extrair(caminho: string, nome: string, mime?: string): Promise<Extracao> {
  const tipo = tipoPorNome(nome, mime);

  switch (tipo) {
    case "planilha":
      return extrairPlanilha(caminho, nome);
    case "pdf":
      return extrairPdf(caminho);
    case "docx":
      return extrairDocx(caminho);
    case "texto":
      return extrairTexto(caminho);
    case "imagem":
      return extrairImagem(caminho, nome);
    default:
      return {
        tipo: "desconhecido",
        texto: "",
        caracteresOriginais: 0,
        aviso:
          "Formato não suportado para leitura. Aceitos: XLSX, CSV, PDF, DOCX, MD, TXT, JSON e imagens (PNG, JPG, WebP).",
        resumoEstrutura: "—",
      };
  }
}

/* ------------------------------------------------------------------ */
/* Recorte por relevância                                              */
/* ------------------------------------------------------------------ */

const PARADAS = new Set([
  "a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que",
  "para","por","com","sem","sobre","qual","quais","como","quando","onde","porque","the","of","and",
  "to","in","is","it","for","on","at","this","that","are","was","be","com","ao","aos","à","às","se",
]);

function palavras(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((p) => p.length > 2 && !PARADAS.has(p));
}

export type Trecho = { rotulo: string; texto: string };

/**
 * Seleciona os trechos mais relevantes à pergunta, respeitando um orçamento.
 *
 * Pontuação por sobreposição de termos raros (inspirada em BM25, sem
 * dependência): evita chamada extra de embeddings, que custaria dinheiro e
 * tempo a cada pergunta.
 */
export function recortarPorRelevancia(
  texto: string,
  pergunta: string,
  orcamento: number,
  prefixoRotulo: string,
): { trechos: Trecho[]; cobertura: number } {
  if (texto.length <= orcamento) {
    return {
      trechos: [{ rotulo: `${prefixoRotulo}1`, texto }],
      cobertura: 1,
    };
  }

  const TAM = 3_000;
  const blocos: string[] = [];
  for (let i = 0; i < texto.length; i += TAM) blocos.push(texto.slice(i, i + TAM));

  const termos = new Set(palavras(pergunta));

  // Frequência de documento, para dar mais peso a termo raro.
  const df = new Map<string, number>();
  const blocosPalavras = blocos.map((b) => {
    const ps = new Set(palavras(b));
    for (const p of ps) if (termos.has(p)) df.set(p, (df.get(p) ?? 0) + 1);
    return ps;
  });

  const pontuados = blocos.map((b, i) => {
    let pontos = 0;
    for (const t of termos) {
      if (blocosPalavras[i].has(t)) {
        const freq = df.get(t) ?? 1;
        pontos += Math.log(1 + blocos.length / freq);
      }
    }
    return { i, pontos, texto: b };
  });

  pontuados.sort((a, b) => b.pontos - a.pontos || a.i - b.i);

  const escolhidos: typeof pontuados = [];
  let usado = 0;
  for (const p of pontuados) {
    if (usado + p.texto.length > orcamento) continue;
    escolhidos.push(p);
    usado += p.texto.length;
    if (usado >= orcamento * 0.95) break;
  }

  // Nenhum termo casou: entrega o começo do documento, que é melhor que nada.
  if (escolhidos.length === 0 || escolhidos.every((e) => e.pontos === 0)) {
    const inicio = texto.slice(0, orcamento);
    return {
      trechos: [{ rotulo: `${prefixoRotulo}1`, texto: inicio }],
      cobertura: inicio.length / texto.length,
    };
  }

  // Ordem de leitura, não de pontuação: o documento faz mais sentido em sequência.
  escolhidos.sort((a, b) => a.i - b.i);

  return {
    trechos: escolhidos.map((e, n) => ({
      rotulo: `${prefixoRotulo}${n + 1}`,
      texto: e.texto,
    })),
    cobertura: usado / texto.length,
  };
}
