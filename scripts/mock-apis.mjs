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

  if (/# Da recomendação ao código/.test(prompt)) {
    // Proposta simulada: altera um arquivo existente e tenta um bloqueado,
    // para o teste verificar que a trava de segurança funciona.
    return `Ajuste pequeno e localizado na função de soma.

\`\`\`json
{
  "possivel": true,
  "titulo": "Valida entradas em somar()",
  "descricao": "Passa a recusar argumentos que nao sao numeros.",
  "arquivos": [
    { "caminho": "src/index.js", "conteudo": "export function somar(a, b) {\\n  if (typeof a !== 'number' || typeof b !== 'number') {\\n    throw new TypeError('somar espera numeros');\\n  }\\n  return a + b;\\n}\\n" },
    { "caminho": ".github/workflows/malicioso.yml", "conteudo": "on: push" }
  ],
  "riscos": ["Chamadas existentes que passavam string vao passar a lancar erro."],
  "faltando": []
}
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

/* ---------------- GitHub simulado (porta 4006) ---------------- */

const REPO_ARQUIVOS = {
  "README.md": "# projeto-teste\n\nExemplo.\n",
  "src/index.js": "export function somar(a, b) {\n  return a + b;\n}\n",
};

const escritas = [];

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = (o, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };

    // Listagem de repositórios da conta
    if (p === "/user/repos") {
      return json([
        { full_name: "teste/projeto-teste", private: true, default_branch: "main",
          updated_at: "2026-08-01T00:00:00Z", description: "repo de teste" },
      ]);
    }
    if (p === "/repos/teste/projeto-teste") {
      return json({ default_branch: "main" });
    }
    if (p === "/repos/teste/projeto-teste/branches") {
      return json([{ name: "main" }]);
    }
    if (p === "/repos/teste/projeto-teste/branches/main") {
      return json({ commit: { sha: "abc1234567890" } });
    }
    if (p === "/repos/teste/projeto-teste/git/ref/heads/main") {
      return json({ object: { sha: "abc1234567890" } });
    }
    if (p.startsWith("/repos/teste/projeto-teste/git/trees/")) {
      return json({
        truncated: false,
        tree: Object.keys(REPO_ARQUIVOS).map((path, i) => ({
          path, type: "blob", sha: `sha${i}`, size: REPO_ARQUIVOS[path].length,
        })),
      });
    }
    if (p.startsWith("/repos/teste/projeto-teste/git/blobs/")) {
      const i = Number(p.split("sha")[1]);
      const conteudo = Object.values(REPO_ARQUIVOS)[i] ?? "";
      return json({ encoding: "base64", content: Buffer.from(conteudo).toString("base64") });
    }

    // Workflows: este repositório NÃO tem CI
    if (p.includes("/contents/.github/workflows")) return json({ message: "Not Found" }, 404);

    // Conteúdo de arquivo (para pegar o sha na atualização)
    if (p.startsWith("/repos/teste/projeto-teste/contents/") && req.method === "GET") {
      const caminho = decodeURIComponent(p.split("/contents/")[1]);
      if (!(caminho in REPO_ARQUIVOS)) return json({ message: "Not Found" }, 404);
      return json({ sha: "sha-atual", content: Buffer.from(REPO_ARQUIVOS[caminho]).toString("base64") });
    }

    // Escrita: branch, arquivo e PR
    if (p === "/repos/teste/projeto-teste/git/refs" && req.method === "POST") {
      escritas.push({ tipo: "branch", ...JSON.parse(body) });
      return json({ ref: JSON.parse(body).ref }, 201);
    }
    if (p.startsWith("/repos/teste/projeto-teste/contents/") && req.method === "PUT") {
      const dados = JSON.parse(body);
      escritas.push({ tipo: "arquivo", caminho: decodeURIComponent(p.split("/contents/")[1]), branch: dados.branch });
      return json({ content: { path: "ok" } }, 201);
    }
    if (p === "/repos/teste/projeto-teste/pulls" && req.method === "POST") {
      const dados = JSON.parse(body);
      escritas.push({ tipo: "pr", ...dados });
      return json({ html_url: "https://github.com/teste/projeto-teste/pull/7", number: 7 }, 201);
    }

    // Endpoint de inspeção do próprio mock, para o teste conferir o que foi escrito
    if (p === "/__escritas") return json(escritas);

    json({ message: `sem rota simulada: ${p}` }, 404);
  });
}).listen(4006, () => console.log("mock github em :4006"));

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

      // Requisição de leitura de imagem: responde sem streaming, como as APIs
      // reais fazem quando `stream` não é pedido.
      const temImagem = JSON.stringify(parsed.messages ?? []).includes("base64");
      if (temImagem || parsed.stream === false || parsed.stream === undefined) {
        const transcricao = [
          "NOTA FISCAL DE SERVICO No 4471",
          "",
          "Prestador: TrustCorp Servicos Ltda",
          "CNPJ: 12.345.678/0001-90",
          "",
          "| Descricao | Qtd | Valor |",
          "|---|---|---|",
          "| Consultoria tecnica | 40 | 8.400,00 |",
          "| Treinamento equipe | 12 | 3.600,00 |",
          "",
          "TOTAL: R$ 12.000,00",
          "Vencimento: 15/03/2027",
        ].join("\n");

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            porta === 4001
              ? {
                  content: [{ type: "text", text: transcricao }],
                  usage: { input_tokens: 1500, output_tokens: 180 },
                }
              : {
                  choices: [{ message: { content: transcricao } }],
                  usage: { prompt_tokens: 1500, completion_tokens: 180 },
                },
          ),
        );
        return;
      }

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
