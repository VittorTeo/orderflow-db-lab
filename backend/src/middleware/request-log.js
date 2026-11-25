import { randomUUID } from 'node:crypto';

export function requestLog(logger) {
  return (req, res, next) => {
    const inicio = process.hrtime.bigint();
    req.id = randomUUID();
    req.log = logger.child({ requisicao_id: req.id });
    res.set('X-Request-Id', req.id);
    // Sem query string nem corpo: podem conter dados de clientes.
    const caminho = req.path;
    res.on('close', () => {
      const dados = {
        metodo: req.method,
        caminho,
        status: res.statusCode,
        concluida: res.writableFinished,
        duracao_ms: Number(process.hrtime.bigint() - inicio) / 1e6
      };
      // Sondas são frequentes; em info esconderiam o que importa.
      req.log[caminho.startsWith('/health/') ? 'debug' : 'info'](dados, 'requisicao');
    });
    next();
  };
}
