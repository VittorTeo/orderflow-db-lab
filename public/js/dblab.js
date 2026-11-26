// A página só lê os arquivos gerados por db-lab/*.js. Todo número exibido
// vem deles; os textos de leitura são calculados a partir dos mesmos dados.
import { graficoBarras, graficoLinhas, tabela } from './graficos.js';
import { el, formatarDataHora } from './ui.js';

const BASE = '/db-lab/results/';
const ms = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const inteiro = new Intl.NumberFormat('pt-BR');
const fms = (v) => `${ms.format(v)} ms`;

async function lerJson(nome) {
  const res = await fetch(`${BASE}${nome}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status === 404 ? 'sem_resultado' : `HTTP ${res.status}`);
  return res.json();
}

// pg_settings em páginas de 8 kB ou em kB, convertido para leitura humana.
function formatarConfiguracao(valor) {
  const paginas = /^(\d+) 8kB$/.exec(valor);
  if (paginas) return `${inteiro.format((Number(paginas[1]) * 8) / 1024)} MB`;
  const kb = /^(\d+) kB$/.exec(valor);
  if (kb) return `${inteiro.format(Number(kb[1]) / 1024)} MB`;
  return valor;
}

function blocoAmbiente(dados, extra) {
  const a = dados.ambiente;
  const resumo = [
    `Medido em ${formatarDataHora(dados.gerado_em)}`,
    `PostgreSQL ${a.postgresql.split(' ')[0]}`,
    `${a.cliente.cpu}, ${a.cliente.nucleos_logicos} núcleos lógicos, ${a.cliente.memoria_gb} GB`,
    extra
  ].filter(Boolean).join(' · ');
  return el('div', { class: 'ambiente' },
    el('p', {}, resumo),
    el('details', {},
      el('summary', {}, 'Ambiente e método'),
      a.descricao ? el('p', {}, a.descricao) : null,
      el('p', {}, dados.metodo),
      el('dl', { class: 'config' },
        Object.entries({
          'Sistema do cliente': a.cliente.sistema,
          'Node.js': a.cliente.node,
          'PostgreSQL': a.postgresql,
          ...Object.fromEntries(Object.entries(a.configuracoes).map(([k, v]) => [k, formatarConfiguracao(v)])),
          'Linhas no banco': Object.entries(a.linhas).map(([t, n]) => `${t}: ${inteiro.format(n)}`).join(', ')
        }).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))));
}

function blocoPlanos(planos) {
  return el('div', { class: 'planos' },
    el('h3', {}, 'Planos de execução (EXPLAIN ANALYZE)'),
    planos.map((plano) => {
      const pre = el('pre', {}, 'Carregando…');
      const detalhes = el('details', {}, el('summary', {}, plano.titulo), pre);
      detalhes.addEventListener('toggle', async () => {
        if (!detalhes.open || detalhes.dataset.carregado) return;
        try {
          const res = await fetch(`${BASE}${plano.arquivo}`, { cache: 'no-cache' });
          pre.textContent = res.ok ? await res.text() : `Arquivo não encontrado (${res.status}).`;
          detalhes.dataset.carregado = '1';
        } catch {
          pre.textContent = 'Não foi possível carregar o plano.';
        }
      });
      return detalhes;
    }));
}

function leitura(texto) {
  return el('p', { class: 'leitura' }, el('strong', {}, 'Leitura: '), texto);
}

function paginacao(dados, alvo) {
  const r = dados.resultados;
  const series = [
    { nome: 'OFFSET', classe: 'serie-1', pontos: r.map((x) => ({ x: x.profundidade, y: x.offset.mediana_ms })) },
    { nome: 'Cursor', classe: 'serie-2', pontos: r.map((x) => ({ x: x.profundidade, y: x.cursor.mediana_ms })) }
  ];
  const ultimo = r.at(-1);
  alvo.append(
    blocoAmbiente(dados, `${dados.parametros.repeticoes} repetições após ${dados.parametros.aquecimento} de aquecimento`),
    leitura(`para pular ${inteiro.format(ultimo.profundidade)} linhas, OFFSET levou ${fms(ultimo.offset.mediana_ms)} (mediana) `
      + `e o cursor ${fms(ultimo.cursor.mediana_ms)}. No servidor, OFFSET leu ${inteiro.format(ultimo.offset.servidor.blocos_lidos)} blocos `
      + `e o cursor ${inteiro.format(ultimo.cursor.servidor.blocos_lidos)}: OFFSET percorre todas as linhas puladas; `
      + 'o cursor vai direto à chave pelo índice.'));
  graficoLinhas(alvo, {
    series,
    rotuloX: 'Linhas puladas antes da página',
    rotuloY: 'Mediana (ms)',
    formatarX: (v) => inteiro.format(v),
    formatarY: (v) => ms.format(v),
    descricao: 'Tempo mediano por página em função da profundidade, OFFSET e cursor. Os valores estão na tabela abaixo.'
  });
  alvo.append(tabela([
    { chave: 'p', titulo: 'Linhas puladas', num: true },
    { chave: 'om', titulo: 'OFFSET mediana', num: true },
    { chave: 'op', titulo: 'OFFSET p95', num: true },
    { chave: 'ob', titulo: 'OFFSET blocos', num: true },
    { chave: 'cm', titulo: 'Cursor mediana', num: true },
    { chave: 'cp', titulo: 'Cursor p95', num: true },
    { chave: 'cb', titulo: 'Cursor blocos', num: true }
  ], r.map((x) => ({
    p: inteiro.format(x.profundidade),
    om: fms(x.offset.mediana_ms),
    op: fms(x.offset.p95_ms),
    ob: inteiro.format(x.offset.servidor.blocos_lidos),
    cm: fms(x.cursor.mediana_ms),
    cp: fms(x.cursor.p95_ms),
    cb: inteiro.format(x.cursor.servidor.blocos_lidos)
  })), 'Tempos de paginação por profundidade'), blocoPlanos(dados.planos));
}

function indices(dados, alvo) {
  const classes = ['serie-1', 'serie-2', 'serie-3'];
  const variantes = dados.resultados;
  const etapas = variantes[0].consultas.map((c) => ({ etapa: c.etapa, rotulo: c.rotulo }));
  const composto = variantes.find((v) => v.variante === 'indice_composto');
  const sem = variantes.find((v) => v.variante === 'sem_indice');
  const simples = variantes.find((v) => v.variante === 'indice_simples');
  const achar = (v, etapa) => v.consultas.find((c) => c.etapa === etapa);

  alvo.append(
    blocoAmbiente(dados, `${dados.parametros.repeticoes} repetições após ${dados.parametros.aquecimento} de aquecimento`),
    leitura(`na etapa com mais linhas (${etapas[1].etapa}), a consulta levou ${fms(achar(sem, etapas[1].etapa).mediana_ms)} sem índice, `
      + `${fms(achar(simples, etapas[1].etapa).mediana_ms)} com o índice simples e ${fms(achar(composto, etapas[1].etapa).mediana_ms)} com o composto. `
      + `Planos escolhidos para essa etapa: simples ${achar(simples, etapas[1].etapa).servidor.nos.join(' › ')}; `
      + `composto ${achar(composto, etapas[1].etapa).servidor.nos.join(' › ')}. `
      + 'Um índice só por etapa filtra, mas não entrega a ordem; o composto entrega as linhas já ordenadas, sem Sort, e para nas 20 primeiras.'));
  graficoBarras(alvo, {
    series: variantes.map((v, i) => ({ nome: v.rotulo, classe: classes[i] })),
    grupos: etapas.map(({ etapa, rotulo }) => ({
      rotulo,
      barras: variantes.map((v, i) => {
        const c = achar(v, etapa);
        return { nome: v.rotulo, classe: classes[i], valor: c.mediana_ms, detalhe: `p95 ${fms(c.p95_ms)} · ${c.servidor.nos.join(' › ')}` };
      })
    })),
    formatar: fms,
    rotuloX: 'Mediana (ms), menor é melhor',
    descricao: 'Tempo mediano da primeira página por etapa, para cada variante de índice. Os valores estão na tabela abaixo.'
  });
  alvo.append(tabela([
    { chave: 'v', titulo: 'Variante' },
    { chave: 'e', titulo: 'Etapa' },
    { chave: 'm', titulo: 'Mediana', num: true },
    { chave: 'p', titulo: 'p95', num: true },
    { chave: 'b', titulo: 'Blocos', num: true },
    { chave: 'n', titulo: 'Plano' },
    { chave: 't', titulo: 'Tamanho do índice', num: true }
  ], variantes.flatMap((v) => v.consultas.map((c) => ({
    v: v.rotulo,
    e: `${c.etapa} (${inteiro.format(c.linhas_na_etapa)} linhas)`,
    m: fms(c.mediana_ms),
    p: fms(c.p95_ms),
    b: inteiro.format(c.servidor.blocos_lidos),
    n: c.servidor.nos.join(' › '),
    t: v.tamanho_indice_bytes === null ? '—' : `${ms.format(v.tamanho_indice_bytes / 1024 / 1024)} MB`
  }))), 'Tempos por variante de índice'), blocoPlanos(dados.planos));
}

function concorrencia(dados, alvo) {
  const p = dados.parametros;
  const cenarios = dados.resultados;
  const nomeAtraso = (a) => (a === 0 ? 'Sem pausa entre ler e gravar' : `Pausa de ${a} ms entre ler e gravar`);
  const sem = cenarios.filter((c) => !c.com_lock);
  const com = cenarios.filter((c) => c.com_lock);
  const mediana = (valores) => {
    const o = [...valores].sort((a, b) => a - b);
    const m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  };

  alvo.append(
    blocoAmbiente(dados, `${p.rodadas} rodadas por cenário`),
    leitura(`sem lock, o sistema aprovou entre ${Math.min(...sem.map((c) => c.vendas_aprovadas_min))} e `
      + `${Math.max(...sem.map((c) => c.vendas_aprovadas_max))} vendas para ${p.estoque_inicial} unidades, e o saldo ficou negativo em `
      + `${sem.reduce((t, c) => t + c.rodadas_com_saldo_negativo, 0)} de ${sem.length * p.rodadas} rodadas. `
      + `Com SELECT ... FOR UPDATE, foram ${com.every((c) => c.vendas_aprovadas_min === p.estoque_inicial && c.vendas_aprovadas_max === p.estoque_inicial) ? `exatamente ${p.estoque_inicial} em todas as rodadas` : 'valores diferentes do estoque; veja a tabela'}. `
      + 'O custo: com lock, as baixas do mesmo insumo passam a ser uma de cada vez; a pausa simulada se soma a cada uma.'));
  graficoBarras(alvo, {
    series: [{ nome: 'Com FOR UPDATE', classe: 'serie-1' }, { nome: 'Sem lock', classe: 'serie-2' }],
    grupos: p.atrasos_ms.map((atraso) => ({
      rotulo: nomeAtraso(atraso),
      barras: [true, false].map((comLock) => {
        const c = cenarios.find((x) => x.atraso_ms === atraso && x.com_lock === comLock);
        return {
          nome: comLock ? 'Com FOR UPDATE' : 'Sem lock',
          classe: comLock ? 'serie-1' : 'serie-2',
          valor: c.vendas_aprovadas_max,
          detalhe: `mín. ${c.vendas_aprovadas_min}, máx. ${c.vendas_aprovadas_max} em ${c.rodadas.length} rodadas`
        };
      })
    })),
    formatar: (v) => inteiro.format(v),
    rotuloX: 'Vendas aprovadas (maior valor entre as rodadas)',
    referencia: { valor: p.estoque_inicial, rotulo: `Estoque: ${p.estoque_inicial}` },
    descricao: 'Vendas aprovadas por cenário comparadas ao estoque disponível. Os valores estão na tabela abaixo.'
  });
  alvo.append(tabela([
    { chave: 'c', titulo: 'Cenário' },
    { chave: 'v', titulo: 'Vendas aprovadas por rodada' },
    { chave: 's', titulo: 'Saldo final por rodada' },
    { chave: 't', titulo: 'Duração mediana da rodada', num: true }
  ], cenarios.map((c) => ({
    c: `${c.com_lock ? 'Com FOR UPDATE' : 'Sem lock'}, ${nomeAtraso(c.atraso_ms).toLowerCase()}`,
    v: c.rodadas.map((r) => r.vendas_aprovadas).join(', '),
    s: c.rodadas.map((r) => inteiro.format(r.saldo_final)).join(', '),
    t: fms(mediana(c.rodadas.map((r) => r.duracao_ms)))
  })), 'Resultados por cenário de concorrência'), blocoPlanos(dados.planos));
}

async function montar(nome, desenhar) {
  const secao = document.querySelector(`#${nome} .conteudo`);
  try {
    const dados = await lerJson(nome);
    secao.replaceChildren();
    desenhar(dados, secao);
  } catch (erro) {
    secao.replaceChildren(el('p', { class: 'vazio' }, erro.message === 'sem_resultado'
      ? 'Ainda não há resultados. Rode "npm run lab" na pasta db-lab (veja o README).'
      : 'Não foi possível ler os resultados deste experimento.'));
  } finally {
    secao.setAttribute('aria-busy', 'false');
  }
}

montar('paginacao', paginacao);
montar('indices', indices);
montar('concorrencia', concorrencia);
