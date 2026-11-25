import { withTransaction } from '../db.js';
import { AppError, naoEncontrado } from '../errors.js';
import { CURSOR_SQL, ETAPAS, decodificarCursor, paginar } from '../validation.js';

const COLUNAS = 'id, cliente, descricao, etapa, prazo, criado_em, atualizado_em';

export function createPedidosService(pool) {
  async function buscar(id, db = pool) {
    // Uma consulta só: pedido e itens vêm do mesmo instante.
    const { rows } = await db.query(
      `SELECT ${COLUNAS},
              COALESCE((
                SELECT json_agg(json_build_object(
                         'insumo_id', it.insumo_id, 'nome', i.nome, 'unidade', i.unidade,
                         'quantidade', it.quantidade::text) ORDER BY it.insumo_id)
                FROM itens_pedido it JOIN insumos i ON i.id = it.insumo_id
                WHERE it.pedido_id = pedidos.id
              ), '[]'::json) AS itens
       FROM pedidos WHERE id = $1`, [id]);
    if (!rows[0]) throw naoEncontrado('Pedido');
    return rows[0];
  }

  async function listar({ etapa, limite, cursor }) {
    const params = [etapa, limite + 1];
    let filtro = '';
    if (cursor !== undefined) {
      params.push(...decodificarCursor(cursor));
      filtro = 'AND (criado_em, id) < ($3::timestamptz, $4::bigint)';
    }
    const { rows } = await pool.query(
      `SELECT ${COLUNAS}, ${CURSOR_SQL} FROM pedidos
       WHERE etapa = $1 ${filtro}
       ORDER BY criado_em DESC, id DESC LIMIT $2`, params);
    return paginar(rows, limite);
  }

  async function inserirItens(db, pedidoId, itens) {
    // Ordenado por insumo: a FK trava cada insumo na mesma ordem que a baixa usa.
    try {
      await db.query(
        `INSERT INTO itens_pedido (pedido_id, insumo_id, quantidade)
         SELECT $1, t.insumo_id, t.quantidade
         FROM unnest($2::bigint[], $3::numeric[]) AS t (insumo_id, quantidade)
         ORDER BY t.insumo_id`,
        [pedidoId, itens.map((item) => item.insumo_id), itens.map((item) => item.quantidade)]);
    } catch (err) {
      if (err.code === '23503') throw new AppError(422, 'insumo_inexistente', 'Um dos insumos não existe.');
      throw err;
    }
  }

  async function travar(db, id) {
    const { rows } = await db.query('SELECT id, etapa FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw naoEncontrado('Pedido');
    return rows[0];
  }

  const criar = ({ cliente, descricao, prazo = null, itens }) => withTransaction(pool, async (db) => {
    const { rows } = await db.query(
      'INSERT INTO pedidos (cliente, descricao, prazo) VALUES ($1, $2, $3) RETURNING id',
      [cliente, descricao, prazo]);
    await inserirItens(db, rows[0].id, itens);
    return buscar(rows[0].id, db);
  });

  const editar = (id, dados) => withTransaction(pool, async (db) => {
    const atual = await travar(db, id);
    if (atual.etapa === 'entrega') throw new AppError(409, 'pedido_entregue', 'Pedido em entrega não pode ser editado.');
    if (dados.itens && atual.etapa !== 'fila') {
      throw new AppError(409, 'itens_ja_baixados', 'Os itens só podem mudar enquanto o pedido está na fila.');
    }
    await db.query(
      `UPDATE pedidos SET
         cliente = COALESCE($2, cliente),
         descricao = COALESCE($3, descricao),
         prazo = CASE WHEN $4::boolean THEN $5::date ELSE prazo END,
         atualizado_em = now()
       WHERE id = $1`,
      // prazo aceita null de propósito; por isso COALESCE não serve para ele.
      [id, dados.cliente ?? null, dados.descricao ?? null, dados.prazo !== undefined, dados.prazo ?? null]);
    if (dados.itens) {
      await db.query('DELETE FROM itens_pedido WHERE pedido_id = $1', [id]);
      await inserirItens(db, id, dados.itens);
    }
    return buscar(id, db);
  });

  const excluir = (id) => withTransaction(pool, async (db) => {
    const atual = await travar(db, id);
    if (atual.etapa !== 'fila') throw new AppError(409, 'pedido_iniciado', 'Só é possível excluir pedidos na fila.');
    await db.query('DELETE FROM pedidos WHERE id = $1', [id]);
  });

  async function baixarInsumos(db, pedidoId) {
    // 1. Trava os insumos sempre em ordem de id: dois pedidos com os mesmos
    //    insumos nunca esperam um pelo outro em ciclo (deadlock).
    await db.query(
      `SELECT id FROM insumos
       WHERE id IN (SELECT insumo_id FROM itens_pedido WHERE pedido_id = $1)
       ORDER BY id FOR UPDATE`, [pedidoId]);

    // 2. Consulta nova após o lock: em READ COMMITTED ela já enxerga o que
    //    outras transações confirmaram enquanto esperávamos.
    const { rows } = await db.query(
      `SELECT i.id AS insumo_id, i.nome, i.saldo AS disponivel, it.quantidade AS necessario,
              i.saldo < it.quantidade AS falta
       FROM itens_pedido it JOIN insumos i ON i.id = it.insumo_id
       WHERE it.pedido_id = $1 ORDER BY i.id`, [pedidoId]);
    if (rows.length === 0) throw new AppError(409, 'pedido_sem_itens', 'O pedido não tem insumos.');
    const faltas = rows.filter((row) => row.falta).map(({ falta, ...row }) => row);
    if (faltas.length > 0) throw new AppError(409, 'estoque_insuficiente', 'Estoque insuficiente.', faltas);

    // 3. Baixa e histórico na mesma transação: ou os dois acontecem, ou nenhum.
    await db.query(
      `UPDATE insumos i SET saldo = i.saldo - it.quantidade, atualizado_em = now()
       FROM itens_pedido it WHERE it.pedido_id = $1 AND it.insumo_id = i.id`, [pedidoId]);
    await db.query(
      `INSERT INTO movimentacoes_estoque (insumo_id, pedido_id, tipo, quantidade, motivo)
       SELECT insumo_id, pedido_id, 'saida', quantidade, 'Início do preparo'
       FROM itens_pedido WHERE pedido_id = $1 ORDER BY insumo_id`, [pedidoId]);
  }

  const mudarEtapa = (id, etapa) => withTransaction(pool, async (db) => {
    // O lock no pedido impede que dois cliques simultâneos avancem duas vezes.
    const atual = await travar(db, id);
    const proxima = ETAPAS[ETAPAS.indexOf(atual.etapa) + 1];
    if (etapa !== proxima) {
      throw new AppError(409, 'transicao_invalida', `Não é possível ir de ${atual.etapa} para ${etapa}.`,
        { etapa_atual: atual.etapa, proxima_etapa: proxima ?? null });
    }
    if (etapa === 'preparo') await baixarInsumos(db, id);
    await db.query('UPDATE pedidos SET etapa = $2, atualizado_em = now() WHERE id = $1', [id, etapa]);
    return buscar(id, db);
  });

  return { buscar, listar, criar, editar, excluir, mudarEtapa };
}
