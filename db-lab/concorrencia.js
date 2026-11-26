// (c) Baixa concorrente de estoque: ler-checar-gravar com e sem SELECT ... FOR UPDATE.
// Usa uma tabela própria (schema lab_concorrencia), sem o CHECK (saldo >= 0) da tabela
// real, justamente para que o efeito da falta de lock fique visível. Apagada ao final.
import { setTimeout as esperar } from 'node:timers/promises';
import { ambiente, criarPool, ehPrincipal, explicar, salvarPlano, salvarResultado } from './lib.js';

const ESTOQUE = 100;
const PEDIDOS = 200;
const CONEXOES = 40;
const RODADAS = Number(process.env.LAB_RODADAS ?? 5);
// Pausa entre ler o saldo e gravar a baixa: simula o processamento da aplicação.
const ATRASOS_MS = [0, 5];

async function baixar(pool, comLock, atrasoMs) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      `SELECT saldo FROM lab_concorrencia.estoque WHERE id = 1${comLock ? ' FOR UPDATE' : ''}`);
    if (atrasoMs > 0) await esperar(atrasoMs);
    if (Number(rows[0].saldo) < 1) {
      await cliente.query('ROLLBACK');
      return false;
    }
    // Atualização relativa: sem lock, a checagem acima pode estar desatualizada.
    await cliente.query('UPDATE lab_concorrencia.estoque SET saldo = saldo - 1 WHERE id = 1');
    await cliente.query('COMMIT');
    return true;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}

async function rodada(pool, comLock, atrasoMs) {
  await pool.query('UPDATE lab_concorrencia.estoque SET saldo = $1 WHERE id = 1', [ESTOQUE]);
  const inicio = performance.now();
  const vendas = await Promise.all(Array.from({ length: PEDIDOS }, () => baixar(pool, comLock, atrasoMs)));
  const duracao = performance.now() - inicio;
  const sucesso = vendas.filter(Boolean).length;
  const saldo = Number((await pool.query('SELECT saldo FROM lab_concorrencia.estoque WHERE id = 1')).rows[0].saldo);
  return {
    vendas_aprovadas: sucesso,
    vendas_alem_do_estoque: Math.max(0, sucesso - ESTOQUE),
    saldo_final: saldo,
    duracao_ms: Math.round(duracao * 10) / 10,
    baixas_por_segundo: Math.round(PEDIDOS / (duracao / 1000))
  };
}

export async function executar() {
  const pool = criarPool(CONEXOES);
  try {
    await pool.query('DROP SCHEMA IF EXISTS lab_concorrencia CASCADE');
    await pool.query('CREATE SCHEMA lab_concorrencia');
    await pool.query('CREATE TABLE lab_concorrencia.estoque (id int PRIMARY KEY, saldo numeric(14,3) NOT NULL)');
    await pool.query('INSERT INTO lab_concorrencia.estoque VALUES (1, $1)', [ESTOQUE]);

    const cenarios = [];
    for (const atrasoMs of ATRASOS_MS) {
      for (const comLock of [false, true]) {
        const rodadas = [];
        for (let i = 0; i < RODADAS; i++) rodadas.push(await rodada(pool, comLock, atrasoMs));
        const aprovadas = rodadas.map((r) => r.vendas_aprovadas);
        cenarios.push({
          cenario: `${comLock ? 'com' : 'sem'}_lock_${atrasoMs}ms`,
          com_lock: comLock,
          atraso_ms: atrasoMs,
          rodadas,
          vendas_aprovadas_min: Math.min(...aprovadas),
          vendas_aprovadas_max: Math.max(...aprovadas),
          rodadas_com_saldo_negativo: rodadas.filter((r) => r.saldo_final < 0).length
        });
        console.log(`${comLock ? 'COM' : 'SEM'} lock, atraso ${atrasoMs} ms: vendas aprovadas ${aprovadas.join(', ')} (estoque ${ESTOQUE})`);
      }
    }

    // Plano da leitura com lock: o nó LockRows é o que trava a linha.
    const cliente = await pool.connect();
    let plano;
    try {
      await cliente.query('BEGIN');
      plano = await explicar(cliente, { text: 'SELECT saldo FROM lab_concorrencia.estoque WHERE id = 1 FOR UPDATE' });
    } finally {
      await cliente.query('ROLLBACK').catch(() => {});
      cliente.release();
    }
    const planos = [await salvarPlano('concorrencia-select-for-update.txt', 'Leitura do saldo com SELECT ... FOR UPDATE', plano)];

    await salvarResultado('concorrencia', {
      experimento: 'concorrencia',
      titulo: 'Baixa concorrente: sem lock vs. SELECT ... FOR UPDATE',
      gerado_em: new Date().toISOString(),
      parametros: { estoque_inicial: ESTOQUE, pedidos_simultaneos: PEDIDOS, conexoes: CONEXOES, rodadas: RODADAS, atrasos_ms: ATRASOS_MS },
      metodo: `Cada rodada parte de saldo ${ESTOQUE} e dispara ${PEDIDOS} transações simultâneas (até ${CONEXOES} conexões), `
        + 'cada uma pedindo 1 unidade: lê o saldo, aguarda o atraso (simula a aplicação), confere se há saldo e baixa. '
        + 'A tabela do laboratório não tem o CHECK (saldo >= 0) da tabela real, para o efeito ficar visível. '
        + 'Esperado sem falha: exatamente 100 vendas aprovadas e saldo final 0.',
      ambiente: await ambiente(pool),
      resultados: cenarios,
      planos
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS lab_concorrencia CASCADE').catch(() => {});
    await pool.end();
  }
}

if (ehPrincipal(import.meta.url)) await executar();
