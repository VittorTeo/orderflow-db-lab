import { AppError, toAppError } from '../errors.js';

export function rotaInexistente(req, res, next) {
  next(new AppError(404, 'rota_inexistente', 'Rota não encontrada.'));
}

// O Express reconhece o tratador de erros pelos quatro parâmetros.
export function errorHandler(err, req, res, next) {
  const erro = toAppError(err);
  // Detalhe interno vai só para o log; o cliente recebe a mensagem segura.
  if (erro.status >= 500) req.log.error({ err }, 'erro_requisicao');
  if (res.headersSent) return next(err);
  return res.status(erro.status).json({
    erro: {
      codigo: erro.codigo,
      mensagem: erro.message,
      ...(erro.detalhes === undefined ? {} : { detalhes: erro.detalhes }),
      requisicao_id: req.id
    }
  });
}
