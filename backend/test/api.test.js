// Roda no banco configurado, dentro de um schema temporário apagado ao final.
// As tabelas reais não são tocadas.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { createLogger } from '../src/logger.js';

const schema = `teste_${randomUUID().replaceAll('-', '')}`;
const logger = createLogger('silent');
const ORIGEM = 'http://localhost:5000';
let admin, pool, server, base;

async function api(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function novoInsumo(saldo) {
  const { status, body } = await api('POST', '/api/insumos', { nome: `Insumo ${randomUUID()}`, unidade: 'kg' });
  assert.equal(status, 201);
  if (saldo) {
    const entrada = await api('POST', `/api/insumos/${body.id}/entradas`, { quantidade: saldo, motivo: 'Teste' });
    assert.equal(entrada.status, 201);
  }
  return body.id;
}

async function novoPedido(itens) {
  const { status, body } = await api('POST', '/api/pedidos', { cliente: 'Cliente', descricao: 'Pedido', itens });
  assert.equal(status, 201);
  return body.id;
}

const saldo = async (id) => (await pool.query('SELECT saldo FROM insumos WHERE id = $1', [id])).rows[0].saldo;
const avancar = (id, etapa) => api('PATCH', `/api/pedidos/${id}/etapa`, { etapa });

before(async () => {
  admin = createPool(logger, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool(logger, { options: `-c search_path=${schema}` });
  for (const file of ['001_schema.sql', '002_indices.sql']) {
    await pool.query(await readFile(new URL(`../../db/init/${file}`, import.meta.url), 'utf8'));
  }
  const app = createApp({ pool, logger, corsOrigins: [ORIGEM] });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

test('health responde com o banco disponível', async () => {
  assert.equal((await api('GET', '/health/live')).status, 200);
  assert.equal((await api('GET', '/health/ready')).status, 200);
});

test('sem banco: live 200, ready 503 e API 503', async () => {
  const morto = createPool(logger, { host: '127.0.0.1', port: 1, connectionString: undefined });
  const outro = createApp({ pool: morto, logger }).listen(0, '127.0.0.1');
  await new Promise((resolve) => outro.once('listening', resolve));
  const url = `http://127.0.0.1:${outro.address().port}`;
  assert.equal((await fetch(`${url}/health/live`)).status, 200);
  assert.equal((await fetch(`${url}/health/ready`)).status, 503);
  assert.equal((await fetch(`${url}/api/insumos`)).status, 503);
  outro.closeAllConnections();
  await new Promise((resolve) => outro.close(resolve));
  await morto.end();
});

test('CRUD de pedido', async () => {
  const a = await novoInsumo();
  const b = await novoInsumo();
  const id = await novoPedido([{ insumo_id: b, quantidade: '1.250' }, { insumo_id: a, quantidade: 2 }]);
  const lido = await api('GET', `/api/pedidos/${id}`);
  assert.deepEqual(lido.body.itens.map((i) => [i.insumo_id, i.quantidade]), [[a, '2.000'], [b, '1.250']]);
  const editado = await api('PATCH', `/api/pedidos/${id}`, { prazo: '2030-01-31', itens: [{ insumo_id: a, quantidade: 3 }] });
  assert.equal(editado.body.prazo, '2030-01-31');
  assert.equal(editado.body.itens.length, 1);
  assert.equal((await api('PATCH', `/api/pedidos/${id}`, { prazo: null })).body.prazo, null);
  assert.equal((await api('DELETE', `/api/pedidos/${id}`)).status, 204);
  assert.equal((await api('GET', `/api/pedidos/${id}`)).status, 404);
});

test('validação e erros', async () => {
  const a = await novoInsumo();
  const item = { insumo_id: a, quantidade: 1 };
  const pedido = { cliente: 'C', descricao: 'D', itens: [item] };
  const invalidos = [
    { ...pedido, cliente: ' ' }, { ...pedido, extra: 1 }, { ...pedido, itens: [] },
    { ...pedido, itens: [item, item] }, { ...pedido, itens: [{ ...item, quantidade: -1 }] },
    { ...pedido, itens: [{ ...item, quantidade: '0.0001' }] }, { ...pedido, prazo: '2026-02-30' },
    { ...pedido, descricao: 'a\u0000b' }
  ];
  for (const corpo of invalidos) assert.equal((await api('POST', '/api/pedidos', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await api('POST', '/api/pedidos')).status, 400);
  assert.equal((await api('POST', '/api/pedidos', '{')).body.erro.codigo, 'json_invalido');
  assert.equal((await api('POST', '/api/pedidos', { ...pedido, descricao: 'x'.repeat(110000) })).status, 413);
  assert.equal((await api('POST', '/api/pedidos', { ...pedido, itens: [{ ...item, insumo_id: 999999 }] })).status, 422);
  assert.equal((await api('GET', '/api/pedidos?etapa=x')).status, 400);
  assert.equal((await api('GET', '/api/pedidos?etapa=fila&cursor=abc')).body.erro.codigo, 'cursor_invalido');
  assert.equal((await api('GET', '/api/pedidos/abc')).status, 400);
  assert.equal((await api('GET', '/nada')).status, 404);
  const nome = `Unico ${randomUUID()}`;
  assert.equal((await api('POST', '/api/insumos', { nome, unidade: 'un' })).status, 201);
  assert.equal((await api('POST', '/api/insumos', { nome, unidade: 'un' })).status, 409);
});

test('CORS libera só as origens configuradas', async () => {
  const ok = await api('GET', '/health/ready', undefined, { Origin: ORIGEM });
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGEM);
  const nao = await api('GET', '/api/insumos', undefined, { Origin: 'https://exemplo.invalid' });
  assert.equal(nao.headers.get('access-control-allow-origin'), null);
  const pre = await api('OPTIONS', '/api/pedidos/1', undefined, { Origin: ORIGEM, 'Access-Control-Request-Method': 'PATCH' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /PATCH/);
});

test('fluxo completo baixa uma vez e bloqueia transições e exclusão', async () => {
  const a = await novoInsumo('10');
  const id = await novoPedido([{ insumo_id: a, quantidade: '4' }]);
  assert.equal((await avancar(id, 'acabamento')).status, 409);
  assert.equal((await avancar(id, 'preparo')).status, 200);
  assert.equal(await saldo(a), '6.000');
  assert.equal((await avancar(id, 'preparo')).status, 409);
  assert.equal((await avancar(id, 'fila')).status, 409);
  assert.equal((await api('PATCH', `/api/pedidos/${id}`, { itens: [{ insumo_id: a, quantidade: 1 }] })).status, 409);
  assert.equal((await api('DELETE', `/api/pedidos/${id}`)).status, 409);
  assert.equal((await avancar(id, 'acabamento')).status, 200);
  assert.equal((await avancar(id, 'entrega')).status, 200);
  assert.equal((await api('PATCH', `/api/pedidos/${id}`, { cliente: 'X' })).status, 409);
  const movs = await api('GET', `/api/insumos/${a}/movimentacoes`);
  assert.deepEqual(movs.body.dados.map((m) => m.tipo), ['saida', 'entrada']);
  assert.equal(await saldo(a), '6.000');
});

test('falta de um insumo desfaz a operação inteira', async () => {
  const a = await novoInsumo('10');
  const b = await novoInsumo('1');
  const id = await novoPedido([{ insumo_id: a, quantidade: 5 }, { insumo_id: b, quantidade: 2 }]);
  const res = await avancar(id, 'preparo');
  assert.equal(res.status, 409);
  assert.equal(res.body.erro.codigo, 'estoque_insuficiente');
  assert.deepEqual(res.body.erro.detalhes.map((d) => d.insumo_id), [b]);
  assert.equal(await saldo(a), '10.000');
  assert.equal((await api('GET', `/api/pedidos/${id}`)).body.etapa, 'fila');
});

test('concorrência: 40 pedidos disputam estoque para 10', async () => {
  const a = await novoInsumo('10');
  const ids = [];
  for (let n = 0; n < 40; n++) ids.push(await novoPedido([{ insumo_id: a, quantidade: 1 }]));
  const respostas = await Promise.all(ids.map((id) => avancar(id, 'preparo')));
  assert.equal(respostas.filter((r) => r.status === 200).length, 10);
  // A recusa vem da regra (409), e não do CHECK do banco (422): o lock funcionou.
  assert.equal(respostas.filter((r) => r.body.erro?.codigo === 'estoque_insuficiente').length, 30);
  assert.equal(await saldo(a), '0.000');
});

test('concorrência: o mesmo pedido só avança uma vez', async () => {
  const a = await novoInsumo('100');
  const id = await novoPedido([{ insumo_id: a, quantidade: 1 }]);
  const status = (await Promise.all(Array.from({ length: 10 }, () => avancar(id, 'preparo')))).map((r) => r.status);
  assert.equal(status.filter((s) => s === 200).length, 1);
  assert.equal(await saldo(a), '99.000');
});

test('concorrência: insumos em ordem oposta não geram deadlock', async () => {
  const a = await novoInsumo('100');
  const b = await novoInsumo('100');
  const ids = [];
  for (let n = 0; n < 30; n++) {
    const itens = [{ insumo_id: a, quantidade: 1 }, { insumo_id: b, quantidade: 1 }];
    ids.push(await novoPedido(n % 2 ? itens : itens.reverse()));
  }
  const status = (await Promise.all(ids.map((id) => avancar(id, 'preparo')))).map((r) => r.status);
  assert.ok(status.every((s) => s === 200), status.join());
  assert.equal(await saldo(a), '70.000');
  assert.equal(await saldo(b), '70.000');
});

test('cursor percorre tudo sem repetir, mesmo com datas iguais ou por microssegundos', async () => {
  await pool.query(`INSERT INTO pedidos (cliente, descricao, etapa, criado_em)
    SELECT 'C', 'D', 'acabamento', timestamptz '2025-01-01 00:00:00Z' + (n / 2) * interval '1 microsecond'
    FROM generate_series(1, 25) n`);
  const vistos = [];
  let cursor = null;
  do {
    const { status, body } = await api('GET', `/api/pedidos?etapa=acabamento&limite=4${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(status, 200);
    vistos.push(...body.dados.map((p) => p.id));
    cursor = body.proximo_cursor;
  } while (cursor);
  const { rows } = await pool.query("SELECT id FROM pedidos WHERE etapa = 'acabamento' ORDER BY criado_em DESC, id DESC");
  assert.deepEqual(vistos, rows.map((r) => r.id));
});
