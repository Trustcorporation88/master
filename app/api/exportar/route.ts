import { lerConversa } from "@/lib/conversas";
import { CONFIANCA_LABEL } from "@/lib/publicTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Exporta uma conversa como planilha.
 *
 * A planilha existe para quem vai continuar trabalhando o conteúdo: filtrar,
 * anotar, cruzar com outra base. Por isso cada turno é uma linha, com a
 * resposta inteira numa célula, e as fontes ficam numa aba própria — link por
 * link, conferível.
 *
 * O PDF não sai daqui: ele é gerado pela impressão da página `/imprimir/<id>`,
 * que reaproveita a tipografia e as tabelas do próprio site. Montar PDF à mão
 * no servidor daria um documento pior, com tabela de markdown achatada.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Informe a conversa." }, { status: 400 });

  const conversa = await lerConversa(id);
  if (!conversa) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });

  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();

    const analise = wb.addWorksheet("Análise", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    analise.columns = [
      { header: "Nº", key: "n", width: 5 },
      { header: "Data", key: "data", width: 18 },
      { header: "Pergunta", key: "pergunta", width: 50 },
      { header: "Resposta", key: "resposta", width: 100 },
      { header: "Confiança", key: "confianca", width: 16 },
      { header: "Pontos a verificar", key: "ressalvas", width: 50 },
      { header: "Documentos usados", key: "documentos", width: 34 },
    ];
    analise.getRow(1).font = { bold: true };

    conversa.turnos.forEach((t, i) => {
      const linha = analise.addRow({
        n: i + 1,
        data: new Date(t.criadoEm).toLocaleString("pt-BR"),
        pergunta: t.pergunta,
        resposta: t.resposta,
        confianca: t.confianca ? CONFIANCA_LABEL[t.confianca].label : "—",
        ressalvas: t.ressalvas.map((r, k) => `${k + 1}. ${r}`).join("\n") || "—",
        documentos: t.documentos.join("\n") || "—",
      });
      // Sem quebra de linha a célula vira uma tira ilegível de mil caracteres.
      linha.alignment = { vertical: "top", wrapText: true };
    });

    const fontes = wb.addWorksheet("Fontes", { views: [{ state: "frozen", ySplit: 1 }] });
    fontes.columns = [
      { header: "Pergunta nº", key: "turno", width: 12 },
      { header: "Ref.", key: "n", width: 7 },
      { header: "Título", key: "titulo", width: 60 },
      { header: "Endereço", key: "url", width: 70 },
      { header: "Data", key: "data", width: 14 },
    ];
    fontes.getRow(1).font = { bold: true };

    conversa.turnos.forEach((t, i) => {
      for (const f of t.fontes) {
        fontes.addRow({
          turno: i + 1,
          n: `[${f.n}]`,
          titulo: f.titulo,
          url: f.url,
          data: f.data ?? "",
        });
      }
    });

    const buffer = await wb.xlsx.writeBuffer();

    return new Response(buffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${nomeArquivo(conversa.titulo)}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[exportar] falha ao gerar planilha:", err);
    return Response.json({ error: "Não foi possível gerar a planilha." }, { status: 500 });
  }
}

/** Nome de arquivo seguro para cabeçalho HTTP e para Windows. */
function nomeArquivo(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 60);

  return base ? `analise-${base}` : "analise";
}
