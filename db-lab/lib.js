import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const DIR_RESULTADOS = fileURLToPath(new URL('../public/db-lab/results/', import.meta.url));
const DIR_PLANOS = path.join(DIR_RESULTADOS, 'plans');

export const MEDICAO = {
  aquecimento: Number(process.env.LAB_AQUECIMENTO ?? 5),
  repeticoes: Number(process.env.LAB_REPETICOES ?? 30)
};

// Sem DATABASE_URL, o pg lê PGHOST, PGPORT, PGUSER, PGPASSWORD e PGDATABASE do .env.
export function criarPool(max = 1) {
  return new pg.Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
    max,
    application_name: 'orderflow-db-lab'
  });
}

export const ehPrincipal = (url) =>
  Boolean(process.argv[1]) && fileURLToPath(url) === path.resolve(process.argv[1]);

const arredondar = (valor) => Math.round(valor * 1000) / 1000;

export function resumir(tempos) {
  const ordenados = [...tempos].sort((a, b) => a - b);
  const n = ordenados.length;
  const meio = Math.floor(n / 2);
  const mediana = n % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
  // Percentil pelo método do posto mais próximo.
  const p95 = ordenados[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return {
    amostras: n,
    min_ms: arredondar(ordenados[0]),
    mediana_ms: arredondar(mediana),
    p95_ms: arredondar(p95),
    max_ms: arredondar(ordenados[n - 1])
  };
}

// Tempo de ida e volta medido no cliente (Node -> PostgreSQL -> Node).
// O aquecimento descarta as primeiras execuções, que pagam cache frio e planejamento.
export async function medir(operacao, { aquecimento = MEDICAO.aquecimento, repeticoes = MEDICAO.repeticoes } = {}) {
  for (let i = 0; i < aquecimento; i++) await operacao();
  const tempos = [];
  for (let i = 0; i < repeticoes; i++) {
    const inicio = performance.now();
    await operacao();
    tempos.push(performance.now() - inicio);
  }
  return resumir(tempos);
}

function nosDoPlano(no, lista = []) {
  lista.push(no['Node Type'] + (no['Index Name'] ? ` (${no['Index Name']})` : ''));
  for (const filho of no.Plans ?? []) nosDoPlano(filho, lista);
  return lista;
}

// EXPLAIN ANALYZE executa a consulta de verdade e mede no servidor.
export async function explicar(executor, consulta) {
  const valores = consulta.values ?? [];
  const texto = (await executor.query({ text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${consulta.text}`, values: valores }))
    .rows.map((linha) => linha['QUERY PLAN']).join('\n');
  const json = (await executor.query({ text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${consulta.text}`, values: valores }))
    .rows[0]['QUERY PLAN'][0];
  const raiz = json.Plan;
  return {
    texto,
    consulta: consulta.text.replace(/\s+/g, ' ').trim(),
    valores,
    metricas: {
      execucao_ms: json['Execution Time'],
      planejamento_ms: json['Planning Time'],
      blocos_lidos: (raiz['Shared Hit Blocks'] ?? 0) + (raiz['Shared Read Blocks'] ?? 0),
      nos: nosDoPlano(raiz)
    }
  };
}

export async function salvarPlano(arquivo, titulo, plano) {
  await mkdir(DIR_PLANOS, { recursive: true });
  const cabecalho = [
    `-- ${titulo}`,
    `-- Gerado em ${new Date().toISOString()} por db-lab (EXPLAIN ANALYZE, BUFFERS)`,
    `-- Consulta: ${plano.consulta}`,
    `-- Parâmetros: ${JSON.stringify(plano.valores)}`,
    '',
    ''
  ].join('\n');
  await writeFile(path.join(DIR_PLANOS, arquivo), cabecalho + plano.texto + '\n', 'utf8');
  return { titulo, arquivo: `plans/${arquivo}` };
}

export async function salvarResultado(nome, dados) {
  await mkdir(DIR_RESULTADOS, { recursive: true });
  const destino = path.join(DIR_RESULTADOS, `${nome}.json`);
  await writeFile(destino, JSON.stringify(dados, null, 2) + '\n', 'utf8');
  console.log(`Resultado salvo em ${path.relative(process.cwd(), destino)}`);
}

export async function garantirDados(executor) {
  const { rows } = await executor.query('SELECT count(*)::int AS total FROM pedidos');
  if (rows[0].total < 10000) {
    throw new Error(`Só há ${rows[0].total} pedidos. Rode o seed (README, seção Banco) antes do laboratório.`);
  }
  return rows[0].total;
}

// O arquivo é publicado: nada de hostname, usuário ou endereço do banco.
export async function ambiente(executor) {
  const versao = (await executor.query('SHOW server_version')).rows[0].server_version;
  const { rows } = await executor.query(
    `SELECT name, setting, unit FROM pg_settings
     WHERE name = ANY($1) ORDER BY name`,
    [['shared_buffers', 'work_mem', 'effective_cache_size', 'random_page_cost', 'jit', 'max_parallel_workers_per_gather', 'max_connections']]);
  const contagens = (await executor.query(
    `SELECT (SELECT count(*) FROM pedidos)::int AS pedidos,
            (SELECT count(*) FROM itens_pedido)::int AS itens_pedido,
            (SELECT count(*) FROM insumos)::int AS insumos,
            (SELECT count(*) FROM movimentacoes_estoque)::int AS movimentacoes_estoque`)).rows[0];
  const cpus = os.cpus();
  return {
    descricao: process.env.LAB_AMBIENTE || null,
    postgresql: versao,
    configuracoes: Object.fromEntries(rows.map((r) => [r.name, r.unit ? `${r.setting} ${r.unit}` : r.setting])),
    linhas: contagens,
    cliente: {
      node: process.version,
      sistema: `${os.type()} ${os.release()} (${os.arch()})`,
      cpu: cpus[0]?.model?.trim() ?? 'desconhecida',
      nucleos_logicos: cpus.length,
      memoria_gb: Math.round(os.totalmem() / 1024 ** 3)
    }
  };
}
