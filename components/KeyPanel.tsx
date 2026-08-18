"use client";

import { useState } from "react";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { SEARCH_PROVIDERS, type SearchProviderId } from "@/lib/search";
import type { AgentSettings, BuscaSettings, Settings } from "@/lib/useKeys";

type Props = {
  settings: Settings;
  busca: BuscaSettings;
  atualizarBusca: (patch: Partial<BuscaSettings>) => void;
  verificarBusca: (p: SearchProviderId, apiKey: string) => Promise<void>;
  atualizar: (p: ProviderId, patch: Partial<AgentSettings>) => void;
  verificar: (p: ProviderId, apiKey: string) => Promise<void>;
  limparTudo: () => void;
  onFechar: () => void;
};

const ORDEM: ProviderId[] = ["anthropic", "openai", "deepseek"];

export function KeyPanel({
  settings,
  busca,
  atualizarBusca,
  verificarBusca,
  atualizar,
  verificar,
  limparTudo,
  onFechar,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8">
      <div className="rise w-full max-w-2xl rounded-xl border border-line bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Chaves de API</h2>
            <p className="mt-0.5 text-xs text-muted">
              Ficam apenas neste navegador. Nada é salvo no servidor.
            </p>
          </div>
          <button
            onClick={onFechar}
            className="rounded-md px-2.5 py-1 text-xs text-muted transition hover:bg-panel-2 hover:text-fg"
          >
            Fechar
          </button>
        </header>

        <div className="divide-y divide-line-soft">
          {ORDEM.map((p) => (
            <ProviderRow
              key={p}
              provider={p}
              s={settings[p]}
              atualizar={atualizar}
              verificar={verificar}
            />
          ))}
        </div>

        <BuscaRow busca={busca} atualizar={atualizarBusca} verificar={verificarBusca} />

        <footer className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-dim">
            As chaves são enviadas ao servidor local apenas para repassar a chamada à API do
            provedor. Use chaves com limite de gasto definido no painel de cada fornecedor.
          </p>
          <button
            onClick={limparTudo}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs text-muted transition hover:border-danger/60 hover:text-danger"
          >
            Apagar todas as chaves
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Busca web: opcional e separada dos agentes.
 * Com ela, o servidor pesquisa uma vez e entrega o mesmo dossiê aos três.
 */
function BuscaRow({
  busca,
  atualizar,
  verificar,
}: {
  busca: BuscaSettings;
  atualizar: Props["atualizarBusca"];
  verificar: Props["verificarBusca"];
}) {
  const [visivel, setVisivel] = useState(false);
  const info = SEARCH_PROVIDERS[busca.provider];

  return (
    <div className="border-t border-line bg-panel-2/40 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-sm">🔍</span>
          <span className="text-sm font-medium">Busca web</span>
          <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-dim">
            opcional
          </span>
          {busca.status === "ok" && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              chave válida
            </span>
          )}
          {busca.status === "erro" && (
            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
              falhou
            </span>
          )}
          {busca.status === "verificando" && (
            <span className="text-[10px] text-muted">verificando…</span>
          )}
        </div>

        {busca.status === "ok" && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={busca.ativa}
              onChange={(e) => atualizar({ ativa: e.target.checked })}
              className="size-3.5"
              style={{ accentColor: "#e8b64c" }}
            />
            Usar nos duelos
          </label>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-dim">
        O servidor pesquisa uma vez e entrega o <strong className="text-muted">mesmo</strong>{" "}
        dossiê de fontes aos três agentes, e o árbitro passa a cobrar citação. Sem chave, o duelo
        funciona como antes — comparando só o que os modelos memorizaram.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          value={busca.provider}
          onChange={(e) =>
            atualizar({
              provider: e.target.value as SearchProviderId,
              status: busca.apiKey ? "vazio" : "vazio",
            })
          }
          className="shrink-0 rounded-md border border-line bg-panel-2 px-2 py-2 text-xs outline-none focus:border-dim"
        >
          {(Object.keys(SEARCH_PROVIDERS) as SearchProviderId[]).map((p) => (
            <option key={p} value={p}>
              {SEARCH_PROVIDERS[p].label}
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <input
            type={visivel ? "text" : "password"}
            value={busca.apiKey}
            placeholder={busca.provider === "tavily" ? "tvly-..." : "BSA..."}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => atualizar({ apiKey: e.target.value, status: "vazio" })}
            onBlur={(e) => {
              if (e.target.value.trim() && busca.status !== "ok") {
                verificar(busca.provider, e.target.value);
              }
            }}
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 pr-16 font-mono text-xs text-fg outline-none transition placeholder:text-dim focus:border-dim"
          />
          {busca.apiKey && (
            <button
              onClick={() => setVisivel((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-dim transition hover:text-fg"
            >
              {visivel ? "ocultar" : "ver"}
            </button>
          )}
        </div>

        <button
          onClick={() => verificar(busca.provider, busca.apiKey)}
          disabled={!busca.apiKey.trim() || busca.status === "verificando"}
          className="shrink-0 rounded-md border border-line bg-panel-2 px-3 py-2 text-xs font-medium transition hover:border-dim disabled:opacity-40"
        >
          Verificar
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-dim">
          {info.nota} Cerca de US$ {info.custoPorBusca.toFixed(3)} por busca.
        </span>
        <a
          href={info.docsKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-dim underline underline-offset-2 transition hover:text-muted"
        >
          obter chave
        </a>
      </div>

      {busca.error && <p className="mt-2 text-[11px] text-danger">{busca.error}</p>}
    </div>
  );
}

function ProviderRow({
  provider,
  s,
  atualizar,
  verificar,
}: {
  provider: ProviderId;
  s: AgentSettings;
  atualizar: Props["atualizar"];
  verificar: Props["verificar"];
}) {
  const [visivel, setVisivel] = useState(false);
  const info = PROVIDERS[provider];

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="size-2.5 rounded-full"
            style={{ background: info.accent, boxShadow: `0 0 10px ${info.accent}66` }}
          />
          <span className="text-sm font-medium">{info.label}</span>
          <Status s={s} />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => atualizar(provider, { enabled: e.target.checked })}
            className="size-3.5 accent-current"
            style={{ accentColor: info.accent }}
          />
          Participa
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            type={visivel ? "text" : "password"}
            value={s.apiKey}
            placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => atualizar(provider, { apiKey: e.target.value, status: "vazio" })}
            onBlur={(e) => {
              if (e.target.value.trim() && s.status !== "ok") verificar(provider, e.target.value);
            }}
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 pr-16 font-mono text-xs text-fg outline-none transition placeholder:text-dim focus:border-dim"
          />
          {s.apiKey && (
            <button
              onClick={() => setVisivel((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-dim transition hover:text-fg"
            >
              {visivel ? "ocultar" : "ver"}
            </button>
          )}
        </div>

        <button
          onClick={() => verificar(provider, s.apiKey)}
          disabled={!s.apiKey.trim() || s.status === "verificando"}
          className="shrink-0 rounded-md border border-line bg-panel-2 px-3 py-2 text-xs font-medium transition hover:border-dim disabled:opacity-40"
        >
          {s.status === "verificando" ? "Verificando…" : "Verificar"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-dim">Modelo</span>
        <select
          value={s.model}
          onChange={(e) => atualizar(provider, { model: e.target.value })}
          className="max-w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-fg outline-none focus:border-dim"
        >
          {s.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {s.status !== "ok" && (
          <a
            href={info.docsKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-dim underline underline-offset-2 transition hover:text-muted"
          >
            obter chave
          </a>
        )}
      </div>

      {s.error && <p className="mt-2 text-[11px] text-danger">{s.error}</p>}
    </div>
  );
}

function Status({ s }: { s: AgentSettings }) {
  if (s.status === "ok") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
        {s.models.length} modelos
      </span>
    );
  }
  if (s.status === "verificando") {
    return <span className="text-[10px] text-muted">verificando…</span>;
  }
  if (s.status === "erro") {
    return (
      <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
        falhou
      </span>
    );
  }
  return <span className="text-[10px] text-dim">sem chave</span>;
}
