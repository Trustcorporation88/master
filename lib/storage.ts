/**
 * Armazenamento de documentos.
 *
 * Dois drivers, mesma interface:
 *  - `supabase`: usado em produção. O navegador envia o arquivo DIRETO para o
 *    Supabase por URL assinada, sem passar pelo servidor do app — é o que
 *    permite 100 MB sem estourar a memória do container nem o timeout de 15
 *    minutos do Railway.
 *  - `disco`: usado quando não há Supabase configurado (desenvolvimento e
 *    testes). O arquivo sobe pela própria API e é gravado em disco local.
 *
 * Metadados vivem como JSON dentro do próprio armazenamento. Isso é
 * deliberado: evita exigir banco de dados e migração SQL para uma
 * funcionalidade que só precisa de uma lista de arquivos.
 *
 * Só servidor.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const LIMITE_BYTES = 100 * 1024 * 1024; // 100 MB por arquivo

export type MetaDoc = {
  id: string;
  nome: string;
  mime: string;
  bytes: number;
  criadoEm: string;
  /** Preenchido após o processamento. */
  tipo?: string;
  resumoEstrutura?: string;
  caracteres?: number;
  aviso?: string;
  estado: "aguardando" | "processando" | "pronto" | "erro";
  erro?: string;
};

const BUCKET = process.env.DUELO_BUCKET?.trim() || "documentos";
const RAIZ_DISCO = join(tmpdir(), "duelo-documentos");

function supabaseConfigurado(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function driverAtual(): "supabase" | "disco" {
  return supabaseConfigurado() ? "supabase" : "disco";
}

let clienteCache: SupabaseClient | null = null;

function cliente(): SupabaseClient {
  if (!clienteCache) {
    clienteCache = createClient(
      process.env.SUPABASE_URL!.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return clienteCache;
}

let bucketPronto = false;

/** Cria o bucket na primeira utilização, para não exigir setup manual. */
async function garantirBucket(): Promise<void> {
  if (bucketPronto || driverAtual() === "disco") return;

  const { data } = await cliente().storage.getBucket(BUCKET);
  if (!data) {
    await cliente().storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: LIMITE_BYTES,
    });
  }
  bucketPronto = true;
}

const caminhoOriginal = (id: string, nome: string) => `${id}/original-${sanitizar(nome)}`;
const caminhoMeta = (id: string) => `${id}/meta.json`;
const caminhoExtracao = (id: string) => `${id}/extracao.txt`;

function sanitizar(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export type Destino =
  | { modo: "assinado"; id: string; url: string; caminho: string }
  | { modo: "servidor"; id: string; caminho: string };

/**
 * Prepara o destino do upload.
 *
 * Com Supabase, devolve uma URL assinada para o navegador enviar direto.
 * Sem Supabase, sinaliza que o arquivo deve subir pela própria API.
 */
export async function prepararUpload(nome: string, mime: string, bytes: number): Promise<Destino> {
  const id = randomUUID();
  const caminho = caminhoOriginal(id, nome);

  const meta: MetaDoc = {
    id,
    nome,
    mime,
    bytes,
    criadoEm: new Date().toISOString(),
    estado: "aguardando",
  };

  if (driverAtual() === "disco") {
    await mkdir(join(RAIZ_DISCO, id), { recursive: true });
    await gravarMeta(meta);
    return { modo: "servidor", id, caminho };
  }

  await garantirBucket();
  await gravarMeta(meta);

  const { data, error } = await cliente().storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error || !data) {
    throw new Error(`Falha ao preparar o envio: ${error?.message ?? "erro desconhecido"}`);
  }

  return { modo: "assinado", id, url: data.signedUrl, caminho };
}

/** Grava bytes recebidos pela própria API (driver de disco). */
export async function gravarBytes(id: string, nome: string, dados: Buffer): Promise<void> {
  if (driverAtual() === "supabase") {
    await garantirBucket();
    const { error } = await cliente()
      .storage.from(BUCKET)
      .upload(caminhoOriginal(id, nome), dados, { upsert: true });
    if (error) throw new Error(error.message);
    return;
  }

  await mkdir(join(RAIZ_DISCO, id), { recursive: true });
  await writeFile(join(RAIZ_DISCO, id, `original-${sanitizar(nome)}`), dados);
}

/* ------------------------------------------------------------------ */
/* Metadados                                                           */
/* ------------------------------------------------------------------ */

export async function gravarMeta(meta: MetaDoc): Promise<void> {
  const conteudo = JSON.stringify(meta, null, 2);

  if (driverAtual() === "disco") {
    await mkdir(join(RAIZ_DISCO, meta.id), { recursive: true });
    await writeFile(join(RAIZ_DISCO, meta.id, "meta.json"), conteudo, "utf-8");
    return;
  }

  await garantirBucket();
  const { error } = await cliente()
    .storage.from(BUCKET)
    .upload(caminhoMeta(meta.id), new Blob([conteudo], { type: "application/json" }), {
      upsert: true,
    });
  if (error) throw new Error(error.message);
}

export async function lerMeta(id: string): Promise<MetaDoc | null> {
  try {
    if (driverAtual() === "disco") {
      const bruto = await readFile(join(RAIZ_DISCO, id, "meta.json"), "utf-8");
      return JSON.parse(bruto) as MetaDoc;
    }

    const { data, error } = await cliente().storage.from(BUCKET).download(caminhoMeta(id));
    if (error || !data) return null;
    return JSON.parse(await data.text()) as MetaDoc;
  } catch {
    return null;
  }
}

/** Lista os documentos, do mais recente para o mais antigo. */
export async function listarDocumentos(): Promise<MetaDoc[]> {
  const ids: string[] = [];

  if (driverAtual() === "disco") {
    try {
      ids.push(...(await readdir(RAIZ_DISCO)));
    } catch {
      return [];
    }
  } else {
    await garantirBucket();
    const { data } = await cliente().storage.from(BUCKET).list("", { limit: 500 });
    ids.push(...(data ?? []).filter((o) => !o.name.includes(".")).map((o) => o.name));
  }

  const metas = await Promise.all(ids.map((id) => lerMeta(id)));
  return metas
    .filter((m): m is MetaDoc => Boolean(m))
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export async function removerDocumento(id: string): Promise<void> {
  if (driverAtual() === "disco") {
    await rm(join(RAIZ_DISCO, id), { recursive: true, force: true });
    return;
  }

  const { data } = await cliente().storage.from(BUCKET).list(id, { limit: 100 });
  const caminhos = (data ?? []).map((o) => `${id}/${o.name}`);
  if (caminhos.length) await cliente().storage.from(BUCKET).remove(caminhos);
}

/* ------------------------------------------------------------------ */
/* Conteúdo                                                            */
/* ------------------------------------------------------------------ */

/** Traz o arquivo para o disco local, para os parsers trabalharem. */
export async function baixarParaDisco(meta: MetaDoc): Promise<string> {
  const nomeArquivo = `original-${sanitizar(meta.nome)}`;

  if (driverAtual() === "disco") {
    return join(RAIZ_DISCO, meta.id, nomeArquivo);
  }

  const { data, error } = await cliente()
    .storage.from(BUCKET)
    .download(caminhoOriginal(meta.id, meta.nome));
  if (error || !data) throw new Error(`Não foi possível baixar o arquivo: ${error?.message}`);

  const destino = join(tmpdir(), `duelo-${meta.id}-${nomeArquivo}`);
  await writeFile(destino, Buffer.from(await data.arrayBuffer()));
  return destino;
}

export async function gravarExtracao(id: string, texto: string): Promise<void> {
  if (driverAtual() === "disco") {
    await writeFile(join(RAIZ_DISCO, id, "extracao.txt"), texto, "utf-8");
    return;
  }

  const { error } = await cliente()
    .storage.from(BUCKET)
    .upload(caminhoExtracao(id), new Blob([texto], { type: "text/plain" }), { upsert: true });
  if (error) throw new Error(error.message);
}

export async function lerExtracao(id: string): Promise<string | null> {
  try {
    if (driverAtual() === "disco") {
      return await readFile(join(RAIZ_DISCO, id, "extracao.txt"), "utf-8");
    }

    const { data, error } = await cliente().storage.from(BUCKET).download(caminhoExtracao(id));
    if (error || !data) return null;
    return await data.text();
  } catch {
    return null;
  }
}
