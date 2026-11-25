import { z } from 'zod';
import { AppError } from './errors.js';

export const ETAPAS = ['fila', 'preparo', 'acabamento', 'entrega'];
const UNIDADES = ['un', 'kg', 'g', 'l', 'ml', 'm'];

const texto = (max) => z.string().trim().min(1).max(max)
  .refine((value) => !value.includes('\0'), 'caractere inválido');

const id = z.number().int().positive();

// Aceita número ou texto, mas guarda como texto para não passar por float.
const decimal = z.union([z.string(), z.number()]).transform(String)
  .refine((value) => /^\d{1,11}(\.\d{1,3})?$/.test(value), 'use até 11 dígitos inteiros e 3 decimais');
const decimalPositivo = decimal.refine((value) => Number(value) > 0, 'deve ser maior que zero');

const itens = z.array(z.strictObject({ insumo_id: id, quantidade: decimalPositivo })).min(1).max(100)
  .refine((lista) => new Set(lista.map((item) => item.insumo_id)).size === lista.length, 'insumo repetido');

const prazo = z.iso.date().nullable();
const limite = z.coerce.number().int().min(1).max(100).default(20);
const cursor = z.string().max(200).optional();

// strictObject recusa campos desconhecidos: um erro de digitação não passa em silêncio.
export const schemas = {
  id: z.string().regex(/^\d{1,15}$/).transform(Number).refine((value) => value > 0),
  novoPedido: z.strictObject({ cliente: texto(120), descricao: texto(500), prazo: prazo.optional(), itens }),
  editarPedido: z.strictObject({
    cliente: texto(120).optional(),
    descricao: texto(500).optional(),
    prazo: prazo.optional(),
    itens: itens.optional()
  }).refine((value) => Object.keys(value).length > 0, 'informe ao menos um campo'),
  mudarEtapa: z.strictObject({ etapa: z.enum(ETAPAS) }),
  listarPedidos: z.strictObject({ etapa: z.enum(ETAPAS), limite, cursor }),
  paginar: z.strictObject({ limite, cursor }),
  novoInsumo: z.strictObject({ nome: texto(120), unidade: z.enum(UNIDADES), estoque_minimo: decimal.default('0') }),
  entrada: z.strictObject({ quantidade: decimalPositivo, motivo: texto(200) })
};

export function validar(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(400, 'validacao', 'Dados inválidos.', result.error.issues.map((issue) => ({
    campo: issue.path.join('.'),
    mensagem: issue.message
  })));
}

const cursorSchema = z.tuple([
  z.iso.datetime({ precision: 6 }),
  z.number().int().positive()
]);

// O cursor é opaco para o cliente: a chave interna pode mudar sem quebrar o contrato.
export const codificarCursor = (criadoEm, idRegistro) =>
  Buffer.from(JSON.stringify([criadoEm, idRegistro])).toString('base64url');

export function decodificarCursor(valor) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(valor, 'base64url').toString('utf8')));
  } catch {
    throw new AppError(400, 'cursor_invalido', 'Cursor inválido.');
  }
}

// Busca-se uma linha a mais: sua existência indica que há próxima página.
export function paginar(rows, tamanho) {
  const temMais = rows.length > tamanho;
  const pagina = temMais ? rows.slice(0, tamanho) : rows;
  const ultimo = pagina.at(-1);
  return {
    dados: pagina.map(({ cursor_em, ...linha }) => linha),
    proximo_cursor: temMais ? codificarCursor(ultimo.cursor_em, ultimo.id) : null
  };
}

// Date do JavaScript só tem milissegundos; o banco tem microssegundos.
// Sem isto, o cursor pularia ou repetiria linhas.
export const CURSOR_SQL =
  `to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_em`;
