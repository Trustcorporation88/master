"use client";

import { useEffect, useState } from "react";
import { ETAPA_LABEL, type Etapa } from "@/lib/publicTypes";

const ORDEM: Etapa[] = ["interpretando", "consultando", "analisando", "revisando", "consolidando"];

/**
 * Progresso durante a análise.
 *
 * Uma análise profunda leva minutos. Sem sinal de vida o usuário acha que
 * travou — daí as etapas nomeadas e o cronômetro. Os rótulos descrevem o que
 * está sendo feito para o usuário, não como é feito internamente.
 */
export function Progresso({ etapa, temFontes }: { etapa: Etapa; temFontes: boolean }) {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // A etapa de consulta a fontes só aparece quando realmente acontece.
  const etapas = ORDEM.filter((e) => e !== "consultando" || temFontes || etapa === "consultando");
  const atual = etapas.indexOf(etapa);

  const mm = String(Math.floor(segundos / 60)).padStart(2, "0");
  const ss = String(segundos % 60).padStart(2, "0");

  return (
    <section className="surgir rounded-xl border border-linha bg-branco p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-tinta-clara">
          Em andamento
        </h2>
        <span className="font-mono text-[12px] tabular-nums text-tinta-clara">
          {mm}:{ss}
        </span>
      </div>

      <ol className="mt-5 space-y-3.5">
        {etapas.map((e, i) => {
          const feito = atual > i;
          const ativo = atual === i;

          return (
            <li key={e} className="flex items-center gap-3">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
                  feito
                    ? "border-sucesso bg-sucesso text-white"
                    : ativo
                      ? "border-marca text-marca"
                      : "border-linha-forte text-tinta-clara"
                }`}
              >
                {feito ? "✓" : i + 1}
              </span>

              <span
                className={`text-[14px] transition-colors ${
                  ativo
                    ? "font-medium text-tinta"
                    : feito
                      ? "text-tinta-media"
                      : "text-tinta-clara"
                }`}
              >
                {ETAPA_LABEL[e]}
              </span>

              {ativo && (
                <span className="girar size-3 rounded-full border-2 border-marca/25 border-t-marca" />
              )}
            </li>
          );
        })}
      </ol>

      {segundos > 45 && (
        <p className="mt-5 border-t border-linha pt-4 text-[12px] leading-relaxed text-tinta-clara">
          Análises mais completas levam alguns minutos. Você pode deixar esta aba aberta.
        </p>
      )}
    </section>
  );
}
