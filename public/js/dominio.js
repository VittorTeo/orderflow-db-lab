export const ETAPAS = ['fila', 'preparo', 'acabamento', 'entrega'];

export const NOMES_ETAPA = {
  fila: 'Fila',
  preparo: 'Preparo',
  acabamento: 'Acabamento',
  entrega: 'Entrega'
};

export const UNIDADES = ['un', 'kg', 'g', 'l', 'ml', 'm'];

// Mesmo formato de erro nos dois modos: as telas não precisam saber qual está ativo.
export class ApiError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.name = 'ApiError';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}
