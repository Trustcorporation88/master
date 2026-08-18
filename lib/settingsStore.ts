/**
 * Store das chaves, modelos e histórico.
 *
 * Usa o padrão de store externa (useSyncExternalStore) em vez de ler o
 * localStorage dentro de um efeito: o servidor renderiza um snapshot vazio
 * estável, o cliente hidrata a partir do storage na primeira inscrição, e não
 * há render em cascata.
 *
 * As chaves nunca saem do navegador por iniciativa desta store — apenas o
 * componente que dispara o duelo as envia ao servidor local.
 */

import { FALLBACK_MODELS, type ProviderId } from "./providers";
import { SEARCH_PROVIDERS, type SearchProviderId } from "./search";
import { lerHistorico, salvarHistorico, type HistoricoItem } from "./export";

export type AgentSettings = {
  apiKey: string;
  model: string;
  enabled: boolean;
  /** Modelos descobertos em /v1/models com esta chave. */
  models: string[];
  status: "vazio" | "verificando" | "ok" | "erro";
  error?: string;
};

export type Settings = Record<ProviderId, AgentSettings>;

/** Configuração da busca web. Opcional: sem chave, o duelo roda sem evidência. */
export type BuscaSettings = {
  provider: SearchProviderId;
  apiKey: string;
  /** Ligada para o próximo duelo? */
  ativa: boolean;
  status: "vazio" | "verificando" | "ok" | "erro";
  error?: string;
};

export type Snapshot = {
  settings: Settings;
  busca: BuscaSettings;
  historico: HistoricoItem[];
  carregado: boolean;
  /**
   * Havia zero agentes configurados na carga da página?
   *
   * Decidido uma única vez na hidratação e nunca recalculado: se fosse derivado
   * do estado atual, o painel de chaves fecharia sozinho no instante em que o
   * usuário digitasse a primeira chave.
   */
  precisaConfigurar: boolean;
};

const STORAGE_KEY = "duelo.settings.v1";
const BUSCA_KEY = "duelo.busca.v1";
const PROVIDERS_ORDEM: ProviderId[] = ["anthropic", "openai", "deepseek"];

const vazio = (provider: ProviderId): AgentSettings => ({
  apiKey: "",
  model: FALLBACK_MODELS[provider][0],
  enabled: true,
  models: FALLBACK_MODELS[provider],
  status: "vazio",
});

const SETTINGS_INICIAL: Settings = {
  anthropic: vazio("anthropic"),
  openai: vazio("openai"),
  deepseek: vazio("deepseek"),
};

const BUSCA_INICIAL: BuscaSettings = {
  provider: "brave",
  apiKey: "",
  ativa: false,
  status: "vazio",
};

/** Snapshot do servidor: precisa ser sempre a mesma referência. */
const SERVER_SNAPSHOT: Snapshot = Object.freeze({
  settings: SETTINGS_INICIAL,
  busca: BUSCA_INICIAL,
  historico: [],
  carregado: false,
  precisaConfigurar: false,
});

let snapshot: Snapshot = SERVER_SNAPSHOT;
let hidratou = false;

const listeners = new Set<() => void>();

function emitir() {
  for (const l of listeners) l();
}

function definir(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  emitir();
}

function persistir(settings: Settings) {
  try {
    // Guarda só o que é configuração — nada de estado transitório ou erro.
    const limpo = Object.fromEntries(
      PROVIDERS_ORDEM.map((p) => [
        p,
        {
          apiKey: settings[p].apiKey,
          model: settings[p].model,
          enabled: settings[p].enabled,
          models: settings[p].models,
        },
      ]),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limpo));
  } catch {
    /* modo privado ou storage cheio */
  }
}

function hidratar() {
  if (hidratou || typeof window === "undefined") return;
  hidratou = true;

  const settings: Settings = { ...SETTINGS_INICIAL };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      for (const p of PROVIDERS_ORDEM) {
        const s = parsed[p];
        if (!s) continue;
        settings[p] = {
          ...SETTINGS_INICIAL[p],
          apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
          model:
            typeof s.model === "string" && s.model
              ? s.model
              : SETTINGS_INICIAL[p].model,
          enabled: s.enabled !== false,
          models:
            Array.isArray(s.models) && s.models.length
              ? s.models
              : SETTINGS_INICIAL[p].models,
          status: s.apiKey ? "ok" : "vazio",
        };
      }
    }
  } catch {
    /* storage corrompido: segue com o padrão */
  }

  let busca = BUSCA_INICIAL;
  try {
    const raw = localStorage.getItem(BUSCA_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<BuscaSettings>;
      const prov =
        typeof p.provider === "string" && p.provider in SEARCH_PROVIDERS
          ? (p.provider as SearchProviderId)
          : BUSCA_INICIAL.provider;
      const chave = typeof p.apiKey === "string" ? p.apiKey : "";
      busca = {
        provider: prov,
        apiKey: chave,
        // Sem chave não faz sentido a busca estar ligada.
        ativa: chave ? p.ativa !== false : false,
        status: chave ? "ok" : "vazio",
      };
    }
  } catch {
    /* storage corrompido */
  }

  snapshot = {
    settings,
    busca,
    historico: lerHistorico(),
    carregado: true,
    precisaConfigurar: agentesProntos(settings).length === 0,
  };
  emitir();
}

/* ------------------------------------------------------------------ */
/* API da store                                                        */
/* ------------------------------------------------------------------ */

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  hidratar();
  return () => listeners.delete(listener);
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

export function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

export function atualizarAgente(
  provider: ProviderId,
  patch: Partial<AgentSettings>,
) {
  const settings = {
    ...snapshot.settings,
    [provider]: { ...snapshot.settings[provider], ...patch },
  };
  persistir(settings);
  definir({ settings });
}

/** Valida a chave listando os modelos disponíveis para ela. */
export async function verificarChave(provider: ProviderId, apiKey: string) {
  const chave = apiKey.trim();
  if (!chave) {
    atualizarAgente(provider, {
      status: "vazio",
      error: undefined,
      apiKey: "",
    });
    return;
  }

  atualizarAgente(provider, { status: "verificando", error: undefined });

  try {
    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey: chave }),
    });
    const data = await res.json();

    if (data.ok) {
      const modelos: string[] = data.models;
      const atual = snapshot.settings[provider];
      atualizarAgente(provider, {
        models: modelos,
        model: modelos.includes(atual.model) ? atual.model : modelos[0],
        status: "ok",
        error: undefined,
      });
    } else {
      atualizarAgente(provider, {
        status: "erro",
        error: data.error ?? "Falha na verificação.",
      });
    }
  } catch {
    atualizarAgente(provider, {
      status: "erro",
      error: "Não foi possível contatar o servidor local.",
    });
  }
}

export function limparChaves() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignora */
  }
  try {
    localStorage.removeItem(BUSCA_KEY);
  } catch {
    /* ignora */
  }
  definir({ settings: SETTINGS_INICIAL, busca: BUSCA_INICIAL });
}

function persistirBusca(b: BuscaSettings) {
  try {
    localStorage.setItem(
      BUSCA_KEY,
      JSON.stringify({ provider: b.provider, apiKey: b.apiKey, ativa: b.ativa }),
    );
  } catch {
    /* ignora */
  }
}

export function atualizarBusca(patch: Partial<BuscaSettings>) {
  const busca = { ...snapshot.busca, ...patch };
  persistirBusca(busca);
  definir({ busca });
}

/** Valida a chave de busca com uma consulta trivial. */
export async function verificarChaveBusca(
  provider: SearchProviderId,
  apiKey: string,
) {
  const chave = apiKey.trim();
  if (!chave) {
    atualizarBusca({ status: "vazio", error: undefined, apiKey: "", ativa: false });
    return;
  }

  atualizarBusca({ status: "verificando", error: undefined });

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey: chave }),
    });
    const data = await res.json();

    if (data.ok) {
      // Chave boa: já liga a busca, que é o que o usuário quis ao cadastrar.
      atualizarBusca({ status: "ok", error: undefined, ativa: true });
    } else {
      atualizarBusca({ status: "erro", error: data.error ?? "Falha na verificação." });
    }
  } catch {
    atualizarBusca({ status: "erro", error: "Não foi possível contatar o servidor local." });
  }
}

export function registrarNoHistorico(item: HistoricoItem) {
  definir({ historico: salvarHistorico(item) });
}

export function agentesProntos(settings: Settings): ProviderId[] {
  return PROVIDERS_ORDEM.filter(
    (p) =>
      settings[p].enabled && settings[p].apiKey.trim() && settings[p].model,
  );
}
