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

const csp = [
  "default-src 'self'",
  dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // O navegador só fala com a própria origem: as chamadas às APIs de IA
  // acontecem no servidor, nunca direto do cliente.
  `connect-src 'self'${dev ? " ws: http://localhost:*" : ""}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
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
