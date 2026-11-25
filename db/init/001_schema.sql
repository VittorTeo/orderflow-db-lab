BEGIN;

CREATE TABLE insumos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome           text NOT NULL UNIQUE CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  unidade        text NOT NULL CHECK (unidade IN ('un', 'kg', 'g', 'l', 'ml', 'm')),
  -- numeric, e não float: quantidades precisam de soma decimal exata.
  -- O CHECK é a última barreira contra estoque negativo, mesmo se a API falhar.
  saldo          numeric(14,3) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  estoque_minimo numeric(14,3) NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pedidos (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente       text NOT NULL CHECK (length(btrim(cliente)) BETWEEN 1 AND 120),
  descricao     text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 500),
  -- text + CHECK, e não ENUM: remover ou trocar valores é uma migração mais simples.
  etapa         text NOT NULL DEFAULT 'fila'
                CHECK (etapa IN ('fila', 'preparo', 'acabamento', 'entrega')),
  prazo         date,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Itens = insumos necessários para produzir o pedido.
CREATE TABLE itens_pedido (
  pedido_id  bigint NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  insumo_id  bigint NOT NULL REFERENCES insumos (id) ON DELETE RESTRICT,
  quantidade numeric(14,3) NOT NULL CHECK (quantidade > 0),
  -- Impede repetir um insumo no pedido e já indexa a busca por pedido_id.
  PRIMARY KEY (pedido_id, insumo_id)
);

-- Histórico de estoque. RESTRICT preserva a trilha de auditoria.
CREATE TABLE movimentacoes_estoque (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  insumo_id  bigint NOT NULL REFERENCES insumos (id) ON DELETE RESTRICT,
  pedido_id  bigint REFERENCES pedidos (id) ON DELETE RESTRICT,
  tipo       text NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  quantidade numeric(14,3) NOT NULL CHECK (quantidade > 0),
  motivo     text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 1 AND 200),
  criado_em  timestamptz NOT NULL DEFAULT now(),
  -- Movimentação ligada a pedido é sempre consumo.
  CHECK (pedido_id IS NULL OR tipo = 'saida')
);

COMMIT;
