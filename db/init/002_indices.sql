BEGIN;

-- Lista por etapa, mais recentes primeiro.
-- A igualdade (etapa) vem antes; criado_em e id entregam a ordem sem Sort.
-- id desempata datas iguais, o que torna o cursor estável.
CREATE INDEX idx_pedidos_etapa_criado_id
  ON pedidos (etapa, criado_em DESC, id DESC);

-- A PK de itens começa por pedido_id e não atende bem a busca por insumo.
-- O PostgreSQL não cria índice na coluna que referencia em uma FK.
CREATE INDEX idx_itens_insumo
  ON itens_pedido (insumo_id);

-- Extrato de um insumo, do mais recente para o mais antigo.
CREATE INDEX idx_mov_insumo_criado_id
  ON movimentacoes_estoque (insumo_id, criado_em DESC, id DESC);

-- Regra de negócio: cada insumo é baixado uma única vez por pedido.
-- Também atende buscas por pedido_id. Parcial: ignora movimentações sem pedido.
CREATE UNIQUE INDEX uq_mov_pedido_insumo
  ON movimentacoes_estoque (pedido_id, insumo_id)
  WHERE pedido_id IS NOT NULL;

COMMIT;
