"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  agentesProntos,
  atualizarAgente,
  atualizarBusca,
  verificarChaveBusca,
  getServerSnapshot,
  getSnapshot,
  limparChaves,
  registrarNoHistorico,
  subscribe,
  verificarChave,
} from "./settingsStore";

export type { AgentSettings, BuscaSettings, Settings } from "./settingsStore";

/**
 * Acesso reativo às chaves, modelos e histórico.
 * A leitura do localStorage acontece na store, não em efeito de componente.
 */
export function useKeys() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const prontos = useMemo(() => agentesProntos(snap.settings), [snap.settings]);

  return {
    settings: snap.settings,
    busca: snap.busca,
    historico: snap.historico,
    carregado: snap.carregado,
    precisaConfigurar: snap.precisaConfigurar,
    prontos,
    atualizar: atualizarAgente,
    verificar: verificarChave,
    limparTudo: limparChaves,
    atualizarBusca,
    verificarBusca: verificarChaveBusca,
    registrarNoHistorico,
  };
}
