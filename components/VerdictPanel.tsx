"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import type { Verdict } from "@/lib/duel/types";

export function VerdictPanel({
  verdict,
  streamingText,
  arbitro,
}: {
  verdict: Verdict | null;
  streamingText: string;
  arbitro: ProviderId | null;
}) {
  const [verNotas, setVerNotas] = useState(false);

  // A coluna de fundamentação só existe quando o duelo teve dossiê.
  const temFund = Boolean(verdict?.scores.some((s) => s.fundamentacao !== undefined));

  if (!verdict && !streamingText) return null;

  const confCor =
    verdict?.confidence === "alta"
      ? "text-emerald-400 bg-emerald-500/10"
      : verdict?.confidence === "baixa"
        ? "text-danger bg-danger/10"
        : "text-gold bg-gold/10";

  return (
    <section className="rise overflow-hidden rounded-xl border border-gold/30 bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-gradient-to-r from-gold/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-base">⚖️</span>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Veredito</h2>
            {arbitro && (
              <p className="text-[11px] text-dim">
                arbitrado por {PROVIDERS[arbitro].label}
              </p>
            )}
          </div>
        </div>

        {verdict && (
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${confCor}`}>
              confiança {verdict.confidence}
            </span>
            <Vencedor winner={verdict.winner} />
            {verdict.scores.length > 0 && (
              <button
                onClick={() => setVerNotas((v) => !v)}
                className="rounded-md border border-line px-2.5 py-1 text-[11px] text-muted transition hover:border-dim hover:text-fg"
              >
                {verNotas ? "ocultar notas" : "ver notas"}
              </button>
            )}
          </div>
        )}
      </header>

      {verdict && verNotas && verdict.scores.length > 0 && (
        <div className="border-b border-line-soft bg-panel-2/60 px-4 py-3">
          <table className="w-full text-left text-[11px]">
            <thead className="text-dim">
              <tr>
                <th className="pb-2 font-medium">Agente</th>
                <th className="pb-2 text-center font-medium">Correção</th>
                <th className="pb-2 text-center font-medium">Completude</th>
                <th className="pb-2 text-center font-medium">Raciocínio</th>
                <th className="pb-2 text-center font-medium">Riscos</th>
                {temFund && (
                  <th className="pb-2 text-center font-medium" title="Afirmações ancoradas e citadas corretamente no dossiê de fontes">
                    Fundamentação
                  </th>
                )}
                <th className="pb-2 text-center font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {verdict.scores.map((s) => (
                <tr key={s.provider} className="border-t border-line-soft">
                  <td className="py-2 font-medium" style={{ color: PROVIDERS[s.provider].accent }}>
                    {PROVIDERS[s.provider].label}
                  </td>
                  <td className="py-2 text-center font-mono">{s.correcao}</td>
                  <td className="py-2 text-center font-mono">{s.completude}</td>
                  <td className="py-2 text-center font-mono">{s.raciocinio}</td>
                  <td className="py-2 text-center font-mono">{s.riscos}</td>
                  {temFund && (
                    <td className="py-2 text-center font-mono">
                      {s.fundamentacao ?? "—"}
                    </td>
                  )}
                  <td className="py-2 text-center font-mono font-semibold text-fg">{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-1.5">
            {verdict.scores.map((s) => (
              <p key={s.provider} className="text-[11px] leading-relaxed text-muted">
                <span style={{ color: PROVIDERS[s.provider].accent }}>
                  {PROVIDERS[s.provider].label}:
                </span>{" "}
                {s.comentario}
              </p>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-dim">
            {temFund
              ? "Total ponderado: correção 35%, completude 20%, raciocínio 20%, fundamentação 15%, riscos 10%."
              : "Total ponderado: correção 40%, completude 25%, raciocínio 25%, riscos 10%."}
          </p>
        </div>
      )}

      <div className="px-4 py-4">
        {verdict ? (
          <Markdown>{verdict.resposta}</Markdown>
        ) : (
          <div className="text-xs text-muted">
            <span className="text-dim">O árbitro está avaliando… </span>
            <Markdown>{streamingText}</Markdown>
          </div>
        )}
      </div>

      {verdict && verdict.ressalvas.length > 0 && (
        <div className="border-t border-line-soft bg-panel-2/60 px-4 py-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gold">
            Ressalvas
          </h3>
          <ul className="space-y-1.5">
            {verdict.ressalvas.map((r, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted">
                <span className="text-dim">—</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Vencedor({ winner }: { winner: Verdict["winner"] }) {
  if (winner === "nenhum") {
    return (
      <span className="rounded-full bg-danger/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-danger">
        nenhuma resposta confiável
      </span>
    );
  }
  if (winner === "empate") {
    return (
      <span className="rounded-full bg-panel-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        empate
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: `${PROVIDERS[winner].accent}1f`, color: PROVIDERS[winner].accent }}
    >
      vencedor: {PROVIDERS[winner].label}
    </span>
  );
}
