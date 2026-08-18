import { Analise } from "@/components/Analise";
import { listarDocumentos } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Ponto de entrada, no servidor.
 *
 * A lista de documentos é lida aqui e entregue pronta ao componente de
 * interface. Assim o cliente não precisa de um efeito de carregamento, e
 * `lib/storage` — que conhece credenciais de armazenamento — nunca entra no
 * bundle do navegador.
 */
export default async function Home() {
  let documentos: Awaited<ReturnType<typeof listarDocumentos>> = [];

  try {
    documentos = await listarDocumentos();
  } catch (err) {
    // Armazenamento indisponível não deve impedir o uso da análise.
    console.error("[inicio] falha ao listar documentos:", err);
  }

  return (
    <Analise
      documentosIniciais={documentos.map((d) => ({
        id: d.id,
        nome: d.nome,
        bytes: d.bytes,
        criadoEm: d.criadoEm,
        tipo: d.tipo,
        resumoEstrutura: d.resumoEstrutura,
        aviso: d.aviso,
        estado: d.estado,
        erro: d.erro,
      }))}
    />
  );
}
