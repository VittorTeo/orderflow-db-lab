// (a) Paginação OFFSET vs. cursor (keyset) na lista de pedidos por etapa.
// Somente leitura: não altera nenhuma tabela.
import {
  MEDICAO, ambiente, criarPool, ehPrincipal, explicar, garantirDados, medir, salvarPlano, salvarResultado
} from './lib.js';

const ETAPA = 'entrega';
const LIMITE = 20;
const PROFUNDIDADES = [0, 1000, 10000, 50000, 100000, 170000];

const COLUNAS = 'id, cliente, descricao, etapa, prazo, criado_em';
const ORDEM = 'ORDER BY criado_em DESC, id DESC';
const SQL_OFFSET = `SELECT ${COLUNAS} FROM pedidos WHERE etapa = $1 ${ORDEM} LIMIT $2 OFFSET $3`;
const SQL_CURSOR = `SELECT ${COLUNAS} FROM pedidos
  WHERE etapa = $1 AND (criado_em, id) < ($3::timestamptz, $4::bigint) ${ORDEM} LIMIT $2`;
const SQL_PRIMEIRA = `SELECT ${COLUNAS} FROM pedidos WHERE etapa = $1 ${ORDEM} LIMIT $2`;

export async function executar() {
  // Uma conexão só: todas as medições passam pelo mesmo caminho.
  const pool = criarPool(1);
  try {
    await garantirDados(pool);
    const total = (await pool.query('SELECT count(*)::int AS n FROM pedidos WHERE etapa = $1', [ETAPA])).rows[0].n;
    const profundidades = PROFUNDIDADES.filter((p) => p + LIMITE <= total);
    const resultados = [];
    const planos = [];

    for (const profundidade of profundidades) {
      const offset = { text: SQL_OFFSET, values: [ETAPA, LIMITE, profundidade] };
      let cursor = { text: SQL_PRIMEIRA, values: [ETAPA, LIMITE] };
      if (profundidade > 0) {
        // A chave da última linha da página anterior, como o cursor da API guardaria.
        const { rows: [chave] } = await pool.query(
          `SELECT criado_em::text AS criado_em, id FROM pedidos WHERE etapa = $1 ${ORDEM} LIMIT 1 OFFSET $2`,
          [ETAPA, profundidade - 1]);
        cursor = { text: SQL_CURSOR, values: [ETAPA, LIMITE, chave.criado_em, chave.id] };
      }

      // Comparar velocidade só faz sentido se as duas devolvem a mesma página.
      const idsOffset = (await pool.query(offset)).rows.map((r) => r.id).join();
      const idsCursor = (await pool.query(cursor)).rows.map((r) => r.id).join();
      if (idsOffset !== idsCursor) throw new Error(`OFFSET e cursor divergiram na profundidade ${profundidade}.`);

      const tempoOffset = await medir(() => pool.query(offset));
      const tempoCursor = await medir(() => pool.query(cursor));
      const planoOffset = await explicar(pool, offset);
      const planoCursor = await explicar(pool, cursor);
      resultados.push({
        profundidade,
        offset: { ...tempoOffset, servidor: planoOffset.metricas },
        cursor: { ...tempoCursor, servidor: planoCursor.metricas }
      });
      console.log(`profundidade ${profundidade}: OFFSET ${tempoOffset.mediana_ms} ms, cursor ${tempoCursor.mediana_ms} ms (medianas)`);

      if (profundidade === profundidades.at(-1)) {
        planos.push(await salvarPlano(`paginacao-offset-${profundidade}.txt`, `OFFSET ${profundidade}: página após ${profundidade} linhas`, planoOffset));
        planos.push(await salvarPlano(`paginacao-cursor-${profundidade}.txt`, `Cursor: mesma página, a partir da chave da linha ${profundidade}`, planoCursor));
      }
    }

    await salvarResultado('paginacao', {
      experimento: 'paginacao',
      titulo: 'Paginação: OFFSET vs. cursor',
      gerado_em: new Date().toISOString(),
      parametros: { etapa: ETAPA, limite: LIMITE, linhas_na_etapa: total, profundidades, ...MEDICAO },
      metodo: 'Para cada profundidade, a mesma página de 20 pedidos é buscada com OFFSET e com cursor (criado_em, id). '
        + 'As duas consultas são conferidas antes de medir. Tempo medido no cliente (ida e volta), após aquecimento; '
        + 'execucao_ms e blocos_lidos vêm do EXPLAIN (ANALYZE, BUFFERS) no servidor.',
      ambiente: await ambiente(pool),
      resultados,
      planos
    });
  } finally {
    await pool.end();
  }
}

if (ehPrincipal(import.meta.url)) await executar();
