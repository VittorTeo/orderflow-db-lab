import { obterServico } from './apiService.js';
import { ETAPAS, NOMES_ETAPA } from './dominio.js';
import {
  avisar, el, erroNoFormulario, formatarDia, formatarQtd, hojeISO, ligarDialogo,
  mensagemDeErro, mostrarModo, normalizarDecimal, ocupado
} from './ui.js';

const PROXIMA = { fila: 'preparo', preparo: 'acabamento', acabamento: 'entrega' };

const quadro = document.querySelector('#quadro');
const botaoNovo = document.querySelector('#novo-pedido');
const dialogo = document.querySelector('#dlg-pedido');
const form = document.querySelector('#form-pedido');
const titulo = document.querySelector('#dlg-pedido-titulo');
const camposItens = document.querySelector('#itens-campos');
const notaItens = document.querySelector('#itens-nota');
const linhasItens = document.querySelector('#itens-linhas');
const erroForm = document.querySelector('#pedido-erro');

const colunas = new Map();
let servico;
let insumos = [];
let edicao = null; // { id, etapa } quando o diálogo edita um pedido existente

function criarColuna(etapa) {
  const lista = el('ul', { class: 'cartoes' });
  const vazio = el('p', { class: 'vazio', hidden: true }, 'Nenhum pedido nesta etapa.');
  const mais = el('button', { type: 'button', class: 'btn mais', hidden: true, onclick: () => carregar(etapa, true) }, 'Carregar mais');
  quadro.append(el('section', { class: `coluna etapa-${etapa}`, 'aria-labelledby': `titulo-${etapa}` },
    el('h2', { id: `titulo-${etapa}` }, NOMES_ETAPA[etapa]), vazio, lista, mais));
  colunas.set(etapa, { lista, vazio, mais, cursor: null });
}

async function carregar(etapa, continuar = false) {
  const coluna = colunas.get(etapa);
  coluna.mais.disabled = true;
  try {
    const resposta = await servico.api.listarPedidos({ etapa, limite: 20, cursor: continuar ? coluna.cursor : undefined });
    if (!continuar) coluna.lista.replaceChildren();
    coluna.lista.append(...resposta.dados.map(cartao));
    coluna.cursor = resposta.proximo_cursor;
    coluna.mais.hidden = !coluna.cursor;
    coluna.vazio.hidden = coluna.lista.children.length > 0;
  } catch (erro) {
    avisar(`${NOMES_ETAPA[etapa]}: ${mensagemDeErro(erro)}`, 'erro');
  } finally {
    coluna.mais.disabled = false;
  }
}

function cartao(pedido) {
  const atrasado = pedido.prazo && pedido.etapa !== 'entrega' && pedido.prazo < hojeISO();
  const proxima = PROXIMA[pedido.etapa];
  const detalhes = el('details', { class: 'detalhes' }, el('summary', {}, 'Insumos'), el('p', { class: 'suave' }, 'Carregando…'));
  detalhes.addEventListener('toggle', () => {
    if (detalhes.open && !detalhes.dataset.carregado) carregarItens(pedido.id, detalhes);
  });

  const acoes = el('div', { class: 'acoes-cartao' });
  if (proxima) {
    acoes.append(el('button', {
      type: 'button',
      class: 'btn primario',
      title: proxima === 'preparo' ? 'Valida e baixa os insumos do estoque' : undefined,
      onclick: (evento) => mover(pedido, proxima, evento.currentTarget)
    }, proxima === 'preparo' ? 'Iniciar preparo' : `Mover para ${NOMES_ETAPA[proxima]}`));
  }
  if (pedido.etapa !== 'entrega') {
    acoes.append(el('button', { type: 'button', class: 'btn', onclick: (evento) => abrirEdicao(pedido.id, evento.currentTarget) }, 'Editar'));
  }
  if (pedido.etapa === 'fila') {
    acoes.append(el('button', { type: 'button', class: 'btn perigo', onclick: (evento) => excluir(pedido, evento.currentTarget) }, 'Excluir'));
  }

  return el('li', { class: 'cartao' },
    el('article', { 'aria-label': `Pedido ${pedido.id}` },
      el('div', { class: 'cartao-topo' },
        el('span', { class: 'numero' }, `#${pedido.id}`),
        pedido.prazo
          ? el('span', { class: atrasado ? 'prazo atrasado' : 'prazo' },
            `${atrasado ? 'Atrasado' : 'Prazo'} ${formatarDia(pedido.prazo)}`)
          : null),
      el('h3', {}, pedido.cliente),
      el('p', { class: 'descricao' }, pedido.descricao),
      detalhes,
      acoes));
}

async function carregarItens(id, detalhes) {
  try {
    const pedido = await servico.api.buscarPedido(id);
    detalhes.dataset.carregado = '1';
    detalhes.replaceChildren(detalhes.querySelector('summary'),
      el('ul', { class: 'itens' }, pedido.itens.map((item) =>
        el('li', {}, el('span', {}, item.nome), el('span', { class: 'qtd' }, formatarQtd(item.quantidade, item.unidade))))));
  } catch (erro) {
    avisar(mensagemDeErro(erro), 'erro');
  }
}

async function mover(pedido, etapa, botao) {
  await ocupado(botao, async () => {
    try {
      await servico.api.mudarEtapa(pedido.id, etapa);
      avisar(etapa === 'preparo'
        ? `Pedido #${pedido.id} em preparo. Insumos baixados do estoque.`
        : `Pedido #${pedido.id} movido para ${NOMES_ETAPA[etapa]}.`);
    } catch (erro) {
      avisar(`Pedido #${pedido.id}: ${mensagemDeErro(erro)}`, 'erro');
      // Outra pessoa pode ter movido o pedido: recarrega para mostrar o estado real.
      if (erro.codigo !== 'transicao_invalida') return;
    }
    await Promise.all([carregar(pedido.etapa), carregar(etapa)]);
  });
}

async function excluir(pedido, botao) {
  if (!confirm(`Excluir o pedido #${pedido.id} de ${pedido.cliente}?`)) return;
  await ocupado(botao, async () => {
    try {
      await servico.api.excluirPedido(pedido.id);
      avisar(`Pedido #${pedido.id} excluído.`);
    } catch (erro) {
      avisar(mensagemDeErro(erro), 'erro');
    }
    await carregar(pedido.etapa);
  });
}

function linhaItem(item = {}) {
  const select = el('select', { name: 'insumo_id', required: true, 'aria-label': 'Insumo' },
    el('option', { value: '' }, 'Escolha um insumo'),
    insumos.map((insumo) => el('option', { value: insumo.id }, `${insumo.nome} (${insumo.unidade})`)));
  if (item.insumo_id) select.value = String(item.insumo_id);
  const quantidade = el('input', {
    name: 'quantidade',
    required: true,
    inputmode: 'decimal',
    pattern: '\\d{1,11}([.,]\\d{1,3})?',
    title: 'Número com até 3 casas decimais',
    placeholder: 'Qtd.',
    'aria-label': 'Quantidade',
    value: item.quantidade ? String(Number(item.quantidade)).replace('.', ',') : undefined
  });
  const linha = el('div', { class: 'linha-item' }, select, quantidade,
    el('button', { type: 'button', class: 'btn', 'aria-label': 'Remover insumo', onclick: () => linha.remove() }, 'Remover'));
  return linha;
}

async function carregarInsumos() {
  insumos = (await servico.api.listarInsumos()).dados;
}

function prepararDialogo(tituloTexto, itensEditaveis) {
  form.reset();
  erroNoFormulario(erroForm, null);
  titulo.textContent = tituloTexto;
  camposItens.disabled = !itensEditaveis;
  notaItens.hidden = itensEditaveis;
  linhasItens.replaceChildren();
}

async function abrirNovo() {
  await ocupado(botaoNovo, async () => {
    try {
      await carregarInsumos();
    } catch (erro) {
      avisar(mensagemDeErro(erro), 'erro');
      return;
    }
    edicao = null;
    prepararDialogo('Novo pedido', true);
    linhasItens.append(linhaItem());
    dialogo.showModal();
  });
}

async function abrirEdicao(id, botao) {
  await ocupado(botao, async () => {
    let pedido;
    try {
      [pedido] = await Promise.all([servico.api.buscarPedido(id), carregarInsumos()]);
    } catch (erro) {
      avisar(mensagemDeErro(erro), 'erro');
      return;
    }
    edicao = { id: pedido.id, etapa: pedido.etapa };
    prepararDialogo(`Editar pedido #${pedido.id}`, pedido.etapa === 'fila');
    form.elements.cliente.value = pedido.cliente;
    form.elements.descricao.value = pedido.descricao;
    form.elements.prazo.value = pedido.prazo ?? '';
    linhasItens.append(...pedido.itens.map(linhaItem));
    dialogo.showModal();
  });
}

function lerFormulario() {
  const dados = {
    cliente: form.elements.cliente.value,
    descricao: form.elements.descricao.value,
    prazo: form.elements.prazo.value || null
  };
  if (!camposItens.disabled) {
    dados.itens = [...linhasItens.querySelectorAll('.linha-item')].map((linha) => ({
      insumo_id: Number(linha.querySelector('select').value),
      quantidade: normalizarDecimal(linha.querySelector('input').value)
    }));
  }
  return dados;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = form.querySelector('button[type="submit"]');
  await ocupado(botao, async () => {
    const dados = lerFormulario();
    if (dados.itens && dados.itens.length === 0) {
      erroNoFormulario(erroForm, 'Adicione ao menos um insumo.');
      return;
    }
    try {
      if (edicao) {
        await servico.api.editarPedido(edicao.id, dados);
        avisar(`Pedido #${edicao.id} atualizado.`);
        dialogo.close();
        await carregar(edicao.etapa);
      } else {
        const criado = await servico.api.criarPedido(dados);
        avisar(`Pedido #${criado.id} criado na fila.`);
        dialogo.close();
        await carregar('fila');
      }
    } catch (erro) {
      erroNoFormulario(erroForm, mensagemDeErro(erro));
    }
  });
});

document.querySelector('#add-item').addEventListener('click', () => {
  if (insumos.length === 0) {
    erroNoFormulario(erroForm, 'Cadastre insumos na tela de Estoque primeiro.');
    return;
  }
  linhasItens.append(linhaItem());
});

botaoNovo.addEventListener('click', abrirNovo);
ligarDialogo(dialogo);

async function iniciar() {
  servico = await obterServico();
  mostrarModo(servico);
  for (const etapa of ETAPAS) criarColuna(etapa);
  await Promise.all(ETAPAS.map((etapa) => carregar(etapa)));
  quadro.setAttribute('aria-busy', 'false');
  botaoNovo.disabled = false;
}

iniciar();
