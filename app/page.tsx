import { Analise } from "@/components/Analise";
import { listarConversas } from "@/lib/conversas";
import { listarDocumentos } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Ponto de entrada, no servidor.
 *
 * As listas de documentos e de conversas são lidas aqui e entregues prontas ao
 * componente de interface. Assim o cliente não precisa de efeito de
 * carregamento, e `lib/storage` — que conhece credenciais de armazenamento —
 * nunca entra no bundle do navegador.
 */
export default async function Home() {
  let documentos: Awaited<ReturnType<typeof listarDocumentos>> = [];
  let conversas: Awaited<ReturnType<typeof listarConversas>> = [];

  try {
    [documentos, conversas] = await Promise.all([listarDocumentos(), listarConversas()]);
  } catch (err) {
    // Armazenamento indisponível não deve impedir o uso da análise.
    console.error("[inicio] falha ao ler o armazenamento:", err);
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
      conversasIniciais={conversas}
    />
  );
}
