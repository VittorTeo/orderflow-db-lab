import { withTransaction } from '../db.js';
import { naoEncontrado } from '../errors.js';
import { CURSOR_SQL, decodificarCursor, paginar } from '../validation.js';

const COLUNAS = `id, nome, unidade, saldo, estoque_minimo,
  saldo < estoque_minimo AS abaixo_do_minimo, criado_em, atualizado_em`;

export function createInsumosService(pool) {
  // Catálogo pequeno (centenas): a tela precisa dele inteiro para montar pedidos.
  async function listar() {
    const { rows } = await pool.query(`SELECT ${COLUNAS} FROM insumos ORDER BY nome, id LIMIT 1000`);
    return { dados: rows };
  }

  async function criar({ nome, unidade, estoque_minimo }) {
    const { rows } = await pool.query(
      `INSERT INTO insumos (nome, unidade, estoque_minimo) VALUES ($1, $2, $3) RETURNING ${COLUNAS}`,
      [nome, unidade, estoque_minimo]);
    return rows[0];
  }

  const registrarEntrada = (id, { quantidade, motivo }) => withTransaction(pool, async (db) => {
    // UPDATE com saldo = saldo + x já trava a linha; não há leitura prévia a proteger.
    const { rows } = await db.query(
      `UPDATE insumos SET saldo = saldo + $2, atualizado_em = now() WHERE id = $1 RETURNING ${COLUNAS}`,
      [id, quantidade]);
    if (!rows[0]) throw naoEncontrado('Insumo');
    await db.query(
      `INSERT INTO movimentacoes_estoque (insumo_id, tipo, quantidade, motivo) VALUES ($1, 'entrada', $2, $3)`,
      [id, quantidade, motivo]);
    return rows[0];
  });

  async function movimentacoes(id, { limite, cursor }) {
    const existe = await pool.query('SELECT 1 FROM insumos WHERE id = $1', [id]);
    if (existe.rowCount === 0) throw naoEncontrado('Insumo');
    const params = [id, limite + 1];
    let filtro = '';
    if (cursor !== undefined) {
      params.push(...decodificarCursor(cursor));
      filtro = 'AND (criado_em, id) < ($3::timestamptz, $4::bigint)';
    }
    const { rows } = await pool.query(
      `SELECT id, insumo_id, pedido_id, tipo, quantidade, motivo, criado_em, ${CURSOR_SQL}
       FROM movimentacoes_estoque WHERE insumo_id = $1 ${filtro}
       ORDER BY criado_em DESC, id DESC LIMIT $2`, params);
    return paginar(rows, limite);
  }

  return { listar, criar, registrarEntrada, movimentacoes };
}
