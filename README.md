# orderflow-db-lab

Cloud-ready custom order &amp; inventory engine with an embedded database performance lab (indexing, cursor pagination &amp; concurrency benchmarks).

Motor de gestão de pedidos sob encomenda e estoque, com um laboratório que mede no PostgreSQL real o efeito de índices, paginação por cursor e locks de concorrência.

**Demo:** https://orderflow-db-lab-e6b1e.web.app (sem API publicada, abre em modo demonstração; o laboratório mostra os resultados medidos)

## O que o projeto resolve

Quem produz sob encomenda precisa saber em que etapa está cada pedido e se há insumos para produzi-lo. Aqui os pedidos seguem **Fila → Preparo → Acabamento → Entrega**. Ao iniciar o Preparo, os insumos do pedido são validados e baixados do estoque numa única transação.

O problema central é de concorrência. Se dois pedidos disputam o último quilo de farinha ao mesmo tempo, os dois podem ler "há 1 kg" e os dois serem aprovados. A API impede isso travando as linhas de estoque com `SELECT ... FOR UPDATE` antes de conferir o saldo. O laboratório mostra o que acontece com e sem esse lock.

## Funcionalidades

- **Pedidos:** quadro por etapa com paginação por cursor; criar, editar, excluir (só na fila) e avançar de etapa.
- **Estoque:** saldos, alerta de estoque mínimo, entradas e extrato de movimentações.
- **Baixa automática:** ao iniciar o Preparo, todos os insumos são conferidos; se faltar um, nada é baixado e a resposta lista o que falta.
- **Modo demonstração:** sem API, o site roda as mesmas regras no navegador com dados de exemplo e avisa "Modo demonstração — dados locais".
- **Laboratório (`/db-lab/`):** gráficos e planos `EXPLAIN ANALYZE` gerados por scripts contra o banco real.

## Arquitetura

```text
Navegador ── HTML/CSS/JS ──────────── Firebase Hosting (public/)
    │
    ├─ modo API ── HTTP/JSON ──► API Node.js + Express (backend/) ──► PostgreSQL 17 (db/)
    │
    └─ modo demonstração ──────► mesmas regras no navegador (localStorage)

Scripts do laboratório (db-lab/) ──► PostgreSQL ──► public/db-lab/results/*.json e plans/*.txt
```

| Camada | Tecnologia | Onde fica |
| --- | --- | --- |
| Frontend | HTML, CSS e JavaScript em módulos ES, sem framework | `public/` |
| API | Node.js, Express 5, `pg`, `zod`, `pino` | `backend/` |
| Banco | PostgreSQL 17 em Docker Compose | `db/`, `docker-compose.yml` |
| Laboratório | Scripts Node contra o banco real | `db-lab/` |

### Modelo de dados

| Tabela | Papel |
| --- | --- |
| `pedidos` | Cliente, descrição, etapa, prazo |
| `itens_pedido` | Insumos e quantidades necessários para cada pedido |
| `insumos` | Catálogo com saldo atual e estoque mínimo |
| `movimentacoes_estoque` | Histórico de entradas e saídas (auditoria) |

### Decisões principais

| Decisão | Por quê |
| --- | --- |
| `SELECT ... FOR UPDATE` nos insumos, sempre em ordem de `id` | Impede vender o mesmo estoque duas vezes; a ordem fixa evita deadlock entre pedidos com os mesmos insumos. |
| `CHECK (saldo >= 0)` além do lock | Última barreira: mesmo com bug na aplicação, o banco recusa saldo negativo. |
| Saldo guardado + histórico de movimentações | Ler o saldo é barato e a linha pode ser travada; o histórico permite auditar. |
| `UNIQUE (pedido_id, insumo_id)` parcial em movimentações | Garante que cada insumo seja baixado uma única vez por pedido. |
| Índice `(etapa, criado_em DESC, id DESC)` | Atende o filtro e a ordem da lista sem etapa de ordenação; `id` desempata o cursor. |
| Paginação por cursor | O custo não cresce com a profundidade, como acontece com OFFSET (medido no laboratório). |
| `numeric` para quantidades, trafegando como texto | Soma decimal exata, sem os erros de arredondamento do ponto flutuante. |
| `/health/live` sem banco e `/health/ready` com banco | Reiniciar a API não conserta o banco; o `ready` decide se ela recebe tráfego. |
| Logs JSON com `requisicao_id` | Uma linha por requisição, fácil de filtrar; o mesmo id volta no erro para o cliente. |
| CSP sem `unsafe-inline` e DOM montado sem `innerHTML` | Texto digitado nunca vira código (proteção contra XSS). |

## Resultados do laboratório

Medição de 26/11/2026: PostgreSQL 17.12 em Docker Desktop, Intel Core i5-10400F, 16 GB, 200 mil pedidos. Medianas de 30 repetições após 5 de aquecimento. Números de outra máquina serão diferentes; as proporções é que importam. Os valores completos, com p95 e planos, estão na página `/db-lab/` e em [public/db-lab/results/](public/db-lab/results/).

| Experimento | Resultado |
| --- | --- |
| Paginação, 20 pedidos após 170 mil linhas | OFFSET 28,55 ms (3.761 blocos lidos) · cursor 1,01 ms (4 blocos) |
| Primeira página da etapa com 180 mil linhas | sem índice 44,67 ms · índice simples 44,47 ms · índice composto 0,89 ms |
| 200 pedidos simultâneos para 100 unidades, 5 rodadas | sem lock: 138 a 139 vendas, saldo −38 a −39 · com `FOR UPDATE`: 100 vendas, saldo 0 |

## Como rodar localmente

Requisitos: [Docker Desktop](https://www.docker.com/products/docker-desktop/), Node.js 22.9 ou mais recente e `firebase-tools` (`npm install -g firebase-tools`). Os comandos abaixo rodam na raiz do projeto, em PowerShell.

### 1. Configurar

```powershell
Copy-Item .env.example .env
```

Abra o `.env` e troque `PGPASSWORD` **antes** de subir o banco pela primeira vez. O PostgreSQL grava a senha na criação do volume; mudar o `.env` depois não muda a senha do banco.

### 2. Banco e API

```powershell
docker compose up -d --build --wait
curl.exe http://localhost:3000/health/ready
```

A resposta esperada é `{"status":"ok","banco":"ok"}`. O banco e a API só ficam acessíveis em `127.0.0.1`.

### 3. Dados para benchmark (opcional)

**Apaga os dados atuais** das quatro tabelas e cria 200 mil pedidos, 600 mil itens e 570 mil movimentações:

```powershell
docker compose exec db psql -U orderflow -d orderflow -v ON_ERROR_STOP=1 -c "SET orderflow.confirmar_seed = 'sim'" -f /seed/seed.sql
```

Ajuste `-U` e `-d` se mudou `PGUSER` ou `PGDATABASE`. Para mudar a quantidade, acrescente `-c "SET orderflow.total_pedidos = '50000'"` antes do `-f`.

### 4. Site

```powershell
firebase emulators:start --only hosting --project demo-orderflow
```

Abra <http://localhost:5000>. Com a API no ar, a faixa verde diz "Conectado à API". Pare a API (`docker compose stop api`) e recarregue: a página entra em modo demonstração.

### 5. Testes

```powershell
cd backend
npm ci
npm test
```

São 18 testes: 11 da API e 7 do modo demonstração. Os da API rodam contra o banco do `.env`, num schema temporário apagado ao final, e incluem concorrência real (40 pedidos disputando estoque para 10, cliques duplos, insumos em ordem oposta).

### Rotas da API

| Método e rota | Função |
| --- | --- |
| `GET /health/live`, `GET /health/ready` | Processo no ar; banco acessível |
| `GET /api/pedidos?etapa=fila&limite=20&cursor=...` | Lista por etapa, com cursor |
| `GET /api/pedidos/:id` | Pedido com itens |
| `POST /api/pedidos` | Cria (`cliente`, `descricao`, `prazo`, `itens`) |
| `PATCH /api/pedidos/:id` | Edita; itens só na fila |
| `DELETE /api/pedidos/:id` | Exclui; só na fila |
| `PATCH /api/pedidos/:id/etapa` | Avança uma etapa; em `preparo`, baixa os insumos |
| `GET /api/insumos`, `POST /api/insumos` | Lista e cria insumos |
| `POST /api/insumos/:id/entradas` | Entrada de estoque |
| `GET /api/insumos/:id/movimentacoes` | Extrato, com cursor |

Erros seguem um formato único: `{"erro": {"codigo", "mensagem", "detalhes", "requisicao_id"}}`. Status: 400 validação, 404 não encontrado, 409 conflito de estado (etapa errada, estoque insuficiente), 422 valor recusado, 503 banco indisponível ou ocupado.

## Como rodar o laboratório e gerar seus próprios resultados

Com banco no ar e seed carregado (passos 2 e 3):

```powershell
cd db-lab
npm ci
$env:LAB_AMBIENTE = "Descreva sua máquina aqui"
npm run lab
```

Leva alguns minutos. Também dá para rodar um experimento por vez: `npm run paginacao`, `npm run indices` ou `npm run concorrencia`.

| Script | O que faz | Toca nos dados? |
| --- | --- | --- |
| `paginacao.js` | Mesma página via OFFSET e via cursor, de 0 a 170 mil linhas puladas | Só lê |
| `indices.js` | Copia `pedidos` e compara sem índice, índice simples e composto | Cria e apaga o schema `lab_indices` |
| `concorrencia.js` | 200 transações disputando 100 unidades, com e sem `FOR UPDATE` | Cria e apaga o schema `lab_concorrencia` |

Os resultados substituem os arquivos em `public/db-lab/results/` (JSON) e `public/db-lab/results/plans/` (`EXPLAIN ANALYZE` em texto). A página `/db-lab/` só lê esses arquivos, então mostra sempre a última execução, com data e ambiente. Para publicar novos números, faça commit desses arquivos e publique de novo.

- **Amostragem:** `LAB_REPETICOES` (padrão 30), `LAB_AQUECIMENTO` (padrão 5) e `LAB_RODADAS` (padrão 5).
- **Para medições estáveis:** feche programas pesados e não use o site durante a execução.
- **Privacidade:** os arquivos gravam versão do PostgreSQL, CPU, memória e sistema, mas não hostname, usuário nem endereço do banco.

## Como publicar o frontend (Firebase Hosting, plano Spark)

Sem backend publicado, o site entra em modo demonstração, e o laboratório mostra os resultados já gravados.

### 1. Entrar e criar o projeto

```powershell
firebase login
```

Crie um projeto em <https://console.firebase.google.com> (o plano Spark é gratuito).

### 2. Ligar a pasta ao projeto

**Recomendado**, porque não altera nenhum arquivo do repositório:

```powershell
firebase use --add
```

Escolha o projeto e dê um apelido, por exemplo `default`. Isso cria o `.firebaserc`, que pode ser commitado (contém só o id do projeto).

**Alternativa com `firebase init hosting`.** Ele **substitui o bloco `hosting` do `firebase.json` e apaga os headers de segurança**. Se usar, responda:

| Pergunta | Resposta |
| --- | --- |
| Use an existing project | o projeto criado |
| What do you want to use as your public directory? | `public` |
| Configure as a single-page app? | `No` |
| Set up automatic builds and deploys with GitHub? | `No` |
| File public/404.html already exists. Overwrite? | `No` |
| File public/index.html already exists. Overwrite? | `No` |

Depois restaure a configuração e confira:

```powershell
git checkout -- firebase.json
git status
```

### 3. Publicar

```powershell
firebase deploy --only hosting
```

O endereço aparece no fim (`https://SEU-PROJETO.web.app`). Para testar antes, num link temporário: `firebase hosting:channel:deploy teste`.

### 4. Conferir os headers de segurança

```powershell
curl.exe -I https://SEU-PROJETO.web.app
```

Devem aparecer `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy`. O emulador local no Windows não aplica esses headers, por isso a conferência é feita no site publicado.

## Quando publicar o backend: onde colocar a URL da API

São três lugares:

1. **[public/config.js, linha 5](public/config.js#L5):** troque `''` pela URL HTTPS da API, sem barra no final:
   ```js
   export const API_URL_PRODUCAO = 'https://sua-api.exemplo.com';
   ```
2. **[firebase.json, linha 11](firebase.json#L11):** no `connect-src` da CSP, acrescente a mesma origem. Sem isso, o navegador bloqueia a chamada:
   ```text
   connect-src 'self' http://localhost:3000 https://sua-api.exemplo.com;
   ```
3. **Variáveis do servidor da API:** inclua o site em `CORS_ORIGINS`, separado por vírgula:
   ```text
   CORS_ORIGINS=https://SEU-PROJETO.web.app,https://SEU-PROJETO.firebaseapp.com
   ```

Depois, `firebase deploy --only hosting` de novo.

- **HTTPS é obrigatório:** um site HTTPS não pode chamar uma API `http://` (conteúdo misto).
- **Banco gerenciado:** a API aceita `DATABASE_URL` no lugar das variáveis `PG*`. Muitos provedores exigem `?sslmode=require` no fim da URL.
- **Autenticação:** a API **não tem**. Publicada como está, qualquer pessoa com a URL pode criar, editar e excluir dados. Acrescente autenticação antes de expor dados reais.

## Estrutura de pastas

```text
backend/
  src/
    routes/              rotas HTTP (pedidos, insumos, health)
    services/            regras de negócio e transações
    middleware/          CORS, log de requisições, tratamento de erros
    app.js, server.js    montagem da aplicação e inicialização
    db.js                pool de conexões e transações
    validation.js        validação de entrada (zod) e cursor
  test/                  testes da API e do modo demonstração
  Dockerfile
db/
  init/                  schema e índices (rodam na criação do volume)
  seed/                  carga de dados para benchmark
db-lab/                  scripts do laboratório
public/                  site publicado no Firebase Hosting
  config.js              URL da API
  js/apiService.js       escolhe entre modo API e modo demonstração
  js/demoStore.js        regras de negócio no navegador
  db-lab/                página do laboratório e resultados
docker-compose.yml       PostgreSQL e API locais
firebase.json            hospedagem e headers de segurança
.env.example             modelo das variáveis de ambiente
```

## Limitações conhecidas

- A API não tem autenticação nem controle de acesso.
- No modo demonstração, os dados ficam só no navegador de quem acessa.
- Os tempos do laboratório dependem da máquina e do momento; compare proporções.
- O emulador do Firebase no Windows não envia os headers configurados.

## Licença

[MIT](LICENSE)
