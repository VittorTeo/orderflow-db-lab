import pg from 'pg';

const INT8 = 20;
const DATE = 1082;

// IDs cabem em Number; se um dia não couberem, falha em vez de arredondar.
function parseInt8(text) {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError('bigint fora do intervalo seguro');
  return value;
}

// date fica como texto: virar Date poderia mudar o dia conforme o fuso.
// numeric já é texto por padrão no pg, o que preserva as casas decimais.
const types = {
  getTypeParser(oid, format) {
    if (format !== 'binary' && oid === INT8) return parseInt8;
    if (format !== 'binary' && oid === DATE) return (text) => text;
    return pg.types.getTypeParser(oid, format);
  }
};

// Sem DATABASE_URL, o pg lê PGHOST, PGPORT, PGUSER, PGPASSWORD e PGDATABASE.
export function createPool(logger, overrides = {}) {
  const pool = new pg.Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    types,
    ...overrides
  });
  // Sem este ouvinte, a queda de uma conexão ociosa derrubaria o processo.
  pool.on('error', (err) => logger.error({ err }, 'conexao_ociosa_falhou'));
  return pool;
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  let broken;
  // Conexão em uso que cai emite 'error' no client, fora do ouvinte do pool.
  const onError = (err) => { broken = err; };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    // Não espera para sempre por uma linha travada.
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      broken = rollbackError;
    }
    throw err;
  } finally {
    client.off('error', onError);
    // Passar o erro descarta a conexão em vez de devolvê-la ao pool.
    client.release(broken);
  }
}
