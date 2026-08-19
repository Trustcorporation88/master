"use client";

import { useCallback, useState } from "react";

/**
 * Proposta de alteração no repositório.
 *
 * Duas etapas de propósito: gerar mostra o que seria feito, aplicar é o único
 * ponto que escreve. Nada vai para o GitHub sem o segundo clique — e mesmo
 * então, sempre como pull request numa branch nova, nunca direto na base.
 */

type Arquivo = { caminho: string; conteudo: string };

type Proposta = {
  possivel: boolean;
  titulo: string;
  descricao: string;
  arquivos: Arquivo[];
  riscos: string[];
  faltando: string[];
};

/**
 * Envia o pedido e espera o resultado, aceitando resposta em fluxo.
 *
 * O servidor responde por SSE nas ações longas: comentários de sinal de vida
 * enquanto trabalha, e o resultado no último quadro. Sem isso, a requisição fica
 * calada por minutos e é cortada pela borda da rede — o cliente recebia a página
 * de erro em HTML e falhava ao ler como JSON.
 *
 * Continua aceitando JSON direto, que é como as validações rápidas respondem.
 */
async function pedir(corpo: unknown): Promise<{ status: number; dados: Record<string, unknown> }> {
  const res = await fetch("/api/proposta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });

  const tipo = res.headers.get("content-type") ?? "";

  if (!tipo.includes("text/event-stream")) {
    const dados = await res.json().catch(() => ({}));
    return { status: res.status, dados };
  }

  if (!res.body) throw new Error("Resposta vazia do servidor.");

  const leitor = res.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = "";
  let ultimo: { status: number; corpo: Record<string, unknown> } | null = null;

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });

    let corte: number;
    while ((corte = buffer.indexOf("\n\n")) !== -1) {
      const quadro = buffer.slice(0, corte);
      buffer = buffer.slice(corte + 2);
      const linha = quadro.split("\n").find((l) => l.startsWith("data:"));
      if (!linha) continue; // comentário de sinal de vida
      try {
        ultimo = JSON.parse(linha.slice(5).trim());
      } catch {
        /* quadro parcial */
      }
    }
  }

  if (!ultimo) throw new Error("A conexão terminou antes do resultado.");
  return { status: ultimo.status, dados: ultimo.corpo };
}

export function PropostaCodigo({
  documentoId,
  pergunta,
  resposta,
}: {
  documentoId: string;
  pergunta: string;
  resposta: string;
}) {
  const [gerando, setGerando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [repo, setRepo] = useState("");
  const [base, setBase] = useState("");
  const [temCi, setTemCi] = useState(false);
  const [recusados, setRecusados] = useState<Array<{ caminho: string; motivo: string }>>([]);
  const [pr, setPr] = useState<{ url: string; numero: number; branch: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verArquivo, setVerArquivo] = useState<string | null>(null);

  const gerar = useCallback(async () => {
    setGerando(true);
    setErro(null);
    setPr(null);

    try {
      const { status, dados } = await pedir({ acao: "gerar", documentoId, pergunta, resposta });
      if (status < 200 || status >= 300) {
        throw new Error(String(dados.error ?? "Não foi possível preparar a proposta."));
      }

      const data = dados as {
        proposta: Proposta;
        repo?: string;
        base?: string;
        temValidacaoDePr?: boolean;
        recusados?: Array<{ caminho: string; motivo: string }>;
      };

      setProposta(data.proposta);
      setRepo(data.repo ?? "");
      setBase(data.base ?? "");
      setTemCi(Boolean(data.temValidacaoDePr));
      setRecusados(data.recusados ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao preparar a proposta.");
    } finally {
      setGerando(false);
    }
  }, [documentoId, pergunta, resposta]);

  const aplicar = useCallback(async () => {
    if (!proposta) return;
    setAplicando(true);
    setErro(null);

    try {
      const { status, dados } = await pedir({ acao: "aplicar", documentoId, proposta });
      if (status < 200 || status >= 300) {
        throw new Error(String(dados.error ?? "Não foi possível abrir o pull request."));
      }

      setPr(dados.pr as { url: string; numero: number; branch: string });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao abrir o pull request.");
    } finally {
      setAplicando(false);
    }
  }, [documentoId, proposta]);

  return (
    <div className="border-t border-linha bg-papel/60 px-6 py-4">
      {!proposta && !pr && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] leading-relaxed text-tinta-media">
            Esta análise leu um repositório. Quer transformá-la em alterações de código?
          </p>
          <button
            onClick={gerar}
            disabled={gerando}
            className="shrink-0 rounded-lg border border-marca px-3.5 py-2 text-[12.5px] font-medium text-marca transition hover:bg-marca hover:text-white disabled:opacity-40"
          >
            {gerando ? "Preparando…" : "Propor alterações"}
          </button>
        </div>
      )}

      {proposta && !pr && (
        <div className="surgir">
          {!proposta.possivel ? (
            <div>
              <p className="text-[13px] font-medium text-tinta">
                Não dá para propor código com segurança aqui.
              </p>
              {proposta.riscos.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {proposta.riscos.map((r, i) => (
                    <li key={i} className="text-[12.5px] leading-relaxed text-tinta-media">
                      — {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-tinta">{proposta.titulo}</h3>
                <span className="font-mono text-[11px] text-tinta-clara">
                  {repo} · base {base}
                </span>
              </div>

              {proposta.descricao && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-tinta-media">
                  {proposta.descricao}
                </p>
              )}

              <ul className="mt-3 divide-y divide-linha rounded-lg border border-linha bg-branco">
                {proposta.arquivos.map((a) => (
                  <li key={a.caminho}>
                    <button
                      onClick={() => setVerArquivo(verArquivo === a.caminho ? null : a.caminho)}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-left transition hover:bg-papel"
                    >
                      <span className="truncate font-mono text-[12px] text-tinta">{a.caminho}</span>
                      <span className="shrink-0 text-[11px] text-tinta-clara">
                        {(a.conteudo.length / 1024).toFixed(1)} KB ·{" "}
                        {verArquivo === a.caminho ? "ocultar" : "ver"}
                      </span>
                    </button>
                    {verArquivo === a.caminho && (
                      <pre className="max-h-80 overflow-auto border-t border-linha bg-[#16191f] px-3.5 py-3 text-[11.5px] leading-relaxed text-[#e3e6ec]">
                        {a.conteudo}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>

              {proposta.riscos.length > 0 && (
                <div className="mt-3 rounded-lg border border-realce/25 bg-realce/5 px-3.5 py-3">
                  <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-realce">
                    Riscos apontados
                  </h4>
                  <ul className="space-y-1">
                    {proposta.riscos.map((r, i) => (
                      <li key={i} className="text-[12px] leading-relaxed text-tinta-media">
                        — {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {proposta.faltando.length > 0 && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-tinta-clara">
                  Arquivos que não estavam no contexto e ficaram de fora:{" "}
                  {proposta.faltando.join(", ")}.
                </p>
              )}

              {recusados.length > 0 && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-alerta">
                  Caminhos bloqueados por segurança:{" "}
                  {recusados.map((r) => `${r.caminho} (${r.motivo})`).join("; ")}.
                </p>
              )}

              {/* O aviso mais importante da tela. */}
              <div
                className={`mt-3 rounded-lg border px-3.5 py-3 ${
                  temCi ? "border-linha bg-branco" : "border-alerta/30 bg-alerta/5"
                }`}
              >
                <p className="text-[12px] leading-relaxed text-tinta-media">
                  {temCi ? (
                    <>
                      Este código <strong>não foi executado nem testado</strong>. O repositório tem
                      verificação automática em pull request, que vai rodar assim que o PR abrir —
                      confira o resultado antes de mesclar.
                    </>
                  ) : (
                    <>
                      <strong className="text-alerta">Este código não foi executado nem testado</strong>
                      , e este repositório não tem verificação automática em pull request. Nada vai
                      conferir se ele funciona além de você. Revise linha a linha antes de mesclar.
                    </>
                  )}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={aplicar}
                  disabled={aplicando}
                  className="rounded-lg bg-marca px-4 py-2 text-[13px] font-medium text-white transition hover:bg-marca-clara disabled:opacity-40"
                >
                  {aplicando ? "Abrindo…" : "Abrir pull request"}
                </button>
                <button
                  onClick={() => setProposta(null)}
                  disabled={aplicando}
                  className="rounded-lg border border-linha px-3.5 py-2 text-[12.5px] text-tinta-media transition hover:border-linha-forte disabled:opacity-40"
                >
                  Descartar
                </button>
                <span className="text-[11px] text-tinta-clara">
                  Vai para uma branch nova, nunca direto na {base}.
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {pr && (
        <div className="surgir rounded-lg border border-sucesso/25 bg-sucesso/5 px-4 py-3">
          <p className="text-[13px] text-tinta">
            Pull request{" "}
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-marca-clara underline underline-offset-2"
            >
              #{pr.numero}
            </a>{" "}
            aberto na branch <span className="font-mono text-[12px]">{pr.branch}</span>.
          </p>
          <p className="mt-1 text-[11.5px] text-tinta-media">
            Revise no GitHub antes de mesclar. Para desfazer, basta fechar o PR e apagar a branch.
          </p>
        </div>
      )}

      {erro && <p className="mt-3 text-[12px] text-alerta">{erro}</p>}
    </div>
  );
}
