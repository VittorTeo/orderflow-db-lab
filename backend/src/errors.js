export class AppError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export const naoEncontrado = (recurso) =>
  new AppError(404, 'nao_encontrado', `${recurso} não encontrado.`);

const INDISPONIVEL = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE']);
// Lock expirado, deadlock, serialização e tempo limite: o cliente pode repetir.
const TENTE_DE_NOVO = new Set(['55P03', '40P01', '40001', '57014']);

export function toAppError(err) {
  if (err instanceof AppError) return err;

  if (err?.type === 'entity.parse.failed') return new AppError(400, 'json_invalido', 'O corpo não é um JSON válido.');
  if (err?.type === 'entity.too.large') return new AppError(413, 'corpo_grande', 'O corpo excede o limite permitido.');

  const code = typeof err?.code === 'string' ? err.code : '';
  if (code === '23505') return new AppError(409, 'duplicado', 'Já existe um registro com esses dados.');
  // PostgreSQL 18+ usa 23001 para RESTRICT; versões anteriores, 23503.
  if (code === '23503' || code === '23001') return new AppError(409, 'referencia_invalida', 'O registro referencia ou é referenciado por outro.');
  if (code === '23514') return new AppError(422, 'regra_violada', 'Os dados violam uma regra do banco.');
  if (/^22[0-9A-Z]{3}$/.test(code)) return new AppError(422, 'valor_invalido', 'Um dos valores não é aceito pelo banco.');
  if (TENTE_DE_NOVO.has(code)) return new AppError(503, 'tente_novamente', 'Recurso ocupado. Tente novamente.');
  if (INDISPONIVEL.has(code) || /^(08|53|57P)/.test(code)
      || /^(Connection terminated|timeout exceeded when trying to connect)/.test(err?.message ?? '')) {
    return new AppError(503, 'banco_indisponivel', 'Banco de dados indisponível.');
  }

  // Erros 4xx do próprio Express, como URL malformada.
  if (err?.status >= 400 && err.status < 500) return new AppError(err.status, 'requisicao_invalida', 'Requisição inválida.');
  return new AppError(500, 'erro_interno', 'Erro interno.');
}
