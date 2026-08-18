"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { KeyPanel } from "@/components/KeyPanel";
import { AgentColumn, type Block } from "@/components/AgentColumn";
import { VerdictPanel } from "@/components/VerdictPanel";
import { SourcesPanel } from "@/components/SourcesPanel";
import { SEARCH_PROVIDERS, type Fonte } from "@/lib/search";
import { useKeys } from "@/lib/useKeys";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { estimarCusto, formatarUSD } from "@/lib/pricing";
import { baixarMarkdown, duelParaMarkdown } from "@/lib/export";
import {
  STRATEGY_INFO,
  type ConvergenceMetrics,
  type DuelEvent,
  type Strategy,
  type Verdict,
} from "@/lib/duel/types";

const ORDEM: ProviderId[] = ["anthropic", "openai", "deepseek"];
const ESTRATEGIAS = Object.keys(STRATEGY_INFO) as Strategy[];

export default function Home() {
  const {
    settings,
    atualizar,
    verificar,
    limparTudo,
    prontos,
    carregado,
    historico,
    registrarNoHistorico,
    precisaConfigurar,
    busca,
    atualizarBusca,
    verificarBusca,
  } = useKeys();

  // null = decide automaticamente; abre sozinho quando não há chave configurada.
  const [painelManual, setPainelManual] = useState<boolean | null>(null);
  const painelAberto = painelManual ?? precisaConfigurar;
  const setPainelAberto = setPainelManual;
  const [pergunta, setPergunta] = useState("");
  const [strategy, setStrategy] = useState<Strategy>("debate");
  const [judge, setJudge] = useState<ProviderId | "rotate">("rotate");

  const [rodando, setRodando] = useState(false);
  const [fase, setFase] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [convergencias, setConvergencias] = useState<
    Array<{ round: number; metrics: ConvergenceMetrics }>
  >([]);
  const [arbitro, setArbitro] = useState<ProviderId | null>(null);
  const [judgeText, setJudgeText] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [erroFatal, setErroFatal] = useState<string | null>(null);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [consultas, setConsultas] = useState<string[]>([]);
  const [buscas, setBuscas] = useState(0);
  const [errosBusca, setErrosBusca] = useState<string[]>([]);
  const [avisoBusca, setAvisoBusca] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const podeDuelar =
    prontos.length >= 2 && pergunta.trim().length > 0 && !rodando;

  const custoTotal = useMemo(() => {
    let t = 0;
    for (const p of ORDEM) {
      const bs = blocks.filter((b) => b.provider === p);
      const i = bs.reduce((a, b) => a + (b.usage?.inputTokens ?? 0), 0);
      const o = bs.reduce((a, b) => a + (b.usage?.outputTokens ?? 0), 0);
      t += estimarCusto(p, settings[p].model, i, o);
    }
    return t;
  }, [blocks, settings]);

  const parar = useCallback(() => {
    abortRef.current?.abort();
    setRodando(false);
    setFase(null);
    setBlocks((bs) => bs.map((b) => ({ ...b, streaming: false })));
  }, []);

  const duelar = useCallback(async () => {
    if (!podeDuelar) return;

    setRodando(true);
    setBlocks([]);
    setConvergencias([]);
    setJudgeText("");
    setVerdict(null);
    setArbitro(null);
    setErroFatal(null);
    setFontes([]);
    setConsultas([]);
    setBuscas(0);
    setErrosBusca([]);
    setAvisoBusca(null);
    setFase("Iniciando…");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const aplicarEvento = (evt: DuelEvent) => {
      switch (evt.type) {
        case "phase":
          setFase(evt.label);
          break;

        case "search_skip":
          setAvisoBusca(evt.motivo);
          break;

        case "search_done":
          setFontes(evt.fontes);
          setConsultas(evt.consultas);
          setBuscas(evt.buscas);
          setErrosBusca(evt.erros);
          break;

        case "search_error":
          setErrosBusca((e) => [...e, evt.error]);
          break;

        case "agent_start":
          setBlocks((bs) => [
            ...bs,
            {
              id: `${evt.provider}-${evt.phase}-${bs.length}`,
              provider: evt.provider,
              phase: evt.phase,
              role: evt.role,
              text: "",
              streaming: true,
            },
          ]);
          break;

        case "agent_delta":
          setBlocks((bs) => {
            const idx = ultimoIndice(bs, evt.provider);
            if (idx === -1) return bs;
            const copy = [...bs];
            copy[idx] = { ...copy[idx], text: copy[idx].text + evt.text };
            return copy;
          });
          break;

        case "agent_done":
          setBlocks((bs) => {
            const idx = ultimoIndice(bs, evt.provider);
            if (idx === -1) return bs;
            const copy = [...bs];
            copy[idx] = { ...copy[idx], usage: evt.usage, streaming: false };
            return copy;
          });
          break;

        case "agent_error":
          setBlocks((bs) => {
            const idx = ultimoIndice(bs, evt.provider);
            if (idx === -1) return bs;
            const copy = [...bs];
            copy[idx] = { ...copy[idx], error: evt.error, streaming: false };
            return copy;
          });
          break;

        case "convergence":
          setConvergencias((c) => [
            ...c,
            { round: evt.round, metrics: evt.metrics },
          ]);
          break;

        case "judge_start":
          setArbitro(evt.provider);
          break;

        case "judge_delta":
          setJudgeText((t) => t + evt.text);
          break;

        case "verdict":
          setVerdict(evt.verdict);
          registrarNoHistorico({
            pergunta: pergunta.trim(),
            strategy,
            vencedor:
              evt.verdict.winner === "empate"
                ? "Empate"
                : evt.verdict.winner === "nenhum"
                  ? "Inconclusivo"
                  : PROVIDERS[evt.verdict.winner].label,
            custo: custoTotal,
            em: Date.now(),
          });
          break;

        case "fatal":
          setErroFatal(evt.error);
          break;
      }
    };

    try {
      const res = await fetch("/api/duel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          query: pergunta.trim(),
          strategy,
          judge,
          maxRounds: 3,
          autoConverge: true,
          busca:
            busca.status === "ok" && busca.ativa
              ? { ativa: true, provider: busca.provider, apiKey: busca.apiKey }
              : undefined,
          agents: prontos.map((p) => ({
            provider: p,
            model: settings[p].model,
            apiKey: settings[p].apiKey,
            enabled: true,
          })),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res
          .json()
          .catch(() => ({ error: "Falha ao iniciar o duelo." }));
        setErroFatal(data.error ?? "Falha ao iniciar o duelo.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          const linha = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!linha) continue;
          try {
            aplicarEvento(JSON.parse(linha.slice(5).trim()) as DuelEvent);
          } catch {
            /* frame parcial ou keep-alive */
          }
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setErroFatal(
          err instanceof Error ? err.message : "Conexão interrompida.",
        );
      }
    } finally {
      setRodando(false);
      setFase(null);
      setBlocks((bs) => bs.map((b) => ({ ...b, streaming: false })));
    }
  }, [
    podeDuelar,
    pergunta,
    strategy,
    judge,
    prontos,
    settings,
    busca,
    custoTotal,
    registrarNoHistorico,
  ]);

  /** Custo das buscas é separado dos tokens: cobrança por consulta, não por token. */
  const custoBusca = buscas * SEARCH_PROVIDERS[busca.provider].custoPorBusca;

  const notaDe = (p: ProviderId) =>
    verdict?.scores.find((s) => s.provider === p)?.total;

  const exportar = useCallback(() => {
    const md = duelParaMarkdown({
      pergunta,
      strategy,
      blocks,
      verdict,
      arbitro,
      modelos: {
        anthropic: settings.anthropic.model,
        openai: settings.openai.model,
        deepseek: settings.deepseek.model,
      },
      fontes,
    });
    baixarMarkdown(md, pergunta);
  }, [pergunta, strategy, blocks, verdict, arbitro, settings, fontes]);

  return (
    <div className="arena-bg flex min-h-screen flex-col">
      {painelAberto && (
        <KeyPanel
          settings={settings}
          busca={busca}
          atualizarBusca={atualizarBusca}
          verificarBusca={verificarBusca}
          atualizar={atualizar}
          verificar={verificar}
          limparTudo={limparTudo}
          onFechar={() => setPainelAberto(false)}
        />
      )}

      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[15px] font-semibold tracking-tight">
              Duelo de Agentes
            </h1>
            <span className="hidden font-mono text-[11px] text-dim sm:inline">
              anthropic × openai × deepseek
            </span>
          </div>

          <div className="flex items-center gap-2">
            {custoTotal + custoBusca > 0 && (
              <span
                title={
                  custoBusca > 0
                    ? `tokens ${formatarUSD(custoTotal)} + ${buscas} buscas ${formatarUSD(custoBusca)}`
                    : "custo estimado em tokens"
                }
                className="rounded-md border border-line bg-panel px-2.5 py-1 font-mono text-[11px] text-muted"
              >
                ~{formatarUSD(custoTotal + custoBusca)}
                {custoBusca > 0 && <span className="text-dim"> · busca {formatarUSD(custoBusca)}</span>}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              {ORDEM.map((p) => (
                <span
                  key={p}
                  title={`${PROVIDERS[p].label}: ${
                    prontos.includes(p) ? settings[p].model : "não configurado"
                  }`}
                  className="size-2 rounded-full transition"
                  style={{
                    background: prontos.includes(p)
                      ? PROVIDERS[p].accent
                      : "var(--line)",
                    boxShadow: prontos.includes(p)
                      ? `0 0 8px ${PROVIDERS[p].accent}80`
                      : "none",
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => setPainelAberto(true)}
              className="rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-medium transition hover:border-dim"
            >
              Chaves
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6">
        <section className="rounded-xl border border-line bg-panel p-4">
          <textarea
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") duelar();
            }}
            rows={3}
            placeholder="Qual a pergunta? Quanto mais específica e verificável, mais útil o duelo. (Ctrl+Enter para começar)"
            className="w-full resize-y bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-dim"
          />

          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line-soft pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-dim">
                  Estratégia
                </span>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as Strategy)}
                  className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs outline-none focus:border-dim"
                >
                  {ESTRATEGIAS.map((s) => (
                    <option key={s} value={s}>
                      {STRATEGY_INFO[s].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-dim">
                  Árbitro
                </span>
                <select
                  value={judge}
                  onChange={(e) =>
                    setJudge(e.target.value as ProviderId | "rotate")
                  }
                  className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs outline-none focus:border-dim"
                >
                  <option value="rotate">Rotativo (menos viés)</option>
                  {prontos.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDERS[p].label}
                    </option>
                  ))}
                </select>
              </label>

              <p className="max-w-xs text-[11px] leading-snug text-dim">
                {STRATEGY_INFO[strategy].blurb}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {blocks.length > 0 && !rodando && (
                <button
                  onClick={exportar}
                  className="rounded-md border border-line px-3 py-2 text-xs font-medium text-muted transition hover:border-dim hover:text-fg"
                >
                  Exportar .md
                </button>
              )}
              {rodando ? (
                <button
                  onClick={parar}
                  className="rounded-md border border-danger/40 px-4 py-2 text-xs font-semibold text-danger transition hover:bg-danger/10"
                >
                  Interromper
                </button>
              ) : (
                <button
                  onClick={duelar}
                  disabled={!podeDuelar}
                  className="rounded-md bg-fg px-5 py-2 text-xs font-semibold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
                >
                  Iniciar duelo
                </button>
              )}
            </div>
          </div>

          {prontos.length < 2 && carregado && (
            <p className="mt-3 rounded-md border border-gold/25 bg-gold/5 px-3 py-2 text-[11px] text-gold">
              Configure ao menos 2 chaves de API para haver duelo.{" "}
              <button
                onClick={() => setPainelAberto(true)}
                className="underline underline-offset-2"
              >
                Abrir configuração
              </button>
            </p>
          )}

          {erroFatal && (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
              {erroFatal}
            </p>
          )}

          {historico.length > 0 && !rodando && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
              <span className="text-[10px] uppercase tracking-wider text-dim">
                Recentes
              </span>
              {historico.map((h) => (
                <button
                  key={h.em}
                  onClick={() => setPergunta(h.pergunta)}
                  title={`${STRATEGY_INFO[h.strategy]?.label ?? h.strategy} · ${h.vencedor} · ~${formatarUSD(h.custo)}`}
                  className="max-w-[240px] truncate rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11px] text-muted transition hover:border-dim hover:text-fg"
                >
                  {h.pergunta}
                </button>
              ))}
            </div>
          )}
        </section>

        {(fase || convergencias.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {fase && (
              <span className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[11px] text-muted">
                <span className="spin size-2.5 rounded-full border border-current border-t-transparent" />
                {fase}
              </span>
            )}
            {convergencias.map(({ round, metrics }) => (
              <span
                key={round}
                title={`concordância ${(metrics.agreementRatio * 100).toFixed(0)}% · estabilidade ${(
                  metrics.avgStability * 100
                ).toFixed(0)}%`}
                className="rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-muted"
              >
                r{round} convergência{" "}
                {(metrics.overallConvergence * 100).toFixed(0)}%
                {metrics.recommendation === "converged" && " ✓"}
                {metrics.recommendation === "stalled" && " ⊘"}
              </span>
            ))}
          </div>
        )}

        {(fontes.length > 0 || avisoBusca || errosBusca.length > 0) && (
          <div className="mt-4">
            <SourcesPanel
              fontes={fontes}
              consultas={consultas}
              buscas={buscas}
              custo={formatarUSD(custoBusca)}
              erros={errosBusca}
              aviso={avisoBusca}
            />
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {ORDEM.filter(
            (p) => prontos.includes(p) || blocks.some((b) => b.provider === p),
          ).map((p) => (
            <div
              key={p}
              // Altura fixa no desktop para as colunas rolarem juntas; no mobile
              // acompanham o conteúdo, com teto para não dominarem a tela.
              className="flex max-h-[65vh] min-h-0 flex-col lg:h-[clamp(320px,52vh,640px)] lg:max-h-none"
            >
              <AgentColumn
                provider={p}
                model={settings[p].model}
                blocks={blocks.filter((b) => b.provider === p)}
                vencedor={verdict?.winner === p}
                nota={notaDe(p)}
              />
            </div>
          ))}
        </div>

        <div className="mt-4">
          <VerdictPanel
            verdict={verdict}
            streamingText={judgeText}
            arbitro={arbitro}
          />
        </div>
      </main>

      <footer className="border-t border-line px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 text-[10px] text-dim">
          <span>
            Suas chaves ficam no seu navegador. Custos são estimativas — a fonte
            da verdade é o billing de cada provedor.
          </span>
          <span>
            Estratégias de duelo adaptadas de{" "}
            <a
              href="https://github.com/DeepMyst/Mysti"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition hover:text-muted"
            >
              DeepMyst/Mysti
            </a>{" "}
            (Apache-2.0)
          </span>
        </div>
      </footer>
    </div>
  );
}

function ultimoIndice(bs: Block[], provider: ProviderId): number {
  for (let i = bs.length - 1; i >= 0; i--) {
    if (bs[i].provider === provider && bs[i].streaming) return i;
  }
  for (let i = bs.length - 1; i >= 0; i--) {
    if (bs[i].provider === provider) return i;
  }
  return -1;
}
