-- ATENÇÃO: apaga todos os dados das quatro tabelas. Exige confirmação na sessão:
--   SET orderflow.confirmar_seed = 'sim';
-- Opcional (padrão 200000):
--   SET orderflow.total_pedidos = '300000';
-- Dados determinísticos: a mesma quantidade gera sempre as mesmas linhas.

BEGIN;

DO $$
BEGIN
  IF current_setting('orderflow.confirmar_seed', true) IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION 'Seed cancelado: ele apaga os dados. Defina orderflow.confirmar_seed = ''sim''.';
  END IF;
END
$$;

CREATE TEMP TABLE seed_config ON COMMIT DROP AS
SELECT COALESCE(NULLIF(current_setting('orderflow.total_pedidos', true), ''), '200000')::bigint AS total;

DO $$
BEGIN
  IF (SELECT total FROM seed_config) NOT BETWEEN 100 AND 1000000 THEN
    RAISE EXCEPTION 'orderflow.total_pedidos deve estar entre 100 e 1000000.';
  END IF;
END
$$;

TRUNCATE movimentacoes_estoque, itens_pedido, pedidos, insumos RESTART IDENTITY;

INSERT INTO insumos (id, nome, unidade, saldo, estoque_minimo, criado_em, atualizado_em)
OVERRIDING SYSTEM VALUE
SELECT n,
       'Insumo ' || lpad(n::text, 3, '0'),
       (ARRAY['un', 'kg', 'g', 'l', 'ml', 'm'])[1 + n % 6],
       0,
       50 + n % 100,
       timestamptz '2024-01-01 00:00:00+00',
       timestamptz '2024-01-01 00:00:00+00'
FROM generate_series(1, 200) AS n;

-- Dos mais antigos aos mais novos: 90% entrega, 2% acabamento, 3% preparo, 5% fila.
-- A divisão inteira (n / 3) repete datas de propósito, para exercitar o desempate por id.
INSERT INTO pedidos (id, cliente, descricao, etapa, prazo, criado_em, atualizado_em)
OVERRIDING SYSTEM VALUE
SELECT n,
       'Cliente ' || lpad((1 + n * 7919 % 5000)::text, 4, '0'),
       'Pedido sob encomenda ' || n,
       CASE
         WHEN n * 100 <= c.total * 90 THEN 'entrega'
         WHEN n * 100 <= c.total * 92 THEN 'acabamento'
         WHEN n * 100 <= c.total * 95 THEN 'preparo'
         ELSE 'fila'
       END,
       (d.criado_em AT TIME ZONE 'UTC')::date + (7 + n % 30)::int,
       d.criado_em,
       d.criado_em
FROM seed_config AS c
CROSS JOIN LATERAL generate_series(1::bigint, c.total) AS n
CROSS JOIN LATERAL (
  SELECT timestamptz '2024-02-01 00:00:00+00'
         + (n / 3) * interval '4 minutes' AS criado_em
) AS d
ORDER BY n;

-- Três insumos distintos por pedido: 53 * k é distinto módulo 200 para k = 0, 1, 2.
INSERT INTO itens_pedido (pedido_id, insumo_id, quantidade)
SELECT p.id,
       1 + (p.id * 7 + k * 53) % 200,
       (1 + (p.id + k) % 20) * 0.250
FROM pedidos AS p
CROSS JOIN generate_series(0, 2) AS k
ORDER BY p.id, k;

-- Entrada inicial = consumo já realizado + reserva variável para testes.
INSERT INTO movimentacoes_estoque (insumo_id, tipo, quantidade, motivo, criado_em)
SELECT i.id,
       'entrada',
       COALESCE(consumo.total, 0) + 100 + i.id,
       'Carga inicial',
       timestamptz '2024-01-01 00:00:00+00'
FROM insumos AS i
LEFT JOIN (
  SELECT it.insumo_id, sum(it.quantidade) AS total
  FROM itens_pedido AS it
  JOIN pedidos AS p ON p.id = it.pedido_id
  WHERE p.etapa <> 'fila'
  GROUP BY it.insumo_id
) AS consumo ON consumo.insumo_id = i.id
ORDER BY i.id;

-- Todo pedido que saiu da fila já consumiu seus insumos.
INSERT INTO movimentacoes_estoque (insumo_id, pedido_id, tipo, quantidade, motivo, criado_em)
SELECT it.insumo_id, p.id, 'saida', it.quantidade, 'Início do preparo', p.criado_em
FROM pedidos AS p
JOIN itens_pedido AS it ON it.pedido_id = p.id
WHERE p.etapa <> 'fila'
ORDER BY p.id, it.insumo_id;

-- O saldo nasce do histórico, portanto os dois sempre batem.
UPDATE insumos AS i
SET saldo = m.saldo
FROM (
  SELECT insumo_id,
         sum(CASE tipo WHEN 'entrada' THEN quantidade ELSE -quantidade END) AS saldo
  FROM movimentacoes_estoque
  GROUP BY insumo_id
) AS m
WHERE m.insumo_id = i.id;

-- IDs explícitos não avançam as sequências.
SELECT setval(pg_get_serial_sequence('insumos', 'id'), (SELECT max(id) FROM insumos));
SELECT setval(pg_get_serial_sequence('pedidos', 'id'), (SELECT max(id) FROM pedidos));

COMMIT;

-- Estatísticas atualizadas para o planejador; VACUUM não roda dentro de transação.
VACUUM (ANALYZE) insumos, pedidos, itens_pedido, movimentacoes_estoque;

SELECT 'insumos' AS tabela, count(*) AS linhas FROM insumos
UNION ALL SELECT 'pedidos', count(*) FROM pedidos
UNION ALL SELECT 'itens_pedido', count(*) FROM itens_pedido
UNION ALL SELECT 'movimentacoes_estoque', count(*) FROM movimentacoes_estoque;
