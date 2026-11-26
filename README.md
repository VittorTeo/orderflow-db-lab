# orderflow-db-lab

Cloud-ready custom order &amp; inventory engine with an embedded database performance lab (indexing, cursor pagination &amp; concurrency benchmarks).

Motor cloud de gestão de pedidos sob encomenda e estoque com laboratório de performance de banco de dados (índices, paginação por cursor e concorrência).

> **Status:** em construção. Fase 4 (laboratório) escrita.

## O que o projeto resolve

Quem produz sob encomenda precisa saber em que etapa está cada pedido e se há insumos para produzi-lo. Os pedidos seguem o fluxo **Fila → Preparo → Acabamento → Entrega**. Ao iniciar o Preparo, os insumos serão validados e baixados do estoque automaticamente.

## Arquitetura

| Camada | Tecnologia | Onde fica |
| --- | --- | --- |
| Frontend | HTML, CSS e JavaScript (módulos ES) no Firebase Hosting | `public/` |
| API | Node.js + Express | `backend/` |
| Banco | PostgreSQL | `db/` |
| Laboratório | Scripts Node contra o banco real | `db-lab/` |

## Estrutura de pastas

```text
backend/src/             API Express
db/init/                 schema e índices
db/seed/                 carga de dados para benchmark
db-lab/                  scripts de medição
public/                  site publicado
  css/  js/
  db-lab/results/        medições em JSON
    plans/               planos EXPLAIN ANALYZE em .txt
docker-compose.yml       PostgreSQL local
firebase.json            hospedagem e headers de segurança
.env.example             modelo das variáveis de ambiente
```

## Como rodar localmente

### Banco

Requer Docker Desktop. Copie `.env.example` para `.env`, troque a senha e rode:

```sh
docker compose up -d --wait db
```

Carga para benchmark. **Apaga os dados atuais** e cria 200 mil pedidos (ajuste usuário e banco se mudou o `.env`). No PowerShell:

```powershell
docker compose exec db psql -U orderflow -d orderflow -v ON_ERROR_STOP=1 -c "SET orderflow.confirmar_seed = 'sim'" -f /seed/seed.sql
```

Os scripts de `db/init/` só rodam com o volume vazio. Para recriar o banco do zero, `docker compose down -v` **apaga todos os dados**.

### API

Com o `.env` criado:

```sh
docker compose up -d --build --wait
curl http://localhost:3000/health/ready
```

Testes (Node 22.9+, contra o banco do `.env`, em um schema temporário que é apagado ao final):

```sh
cd backend
npm ci
npm test
```

| Método e rota | Função |
| --- | --- |
| `GET /health/live`, `GET /health/ready` | Processo no ar; banco acessível |
| `GET /api/pedidos?etapa=fila&limite=20` | Lista por etapa; `cursor` opcional |
| `GET /api/pedidos/:id` | Pedido com itens |
| `POST /api/pedidos` | Cria |
| `PATCH /api/pedidos/:id` | Edita (itens só na fila) |
| `DELETE /api/pedidos/:id` | Exclui (só na fila) |
| `PATCH /api/pedidos/:id/etapa` | Avança; em `preparo`, baixa os insumos |
| `GET /api/insumos`, `POST /api/insumos` | Lista e cria insumos |
| `POST /api/insumos/:id/entradas` | Entrada de estoque |
| `GET /api/insumos/:id/movimentacoes` | Extrato, com cursor |

A API não tem autenticação; por isso o Compose só a publica em `127.0.0.1`.

### Site estático

Requer `firebase-tools`:

```sh
firebase emulators:start --only hosting --project demo-orderflow
```

Abra <http://localhost:5000>: **Pedidos** (quadro por etapa) e **Estoque** (saldos, entradas e extrato).

O frontend escolhe o modo ao carregar a página, consultando `/health/ready` da URL definida em [public/config.js](public/config.js):

- **API:** a API respondeu e o banco está acessível. Os dados vêm do PostgreSQL.
- **Demonstração:** a API não respondeu (ou não há URL configurada). As mesmas regras rodam no navegador com dados de exemplo salvos no `localStorage`, e a página mostra "Modo demonstração — dados locais".

Os testes em `backend/test/demo.test.js` garantem que o modo demonstração devolve os mesmos códigos de erro da API.

## Laboratório de performance

Três experimentos em `db-lab/`, rodados contra o banco do `.env` (com o seed carregado):

| Script | Compara |
| --- | --- |
| `paginacao.js` | OFFSET vs. cursor em profundidades de 0 a 170 mil linhas |
| `indices.js` | Sem índice vs. índice simples vs. índice composto |
| `concorrencia.js` | Baixa simultânea de estoque sem lock vs. `SELECT ... FOR UPDATE` |

```sh
cd db-lab
npm ci
npm run lab
```

Os resultados vão para `public/db-lab/results/*.json` e os planos `EXPLAIN ANALYZE` para `public/db-lab/results/plans/*.txt`. A página `/db-lab/` só lê esses arquivos e mostra data, máquina e configuração de cada medição.

- **Seguro para os dados:** `paginacao.js` só lê. Os outros dois criam schemas próprios (`lab_indices`, `lab_concorrencia`) e os apagam ao final.
- **Opcional:** `LAB_AMBIENTE="descrição da máquina"` registra o ambiente no resultado; `LAB_REPETICOES` (padrão 30) e `LAB_RODADAS` (padrão 5) mudam a amostragem.
- **Para resultados comparáveis**, feche programas pesados e não use a API durante a execução. Os números variam entre máquinas: compare as proporções, não os valores absolutos.

## Como publicar

A documentar na Fase 5.

## Roteiro

- [x] Fase 0: estrutura e configuração
- [x] Fase 1: banco, Docker Compose e seed
- [x] Fase 2: API
- [x] Fase 3: frontend
- [x] Fase 4: laboratório
- [ ] Fase 5: README final

## Licença

[MIT](LICENSE)
