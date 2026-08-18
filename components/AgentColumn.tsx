"use client";

import { useEffect, useRef } from "react";
import { Markdown } from "./Markdown";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { estimarCusto, formatarUSD } from "@/lib/pricing";
import type { Usage } from "@/lib/providers";

export type Block = {
  id: string;
  provider: ProviderId;
  phase: string;
  role: string;
  text: string;
  usage?: Usage;
  error?: string;
  streaming: boolean;
};

export function AgentColumn({
  provider,
  model,
  blocks,
  vencedor,
  nota,
}: {
  provider: ProviderId;
  model: string;
  blocks: Block[];
  vencedor: boolean;
  nota?: number;
}) {
  const info = PROVIDERS[provider];
  const scroller = useRef<HTMLDivElement>(null);
  const colado = useRef(true);

  // Acompanha o streaming, mas para de forçar scroll se o usuário subir a leitura.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !colado.current) return;
    el.scrollTop = el.scrollHeight;
  }, [blocks]);

  const totalIn = blocks.reduce((a, b) => a + (b.usage?.inputTokens ?? 0), 0);
  const totalOut = blocks.reduce((a, b) => a + (b.usage?.outputTokens ?? 0), 0);
  const custo = estimarCusto(provider, model, totalIn, totalOut);
  const ativo = blocks.some((b) => b.streaming);

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-panel transition-colors"
      style={{
        borderColor: vencedor ? "var(--gold)" : "var(--line)",
        boxShadow: vencedor ? "0 0 0 1px var(--gold), 0 8px 32px -12px rgba(232,182,76,0.35)" : undefined,
      }}
    >
      <header
        className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5"
        style={{
          borderColor: "var(--line)",
          background: `linear-gradient(180deg, ${info.accent}14, transparent)`,
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{
              background: info.accent,
              boxShadow: ativo ? `0 0 8px ${info.accent}` : "none",
            }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold">{info.label}</span>
              {vencedor && (
                <span className="shrink-0 rounded bg-gold/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-gold">
                  vence
                </span>
              )}
            </div>
            <span className="block truncate font-mono text-[10px] text-dim">{model}</span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          {nota !== undefined && (
            <div className="font-mono text-sm font-semibold" style={{ color: info.accent }}>
              {nota.toFixed(1)}
            </div>
          )}
          {(totalIn > 0 || totalOut > 0) && (
            <div className="font-mono text-[9px] text-dim">
              {((totalIn + totalOut) / 1000).toFixed(1)}k · {formatarUSD(custo)}
            </div>
          )}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3"
      >
        {blocks.length === 0 && (
          <p className="py-8 text-center text-xs text-dim">Aguardando o duelo…</p>
        )}

        {blocks.map((b, i) => (
          <div key={b.id} className={i > 0 ? "mt-4 border-t border-line-soft pt-4" : ""}>
            <div className="mb-2 flex items-center gap-2">
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: `${info.accent}1a`, color: info.accent }}
              >
                {b.role}
              </span>
              {b.streaming && (
                <span
                  className="spin size-2.5 rounded-full border border-current border-t-transparent"
                  style={{ color: info.accent }}
                />
              )}
            </div>

            {b.error ? (
              <p className="rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-xs text-danger">
                {b.error}
              </p>
            ) : (
              <div className={b.streaming && !b.text ? "text-xs text-dim" : ""}>
                {b.text ? (
                  <>
                    <Markdown>{b.text}</Markdown>
                    {b.streaming && <span className="caret" style={{ color: info.accent }} />}
                  </>
                ) : (
                  b.streaming && "pensando…"
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
