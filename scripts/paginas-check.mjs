/**
 * Confere extração de URLs, leitura HTTP e bloqueio de endereço privado.
 *
 * Uso: node --experimental-strip-types scripts/paginas-check.mjs
 */

import { createServer } from "node:http";

process.env.NODE_ENV =
  process.env.NODE_ENV === "production" ? "test" : process.env.NODE_ENV || "test";

const { extrairUrls, lerPaginasDaPergunta, dossiePaginas } = await import(
  new URL("../lib/paginas.ts", import.meta.url).href
);

const falhas = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas.push(msg);
};

const pergunta =
  "Avalie https://powerball-production-b6c1.up.railway.app e também foo.up.railway.app/health, sem repetir. Contato: admin@trustcorp.com.br";

const urls = extrairUrls(pergunta);
ok(
  urls.includes("https://powerball-production-b6c1.up.railway.app/"),
  `https explícito extraído (${urls[0] ?? "nenhuma"})`,
);
ok(
  urls.some((u) => u.includes("foo.up.railway.app/health")),
  "endereço nu de railway.app extraído",
);
ok(!urls.some((u) => u.includes("trustcorp.com.br")), "e-mail não vira URL");
ok(urls.length <= 4, `teto de ${urls.length} URLs`);

const spa = `<!doctype html><html><head><title>Loterias Inteligentes • Palpites</title>
<meta name="description" content="Palpites Caixa"><script type="module" src="/assets/index.js"></script>
</head><body><div id="root"></div></body></html>`;

const jsonOk = JSON.stringify({ status: "ok", time: "2026-09-16T00:00:00Z" });

const server = createServer((req, res) => {
  if (req.url === "/spa") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(spa);
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(jsonOk);
    return;
  }
  if (req.url === "/vai") {
    res.writeHead(302, { location: "/health" });
    res.end();
    return;
  }
  res.writeHead(404).end("nao");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const porta = server.address().port;
const base = `http://127.0.0.1:${porta}`;

const lidas = await lerPaginasDaPergunta(
  `Abra ${base}/spa e ${base}/health e ${base}/vai`,
);

ok(lidas.fontes.length === 3, `leu ${lidas.fontes.length} páginas locais`);
ok(
  lidas.fontes.some((f) => /Loterias Inteligentes/.test(f.titulo) && /casco HTML|aplicativo cliente/.test(f.trecho)),
  "SPA entra como casco HTML com título",
);
ok(
  lidas.fontes.some((f) => /"status":"ok"/.test(f.trecho)),
  "JSON /health entra no dossiê",
);
ok(
  lidas.fontes.some((f) => f.url.endsWith("/health") && f.consulta.endsWith("/vai")),
  "redirect é seguido e revalidado",
);

const dossie = dossiePaginas(lidas);
ok(/Páginas lidas agora pelo servidor/.test(dossie), "dossiê declara leitura pelo servidor");
ok(!/não fazem HTTP/i.test(dossie) || /não diga que/.test(dossie), "dossiê instrui a não negar HTTP");

const prev = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const bloqueio = await lerPaginasDaPergunta(`veja http://127.0.0.1:${porta}/health`);
process.env.NODE_ENV = prev;
ok(
  bloqueio.fontes.length === 0 && bloqueio.erros.some((e) => /privado|local/.test(e)),
  "produção bloqueia loopback",
);

try {
  const vivo = await lerPaginasDaPergunta(
    "o site https://powerball-production-b6c1.up.railway.app carrega?",
  );
  const fonte = vivo.fontes[0];
  ok(Boolean(fonte), `site ao vivo respondeu (${vivo.erros.join("; ") || "sem erro"})`);
  if (fonte) {
    ok(/http \d{3}/i.test(fonte.trecho), "status HTTP no trecho da página ao vivo");
    console.log(`  título: ${fonte.titulo}`);
    console.log(`  url: ${fonte.url}`);
    console.log(`  trecho: ${fonte.trecho.slice(0, 220).replace(/\s+/g, " ")}…`);
  }
} catch (err) {
  falhas.push(`fetch ao vivo: ${err instanceof Error ? err.message : err}`);
  console.log(`✗ fetch ao vivo: ${err instanceof Error ? err.message : err}`);
}

server.close();

if (falhas.length) {
  console.error(`\n${falhas.length} falha(s)`);
  process.exit(1);
}
console.log("\nok");
