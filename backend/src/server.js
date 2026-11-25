import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const pool = createPool(logger);
const estado = { encerrando: false };
const app = createApp({ pool, logger, corsOrigins: config.corsOrigins, estado });

const server = app.listen(config.port, (err) => {
  if (err) {
    logger.fatal({ err }, 'falha_ao_iniciar');
    process.exit(1);
  }
  logger.info({ porta: config.port }, 'api_iniciada');
});

// Encerramento gracioso: termina o que está em andamento antes de fechar o pool.
function encerrar(sinal) {
  if (estado.encerrando) return;
  estado.encerrando = true;
  logger.info({ sinal }, 'encerrando');
  setTimeout(() => process.exit(1), 9000).unref();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
