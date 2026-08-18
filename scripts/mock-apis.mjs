/**
 * Servidor de teste que emula as APIs da Anthropic, OpenAI e DeepSeek.
 *
 * Serve para validar o motor de duelo de ponta a ponta sem gastar chaves reais.
 * Uso: node scripts/mock-apis.mjs & e depois aponte *_BASE_URL para as portas.
 *
 * Porta 4001 = formato Anthropic (/v1/messages)
 * Porta 4002 = formato OpenAI    (/v1/chat/completions)
 * Porta 4003 = formato DeepSeek  (idem OpenAI)
 * Porta 4004 = formato Brave Search (/res/v1/web/search)
 * Porta 4005 = formato Tavily      (/search)
 */

import { createServer } from "node:http";

const MODELOS = {
  4001: ["claude-opus-4-5", "claude-sonnet-4-5"],
  4002: ["gpt-5.1", "gpt-4.1"],
  4003: ["deepseek-chat", "deepseek-reasoner"],
};

const NOMES = { 4001: "anthropic", 4002: "openai", 4003: "deepseek" };

/** Resposta sintética que depende da fase, para exercitar todos os caminhos. */
function textoPara(porta, prompt) {
  const quem = NOMES[porta];

  if (/# Consolidação final/.test(prompt)) {
    const comDossie = /# Dossiê de evidência/.test(prompt);
    const scores = ["anthropic", "openai", "deepseek"]
      .filter((p) => prompt.includes(`id: ${p}`))
      .map(
        (p) =>
          `{"provider":"${p}","correcao":8,"completude":7,"raciocinio":8,"riscos":6,${
            comDossie ? '"fundamentacao":9,' : ""
          }"comentario":"Parecer consistente."}`,
      )
      .join(",");

    // Formato novo: a resposta ao usuário primeiro, telemetria depois.
    return `## Resposta consolidada

Esta é uma resposta simulada para teste, com **markdown** e um trecho de código:

\`\`\`python
print('ok')
\`\`\`

O ponto central se confirma${comDossie ? " [1]" : ""}, e a data consta na fonte${comDossie ? " [2]" : ""}.

\`\`\`json
{"confidence":"alta","winner":"anthropic","scores":[${scores}],"ressalvas":["Este é um teste com servidor simulado, não uma resposta real."]}
\`\`\``;
  }

  if (/# Levantamento de evidência/.test(prompt)) {
    // Simula o agente decidindo pesquisar; "revise este código" pede NENHUMA.
    if (/revise|revisar|este c[óo]digo|trecho abaixo/i.test(prompt)) return "NENHUMA";
    return '["capital do brasil historia", "brasilia construcao 1960"]';
  }

  if (/# Síntese do facilitador/.test(prompt)) {
    return `### Pontos de consenso\n- **Forte** — os agentes concordam no núcleo.\n\n### Pontos de divergência\nNenhuma divergência relevante.\n\n### Convergência: 8/10`;
  }
  if (/# Crítica cruzada/.test(prompt)) {
    return `Concordo com o núcleo da resposta alheia e reconheço que ela está correta no ponto principal. Porém identifiquei uma lacuna em casos-limite.\n\n**Minha posição agora**: ajusto minha resposta.`;
  }
  if (/# Red Team/.test(prompt)) {
    return `1. **Falha**: caso-limite não tratado\n2. **Gravidade**: Média\n3. **Correção**: validar a entrada\n\n**Veredito do ataque**: sobrevive com correções.`;
  }

  const citando = /# Dossiê de evidência/.test(prompt)
    ? " Segundo a fonte [1], o ponto central se confirma, e [2] traz a data."
    : "";

  return `### Resposta de ${quem}\n\nEsta é uma resposta simulada para teste do motor.${citando} Concordo que o ponto central está correto.\n\n- item um\n- item dois\n\n**Confiança**: Alta.`;
}

function sseAnthropic(res, texto) {
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ type: "message_start", message: { usage: { input_tokens: 120 } } });
  send({ type: "content_block_start", index: 0 });
  for (const parte of texto.match(/[\s\S]{1,24}/g) ?? []) {
    send({ type: "content_block_delta", delta: { type: "text_delta", text: parte } });
  }
  send({ type: "content_block_stop", index: 0 });
  send({ type: "message_delta", delta: {}, usage: { output_tokens: 210 } });
  send({ type: "message_stop" });
  res.end();
}

function sseOpenAI(res, texto) {
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  for (const parte of texto.match(/[\s\S]{1,24}/g) ?? []) {
    send({ choices: [{ delta: { content: parte } }] });
  }
  send({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 130, completion_tokens: 190 } });
  res.write("data: [DONE]\n\n");
  res.end();
}

/* ---------------- APIs de busca simuladas ---------------- */

const FONTES = [
  {
    title: "Brasília — história da construção",
    url: "https://exemplo.org/brasilia-historia",
    text: "Brasília foi inaugurada em 21 de abril de 1960, planejada por Lúcio Costa e Oscar Niemeyer.",
    date: "2024-03-11",
  },
  {
    title: "Interiorização da capital brasileira",
    url: "https://exemplo.org/interiorizacao",
    text: "A transferência da capital para o Planalto Central buscava ocupar o interior do país.",
    date: "2023-09-02",
  },
  {
    title: "Plano Piloto e o concurso de 1957",
    url: "https://exemplo.org/plano-piloto",
    text: "O Plano Piloto venceu o concurso nacional realizado em 1957.",
    date: "2022-01-20",
  },
];

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/res/v1/web/search")) {
    res.writeHead(404).end("{}");
    return;
  }
  if (req.headers["x-subscription-token"] === "invalida") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid token" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      web: {
        results: FONTES.map((f) => ({
          title: f.title,
          url: f.url,
          description: `<strong>${f.text}</strong>`,
          extra_snippets: ["Trecho adicional da mesma página."],
          page_age: f.date,
        })),
      },
    }),
  );
}).listen(4004, () => console.log("mock brave em :4004"));

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.headers.authorization === "Bearer invalida") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: { error: "unauthorized" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        results: FONTES.map((f) => ({
          title: f.title,
          url: f.url,
          content: f.text,
          score: 0.9,
          published_date: f.date,
        })),
      }),
    );
  });
}).listen(4005, () => console.log("mock tavily em :4005"));

for (const porta of [4001, 4002, 4003]) {
  createServer((req, res) => {
    if (req.url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: MODELOS[porta].map((id) => ({ id })) }));
      return;
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");

      // Modelo com "falha" no nome simula erro de autenticação do provedor.
      if (String(parsed.model ?? "").includes("falha")) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "API key is invalid." } }));
        return;
      }

      const prompt = parsed.messages?.map((m) => m.content).join("\n") ?? "";
      const texto = textoPara(porta, prompt);

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });

      if (porta === 4001) sseAnthropic(res, texto);
      else sseOpenAI(res, texto);
    });
  }).listen(porta, () => console.log(`mock ${NOMES[porta]} em :${porta}`));
}
