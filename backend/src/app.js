import express from 'express';
import { cors } from './middleware/cors.js';
import { errorHandler, rotaInexistente } from './middleware/error-handler.js';
import { requestLog } from './middleware/request-log.js';
import { healthRouter } from './routes/health.js';
import { insumosRouter } from './routes/insumos.js';
import { pedidosRouter } from './routes/pedidos.js';
import { createInsumosService } from './services/insumos.js';
import { createPedidosService } from './services/pedidos.js';

// Dependências recebidas por parâmetro: os testes usam outro pool sem truques.
export function createApp({ pool, logger, corsOrigins = [], estado = { encerrando: false } }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLog(logger));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Antes do health: o frontend consulta /health/ready a partir de outra origem.
  app.use(cors(corsOrigins));
  app.use('/health', healthRouter(pool, estado, logger));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/pedidos', pedidosRouter(createPedidosService(pool)));
  app.use('/api/insumos', insumosRouter(createInsumosService(pool)));
  app.use(rotaInexistente);
  app.use(errorHandler);
  return app;
}
