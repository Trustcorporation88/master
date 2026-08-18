import { PROVIDERS, type ProviderId } from "./providers";
import { estimarCusto, formatarUSD } from "./pricing";
import { STRATEGY_INFO, type Strategy, type Verdict } from "./duel/types";
import type { Fonte } from "./search";
import type { Block } from "@/components/AgentColumn";

/** Monta o duelo inteiro como um documento markdown. */
export function duelParaMarkdown(args: {
  pergunta: string;
  strategy: Strategy;
  blocks: Block[];
  verdict: Verdict | null;
  arbitro: ProviderId | null;
  modelos: Record<ProviderId, string>;
  fontes: Fonte[];
}): string {
  const { pergunta, strategy, blocks, verdict, arbitro, modelos, fontes } = args;
  const L: string[] = [];

  L.push(`# Duelo de Agentes`);
  L.push(`\n**Pergunta:** ${pergunta}`);
  L.push(`**Estratégia:** ${STRATEGY_INFO[strategy].label}`);
  if (arbitro) L.push(`**Árbitro:** ${PROVIDERS[arbitro].label}`);
  L.push(`**Data:** ${new Date().toLocaleString("pt-BR")}`);

  if (verdict) {
    L.push(`\n---\n\n## Veredito`);
    const v =
      verdict.winner === "empate"
        ? "Empate"
        : verdict.winner === "nenhum"
          ? "Nenhuma resposta considerada confiável"
          : PROVIDERS[verdict.winner].label;
    L.push(`\n**Resultado:** ${v} · confiança ${verdict.confidence}`);

    if (verdict.scores.length) {
      const temFund = verdict.scores.some((s) => s.fundamentacao !== undefined);

      L.push(
        temFund
          ? `\n| Agente | Correção | Completude | Raciocínio | Riscos | Fundamentação | Total |`
          : `\n| Agente | Correção | Completude | Raciocínio | Riscos | Total |`,
      );
      L.push(temFund ? `|---|---|---|---|---|---|---|` : `|---|---|---|---|---|---|`);

      for (const s of verdict.scores) {
        const base = `| ${PROVIDERS[s.provider].label} | ${s.correcao} | ${s.completude} | ${s.raciocinio} | ${s.riscos} |`;
        L.push(temFund ? `${base} ${s.fundamentacao ?? "—"} | **${s.total}** |` : `${base} **${s.total}** |`);
      }

      L.push(
        temFund
          ? `\n_Total ponderado: correção 35%, completude 20%, raciocínio 20%, fundamentação 15%, riscos 10%._`
          : `\n_Total ponderado: correção 40%, completude 25%, raciocínio 25%, riscos 10%._`,
      );
    }

    L.push(`\n### Resposta final\n\n${verdict.resposta}`);

    if (verdict.ressalvas.length) {
      L.push(`\n### Ressalvas\n`);
      for (const r of verdict.ressalvas) L.push(`- ${r}`);
    }
  }

  if (fontes.length) {
    L.push(`\n---\n\n## Fontes do dossiê`);
    L.push(`\n_Os três agentes receberam exatamente estas fontes._\n`);
    for (const f of fontes) {
      L.push(`${f.n}. [${f.titulo}](${f.url})${f.data ? ` — ${f.data}` : ""}`);
    }
  }

  L.push(`\n---\n\n## Transcrição do duelo`);

  for (const p of Object.keys(PROVIDERS) as ProviderId[]) {
    const bs = blocks.filter((b) => b.provider === p);
    if (!bs.length) continue;

    const i = bs.reduce((a, b) => a + (b.usage?.inputTokens ?? 0), 0);
    const o = bs.reduce((a, b) => a + (b.usage?.outputTokens ?? 0), 0);

    L.push(`\n### ${PROVIDERS[p].label} — \`${modelos[p]}\``);
    L.push(
      `_${(i + o).toLocaleString("pt-BR")} tokens · custo estimado ${formatarUSD(
        estimarCusto(p, modelos[p], i, o),
      )}_`,
    );

    for (const b of bs) {
      L.push(`\n#### ${b.role}`);
      L.push(b.error ? `> ⚠️ ${b.error}` : b.text || "_(vazio)_");
    }
  }

  L.push(
    `\n---\n\n_Gerado com Duelo de Agentes. Estratégias adaptadas de [DeepMyst/Mysti](https://github.com/DeepMyst/Mysti) (Apache-2.0)._`,
  );

  return L.join("\n");
}

export function baixarMarkdown(conteudo: string, pergunta: string) {
  const slug =
    pergunta
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "duelo";

  const blob = new Blob([conteudo], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `duelo-${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Histórico local — só metadados, para reencontrar perguntas          */
/* ------------------------------------------------------------------ */

export type HistoricoItem = {
  pergunta: string;
  strategy: Strategy;
  vencedor: string;
  custo: number;
  em: number;
};

const HIST_KEY = "duelo.historico.v1";

export function lerHistorico(): HistoricoItem[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    return raw ? (JSON.parse(raw) as HistoricoItem[]) : [];
  } catch {
    return [];
  }
}

export function salvarHistorico(item: HistoricoItem): HistoricoItem[] {
  const lista = [item, ...lerHistorico().filter((h) => h.pergunta !== item.pergunta)].slice(0, 8);
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(lista));
  } catch {
    /* storage cheio ou bloqueado */
  }
  return lista;
}
