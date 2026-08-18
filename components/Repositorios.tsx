"use client";

import { useCallback, useState } from "react";

/**
 * Importação de repositório do GitHub.
 *
 * Um repositório vira um documento como qualquer outro — o nome carrega o
 * commit (`owner/repo@abc1234`), então reimportar a mesma versão reaproveita o
 * que já está gravado, e um push novo gera uma entrada nova.
 */

export type RepoResumo = {
  nomeCompleto: string;
  privado: boolean;
  branchPadrao: string;
  descricao?: string;
};

export function Repositorios({
  onImportado,
  rodando,
}: {
  onImportado: () => void;
  rodando: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [repos, setRepos] = useState<RepoResumo[] | null>(null);
  const [somentePublicos, setSomentePublicos] = useState(false);
  const [manual, setManual] = useState("");
  const [indisponivel, setIndisponivel] = useState(false);
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  /** Só busca a lista quando o painel abre: evita chamada à toa. */
  const abrir = useCallback(async () => {
    const proximo = !aberto;
    setAberto(proximo);
    if (!proximo || repos !== null || carregando) return;

    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/repos");
      const data = await res.json();

      if (data.configurado === false) {
        setIndisponivel(true);
        setRepos([]);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Falha ao listar repositórios.");

      setSomentePublicos(Boolean(data.somentePublicos));
      setRepos(data.repos ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao consultar o GitHub.");
      setRepos([]);
    } finally {
      setCarregando(false);
    }
  }, [aberto, repos, carregando]);

  const escolherRepo = useCallback(
    async (nomeCompleto: string) => {
      setRepo(nomeCompleto);
      setBranch("");
      setBranches([]);
      setErro(null);
      setFeito(null);
      if (!nomeCompleto) return;

      const padrao = repos?.find((r) => r.nomeCompleto === nomeCompleto)?.branchPadrao ?? "";
      setBranch(padrao);

      try {
        const res = await fetch(`/api/repos?repo=${encodeURIComponent(nomeCompleto)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Repositório não encontrado.");

        if (Array.isArray(data.branches)) setBranches(data.branches);

        // Repositório digitado à mão não está na lista, então a branch padrão
        // precisa vir do próprio GitHub — senão nada fica selecionado.
        if (!padrao) setBranch(data.branchPadrao || data.branches?.[0] || "");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível ler o repositório.");
      }
    },
    [repos],
  );

  const importar = useCallback(async () => {
    if (!repo || !branch || importando) return;

    setImportando(true);
    setErro(null);
    setFeito(null);

    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível importar.");

      setFeito(data.documento?.nome ?? repo);
      onImportado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha na importação.");
    } finally {
      setImportando(false);
    }
  }, [repo, branch, importando, onImportado]);

  return (
    <div className="border-t border-linha">
      <button
        onClick={abrir}
        className="flex w-full items-center justify-between px-5 py-3 text-left transition hover:bg-papel"
      >
        <span className="flex items-center gap-2 text-[13px] font-medium text-tinta-media">
          <span>🗂️</span>
          Repositórios do GitHub
        </span>
        <span className="text-[11px] text-tinta-clara">{aberto ? "▲" : "▼"}</span>
      </button>

      {aberto && (
        <div className="border-t border-linha px-5 py-4">
          {carregando && <p className="text-[12.5px] text-tinta-clara">Carregando repositórios…</p>}

          {indisponivel && (
            <p className="text-[12.5px] leading-relaxed text-tinta-media">
              A conexão com o GitHub não está configurada neste ambiente. Fale com o administrador
              para adicionar o token de acesso.
            </p>
          )}

          {!carregando && !indisponivel && repos && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1">
                  <span className="mb-1.5 block text-[10.5px] font-medium uppercase tracking-wider text-tinta-clara">
                    Repositório
                  </span>
                  <select
                    value={repo}
                    onChange={(e) => escolherRepo(e.target.value)}
                    disabled={rodando || importando}
                    className="w-full rounded-lg border border-linha-forte bg-papel px-3 py-2 text-[13px] outline-none focus:border-marca disabled:opacity-50"
                  >
                    <option value="">Escolha um repositório…</option>
                    {repos.map((r) => (
                      <option key={r.nomeCompleto} value={r.nomeCompleto}>
                        {r.nomeCompleto}
                        {r.privado ? " (privado)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="sm:w-44">
                  <span className="mb-1.5 block text-[10.5px] font-medium uppercase tracking-wider text-tinta-clara">
                    Branch
                  </span>
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    disabled={!repo || rodando || importando}
                    className="w-full rounded-lg border border-linha-forte bg-papel px-3 py-2 text-[13px] outline-none focus:border-marca disabled:opacity-50"
                  >
                    {branch && !branches.includes(branch) && (
                      <option value={branch}>{branch}</option>
                    )}
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={importar}
                  disabled={!repo || !branch || rodando || importando}
                  className="shrink-0 rounded-lg bg-marca px-4 py-2 text-[13px] font-medium text-white transition hover:bg-marca-clara disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {importando ? "Importando…" : "Importar"}
                </button>
              </div>

              {/* Escape para repositório fora da lista, ou público de terceiros. */}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-[11.5px] text-tinta-clara">
                  {somentePublicos ? "Informe um repositório público:" : "Ou informe direto:"}
                </span>
                <input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  onBlur={() => manual.includes("/") && escolherRepo(manual.trim())}
                  placeholder="dono/repositorio"
                  spellCheck={false}
                  className="flex-1 rounded-lg border border-linha-forte bg-papel px-3 py-1.5 font-mono text-[12.5px] outline-none focus:border-marca"
                />
              </div>

              {repos.length === 0 && !somentePublicos && (
                <p className="mt-3 text-[12px] text-tinta-clara">
                  Nenhum repositório disponível para este token.
                </p>
              )}

              <p className="mt-3 text-[11px] leading-relaxed text-tinta-clara">
                O código entra como contexto da análise: a estrutura completa mais o conteúdo dos
                arquivos de código e documentação. Dependências, binários e arquivos gerados ficam
                de fora. Cada commit é guardado separadamente — reimportar a mesma versão não custa
                nada.
              </p>
            </>
          )}

          {feito && (
            <p className="mt-3 rounded-lg border border-sucesso/25 bg-sucesso/5 px-3 py-2 text-[12.5px] text-sucesso">
              {feito} importado e pronto para uso.
            </p>
          )}

          {erro && <p className="mt-3 text-[12px] text-alerta">{erro}</p>}
        </div>
      )}
    </div>
  );
}
