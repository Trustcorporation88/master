"use client";

import { useState } from "react";
import type { Fonte } from "@/lib/search";

/**
 * Fontes que os três agentes receberam.
 *
 * Fica visível de propósito: o valor do dossiê compartilhado é o usuário poder
 * conferir a citação [n] de qualquer afirmação contra a fonte original.
 */
export function SourcesPanel({
  fontes,
  consultas,
  buscas,
  custo,
  erros,
  aviso,
}: {
  fontes: Fonte[];
  consultas: string[];
  buscas: number;
  custo: string;
  erros: string[];
  aviso: string | null;
}) {
  const [aberto, setAberto] = useState(false);

  if (!fontes.length && !aviso && !erros.length) return null;

  if (!fontes.length) {
    return (
      <section className="rise rounded-xl border border-line bg-panel px-4 py-3">
        <p className="text-[11px] leading-relaxed text-muted">
          <span className="mr-1.5 text-dim">Busca web:</span>
          {aviso ?? erros.join(" · ")}
        </p>
      </section>
    );
  }

  return (
    <section className="rise overflow-hidden rounded-xl border border-line bg-panel">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-panel-2/50"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">🔍</span>
          <span className="text-[13px] font-semibold">
            {fontes.length} fontes no dossiê
          </span>
          <span className="text-[11px] text-dim">
            entregues igualmente aos três agentes
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] text-dim">
            {buscas} buscas · {custo}
          </span>
          <span className="text-[11px] text-muted">{aberto ? "ocultar" : "ver fontes"}</span>
        </div>
      </button>

      {aberto && (
        <div className="border-t border-line-soft px-4 py-3">
          <p className="mb-3 text-[11px] text-dim">
            Consultas: {consultas.map((c) => `"${c}"`).join(", ")}
          </p>

          <ol className="space-y-3">
            {fontes.map((f) => (
              <li key={f.n} className="flex gap-2.5">
                <span className="shrink-0 font-mono text-[11px] text-gold">[{f.n}]</span>
                <div className="min-w-0">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-[12px] font-medium text-fg underline-offset-2 hover:underline"
                  >
                    {f.titulo}
                  </a>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-dim">
                    <span className="truncate font-mono">{hostDe(f.url)}</span>
                    {f.data && <span>· {f.data}</span>}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted">
                    {f.trecho}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {erros.length > 0 && (
            <p className="mt-3 border-t border-line-soft pt-3 text-[10px] text-danger">
              {erros.length} consulta(s) falharam: {erros.join(" · ")}
            </p>
          )}

          <p className="mt-3 border-t border-line-soft pt-3 text-[10px] leading-relaxed text-dim">
            O dossiê é evidência, não veredito. Fonte compartilhada também significa erro
            compartilhado: se uma fonte estiver errada, os três agentes podem errar junto — por isso
            os prompts pedem que avaliem a qualidade e a data de cada fonte.
          </p>
        </div>
      )}
    </section>
  );
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
