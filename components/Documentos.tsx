"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Repositorios } from "./Repositorios";

/**
 * Painel de documentos.
 *
 * O upload vai DIRETO para o armazenamento por URL assinada quando disponível —
 * é o que permite 100 MB sem passar pelo servidor do app. Em desenvolvimento,
 * sem armazenamento externo, o arquivo sobe pela própria API.
 */

export type Documento = {
  id: string;
  nome: string;
  bytes: number;
  criadoEm: string;
  tipo?: string;
  resumoEstrutura?: string;
  aviso?: string;
  estado: "aguardando" | "processando" | "pronto" | "erro";
  erro?: string;
};

const LIMITE_MB = 100;

const ACEITOS =
  ".xlsx,.xlsm,.csv,.tsv,.pdf,.docx,.md,.markdown,.txt,.json,.log,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif";

export function Documentos({
  documentos,
  selecionados,
  onAlternar,
  onMudou,
  rodando,
}: {
  documentos: Documento[];
  selecionados: Set<string>;
  onAlternar: (id: string) => void;
  onMudou: () => void;
  rodando: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const enviar = useCallback(
    async (arquivos: FileList | File[]) => {
      setErro(null);

      for (const arquivo of Array.from(arquivos)) {
        if (arquivo.size > LIMITE_MB * 1024 * 1024) {
          setErro(`"${arquivo.name}" passa de ${LIMITE_MB} MB.`);
          continue;
        }

        setEnviando(arquivo.name);
        setProgresso(0);

        try {
          // 1) Onde gravar
          const prep = await fetch("/api/documentos", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              acao: "preparar",
              nome: arquivo.name,
              mime: arquivo.type,
              bytes: arquivo.size,
            }),
          });
          const destino = await prep.json();
          if (!prep.ok) throw new Error(destino.error ?? "Falha ao preparar o envio.");

          // Já existe idêntico: nada a enviar nem a processar.
          if (destino.modo === "reaproveitado") {
            setProgresso(100);
            continue;
          }

          // 2) Enviar os bytes
          const pelaApi = async () => {
            const form = new FormData();
            form.append("id", destino.id);
            form.append("arquivo", arquivo);
            const env = await fetch("/api/documentos", { method: "POST", body: form });
            if (!env.ok) {
              throw new Error((await env.json().catch(() => ({}))).error ?? "Falha no envio.");
            }
            setProgresso(100);
          };

          if (destino.modo === "assinado") {
            try {
              await enviarAssinado(destino.url, arquivo, setProgresso);
            } catch (falhaDireta) {
              // O envio direto ao armazenamento pode estar bloqueado por
              // extensão de navegador, proxy ou firewall — coisas que não dá
              // para consertar daqui. Em vez de desistir, o arquivo sobe pelo
              // próprio servidor, que é mais lento mas passa onde o outro não.
              console.warn("envio direto falhou, tentando pelo servidor:", falhaDireta);
              setProgresso(0);
              try {
                await pelaApi();
              } catch (falhaApi) {
                // Duas falhas seguidas por caminhos diferentes: dizer as duas
                // é o que permite descobrir a causa sem abrir o console.
                const a = falhaDireta instanceof Error ? falhaDireta.message : String(falhaDireta);
                const b = falhaApi instanceof Error ? falhaApi.message : String(falhaApi);
                throw new Error(`Envio direto: ${a} Pelo servidor: ${b}`);
              }
            }
          } else {
            await pelaApi();
          }

          // 3) Ler o conteúdo
          const proc = await fetch("/api/documentos", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ acao: "processar", id: destino.id }),
          });
          if (!proc.ok) {
            const d = await proc.json().catch(() => ({}));
            throw new Error(d.error ?? "Não foi possível ler o arquivo.");
          }

          onMudou();
        } catch (e) {
          setErro(e instanceof Error ? e.message : "Falha no envio.");
        } finally {
          setEnviando(null);
          setProgresso(0);
        }
      }

      onMudou();
      setAberto(true);
    },
    [onMudou],
  );

  /**
   * Arrastar para qualquer lugar da janela.
   *
   * Exigir acerto no retângulo pontilhado é uma armadilha: quem erra por vinte
   * pixels não vê nada acontecer. E deixar o navegador cuidar do resto é pior
   * ainda, porque ele abre o arquivo na aba e descarta a análise em andamento.
   *
   * Então a janela inteira recebe: soltar em qualquer ponto envia, e enquanto o
   * arquivo está sobre a página o painel abre e a área acende, para deixar claro
   * para onde ele vai.
   */
  useEffect(() => {
    const temArquivo = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const sobre = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      setArrastando(true);
      setAberto(true);
    };

    // dragleave dispara ao cruzar fronteira entre elementos filhos, então só
    // conta quando o ponteiro sai de verdade da janela.
    const saiu = (e: DragEvent) => {
      if (e.relatedTarget === null) setArrastando(false);
    };

    const soltar = (e: DragEvent) => {
      // Bloqueia sempre: sem isso o navegador abre o arquivo e perde a página.
      e.preventDefault();
      setArrastando(false);
      const arquivos = e.dataTransfer?.files;
      if (arquivos?.length) enviar(arquivos);
    };

    window.addEventListener("dragover", sobre);
    window.addEventListener("dragleave", saiu);
    window.addEventListener("drop", soltar);
    return () => {
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("dragleave", saiu);
      window.removeEventListener("drop", soltar);
    };
  }, [enviar]);


  const remover = useCallback(
    async (id: string) => {
      await fetch(`/api/documentos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      onMudou();
    },
    [onMudou],
  );

  const prontos = documentos.filter((d) => d.estado === "pronto");
  const nSelecionados = prontos.filter((d) => selecionados.has(d.id)).length;

  return (
    <section className="mt-3 rounded-xl border border-linha bg-branco shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <button
          onClick={() => setAberto((v) => !v)}
          className="flex items-center gap-2 text-left text-[13px] font-medium text-tinta-media transition hover:text-tinta"
        >
          <span>📎</span>
          <span>
            Documentos
            {documentos.length > 0 && (
              <span className="ml-1.5 text-tinta-clara">
                ({documentos.length}
                {nSelecionados > 0 && `, ${nSelecionados} em uso`})
              </span>
            )}
          </span>
          <span className="text-[11px] text-tinta-clara">{aberto ? "▲" : "▼"}</span>
        </button>

        <button
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(enviando) || rodando}
          className="rounded-lg border border-linha-forte px-3 py-1.5 text-[12.5px] font-medium text-tinta-media transition hover:border-marca hover:text-marca disabled:opacity-40"
        >
          {enviando ? `Enviando ${progresso}%` : "Enviar arquivo"}
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACEITOS}
          className="hidden"
          onChange={(e) => e.target.files && enviar(e.target.files)}
        />
      </div>

      {aberto && (
        <div className="border-t border-linha px-5 py-4">
          {/*
            Sem ouvintes de arrastar aqui: quem cuida disso é o efeito na janela.
            Ter os dois faria o mesmo arquivo ser enviado duas vezes quando o
            solto acertasse justamente este retângulo.
          */}
          <div
            className={`rounded-lg border border-dashed px-4 py-6 text-center transition ${
              arrastando ? "border-marca bg-marca/5" : "border-linha-forte"
            }`}
          >
            <p className="text-[13px] text-tinta-media">
              Arraste arquivos aqui, ou{" "}
              <button
                onClick={() => inputRef.current?.click()}
                className="text-marca underline underline-offset-2"
              >
                escolha do computador
              </button>
            </p>
            <p className="mt-1.5 text-[11px] text-tinta-clara">
              Planilha, PDF, Word, Markdown, texto, JSON e imagem · até {LIMITE_MB} MB cada
            </p>
          </div>

          {enviando && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11.5px] text-tinta-media">
                <span className="truncate">{enviando}</span>
                <span className="font-mono">{progresso}%</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-linha">
                <div
                  className="h-full rounded-full bg-marca transition-all"
                  style={{ width: `${progresso}%` }}
                />
              </div>
            </div>
          )}

          {erro && <p className="mt-3 text-[12px] text-alerta">{erro}</p>}

          {documentos.length > 0 && (
            <ul className="mt-4 divide-y divide-linha">
              {documentos.map((d) => (
                <li key={d.id} className="flex items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    checked={selecionados.has(d.id)}
                    disabled={d.estado !== "pronto" || rodando}
                    onChange={() => onAlternar(d.id)}
                    className="mt-1 size-3.5 shrink-0 disabled:opacity-30"
                    style={{ accentColor: "var(--marca)" }}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-tinta">{d.nome}</p>
                    <p className="text-[11px] text-tinta-clara">
                      {formatarBytes(d.bytes)}
                      {d.resumoEstrutura && ` · ${d.resumoEstrutura}`}
                      {d.estado === "processando" && " · lendo…"}
                      {d.estado === "aguardando" && " · aguardando envio"}
                    </p>
                    {d.estado === "erro" && (
                      <p className="mt-1 text-[11.5px] text-alerta">{d.erro}</p>
                    )}
                    {d.aviso && d.estado === "pronto" && (
                      <p className="mt-1 text-[11.5px] leading-relaxed text-realce">{d.aviso}</p>
                    )}
                  </div>

                  <button
                    onClick={() => remover(d.id)}
                    disabled={rodando}
                    className="shrink-0 text-[11.5px] text-tinta-clara transition hover:text-alerta disabled:opacity-30"
                  >
                    remover
                  </button>
                </li>
              ))}
            </ul>
          )}

          {prontos.length > 0 && (
            <p className="mt-3 border-t border-linha pt-3 text-[11px] leading-relaxed text-tinta-clara">
              Marque os documentos que a próxima pergunta deve considerar. Eles ficam guardados —
              não precisa enviar de novo.
            </p>
          )}
        </div>
      )}

      <Repositorios onImportado={onMudou} rodando={rodando} />
    </section>
  );
}

/**
 * Envia direto para o armazenamento, com progresso real.
 *
 * XMLHttpRequest em vez de fetch porque só ele reporta progresso de upload, o
 * que importa quando o arquivo tem 100 MB. Tenta PUT e, se o armazenamento
 * recusar o método, repete com POST.
 */
function enviarAssinado(
  url: string,
  arquivo: File,
  onProgresso: (pct: number) => void,
): Promise<void> {
  const tentativa = (metodo: "PUT" | "POST") =>
    new Promise<number>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(metodo, url);
      xhr.setRequestHeader("x-upsert", "true");
      if (arquivo.type) xhr.setRequestHeader("content-type", arquivo.type);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgresso(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => resolve(xhr.status);
      xhr.onerror = () => reject(new Error("Falha de rede durante o envio."));
      xhr.send(arquivo);
    });

  return (async () => {
    let status = await tentativa("PUT");
    if (status === 405 || status === 400) status = await tentativa("POST");
    // 413 é o caso comum e tem causa específica: o teto de tamanho configurado
    // no armazenamento é menor que o arquivo. Dizer só o código manda quem lê
    // procurar no lugar errado.
    if (status === 413) {
      throw new Error(
        "O arquivo passou do limite de tamanho configurado no armazenamento. " +
          "É preciso aumentar esse limite, ou enviar um arquivo menor.",
      );
    }
    if (status < 200 || status >= 300) {
      throw new Error(`O armazenamento recusou o arquivo (código ${status}).`);
    }
  })();
}

function formatarBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
