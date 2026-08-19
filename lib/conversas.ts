/**
 * Conversas: perguntas e respostas que sobrevivem ao recarregar a página.
 *
 * Antes cada pergunta apagava a anterior. Isso quebrava dois usos legítimos:
 * perguntar em cima da resposta ("e no caso de perda por validade?"), e voltar
 * a uma análise feita ontem.
 *
 * A gravação é JSON no mesmo armazenamento dos documentos — sem banco, sem
 * migração. Uma conversa é um arquivo; o app é de uso pessoal e o volume não
 * justifica mais estrutura que isso.
 *
 * Só servidor.
 */

import { randomUUID } from "node:crypto";
import { gravarJson, lerJson, listarCaminhos, removerCaminho } from "./storage";
import type { Confianca, FontePublica } from "./publicTypes";

export type Turno = {
  pergunta: string;
  resposta: string;
  confianca: Confianca | null;
  ressalvas: string[];
  fontes: FontePublica[];
  /** Nomes dos documentos que entraram nesta resposta. */
  documentos: string[];
  criadoEm: string;
};

export type Conversa = {
  id: string;
  titulo: string;
  criadoEm: string;
  atualizadoEm: string;
  turnos: Turno[];
};

export type ConversaResumo = {
  id: string;
  titulo: string;
  atualizadoEm: string;
  turnos: number;
};

const PASTA = "conversas";

/** Quantas conversas a lista traz. */
const MAX_LISTA = 60;

/**
 * Quantos turnos anteriores entram no contexto da próxima pergunta.
 *
 * O histórico entra no prompt de cada fornecedor, então o custo se multiplica.
 * Seis turnos cobrem qualquer encadeamento real de raciocínio; além disso o
 * usuário já mudou de assunto, e pagar por isso não melhora a resposta.
 */
const TURNOS_NO_CONTEXTO = 6;

/**
 * Corte da resposta anterior dentro do contexto.
 *
 * A pergunta vai inteira — é curta e é o que orienta. A resposta é resumida
 * pelo começo, que é onde fica a conclusão.
 */
const CORTE_RESPOSTA = 3_000;

const caminho = (id: string) => `${PASTA}/${id}.json`;

function tituloDe(pergunta: string): string {
  const limpo = pergunta.replace(/\s+/g, " ").trim();
  return limpo.length > 80 ? `${limpo.slice(0, 77)}…` : limpo;
}

export async function lerConversa(id: string): Promise<Conversa | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null; // evita caminho arbitrário
  return lerJson<Conversa>(caminho(id));
}

/**
 * Acrescenta um turno, criando a conversa se ainda não existir.
 *
 * Devolve a conversa gravada para que o chamador saiba o id — é assim que o
 * cliente descobre onde continuar quando a conversa acaba de nascer.
 */
export async function acrescentarTurno(
  id: string | null,
  turno: Turno,
): Promise<Conversa> {
  const agora = new Date().toISOString();
  const existente = id ? await lerConversa(id) : null;

  const conversa: Conversa = existente
    ? { ...existente, atualizadoEm: agora, turnos: [...existente.turnos, turno] }
    : {
        id: randomUUID(),
        titulo: tituloDe(turno.pergunta),
        criadoEm: agora,
        atualizadoEm: agora,
        turnos: [turno],
      };

  await gravarJson(caminho(conversa.id), conversa);
  return conversa;
}

export async function listarConversas(): Promise<ConversaResumo[]> {
  const arquivos = (await listarCaminhos(PASTA)).filter((n) => n.endsWith(".json"));

  const lidas = await Promise.all(
    arquivos.slice(0, MAX_LISTA).map((n) => lerJson<Conversa>(`${PASTA}/${n}`)),
  );

  return lidas
    .filter((c): c is Conversa => Boolean(c?.turnos?.length))
    .map((c) => ({
      id: c.id,
      titulo: c.titulo,
      atualizadoEm: c.atualizadoEm,
      turnos: c.turnos.length,
    }))
    .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
}

export async function removerConversa(id: string): Promise<void> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return;
  await removerCaminho(caminho(id));
}

/**
 * Monta o bloco de histórico que vai nos prompts.
 *
 * Ele diz explicitamente que o assunto pode ter mudado. Sem esse aviso, um
 * modelo tende a forçar ligação entre a pergunta nova e a conversa anterior,
 * respondendo o que não foi perguntado.
 */
export function blocoConversa(turnos: Turno[]): string {
  if (!turnos.length) return "";

  const recentes = turnos.slice(-TURNOS_NO_CONTEXTO);
  const partes: string[] = ["# Conversa até aqui", ""];

  recentes.forEach((t, i) => {
    const n = recentes.length - i;
    const resposta =
      t.resposta.length > CORTE_RESPOSTA
        ? `${t.resposta.slice(0, CORTE_RESPOSTA)}\n\n_(resposta truncada aqui; o texto completo já foi entregue ao usuário)_`
        : t.resposta;

    partes.push(`## Pergunta anterior ${n === 1 ? "(a mais recente)" : `(${n} antes)`}`);
    partes.push(t.pergunta);
    partes.push("");
    partes.push("### Resposta que o usuário recebeu");
    partes.push(resposta);
    if (t.confianca) partes.push(`\n_Confiança declarada: ${t.confianca}._`);
    partes.push("");
  });

  partes.push("## Como usar este histórico");
  partes.push("");
  partes.push("- A pergunta nova pode ser continuação do que veio antes, ou assunto novo. Leia a pergunta primeiro e decida: não force ligação onde não há.");
  partes.push("- Sendo continuação, não repita o que já foi dito: avance. Pronomes e referências soltas na pergunta ('e nesse caso', 'e ele') se resolvem aqui.");
  partes.push("- Se você discorda de algo afirmado antes, corrija abertamente e explique. Coerência com um erro anterior é pior que a contradição.");
  partes.push("");

  return partes.join("\n");
}
