# orderflow-db-lab

Cloud-ready custom order &amp; inventory engine with an embedded database performance lab (indexing, cursor pagination &amp; concurrency benchmarks).

Motor cloud de gestão de pedidos sob encomenda e estoque com laboratório de performance de banco de dados (índices, paginação por cursor e concorrência).

> **Status:** em construção. Fase 1 (banco, Docker Compose e seed) escrita.

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

### Site estático

Requer `firebase-tools`:

```sh
firebase emulators:start --only hosting --project demo-orderflow
```

Abra <http://localhost:5000>. A API será documentada na Fase 2.

## Laboratório de performance

A documentar na Fase 4. Só serão publicados números medidos em execuções reais dos scripts.

## Como publicar

A documentar na Fase 5.

## Roteiro

- [x] Fase 0: estrutura e configuração
- [x] Fase 1: banco, Docker Compose e seed
- [ ] Fase 2: API
- [ ] Fase 3: frontend
- [ ] Fase 4: laboratório
- [ ] Fase 5: README final

## Licença

[MIT](LICENSE)
