# Master — Inteligência Analítica

Aplicação web em que o usuário faz uma pergunta e recebe **uma** resposta consolidada, com grau de confiança declarado, pontos a verificar e fontes conferíveis.

Por dentro, cada pergunta passa por vários modelos de IA de fornecedores diferentes que respondem de forma independente, criticam as respostas uns dos outros, se corrigem, e têm o resultado julgado por uma rubrica antes de virar resposta única. **Nada disso aparece para quem usa** — a interface entrega o resultado, não o método.

---

## Como funciona (visão de quem opera)

```
pergunta
   ↓
[0] levantamento de fontes na web        (opcional, se houver chave de busca)
   ↓
[1] pareceres independentes              (um por fornecedor configurado, em paralelo)
   ↓
[2] crítica cruzada e refinamento        (varia com a profundidade escolhida)
   ↓
[3] consolidação com rubrica             (correção 35%, completude 20%,
                                          raciocínio 20%, fundamentação 15%,
                                          riscos 10% — sem fontes, correção 40%)
   ↓
resposta única + confiança + ressalvas + fontes
```

As três opções de profundidade da interface mapeiam para estratégias internas distintas:

| Interface | Interno | Chamadas de API | Tempo típico |
|---|---|---|---|
| **Rápida** | pareceres independentes + consolidação | n + 1 | ~30s |
| **Equilibrada** | + crítica cruzada e refinamento | 3n + 1 | 1 a 2 min |
| **Profunda** | + rodadas de convergência medida | até 7n + 1 | 3 a 6 min |

`n` = número de fornecedores com chave configurada. Duas chaves já bastam; três tornam o julgamento mais robusto.

### Por que vários fornecedores

Modelos treinados de formas diferentes têm **pontos cegos diferentes**. Quando um erra, outro frequentemente percebe. O sistema transforma essa diferença em correção mútua — e o consolidador é instruído a marcar a resposta como incerta quando nenhum parecer é confiável, em vez de eleger o mais bem escrito. Consenso não é prova.

### Fontes

Com chave de busca configurada, o servidor pesquisa **uma vez** e entrega o mesmo dossiê a todos os pareceres. Isso mantém a comparação justa (todos veem a mesma evidência) e permite exigir citação `[n]`, que o usuário confere clicando na fonte.

O risco desse desenho: fonte ruim engana todos de forma correlacionada. Por isso os prompts exigem avaliação da qualidade e da data de cada fonte, não apenas leitura.

---

## Configuração

Todas as chaves ficam em **variáveis de ambiente no servidor**. O navegador nunca vê chave nenhuma, e o cliente não pode injetar chaves na API — o servidor ignora qualquer credencial vinda da requisição.

### Obrigatório em produção

```
DUELO_SENHA=uma-senha-forte
```

Sem essa variável o site fica **aberto**. Como as chaves são suas, qualquer visitante gastaria o seu saldo. Com ela, há tela de login e cookie de sessão assinado (HMAC, validade de 7 dias, `HttpOnly`, `Secure` em produção).

### Chaves de IA (pelo menos duas)

```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
```

Modelos são opcionais (`ANTHROPIC_MODEL`, `OPENAI_MODEL`, `DEEPSEEK_MODEL`); sem eles, usa-se um padrão de cada fornecedor.

### Busca web (opcional)

```
BRAVE_API_KEY=...      # ou TAVILY_API_KEY=...
BUSCA_PROVIDER=brave   # se as duas estiverem definidas
```

Sem chave de busca o sistema funciona, mas compara apenas o que os modelos memorizaram — sem fontes para citar.

Veja `.env.example` para a lista completa.

---

## Rodar localmente

Requisitos: Node.js 20+.

```bash
npm install
cp .env.example .env.local   # preencha as chaves
npm run dev
```

Abra <http://localhost:3000>. Sem `DUELO_SENHA` no `.env.local`, o login é dispensado — conveniente para desenvolvimento, nunca para produção.

---

## Publicar

### Railway (recomendado)

Uma análise profunda pode passar de 5 minutos, que é o teto por requisição da Vercel no plano gratuito — a análise seria cortada com erro. O Railway mantém um servidor ligado, sem esse teto.

1. **New Project → Deploy from GitHub repo**. O Next.js é detectado automaticamente (`npm install`, `npm run build`, `npm start`).
2. Em **Variables**, adicione `DUELO_SENHA` e as chaves de IA (e de busca, se quiser fontes).
3. Em **Settings → Networking → Custom Domain**, informe o domínio; o Railway devolve um destino CNAME.
4. No DNS do domínio, crie o **CNAME** apontando para esse destino. O HTTPS é emitido automaticamente.

Não é preciso configurar porta: o Railway injeta `PORT` e o `next start` a respeita.

### Vercel

Funciona para os modos Rápida e Equilibrada. Evite Profunda no plano gratuito (corte em 5 min); o plano Pro vai a 13 min.

---

## O que o navegador recebe

Isto é uma decisão de projeto, verificada por teste automatizado a cada execução do `e2e`:

- **Não recebe** nome de fornecedor, nome de modelo, nome de estratégia, pareceres individuais, notas por fornecedor, custo ou qualquer termo do processo interno — nem na tela, nem no HTML, nem em nenhum arquivo JavaScript carregado.
- **Recebe** a resposta final (transmitida ao vivo, palavra por palavra), o grau de confiança, as ressalvas, e as fontes com título, link e data.

Como isso é garantido no código:

- `lib/publicTypes.ts` é o único módulo de domínio que componentes de cliente importam. Ele não contém nome de fornecedor nem de estratégia.
- `lib/providers.ts`, `lib/search.ts`, `lib/serverConfig.ts` e `lib/duel/*` são exclusivos do servidor.
- A rota de API traduz eventos internos em etapas de produto ("Consultando fontes", "Revisando e confrontando") e descarta os eventos que revelariam o mecanismo.
- O consolidador é instruído a escrever como autor único, sem citar pareceres ou modelos. Sua saída vem em duas partes: a resposta ao usuário primeiro, depois um bloco JSON de telemetria — que é **cortado no servidor** e nunca chega ao navegador.
- Erros de provedor são reescritos em mensagens de produto antes de sair; o detalhe técnico fica no log do servidor. Isso também evita um vazamento concreto: a API da OpenAI devolve a chave enviada dentro da mensagem de erro.

---

## Estrutura

```
app/
  page.tsx                 A interface (cliente)
  login/page.tsx           Tela de login
  api/duel/route.ts        Executa a análise, transmite etapas por SSE
  api/login/route.ts       Troca a senha por cookie de sessão
middleware.ts              Exige sessão em todas as rotas, exceto o login
lib/
  publicTypes.ts           Único módulo de domínio visível ao cliente
  auth.ts                  Sessão por cookie assinado (HMAC)
  serverConfig.ts          Chaves e modelos vindos do ambiente
  providers.ts             Camada unificada dos fornecedores de IA
  search.ts                Busca web e montagem do dossiê
  duel/
    engine.ts              Orquestração das fases e consolidação
    prompts.ts             Prompts de cada papel
    convergence.ts         Heurística de convergência
    types.ts               Tipos internos
components/
  Resposta.tsx             Resposta, confiança, ressalvas, fontes
  Progresso.tsx            Etapas durante o processamento
  Markdown.tsx             Renderização de markdown e código
scripts/
  mock-apis.mjs            Emula as 5 APIs externas, para testar sem gastar chave
  e2e.mjs                  Teste de ponta a ponta, incluindo vazamento
```

---

## Testar sem gastar chaves

```bash
node scripts/mock-apis.mjs &     # modelos em :4001-4003, buscas em :4004-4005

DUELO_SENHA=teste123 \
ANTHROPIC_API_KEY=k1 OPENAI_API_KEY=k2 DEEPSEEK_API_KEY=k3 BRAVE_API_KEY=k4 \
ANTHROPIC_BASE_URL=http://localhost:4001 \
OPENAI_BASE_URL=http://localhost:4002 \
DEEPSEEK_BASE_URL=http://localhost:4003 \
BRAVE_BASE_URL=http://localhost:4004 \
npm run build && npm start &

npm i -D playwright && npx playwright install chromium
E2E_SENHA=teste123 node scripts/e2e.mjs
```

O `e2e` verifica o fluxo de login, a análise completa, e faz a varredura de vazamento na tela, no HTML e em todo o JavaScript carregado.

---

## Limites conhecidos

- **Custo por pergunta.** Uma análise profunda com três fornecedores pode passar de 20 chamadas de API, e o dossiê de fontes entra no prompt de cada parecer — os tokens de entrada se multiplicam. Defina limite de gasto nas chaves no painel de cada fornecedor.
- **Análises longas são lentas.** O modo Profunda leva minutos. Há botão de cancelar, e o progresso mostra a etapa e o tempo decorrido.
- **O consolidador é um LLM.** Ele erra. O grau de confiança e as ressalvas são instrumentos de leitura crítica, não garantias.
- **Sem busca, ninguém verifica nada.** Sem chave de busca, a análise compara apenas o que os modelos memorizaram.

---

## Créditos

As estratégias de colaboração entre modelos (crítica cruzada, red team, perspectivas complementares, convergência Delphi), os prompts de papéis e a heurística de detecção de convergência são adaptados de [DeepMyst/Mysti](https://github.com/DeepMyst/Mysti) (Apache-2.0), um assistente de programação multiagente para VS Code. Veja [NOTICE](./NOTICE) para o detalhamento do que é derivado e do que é original.

O Mysti orquestra CLIs locais dentro do editor; este projeto porta a inteligência de orquestração para a web, com chamadas diretas de API e uma camada de produto por cima.
