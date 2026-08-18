"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";
import {
  CONFIANCA_LABEL,
  type Confianca,
  type FontePublica,
} from "@/lib/publicTypes";

/**
 * A resposta final.
 *
 * Mostra o que é valor para quem lê — o texto, o grau de confiança, o que ficou
 * incerto e as fontes conferíveis. Nada sobre como a resposta foi produzida.
 */
export function Resposta({
  texto,
  streaming,
  confianca,
  ressalvas,
  fontes,
  onCopiar,
  proposta,
}: {
  texto: string;
  streaming: boolean;
  confianca: Confianca | null;
  ressalvas: string[];
  fontes: FontePublica[];
  onCopiar: () => void;
  /** Bloco de proposta de código, quando a análise leu um repositório. */
  proposta?: React.ReactNode;
}) {
  const [copiado, setCopiado] = useState(false);

  function copiar() {
    onCopiar();
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const conf = confianca ? CONFIANCA_LABEL[confianca] : null;
  const corConf =
    confianca === "alta"
      ? "text-sucesso bg-sucesso/8 border-sucesso/25"
      : confianca === "baixa"
        ? "text-alerta bg-alerta/8 border-alerta/25"
        : "text-realce bg-realce/8 border-realce/25";

  return (
    <article className="surgir overflow-hidden rounded-xl border border-linha bg-branco shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-linha px-6 py-4">
        <h2 className="font-serif text-[17px] font-semibold tracking-tight">Resposta</h2>

        <div className="flex items-center gap-2.5">
          {conf && (
            <span
              title={conf.explicacao}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${corConf}`}
            >
              {conf.label}
            </span>
          )}
          {!streaming && texto && (
            <button
              onClick={copiar}
              className="rounded-md border border-linha px-2.5 py-1 text-[12px] text-tinta-media transition hover:border-linha-forte hover:text-tinta"
            >
              {copiado ? "Copiado" : "Copiar"}
            </button>
          )}
        </div>
      </header>

      <div className="px-6 py-6">
        <Markdown>{texto}</Markdown>
        {streaming && <span className="cursor" />}
      </div>

      {!streaming && ressalvas.length > 0 && (
        <div className="border-t border-linha bg-realce/5 px-6 py-5">
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-realce">
            Pontos a verificar
          </h3>
          <ul className="space-y-2">
            {ressalvas.map((r, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-tinta-media">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-realce" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fontes.length > 0 && <Fontes fontes={fontes} />}

      {!streaming && proposta}
    </article>
  );
}

function Fontes({ fontes }: { fontes: FontePublica[] }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="border-t border-linha">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-papel"
      >
        <span className="text-[13px] font-medium text-tinta-media">
          {fontes.length} {fontes.length === 1 ? "fonte consultada" : "fontes consultadas"}
        </span>
        <span className="text-[12px] text-tinta-clara">{aberto ? "ocultar" : "ver"}</span>
      </button>

      {aberto && (
        <ol className="space-y-3 border-t border-linha px-6 py-5">
          {fontes.map((f) => (
            <li key={f.n} className="flex gap-3">
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-marca-clara">
                [{f.n}]
              </span>
              <div className="min-w-0">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[13.5px] font-medium text-tinta underline-offset-2 hover:text-marca-clara hover:underline"
                >
                  {f.titulo}
                </a>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-tinta-clara">
                  <span className="font-mono">{host(f.url)}</span>
                  {f.data && <span>· {f.data}</span>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
