import { Router } from 'express';

export function healthRouter(pool, estado, logger) {
  const router = Router();
  // live: o processo responde? Não consulta o banco, pois reiniciar a API
  // não conserta um banco fora do ar.
  router.get('/live', (req, res) => res.json({ status: 'ok' }));
  // ready: pode receber tráfego? Depende do banco.
  router.get('/ready', async (req, res) => {
    if (estado.encerrando) return res.status(503).json({ status: 'encerrando' });
    try {
      await pool.query({ text: 'SELECT 1', query_timeout: 2000 });
      return res.json({ status: 'ok', banco: 'ok' });
    } catch (err) {
      logger.warn({ err }, 'banco_indisponivel');
      return res.status(503).json({ status: 'indisponivel', banco: 'erro' });
    }
  });
  return router;
}
