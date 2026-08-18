import { extrair, LIMITE_CARACTERES } from "@/lib/extract";
import {
  baixarParaDisco,
  gravarBytes,
  gravarExtracao,
  gravarMeta,
  lerMeta,
  LIMITE_BYTES,
  listarDocumentos,
  prepararUpload,
  removerDocumento,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const EXTENSOES_ACEITAS = [
  "xlsx", "xlsm", "csv", "tsv",
  "pdf",
  "docx",
  "md", "markdown", "txt", "json", "log", "yaml", "yml",
  // Imagens: lidas por reconhecimento de texto.
  "png", "jpg", "jpeg", "webp", "gif",
];

function extensaoAceita(nome: string): boolean {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  return EXTENSOES_ACEITAS.includes(ext);
}

/** Lista os documentos guardados. */
export async function GET() {
  try {
    const documentos = await listarDocumentos();
    return Response.json({ documentos }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[documentos] falha ao listar:", err);
    return Response.json(
      { error: "Não foi possível carregar os documentos." },
      { status: 500 },
    );
  }
}

/**
 * Três ações, distinguidas pelo campo `acao`:
 *  - `preparar`: devolve destino do upload (URL assinada, ou envio pela API)
 *  - `enviar`: recebe os bytes (apenas quando não há Supabase)
 *  - `processar`: extrai o conteúdo do arquivo já armazenado
 */
export async function POST(req: Request) {
  const tipoConteudo = req.headers.get("content-type") ?? "";

  // Envio pela própria API (driver de disco): multipart.
  if (tipoConteudo.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      const id = String(form.get("id") ?? "");
      const arquivo = form.get("arquivo");

      if (!id || !(arquivo instanceof File)) {
        return Response.json({ error: "Envio inválido." }, { status: 400 });
      }
      if (arquivo.size > LIMITE_BYTES) {
        return Response.json({ error: "Arquivo acima de 100 MB." }, { status: 413 });
      }

      const meta = await lerMeta(id);
      if (!meta) return Response.json({ error: "Documento não encontrado." }, { status: 404 });

      await gravarBytes(id, meta.nome, Buffer.from(await arquivo.arrayBuffer()));
      return Response.json({ ok: true });
    } catch (err) {
      console.error("[documentos] falha no envio:", err);
      return Response.json({ error: "Falha ao receber o arquivo." }, { status: 500 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const acao = String(body.acao ?? "");

  if (acao === "preparar") {
    const nome = String(body.nome ?? "").trim();
    const mime = String(body.mime ?? "application/octet-stream");
    const bytes = Number(body.bytes ?? 0);

    if (!nome) return Response.json({ error: "Nome do arquivo ausente." }, { status: 400 });
    if (!extensaoAceita(nome)) {
      return Response.json(
        {
          error:
            "Formato não aceito. Envie planilha, PDF, Word, texto, JSON ou imagem (PNG, JPG, WebP).",
        },
        { status: 415 },
      );
    }
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return Response.json({ error: "Tamanho do arquivo inválido." }, { status: 400 });
    }
    if (bytes > LIMITE_BYTES) {
      return Response.json({ error: "Arquivo acima de 100 MB." }, { status: 413 });
    }

    try {
      // Reenvio do mesmo arquivo não deve criar duplicata: nome e tamanho
      // idênticos, já lido com sucesso, é o mesmo documento.
      const existentes = await listarDocumentos();
      const igual = existentes.find(
        (d) => d.nome === nome && d.bytes === bytes && d.estado === "pronto",
      );
      if (igual) {
        return Response.json({ modo: "reaproveitado", id: igual.id, documento: igual });
      }

      const destino = await prepararUpload(nome, mime, bytes);
      return Response.json(destino);
    } catch (err) {
      console.error("[documentos] falha ao preparar:", err);
      return Response.json(
        { error: "O armazenamento não está configurado. Fale com o administrador." },
        { status: 503 },
      );
    }
  }

  if (acao === "processar") {
    const id = String(body.id ?? "");
    const meta = await lerMeta(id);
    if (!meta) return Response.json({ error: "Documento não encontrado." }, { status: 404 });

    try {
      await gravarMeta({ ...meta, estado: "processando" });

      const caminho = await baixarParaDisco(meta);
      const extracao = await extrair(caminho, meta.nome, meta.mime);

      await gravarExtracao(id, extracao.texto);

      const atualizado = {
        ...meta,
        estado: extracao.texto ? ("pronto" as const) : ("erro" as const),
        tipo: extracao.tipo,
        resumoEstrutura: extracao.resumoEstrutura,
        caracteres: extracao.caracteresOriginais,
        aviso: extracao.aviso,
        erro: extracao.texto ? undefined : "Nenhum texto pôde ser extraído deste arquivo.",
      };
      await gravarMeta(atualizado);

      return Response.json({
        documento: atualizado,
        // Sinaliza se a análise vai precisar recortar por relevância.
        recorteNecessario: extracao.caracteresOriginais > LIMITE_CARACTERES,
      });
    } catch (err) {
      console.error("[documentos] falha ao processar:", err);
      await gravarMeta({
        ...meta,
        estado: "erro",
        erro: "Não foi possível ler este arquivo. Verifique se ele não está corrompido ou protegido por senha.",
      });
      return Response.json(
        { error: "Não foi possível ler este arquivo." },
        { status: 422 },
      );
    }
  }

  return Response.json({ error: "Ação desconhecida." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Documento não informado." }, { status: 400 });

  try {
    await removerDocumento(id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[documentos] falha ao remover:", err);
    return Response.json({ error: "Não foi possível remover." }, { status: 500 });
  }
}
