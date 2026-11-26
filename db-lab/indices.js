// (b) Consulta sem índice vs. índice simples vs. índice composto.
// Roda numa cópia (schema lab_indices) para não travar nem alterar as tabelas reais;
// a cópia é apagada ao final.
import {
  MEDICAO, ambiente, criarPool, ehPrincipal, explicar, garantirDados, medir, salvarPlano, salvarResultado
} from './lib.js';

const LIMITE = 20;
const SQL = `SELECT id, cliente, descricao, etapa, prazo, criado_em FROM lab_indices.pedidos
  WHERE etapa = $1 ORDER BY criado_em DESC, id DESC LIMIT $2`;

const CONSULTAS = [
  { etapa: 'fila', rotulo: 'Fila (poucas linhas)' },
  { etapa: 'entrega', rotulo: 'Entrega (maioria das linhas)' }
];

const VARIANTES = [
  { chave: 'sem_indice', rotulo: 'Sem índice', ddl: null },
  { chave: 'indice_simples', rotulo: 'Índice simples (etapa)', ddl: 'CREATE INDEX lab_idx ON lab_indices.pedidos (etapa)' },
  {
    chave: 'indice_composto',
    rotulo: 'Índice composto (etapa, criado_em, id)',
    ddl: 'CREATE INDEX lab_idx ON lab_indices.pedidos (etapa, criado_em DESC, id DESC)'
  }
];

export async function executar() {
  const pool = criarPool(1);
  try {
    await garantirDados(pool);
    await pool.query('DROP SCHEMA IF EXISTS lab_indices CASCADE');
    await pool.query('CREATE SCHEMA lab_indices');
    // Mesmos dados e mesma PK da tabela real, sem os índices secundários.
    await pool.query('CREATE TABLE lab_indices.pedidos AS SELECT * FROM public.pedidos ORDER BY id');
    await pool.query('ALTER TABLE lab_indices.pedidos ADD PRIMARY KEY (id)');
    await pool.query('VACUUM (ANALYZE) lab_indices.pedidos');
    const totais = Object.fromEntries((await pool.query(
      'SELECT etapa, count(*)::int AS n FROM lab_indices.pedidos GROUP BY etapa')).rows.map((r) => [r.etapa, r.n]));

    const resultados = [];
    const planos = [];
    const referencia = new Map();

    for (const variante of VARIANTES) {
      let criacao = null;
      let tamanho = null;
      await pool.query('DROP INDEX IF EXISTS lab_indices.lab_idx');
      if (variante.ddl) {
        const inicio = performance.now();
        await pool.query(variante.ddl);
        criacao = Math.round((performance.now() - inicio) * 10) / 10;
        tamanho = (await pool.query(
          `SELECT pg_relation_size('lab_indices.lab_idx')::bigint AS bytes`)).rows[0].bytes;
      }
      await pool.query('ANALYZE lab_indices.pedidos');

      const consultas = [];
      for (const { etapa, rotulo } of CONSULTAS) {
        const consulta = { text: SQL, values: [etapa, LIMITE] };
        const ids = (await pool.query(consulta)).rows.map((r) => r.id).join();
        if (!referencia.has(etapa)) referencia.set(etapa, ids);
        if (referencia.get(etapa) !== ids) throw new Error(`Resultado diferente em ${variante.chave}/${etapa}.`);

        const tempo = await medir(() => pool.query(consulta));
        const plano = await explicar(pool, consulta);
        planos.push(await salvarPlano(`indices-${variante.chave}-${etapa}.txt`, `${variante.rotulo}: ${rotulo}`, plano));
        consultas.push({ etapa, rotulo, linhas_na_etapa: totais[etapa] ?? 0, ...tempo, servidor: plano.metricas });
        console.log(`${variante.chave} / ${etapa}: ${tempo.mediana_ms} ms (mediana), plano: ${plano.metricas.nos.join(' > ')}`);
      }
      resultados.push({
        variante: variante.chave,
        rotulo: variante.rotulo,
        ddl: variante.ddl,
        criacao_indice_ms: criacao,
        tamanho_indice_bytes: tamanho === null ? null : Number(tamanho),
        consultas
      });
    }

    await salvarResultado('indices', {
      experimento: 'indices',
      titulo: 'Índices: sem índice vs. simples vs. composto',
      gerado_em: new Date().toISOString(),
      parametros: { limite: LIMITE, linhas_por_etapa: totais, ...MEDICAO },
      metodo: 'Cópia de pedidos (mesmos dados, só a PK) no schema lab_indices. Para cada variante, o índice é criado, '
        + 'a tabela é analisada e a consulta da primeira página por etapa é medida. Os resultados são conferidos entre '
        + 'variantes. Tempo medido no cliente após aquecimento; execucao_ms e blocos_lidos vêm do EXPLAIN (ANALYZE, BUFFERS).',
      ambiente: await ambiente(pool),
      resultados,
      planos
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS lab_indices CASCADE').catch(() => {});
    await pool.end();
  }
}

if (ehPrincipal(import.meta.url)) await executar();
