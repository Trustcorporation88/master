import type { ProviderId } from "./providers";

/**
 * Tabela de preços para ESTIMATIVA de custo (USD por 1 milhão de tokens).
 *
 * Preços de API mudam com frequência e variam por modelo. Isto serve para dar
 * noção de ordem de grandeza durante o duelo, não para faturamento. A fonte da
 * verdade é sempre o painel de billing do provedor.
 */
type Price = { in: number; out: number };

const TABELA: Array<{ match: RegExp; price: Price }> = [
  // Anthropic
  { match: /^claude-opus/i, price: { in: 5, out: 25 } },
  { match: /^claude-sonnet/i, price: { in: 3, out: 15 } },
  { match: /^claude-haiku/i, price: { in: 1, out: 5 } },
  // OpenAI
  { match: /^gpt-5.*mini/i, price: { in: 0.25, out: 2 } },
  { match: /^gpt-5/i, price: { in: 1.25, out: 10 } },
  { match: /^gpt-4\.1-mini/i, price: { in: 0.4, out: 1.6 } },
  { match: /^gpt-4\.1/i, price: { in: 2, out: 8 } },
  { match: /^gpt-4o-mini/i, price: { in: 0.15, out: 0.6 } },
  { match: /^gpt-4o/i, price: { in: 2.5, out: 10 } },
  { match: /^o[34]/i, price: { in: 2, out: 8 } },
  // DeepSeek
  { match: /^deepseek-reasoner/i, price: { in: 0.55, out: 2.19 } },
  { match: /^deepseek/i, price: { in: 0.27, out: 1.1 } },
];

const PADRAO: Record<ProviderId, Price> = {
  anthropic: { in: 3, out: 15 },
  openai: { in: 1.25, out: 10 },
  deepseek: { in: 0.27, out: 1.1 },
};

export function precoDe(provider: ProviderId, model: string): Price {
  return TABELA.find((t) => t.match.test(model))?.price ?? PADRAO[provider];
}

export function estimarCusto(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = precoDe(provider, model);
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
}

export function formatarUSD(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
