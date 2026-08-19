import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança.
 *
 * As chaves de API do usuário vivem no localStorage, então XSS é o vetor de
 * risco real deste projeto. A CSP abaixo restringe de onde pode vir script,
 * para onde a página pode falar, e bloqueia enquadramento por terceiros.
 *
 * 'unsafe-inline' em style-src é necessário para os estilos inline do React.
 * Em desenvolvimento, o runtime do Next exige 'unsafe-eval'; em produção a
 * política fica mais estrita.
 */
const dev = process.env.NODE_ENV !== "production";

/**
 * Origem do armazenamento, para a CSP.
 *
 * O navegador envia o arquivo DIRETO para o armazenamento por URL assinada, o
 * que é uma chamada a outra origem. Sem liberá-la aqui, o navegador barra o
 * envio antes de ele sair da máquina — e o erro que aparece é "falha de rede",
 * que não diz nada sobre a causa real.
 *
 * Prefere-se a origem exata; o curinga só entra quando a variável não está
 * definida no momento em que a configuração é lida.
 */
function origemArmazenamento(): string {
  const bruto = process.env.SUPABASE_URL?.trim();
  if (!bruto) return "https://*.supabase.co";
  try {
    return new URL(bruto).origin;
  } catch {
    return "https://*.supabase.co";
  }
}

const csp = [
  "default-src 'self'",
  dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // As chamadas às APIs de IA acontecem no servidor, nunca direto do cliente.
  // A única exceção é o armazenamento, que recebe o arquivo direto do
  // navegador para não passar 100 MB pela memória do app.
  `connect-src 'self' ${origemArmazenamento()}${dev ? " ws: http://localhost:*" : ""}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  /**
   * Bibliotecas de leitura de documento ficam fora do empacotamento.
   *
   * O pdfjs carrega o próprio worker por caminho de arquivo; empacotado, o
   * caminho aponta para um chunk que não existe e a leitura de PDF falha em
   * produção (funciona em desenvolvimento, o que torna a falha traiçoeira).
   * exceljs e mammoth entram pelo mesmo motivo: dependem de recursos em disco.
   * @napi-rs/canvas é binário nativo e simplesmente não é empacotável.
   */
  serverExternalPackages: ["pdfjs-dist", "exceljs", "mammoth", "@napi-rs/canvas"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Evita que qualquer intermediário guarde respostas com dados do duelo.
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
