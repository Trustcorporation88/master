import { PROVIDERS, type ProviderId } from "./providers";
import { SEARCH_PROVIDERS, type SearchProviderId } from "./search";
import type { AgentConfig, BuscaConfig } from "./duel/types";

/**
 * Configuração do servidor, lida de variáveis de ambiente.
 *
 * Este arquivo é SÓ servidor. Nenhum componente de cliente deve importá-lo —
 * ele carrega nomes de fornecedores e modelos, que não devem chegar ao bundle
 * do navegador.
 */

const MODELOS_PADRAO: Record<ProviderId, string> = {
  anthropic: "claude-opus-4-5",
  openai: "gpt-5.1",
  deepseek: "deepseek-chat",
};

const ENV_CHAVE: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

const ENV_MODELO: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_MODEL",
  openai: "OPENAI_MODEL",
  deepseek: "DEEPSEEK_MODEL",
};

/** Agentes com chave configurada no servidor. */
export function agentesDoServidor(): AgentConfig[] {
  const out: AgentConfig[] = [];

  for (const provider of Object.keys(PROVIDERS) as ProviderId[]) {
    const apiKey = process.env[ENV_CHAVE[provider]]?.trim();
    if (!apiKey) continue;

    out.push({
      provider,
      apiKey,
      model: process.env[ENV_MODELO[provider]]?.trim() || MODELOS_PADRAO[provider],
      enabled: true,
    });
  }

  return out;
}

/** Busca web do servidor, se houver chave. */
export function buscaDoServidor(): BuscaConfig | undefined {
  const preferido = process.env.BUSCA_PROVIDER?.trim().toLowerCase();

  const candidatos: SearchProviderId[] =
    preferido && preferido in SEARCH_PROVIDERS
      ? [preferido as SearchProviderId]
      : ["brave", "tavily"];

  for (const provider of candidatos) {
    const apiKey = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
    if (apiKey) return { ativa: true, provider, apiKey };
  }

  return undefined;
}

/**
 * O que o cliente pode saber sobre a configuração.
 *
 * Deliberadamente sem nomes de fornecedores, modelos ou chaves: apenas se o
 * serviço está operante e se consegue consultar fontes na web.
 */
export function estadoPublico() {
  const agentes = agentesDoServidor();
  return {
    pronto: agentes.length >= 2,
    /** Quantos pareceres independentes a análise cruza. */
    pareceres: agentes.length,
    fontesWeb: Boolean(buscaDoServidor()),
  };
}
