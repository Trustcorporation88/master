"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Documentos, type Documento } from "@/components/Documentos";
import { Progresso } from "@/components/Progresso";
import { Resposta } from "@/components/Resposta";
import {
  PROFUNDIDADES,
  type Confianca,
  type Etapa,
  type EventoPublico,
  type FontePublica,
  type Profundidade,
} from "@/lib/publicTypes";

/**
 * A interface do produto.
 *
 * Importa apenas de `publicTypes` — nada de `lib/providers`, `lib/duel/*`,
 * `lib/search` ou `lib/storage`. Isso é intencional: manter nomes de
 * fornecedores, modelos e estratégias fora do bundle que vai para o navegador.
 *
 * A lista inicial de documentos vem pronta do servidor, o que evita um efeito
 * de carregamento no cliente e um ida-e-volta na primeira renderização.
 */
export function Analise({ documentosIniciais }: { documentosIniciais: Documento[] }) {
  const router = useRouter();
  const [pergunta, setPergunta] = useState("");
  const [profundidade, setProfundidade] = useState<Profundidade>("equilibrada");

  const [rodando, setRodando] = useState(false);
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const [resposta, setResposta] = useState("");
  const [confianca, setConfianca] = useState<Confianca | null>(null);
  const [ressalvas, setRessalvas] = useState<string[]>([]);
  const [fontes, setFontes] = useState<FontePublica[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [perguntaFeita, setPerguntaFeita] = useState("");
  const [documentos, setDocumentos] = useState<Documento[]>(documentosIniciais);
  const [selecionados, setSelecionados] = useState<Set<string>>(
    () => new Set(documentosIniciais.filter((d) => d.estado === "pronto").map((d) => d.id)),
  );
  const [coberturas, setCoberturas] = useState<Array<{ nome: string; cobertura: number }>>([]);

  const abortRef = useRef<AbortController | null>(null);

  const carregarDocumentos = useCallback(async () => {
    try {
      const res = await fetch("/api/documentos");
      if (!res.ok) return;
      const data = await res.json();
      const lista: Documento[] = data.documentos ?? [];
      setDocumentos(lista);
      // Marca automaticamente o que acabou de ficar pronto: quem enviou um
      // arquivo quer usá-lo, e obrigar um segundo clique é atrito sem motivo.
      setSelecionados((atual) => {
        const novo = new Set(atual);
        for (const d of lista) if (d.estado === "pronto" && !atual.has(d.id)) novo.add(d.id);
        for (const id of atual) if (!lista.some((d) => d.id === id)) novo.delete(id);
        return novo;
      });
    } catch {
      /* silencioso: a lista é acessória */
    }
  }, []);

  const alternarDocumento = useCallback((id: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }, []);

  const podeEnviar = pergunta.trim().length > 0 && !rodando;

  const cancelar = useCallback(() => {
    abortRef.current?.abort();
    setRodando(false);
    setEtapa(null);
  }, []);

  const analisar = useCallback(async () => {
    if (!podeEnviar) return;

    const texto = pergunta.trim();
    setPerguntaFeita(texto);
    setRodando(true);
    setEtapa("interpretando");
    setResposta("");
    setConfianca(null);
    setRessalvas([]);
    setFontes([]);
    setCoberturas([]);
    setErro(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const aplicar = (evt: EventoPublico) => {
      switch (evt.type) {
        case "etapa":
          setEtapa(evt.etapa);
          break;
        case "fontes":
          setFontes(evt.fontes);
          break;
        case "documentos":
          setCoberturas(evt.documentos);
          break;
        case "resposta_delta":
          setResposta((t) => t + evt.texto);
          break;
        case "final":
          setConfianca(evt.confianca);
          setRessalvas(evt.ressalvas);
          break;
        case "erro":
          setErro(evt.texto);
          break;
        case "aviso":
          break;
      }
    };

    try {
      const res = await fetch("/api/duel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          query: texto,
          profundidade,
          documentos: [...selecionados],
        }),
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setErro(data.error ?? "Não foi possível iniciar a análise.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let corte: number;
        while ((corte = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, corte);
          buffer = buffer.slice(corte + 2);
          const linha = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!linha) continue;
          try {
            aplicar(JSON.parse(linha.slice(5).trim()) as EventoPublico);
          } catch {
            /* quadro parcial */
          }
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setErro(err instanceof Error ? "Conexão interrompida." : "Falha inesperada.");
      }
    } finally {
      setRodando(false);
      setEtapa(null);
    }
  }, [podeEnviar, pergunta, profundidade, router, selecionados]);

  const copiar = useCallback(() => {
    navigator.clipboard?.writeText(resposta);
  }, [resposta]);

  const mostrandoResposta = resposta.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-linha bg-papel/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-marca">
              <span className="font-serif text-[13px] font-semibold text-white">M</span>
            </span>
            <div className="leading-tight">
              <span className="block font-serif text-[15px] font-semibold tracking-tight">
                Master
              </span>
              <span className="block text-[10.5px] text-tinta-clara">Inteligência analítica</span>
            </div>
          </div>

          <button
            onClick={async () => {
              await fetch("/api/login", { method: "DELETE" });
              router.replace("/login");
            }}
            className="text-[12px] text-tinta-clara transition hover:text-tinta"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        {!mostrandoResposta && !rodando && (
          <div className="mb-8 text-center">
            <h1 className="font-serif text-[27px] font-semibold leading-tight tracking-tight text-tinta sm:text-[32px]">
              O que você precisa saber?
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[14.5px] leading-relaxed text-tinta-media">
              Sua pergunta passa por análise cruzada e revisão antes de virar resposta. O grau de
              confiança e as fontes vêm sempre declarados.
            </p>
          </div>
        )}

        {/* Composição da pergunta */}
        <section className="rounded-xl border border-linha bg-branco p-5 shadow-sm">
          <textarea
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") analisar();
            }}
            rows={mostrandoResposta ? 2 : 4}
            placeholder="Descreva sua pergunta. Quanto mais específica, melhor a resposta."
            className="w-full resize-y bg-transparent text-[15px] leading-relaxed text-tinta outline-none placeholder:text-tinta-clara"
          />

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-linha pt-4">
            <div>
              <span className="mb-1.5 block text-[10.5px] font-medium uppercase tracking-wider text-tinta-clara">
                Profundidade
              </span>
              <div className="flex rounded-lg border border-linha p-0.5">
                {PROFUNDIDADES.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProfundidade(p.id)}
                    title={`${p.descricao} (${p.tempo})`}
                    className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
                      profundidade === p.id
                        ? "bg-marca text-white"
                        : "text-tinta-media hover:bg-papel"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="hidden text-[11.5px] text-tinta-clara sm:inline">
                {PROFUNDIDADES.find((p) => p.id === profundidade)?.tempo}
              </span>
              {rodando ? (
                <button
                  onClick={cancelar}
                  className="rounded-lg border border-linha-forte px-4 py-2.5 text-[13px] font-medium text-tinta-media transition hover:border-alerta/50 hover:text-alerta"
                >
                  Cancelar
                </button>
              ) : (
                <button
                  onClick={analisar}
                  disabled={!podeEnviar}
                  className="rounded-lg bg-marca px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-marca-clara disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Analisar
                </button>
              )}
            </div>
          </div>
        </section>

        <Documentos
          documentos={documentos}
          selecionados={selecionados}
          onAlternar={alternarDocumento}
          onMudou={carregarDocumentos}
          rodando={rodando}
        />

        {erro && (
          <p className="mt-4 rounded-lg border border-alerta/25 bg-alerta/5 px-4 py-3 text-[13px] text-alerta">
            {erro}
          </p>
        )}

        {perguntaFeita && (rodando || mostrandoResposta) && (
          <p className="mt-8 border-l-2 border-linha-forte pl-4 font-serif text-[15px] italic leading-relaxed text-tinta-media">
            {perguntaFeita}
          </p>
        )}

        {/* Progresso, enquanto a resposta ainda não começou a chegar */}
        {rodando && !mostrandoResposta && etapa && (
          <div className="mt-5">
            <Progresso etapa={etapa} temFontes={fontes.length > 0} />
          </div>
        )}

        {coberturas.some((c) => c.cobertura < 100) && (
          <div className="mt-4 rounded-lg border border-realce/25 bg-realce/5 px-4 py-3">
            <p className="text-[12px] leading-relaxed text-tinta-media">
              <span className="font-medium">Leitura parcial dos documentos.</span>{" "}
              {coberturas
                .filter((c) => c.cobertura < 100)
                .map((c) => `${c.nome}: ${c.cobertura}% do conteúdo`)
                .join(" · ")}
              . Foram usados os trechos mais relevantes à sua pergunta.
            </p>
          </div>
        )}

        {mostrandoResposta && (
          <div className="mt-5">
            <Resposta
              texto={resposta}
              streaming={rodando}
              confianca={confianca}
              ressalvas={ressalvas}
              fontes={fontes}
              onCopiar={copiar}
            />
          </div>
        )}
      </main>

      <footer className="border-t border-linha px-6 py-5">
        <div className="mx-auto max-w-3xl text-[11px] leading-relaxed text-tinta-clara">
          Respostas geradas por inteligência artificial com verificação de fontes. Confira as
          ressalvas antes de decisões críticas. · TrustCorp
        </div>
      </footer>
    </div>
  );
}
