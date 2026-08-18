/**
 * Tipos e rótulos compartilhados com o navegador.
 *
 * Este é o ÚNICO arquivo de domínio que componentes de cliente importam. Ele não
 * contém nome de fornecedor, nome de modelo, nome de estratégia nem qualquer
 * detalhe do processo interno — nada disso deve chegar ao bundle público.
 */

export type Profundidade = "rapida" | "equilibrada" | "profunda";

export const PROFUNDIDADES: Array<{
  id: Profundidade;
  label: string;
  descricao: string;
  tempo: string;
}> = [
  {
    id: "rapida",
    label: "Rápida",
    descricao: "Resposta direta, com verificação básica.",
    tempo: "~30s",
  },
  {
    id: "equilibrada",
    label: "Equilibrada",
    descricao: "Análise cruzada e revisão antes de concluir.",
    tempo: "1 a 2 min",
  },
  {
    id: "profunda",
    label: "Profunda",
    descricao: "Rodadas de revisão até estabilizar a conclusão.",
    tempo: "3 a 6 min",
  },
];

/** Fonte consultada, como o usuário a vê. */
export type FontePublica = {
  n: number;
  titulo: string;
  url: string;
  data?: string;
};

/** Etapas mostradas durante o processamento, em linguagem de produto. */
export type Etapa =
  | "interpretando"
  | "consultando"
  | "analisando"
  | "revisando"
  | "consolidando"
  | "concluido";

export const ETAPA_LABEL: Record<Etapa, string> = {
  interpretando: "Interpretando a pergunta",
  consultando: "Consultando fontes",
  analisando: "Elaborando a análise",
  revisando: "Revisando e confrontando",
  consolidando: "Consolidando a resposta",
  concluido: "Concluído",
};

/** Eventos que o navegador recebe. Nada aqui revela o mecanismo. */
export type EventoPublico =
  | { type: "etapa"; etapa: Etapa }
  | { type: "fontes"; fontes: FontePublica[] }
  | { type: "documentos"; documentos: Array<{ nome: string; cobertura: number }> }
  | { type: "aviso"; texto: string }
  | { type: "resposta_delta"; texto: string }
  | { type: "final"; confianca: Confianca; ressalvas: string[] }
  | { type: "erro"; texto: string };

export type Confianca = "alta" | "media" | "baixa";

export const CONFIANCA_LABEL: Record<Confianca, { label: string; explicacao: string }> = {
  alta: {
    label: "Confiança alta",
    explicacao: "A análise chegou a uma conclusão estável e bem sustentada.",
  },
  media: {
    label: "Confiança média",
    explicacao: "A conclusão é razoável, mas há pontos que merecem verificação.",
  },
  baixa: {
    label: "Confiança baixa",
    explicacao: "Não há base suficiente para uma conclusão firme. Leia as ressalvas.",
  },
};
