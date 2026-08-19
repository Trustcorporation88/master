# Master — Inteligência Analítica

Aplicação web em que o usuário faz uma pergunta e recebe **uma** resposta consolidada, com grau de confiança declarado, pontos a verificar e fontes conferíveis.

O usuário também pode anexar documentos — planilhas, PDFs, Word, Markdown, **e documentos digitalizados ou fotografados** — de até 100 MB cada, ou **importar um repositório do GitHub**, e perguntar sobre eles.

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

### GitHub (opcional)

```
GITHUB_TOKEN=github_pat_...
GITHUB_REPOS=dono/repo1,dono/repo2   # opcional: restringe a lista
GITHUB_PUBLICO=true                  # opcional: público sem token
```

O token precisa apenas de leitura de conteúdo (*Contents: Read-only*).

### Armazenamento de documentos (necessário para upload)

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

O bucket é criado automaticamente na primeira utilização — não há SQL nem migração para rodar. Metadados ficam como JSON no próprio Storage, o que dispensa banco de dados.

Sem essas variáveis o upload continua funcionando, mas grava em disco local do container: serve para desenvolvimento e **se perde a cada deploy**.

A chave `service_role` tem poder total no projeto Supabase. Ela é usada apenas no servidor e nunca chega ao navegador.

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
  imprimir/[id]/page.tsx   Versão da conversa para imprimir ou salvar em PDF
  api/duel/route.ts        Executa a análise, transmite etapas por SSE, grava o turno
  api/conversas/route.ts   Lista, abre e remove conversas gravadas
  api/exportar/route.ts    Exporta a conversa, ou um turno, em planilha (.xlsx)
  api/documentos/route.ts  Upload, leitura e remoção de documentos
  api/repos/route.ts       Lista e importa repositórios do GitHub
  api/proposta/route.ts    Gera a proposta de código e abre o pull request
  api/login/route.ts       Troca a senha por cookie de sessão
middleware.ts              Exige sessão em todas as rotas, exceto o login
lib/
  publicTypes.ts           Único módulo de domínio visível ao cliente
  conversas.ts             Conversas gravadas e o bloco de histórico dos prompts
  auth.ts                  Sessão por cookie assinado (HMAC)
  serverConfig.ts          Chaves e modelos vindos do ambiente
  providers.ts             Camada unificada dos fornecedores de IA
  search.ts                Busca web e montagem do dossiê
  storage.ts               Supabase Storage, com driver de disco para dev
  extract.ts               Leitura de planilha, PDF, DOCX e texto
  ocr.ts                   Renderização de página e transcrição por visão
  github.ts                Leitura de repositório, montagem do pacote e escrita de PR
  duel/
    engine.ts              Orquestração das fases e consolidação
    prompts.ts             Prompts de cada papel
    convergence.ts         Heurística de convergência
    types.ts               Tipos internos
components/
  Analise.tsx              Interface principal (cliente)
  Documentos.tsx           Painel de documentos e upload direto
  Repositorios.tsx         Seleção e importação de repositório
  Proposta.tsx             Pré-visualização e abertura de pull request
  Resposta.tsx             Resposta, confiança, ressalvas, fontes
  Progresso.tsx            Etapas durante o processamento
  Markdown.tsx             Renderização de markdown e código
  AutoImprimir.tsx         Abre o diálogo de impressão na página de PDF
scripts/
  mock-apis.mjs            Emula as 5 APIs externas, para testar sem gastar chave
  e2e.mjs                  Teste de ponta a ponta, incluindo vazamento
  e2e-conversa.mjs         Teste da conversa: continuidade, histórico e exportação
  pdf-check.mjs            Gera o PDF e mede margem e aproveitamento de cada folha
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

## Conversa, histórico e exportação

Cada pergunta e a resposta correspondente formam um **turno**. Os turnos ficam na
tela, e a pergunta seguinte é respondida em cima dos anteriores — o histórico
entra no prompt de todos os fornecedores, junto dos documentos, mas **separado
deles**: histórico é contexto, não evidência, e não deve fazer o julgamento final
passar a exigir citação de fonte.

A conversa é gravada **pelo servidor**, não pelo cliente: quem grava é quem
produziu a resposta, então o que está no histórico é o que realmente foi
entregue. A gravação acontece mesmo quando a análise é interrompida no meio, para
que o texto já lido não desapareça ao recarregar.

O formato é um JSON por conversa, dentro do mesmo armazenamento dos documentos —
sem banco e sem migração. Seis turnos anteriores entram no contexto, com a
resposta cortada em 3 mil caracteres; além disso o custo cresce sem melhorar a
resposta.

Duas formas de levar a análise para fora:

- **Excel** (`/api/exportar?id=`) — um turno por linha, com resposta inteira na
  célula, e uma aba de fontes com link por link. Serve para quem vai continuar
  trabalhando o conteúdo.
- **PDF** (`/imprimir/<id>`) — a página é feita para o diálogo de impressão do
  navegador, que já sabe paginar e embutir fonte. Montar PDF no servidor daria
  documento pior: as tabelas das análises seriam achatadas.

Duas regras do CSS de impressão existem por defeito observado no papel, não por
estilo. A margem vem do `@page`, não do padding: padding não impede o texto de
tocar a borda física quando se imprime sem margens. E uma resposta **não** é
bloco indivisível — marcá-la assim faz o navegador empurrar uma resposta de três
páginas para a folha seguinte e deixar a anterior em branco. Indivisível é só o
que é pequeno por natureza: linha de tabela, bloco de código, citação.

Cada resposta tem seus próprios botões de PDF e Excel, além dos da conversa
inteira no fim. O parâmetro `?turno=N` recorta uma resposta — sem ele, exportar
uma conversa de vários assuntos leva o assunto anterior junto, o que confundiu em
uso real. No recorte, o título do documento passa a ser a pergunta recortada, e a
conversa de origem fica citada como referência.

`scripts/pdf-check.mjs` gera o PDF pelo motor do navegador e **mede** cada
folha: quanto da altura foi aproveitada e se a faixa de 8 mm nas laterais ficou
livre. Foi o que pegou as duas falhas acima, que passaram por revisão visual na
tela.

---

## Limites conhecidos

- **Custo por pergunta.** Uma análise profunda com três fornecedores pode passar de 20 chamadas de API, e o dossiê de fontes e documentos entra no prompt de cada parecer — os tokens de entrada se multiplicam. Defina limite de gasto nas chaves no painel de cada fornecedor.
- **Transcrição de digitalizado não é o original.** O reconhecimento é bom, mas não é perfeito: a interface avisa para conferir números e datas críticos na fonte. Páginas acima do teto não são lidas.
- **`.xls` antigo não é aceito.** O formato binário legado ficou de fora; salve como `.xlsx` ou `.csv`.
- **Planilha muito grande é perfilada, não lida linha a linha.** Perguntas que dependem de encontrar uma linha específica entre 200 mil podem não ser respondidas pela amostra.
- **A proposta de código não é testada.** Nenhum dos repositórios inspecionados tinha workflow de validação em pull request — os que têm CI rodam deploy, não teste. Enquanto for assim, a revisão humana é a única barreira.
- **Repositório grande entra parcial.** No máximo 120 arquivos e 400 mil caracteres por importação, priorizando documentação e código-fonte. A estrutura completa sempre entra, então o modelo sabe o que existe mesmo sem ter lido.
- **Requisição longa e calada é cortada pela borda da rede.** Com o domínio atrás de CDN, uma resposta que demora mais de ~100 segundos sem enviar byte nenhum é substituída por uma página de erro em HTML. É por isso que a análise transmite por SSE e a proposta de código também: o fluxo com sinal de vida a cada 10 segundos é o que mantém a conexão de pé. Endpoint novo que possa demorar precisa do mesmo tratamento.
- **Análises longas são lentas.** O modo Profunda leva minutos. Há botão de cancelar, e o progresso mostra a etapa e o tempo decorrido.
- **O consolidador é um LLM.** Ele erra. O grau de confiança e as ressalvas são instrumentos de leitura crítica, não garantias.
- **O histórico não é infinito.** A partir do sétimo turno, os mais antigos saem do contexto. Uma conversa muito longa perde o começo — vale abrir conversa nova quando o assunto mudar.
- **Sem busca, ninguém verifica nada.** Sem chave de busca, a análise compara apenas o que os modelos memorizaram.

---

## Créditos

As estratégias de colaboração entre modelos (crítica cruzada, red team, perspectivas complementares, convergência Delphi), os prompts de papéis e a heurística de detecção de convergência são adaptados de [DeepMyst/Mysti](https://github.com/DeepMyst/Mysti) (Apache-2.0), um assistente de programação multiagente para VS Code. Veja [NOTICE](./NOTICE) para o detalhamento do que é derivado e do que é original.

O Mysti orquestra CLIs locais dentro do editor; este projeto porta a inteligência de orquestração para a web, com chamadas diretas de API e uma camada de produto por cima.
