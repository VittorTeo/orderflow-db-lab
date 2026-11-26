// Garante que o modo demonstração do frontend segue as mesmas regras da API.
// Roda sem banco de dados.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarDemoStore } from '../../public/js/demoStore.js';

function memoria() {
  const dados = new Map();
  return { getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => dados.set(k, String(v)) };
}

const novo = () => criarDemoStore({ storage: memoria() });

async function erroDe(promessa) {
  try {
    await promessa;
  } catch (erro) {
    return erro;
  }
  assert.fail('deveria ter falhado');
}

async function insumoCom(store, saldo) {
  const insumo = await store.criarInsumo({ nome: `Teste ${Math.random()}`, unidade: 'kg' });
  if (saldo) await store.registrarEntrada(insumo.id, { quantidade: saldo, motivo: 'Teste' });
  return insumo.id;
}

test('dados de exemplo: saldo de cada insumo bate com o extrato', async () => {
  const store = novo();
  for (const insumo of (await store.listarInsumos()).dados) {
    let total = 0;
    let cursor;
    do {
      const pagina = await store.listarMovimentacoes(insumo.id, { limite: 2, cursor });
      for (const m of pagina.dados) total += (m.tipo === 'entrada' ? 1 : -1) * Math.round(Number(m.quantidade) * 1000);
      cursor = pagina.proximo_cursor ?? undefined;
    } while (cursor);
    assert.equal(total, Math.round(Number(insumo.saldo) * 1000), insumo.nome);
  }
});

test('fluxo e transições iguais aos da API', async () => {
  const store = novo();
  const a = await insumoCom(store, '10');
  const { id } = await store.criarPedido({ cliente: 'C', descricao: 'D', itens: [{ insumo_id: a, quantidade: '4' }] });
  assert.equal((await erroDe(store.mudarEtapa(id, 'acabamento'))).codigo, 'transicao_invalida');
  await store.mudarEtapa(id, 'preparo');
  const saldo = async () => (await store.listarInsumos()).dados.find((i) => i.id === a).saldo;
  assert.equal(await saldo(), '6.000');
  assert.equal((await erroDe(store.mudarEtapa(id, 'preparo'))).codigo, 'transicao_invalida');
  assert.equal((await erroDe(store.editarPedido(id, { itens: [{ insumo_id: a, quantidade: 1 }] }))).codigo, 'itens_ja_baixados');
  assert.equal((await erroDe(store.excluirPedido(id))).codigo, 'pedido_iniciado');
  await store.mudarEtapa(id, 'acabamento');
  await store.mudarEtapa(id, 'entrega');
  assert.equal((await erroDe(store.editarPedido(id, { cliente: 'X' }))).codigo, 'pedido_entregue');
  const movs = await store.listarMovimentacoes(a);
  assert.deepEqual(movs.dados.map((m) => m.tipo), ['saida', 'entrada']);
});

test('falta de insumo não altera nada', async () => {
  const store = novo();
  const a = await insumoCom(store, '10');
  const b = await insumoCom(store, '1');
  const { id } = await store.criarPedido({
    cliente: 'C', descricao: 'D', itens: [{ insumo_id: a, quantidade: 5 }, { insumo_id: b, quantidade: 2 }]
  });
  const erro = await erroDe(store.mudarEtapa(id, 'preparo'));
  assert.equal(erro.status, 409);
  assert.equal(erro.codigo, 'estoque_insuficiente');
  assert.deepEqual(erro.detalhes, [{ insumo_id: b, nome: erro.detalhes[0].nome, disponivel: '1.000', necessario: '2.000' }]);
  assert.equal((await store.listarInsumos()).dados.find((i) => i.id === a).saldo, '10.000');
  assert.equal((await store.buscarPedido(id)).etapa, 'fila');
});

test('validação devolve os mesmos códigos da API', async () => {
  const store = novo();
  const a = await insumoCom(store);
  const item = { insumo_id: a, quantidade: 1 };
  const pedido = { cliente: 'C', descricao: 'D', itens: [item] };
  const invalidos = [
    { ...pedido, cliente: ' ' }, { ...pedido, extra: 1 }, { ...pedido, itens: [] },
    { ...pedido, itens: [item, item] }, { ...pedido, itens: [{ ...item, quantidade: -1 }] },
    { ...pedido, itens: [{ ...item, quantidade: '0.0001' }] }, { ...pedido, prazo: '2026-02-30' },
    { ...pedido, descricao: 'a\u0000b' }
  ];
  for (const corpo of invalidos) assert.equal((await erroDe(store.criarPedido(corpo))).status, 400, JSON.stringify(corpo));
  assert.equal((await erroDe(store.criarPedido({ ...pedido, itens: [{ ...item, insumo_id: 999999 }] }))).status, 422);
  assert.equal((await erroDe(store.listarPedidos({ etapa: 'x' }))).status, 400);
  assert.equal((await erroDe(store.listarPedidos({ etapa: 'fila', cursor: 'abc' }))).codigo, 'cursor_invalido');
  assert.equal((await erroDe(store.buscarPedido(999999))).status, 404);
  await store.criarInsumo({ nome: 'Unico', unidade: 'un' });
  assert.equal((await erroDe(store.criarInsumo({ nome: 'Unico', unidade: 'un' }))).status, 409);
});

test('cursor percorre tudo sem repetir e na mesma ordem da API', async () => {
  let relogio = Date.parse('2025-01-01T00:00:00Z');
  const store = criarDemoStore({ storage: memoria(), agora: () => new Date(relogio) });
  const a = await insumoCom(store, '1');
  for (let n = 0; n < 25; n++) {
    if (n % 2) relogio += 1; // pares de pedidos com o mesmo instante
    await store.criarPedido({ cliente: 'C', descricao: `P${n}`, itens: [{ insumo_id: a, quantidade: 1 }] });
  }
  const todos = (await store.listarPedidos({ etapa: 'fila', limite: 100 })).dados;
  const vistos = [];
  let cursor;
  do {
    const pagina = await store.listarPedidos({ etapa: 'fila', limite: 4, cursor });
    vistos.push(...pagina.dados.map((p) => p.id));
    cursor = pagina.proximo_cursor ?? undefined;
  } while (cursor);
  assert.deepEqual(vistos, todos.map((p) => p.id));
  assert.equal(new Set(vistos).size, vistos.length);
});

test('dados persistem entre recargas e resetar volta ao exemplo', async () => {
  const storage = memoria();
  const primeira = criarDemoStore({ storage });
  const a = await insumoCom(primeira, '3');
  const segunda = criarDemoStore({ storage });
  assert.ok((await segunda.listarInsumos()).dados.some((i) => i.id === a));
  await segunda.resetar();
  assert.ok(!(await criarDemoStore({ storage }).listarInsumos()).dados.some((i) => i.id === a));
});

test('sem localStorage, funciona em memória', async () => {
  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const store = criarDemoStore({ storage: quebrado });
  assert.ok((await store.listarInsumos()).dados.length > 0);
  await insumoCom(store, '1');
});
