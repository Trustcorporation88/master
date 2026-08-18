# Duelo de Agentes

Três modelos de IA de fornecedores diferentes — **Anthropic**, **OpenAI** e **DeepSeek** — respondem à mesma pergunta, criticam as respostas uns dos outros, se corrigem, e um árbitro julga tudo com uma rubrica explícita e entrega a resposta final consolidada.

Opcionalmente, o servidor pesquisa a web antes do duelo e entrega o **mesmo dossiê de fontes** aos três — aí o árbitro passa a cobrar citação e a punir afirmação sem respaldo.

Você usa suas próprias chaves de API. Elas ficam apenas no seu navegador.

---

## Por que isso funciona

Modelos de fornecedores diferentes têm treinamentos diferentes, e portanto **pontos cegos diferentes**. Quando um erra, o outro frequentemente percebe. O duelo transforma essa diferença em correção mútua, em vez de você ter que adivinhar qual resposta confiar.

O que o sistema entrega e um chat comum não:

- **Crítica real, não consenso educado.** Os agentes são instruídos a apontar erros factuais e suposições frágeis — e também a admitir quando o outro acertou mais.
- **Um árbitro com rubrica.** A resposta final não é a mais bem escrita: é a que pontua melhor em correção (peso 40%), completude, raciocínio e tratamento de riscos.
- **Honestidade sobre incerteza.** Se todos os agentes concordarem e todos estiverem errados, o árbitro é instruído a marcar o resultado como **inconclusivo** em vez de eleger um vencedor. Consenso não é prova.
- **Fundamentação verificável.** Com busca ligada, cada afirmação factual deve citar `[n]` de uma fonte que você pode abrir e conferir.

---

## Começando

Requisitos: Node.js 20+ e pelo menos **duas** chaves de API.

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>. Na primeira visita, o painel de chaves abre sozinho:

1. Cole cada chave. Ao sair do campo, ela é verificada contra o endpoint `/v1/models` do provedor.
2. Se a chave for válida, a lista de modelos daquela conta é carregada — escolha o que quiser.
3. Feche o painel, escreva a pergunta e clique em **Iniciar duelo** (ou `Ctrl+Enter`).

Onde obter as chaves: [Anthropic](https://console.anthropic.com/settings/keys) · [OpenAI](https://platform.openai.com/api-keys) · [DeepSeek](https://platform.deepseek.com/api_keys)

Com duas chaves já há duelo. Com três, o julgamento fica mais robusto.

### Busca web (opcional)

No mesmo painel há uma seção **Busca web**. Cadastre uma chave de [Brave Search](https://api-dashboard.search.brave.com/app/keys) (barata, tem plano gratuito) ou [Tavily](https://app.tavily.com/home) (feita para agentes, devolve conteúdo mais longo). Ao validar, a busca já fica ligada; o checkbox **Usar nos duelos** liga e desliga quando quiser.

Sem chave de busca, o site funciona exatamente como antes.

---

## As cinco estratégias

| Estratégia | O que acontece | Chamadas de API | Quando usar |
|---|---|---|---|
| **Rápido** | Cada agente responde sozinho, o árbitro julga | n + 1 | Perguntas diretas, quando custo importa |
| **Debate** | Respostas → crítica cruzada → refinamento → árbitro | 3n + 1 | Decisões com trade-offs |
| **Red Team** | Cada agente ataca a resposta do colega, depois defende a sua | 3n + 1 | Achar falhas, revisão de segurança |
| **Perspectivas** | Cada agente usa uma lente: risco, inovação, execução | 2n + 1 | Problemas abertos, escolha de abordagem |
| **Delphi** | Rodadas de refinamento com facilitador até haver consenso medido | até 7n + 1 | Problemas complexos, quando quer consenso real |

Onde `n` é o número de agentes ativos. **Rápido** com 3 agentes = 4 chamadas; **Delphi** pode passar de 20. O custo estimado aparece no topo em tempo real.

### Convergência

Nas estratégias com rodadas, o sistema mede o quanto os agentes estão convergindo — razão entre sinais de concordância e discordância, mais a estabilidade das posições entre rodadas. Quando há consenso, a discussão encerra antes do limite; quando as posições ficam andando em círculos, o sistema detecta a estagnação e para em vez de queimar tokens.

### Fundamento factual

Com a busca ligada, o duelo ganha uma fase 0:

1. Um agente transforma sua pergunta em 2-5 consultas de busca — e pode concluir **"não há o que pesquisar"**. Revisão de código, matemática e pedidos de criação não gastam busca.
2. O servidor executa as consultas, deduplica por URL e monta um dossiê de até 12 fontes numeradas, com trecho e data de publicação.
3. **O mesmo dossiê vai para os três agentes.** Eles devem citar `[n]` ao afirmar fatos, avaliar a qualidade e a data de cada fonte, e declarar quando o dossiê não cobre parte da pergunta.
4. O árbitro recebe o dossiê e ganha um quinto critério: **fundamentação**. Afirmação apoiada e citada corretamente pontua alto; afirmação factual sem respaldo, ou citação que não corresponde à fonte, pontua baixo. Reconhecer uma lacuna honestamente **não** é penalidade.

Com dossiê, os pesos passam a ser correção 35%, completude 20%, raciocínio 20%, fundamentação 15%, riscos 10%. Sem dossiê, seguem os pesos originais.

**Por que dossiê compartilhado em vez da busca nativa de cada provedor.** Anthropic, OpenAI e DeepSeek expõem busca de formas incompatíveis — a da OpenAI só existe no Responses API, a da DeepSeek só no endpoint Anthropic-compatible. Além do retrabalho, cada agente pesquisaria coisas diferentes e o duelo passaria a medir qualidade de ferramenta de busca em vez de qualidade de raciocínio. Com a mesma evidência para todos, a comparação isola o que interessa.

**O risco que isso cria:** evidência compartilhada significa que uma fonte ruim engana os três de forma correlacionada — exatamente o viés que o duelo existe para evitar. Por isso os prompts pedem avaliação da fonte, não só leitura dela, e o painel de fontes fica sempre acessível para você conferir.

### O árbitro

Por padrão o árbitro é **rotativo**: muda a cada dia, para que o resultado não fique sistematicamente enviesado a favor de um fornecedor. Você pode fixar um árbitro específico. O prompt do árbitro proíbe explicitamente autofavorecimento — mas se você quer o julgamento mais isento possível, fixe como árbitro um modelo que não está competindo.

---

## Suas chaves

- Ficam no **localStorage do seu navegador**. Não há banco de dados, não há `.env` com chave, nada é gravado no servidor.
- A cada duelo, o navegador envia as chaves para o servidor local, que as usa na chamada e as descarta ao responder. Nenhuma chave é registrada em log — verificado.
- Erros de autenticação são reescritos antes de chegar à tela. Isso importa: a API da OpenAI **devolve a chave enviada dentro da mensagem de erro**, e repassá-la cruamente a exibiria na interface.
- O botão **Apagar todas as chaves** limpa o localStorage.

O risco que sobra: chaves em localStorage são acessíveis a JavaScript, então um XSS as alcançaria. Por isso há CSP estrita (`connect-src 'self'` — a página não fala com nenhum domínio externo), `frame-ancestors 'none'` e nenhuma dependência de terceiros carregada em runtime.

**Recomendações:** rode localmente ou atrás da trava de senha (`DUELO_SENHA`); não publique numa URL aberta. Defina limite de gasto nas chaves no painel de cada fornecedor.

---

## Estrutura

```
app/
  api/duel/route.ts      Executa o duelo e transmite eventos por SSE
  api/models/route.ts    Valida a chave e lista modelos da conta
  api/search/route.ts    Valida a chave de busca
  page.tsx               A arena
lib/
  providers.ts           Camada unificada: Anthropic + OpenAI + DeepSeek
  search.ts              Busca web: Brave + Tavily, e a montagem do dossiê
  pricing.ts             Estimativa de custo
  export.ts              Exportação em markdown e histórico local
  duel/
    engine.ts            Orquestração das fases e arbitragem
    prompts.ts           Prompts de cada papel
    convergence.ts       Heurística de convergência
components/              Colunas dos agentes, veredito, fontes, chaves
middleware.ts            Trava de acesso por senha (DUELO_SENHA)
.env.example             Variáveis de ambiente disponíveis
scripts/
  mock-apis.mjs          Emula as cinco APIs, para testar sem gastar chave
  e2e.mjs                Teste de ponta a ponta da interface
```

### Endpoint customizado

Para usar um proxy, gateway compatível ou ambiente de teste:

```bash
ANTHROPIC_BASE_URL=http://localhost:4001 \
OPENAI_BASE_URL=http://localhost:4002 \
DEEPSEEK_BASE_URL=http://localhost:4003 \
BRAVE_BASE_URL=http://localhost:4004 \
TAVILY_BASE_URL=http://localhost:4005 \
npm run dev
```

### Testes sem gastar chaves

```bash
node scripts/mock-apis.mjs &          # emula os 3 modelos (4001-4003) e as 2 buscas (4004-4005)
# suba o dev server com as *_BASE_URL acima, e então:
npm i -D playwright && npx playwright install chromium
node scripts/e2e.mjs                  # exercita a interface inteira
```

---

## Publicar num domínio

O site pode ir para o ar sem risco para as suas chaves: elas ficam no navegador de cada visitante, nunca no servidor. O risco real é outro — sem trava, quem descobrir a URL usa o seu servidor como ponte para as APIs. Por isso existe a variável `DUELO_SENHA`.

### Trava de acesso

Defina `DUELO_SENHA` no ambiente de produção. O site inteiro, **incluindo as rotas de API**, passa a exigir senha (o navegador pede num popup; o usuário pode ser qualquer coisa, só a senha é conferida). Sem essa variável o site fica aberto — aceitável em `localhost`, não em produção.

### Railway (recomendado)

Duelos longos são o motivo da escolha: no modo Delphi com três agentes um duelo pode passar de 5 minutos, que é o teto por requisição da Vercel no plano gratuito — o duelo seria cortado com erro 504. O Railway mantém um servidor ligado, sem esse teto.

1. Suba o projeto para um repositório no GitHub (ou use a CLI: `npm i -g @railway/cli`, `railway login`, `railway up` dentro da pasta).
2. No Railway: **New Project → Deploy from GitHub repo**. Ele detecta Next.js e roda `npm install`, `npm run build` e `npm start` sozinho.
3. Em **Variables**, adicione `DUELO_SENHA` com a senha que você escolher.
4. Em **Settings → Networking → Custom Domain**, informe seu domínio. O Railway devolve um destino CNAME.
5. No DNS do seu domínio, crie um registro **CNAME** apontando o subdomínio para esse destino. O certificado HTTPS é emitido automaticamente em alguns minutos.

Não é preciso configurar porta: o Railway injeta `PORT` e o `next start` a respeita.

### Por que não há banco de dados

Não há nada para guardar no servidor. Chaves, modelos escolhidos e histórico ficam no `localStorage` do navegador; o duelo acontece em memória e é transmitido por SSE. Se um dia quiser contas de usuário separadas em vez de uma senha única, aí sim entra um provedor de autenticação — hoje seria complexidade sem função.

### Vercel

Funciona, com a ressalva do tempo: plano gratuito corta em 5 minutos, Pro vai a 13. Se for esse o caminho, prefira os modos Rápido e Debate e evite Delphi.

---

## Limites conhecidos

- **Custos são estimativas.** A tabela de preços em `lib/pricing.ts` é aproximada e envelhece. A fonte da verdade é o billing de cada fornecedor. O custo das buscas aparece separado, porque é cobrado por consulta e não por token.
- **Busca aumenta o custo de tokens.** O dossiê entra no prompt de **cada** agente, então tokens de entrada são multiplicados pelo número de agentes. Há tetos: 12 fontes, 1.200 caracteres por trecho, ~18.000 caracteres de dossiê.
- **Sem busca, ninguém verifica nada.** Sem chave de busca, o duelo compara apenas o que os modelos memorizaram. Para perguntas que dependem de dados atuais, o árbitro tende a apontar a lacuna — e é isso mesmo que deve fazer.
- **Estratégias longas são lentas.** Delphi com 3 agentes pode levar vários minutos. O botão **Interromper** cancela as chamadas em andamento. Em hospedagem com teto de tempo por requisição (Vercel), duelos longos podem ser cortados — veja a seção de publicação.
- **O árbitro é um LLM.** Ele erra. As notas são um instrumento de comparação, não uma medição objetiva.

---

## Créditos

As cinco estratégias de duelo, os prompts de papéis e a heurística de convergência são adaptados de [DeepMyst/Mysti](https://github.com/DeepMyst/Mysti) (Apache-2.0), um assistente de programação multiagente para VS Code. Veja [NOTICE](./NOTICE) para o detalhamento do que foi derivado e do que é original.

O Mysti orquestra CLIs locais dentro do editor; este projeto porta a inteligência de orquestração dele para a web, com chamadas diretas de API.
