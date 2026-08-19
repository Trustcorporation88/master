import { notFound } from "next/navigation";
import { lerConversa } from "@/lib/conversas";
import { CONFIANCA_LABEL } from "@/lib/publicTypes";
import { Markdown } from "@/components/Markdown";
import { AutoImprimir } from "@/components/AutoImprimir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Versão para impressão e para salvar em PDF.
 *
 * Em vez de montar PDF no servidor, esta página é feita para o diálogo de
 * impressão do navegador: ele já sabe paginar, quebrar tabela e embutir fonte,
 * e o resultado sai com a mesma tipografia do site. Um PDF montado à mão
 * achataria as tabelas das análises, que é justamente onde está o conteúdo.
 */
export default async function Imprimir({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ turno?: string }>;
}) {
  const { id } = await params;
  const { turno } = await searchParams;
  const conversa = await lerConversa(id);
  if (!conversa) notFound();

  // Uma resposta só, quando pedido: exportar a conversa inteira leva junto o
  // assunto anterior, que raramente é o que se quer imprimir.
  const numero = Number(turno);
  const umTurno =
    Number.isInteger(numero) && numero >= 1 && numero <= conversa.turnos.length;
  const recorte = umTurno
    ? { inicio: numero - 1, turnos: [conversa.turnos[numero - 1]] }
    : { inicio: 0, turnos: conversa.turnos };
  if (!recorte.turnos.length) notFound();

  // O título da conversa é a primeira pergunta. Num recorte de uma resposta só,
  // isso anuncia o assunto errado: o documento vira a pergunta recortada, e a
  // conversa de origem fica como referência.
  const titulo = umTurno ? recorte.turnos[0].pergunta : conversa.titulo;

  const data = new Date(conversa.atualizadoEm).toLocaleString("pt-BR");

  return (
    <div className="mx-auto max-w-3xl px-8 py-10 print:p-0">
      <AutoImprimir />

      <header className="mb-8 border-b border-linha pb-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-serif text-[15px] font-semibold tracking-tight">Master</span>
          <span className="text-[11px] text-tinta-clara">{data}</span>
        </div>
        <h1 className="mt-3 font-serif text-[22px] font-semibold leading-snug tracking-tight">
          {titulo}
        </h1>
        {umTurno && (
          <p className="mt-2 text-[11px] text-tinta-clara">
            Pergunta {numero} de {conversa.turnos.length} da conversa &ldquo;{conversa.titulo}
            &rdquo;.
          </p>
        )}
      </header>

      {recorte.turnos.map((t, i) => (
        <article key={i} className="mb-10">
          {/* A pergunta e o começo da resposta não devem se separar. */}
          <div className="break-inside-avoid">
            <h2 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-tinta-clara">
              Pergunta {recorte.inicio + i + 1}
            </h2>
            <p className="mb-5 border-l-2 border-linha-forte pl-3 font-serif text-[15px] leading-relaxed">
              {t.pergunta}
            </p>
          </div>

          <Markdown>{t.resposta}</Markdown>

          {t.confianca && (
            <p className="mt-4 text-[12px] text-tinta-media">
              <strong>{CONFIANCA_LABEL[t.confianca].label}.</strong>{" "}
              {CONFIANCA_LABEL[t.confianca].explicacao}
            </p>
          )}

          {t.documentos.length > 0 && (
            <p className="mt-2 text-[11.5px] text-tinta-clara">
              Documentos considerados: {t.documentos.join(", ")}.
            </p>
          )}

          {t.ressalvas.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-tinta-clara">
                Pontos a verificar
              </h3>
              <ol className="ml-4 list-decimal space-y-1 text-[12.5px] leading-relaxed text-tinta-media">
                {t.ressalvas.map((r, k) => (
                  <li key={k}>{r}</li>
                ))}
              </ol>
            </section>
          )}

          {t.fontes.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-tinta-clara">
                Fontes consultadas
              </h3>
              <ol className="space-y-1 text-[11.5px] leading-relaxed text-tinta-media">
                {t.fontes.map((f) => (
                  <li key={f.n}>
                    [{f.n}] {f.titulo} — <span className="fonte-url break-all">{f.url}</span>
                    {f.data ? ` (${f.data})` : ""}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>
      ))}

      <footer className="mt-10 border-t border-linha pt-4 text-[10.5px] leading-relaxed text-tinta-clara">
        Documento gerado por análise automatizada. O grau de confiança e os pontos a verificar são
        declarados pela própria análise — confira no original os números e datas que forem decidir
        algo.
      </footer>
    </div>
  );
}
