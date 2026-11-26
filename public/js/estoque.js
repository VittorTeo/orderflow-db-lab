import { obterServico } from './apiService.js';
import {
  avisar, el, erroNoFormulario, formatarDataHora, formatarQtd, ligarDialogo,
  mensagemDeErro, mostrarModo, normalizarDecimal, ocupado
} from './ui.js';

const corpoTabela = document.querySelector('#insumos tbody');
const vazio = document.querySelector('#insumos-vazio');
const botaoNovo = document.querySelector('#novo-insumo');

const dlgInsumo = document.querySelector('#dlg-insumo');
const formInsumo = document.querySelector('#form-insumo');
const erroInsumo = document.querySelector('#insumo-erro');

const dlgEntrada = document.querySelector('#dlg-entrada');
const formEntrada = document.querySelector('#form-entrada');
const tituloEntrada = document.querySelector('#dlg-entrada-titulo');
const erroEntrada = document.querySelector('#entrada-erro');

const dlgExtrato = document.querySelector('#dlg-extrato');
const tituloExtrato = document.querySelector('#dlg-extrato-titulo');
const listaExtrato = document.querySelector('#extrato-lista');
const maisExtrato = document.querySelector('#extrato-mais');

let servico;
let insumoEntrada = null;
let extrato = { insumo: null, cursor: null };

function linha(insumo) {
  return el('tr', { class: insumo.abaixo_do_minimo ? 'abaixo' : undefined },
    el('th', { scope: 'row' }, insumo.nome),
    el('td', { class: 'num' }, formatarQtd(insumo.saldo, insumo.unidade)),
    el('td', { class: 'num' }, formatarQtd(insumo.estoque_minimo, insumo.unidade)),
    el('td', {}, insumo.abaixo_do_minimo
      ? el('span', { class: 'selo selo-alerta' }, 'Abaixo do mínimo')
      : el('span', { class: 'selo selo-ok' }, 'Ok')),
    // div interno: display:flex direto no td quebra o layout da tabela.
    el('td', {}, el('div', { class: 'acoes-linha' },
      el('button', { type: 'button', class: 'btn primario', onclick: () => abrirEntrada(insumo) }, 'Entrada'),
      el('button', { type: 'button', class: 'btn', onclick: () => abrirExtrato(insumo) }, 'Extrato'))));
}

async function carregar() {
  try {
    const { dados } = await servico.api.listarInsumos();
    corpoTabela.replaceChildren(...dados.map(linha));
    vazio.hidden = dados.length > 0;
  } catch (erro) {
    avisar(mensagemDeErro(erro), 'erro');
  }
}

function abrirEntrada(insumo) {
  insumoEntrada = insumo;
  formEntrada.reset();
  erroNoFormulario(erroEntrada, null);
  tituloEntrada.textContent = `Entrada: ${insumo.nome} (${insumo.unidade})`;
  dlgEntrada.showModal();
}

formEntrada.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  await ocupado(formEntrada.querySelector('button[type="submit"]'), async () => {
    try {
      const atualizado = await servico.api.registrarEntrada(insumoEntrada.id, {
        quantidade: normalizarDecimal(formEntrada.elements.quantidade.value),
        motivo: formEntrada.elements.motivo.value
      });
      dlgEntrada.close();
      avisar(`${atualizado.nome}: saldo agora é ${formatarQtd(atualizado.saldo, atualizado.unidade)}.`);
      await carregar();
    } catch (erro) {
      erroNoFormulario(erroEntrada, mensagemDeErro(erro));
    }
  });
});

botaoNovo.addEventListener('click', () => {
  formInsumo.reset();
  erroNoFormulario(erroInsumo, null);
  dlgInsumo.showModal();
});

formInsumo.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  await ocupado(formInsumo.querySelector('button[type="submit"]'), async () => {
    try {
      const criado = await servico.api.criarInsumo({
        nome: formInsumo.elements.nome.value,
        unidade: formInsumo.elements.unidade.value,
        estoque_minimo: normalizarDecimal(formInsumo.elements.estoque_minimo.value || '0')
      });
      dlgInsumo.close();
      avisar(`Insumo ${criado.nome} cadastrado. Registre uma entrada para ter saldo.`);
      await carregar();
    } catch (erro) {
      erroNoFormulario(erroInsumo, erro.codigo === 'duplicado' ? 'Já existe um insumo com esse nome.' : mensagemDeErro(erro));
    }
  });
});

function itemExtrato(mov, unidade) {
  const sinal = mov.tipo === 'entrada' ? '+' : '−';
  return el('li', { class: `mov mov-${mov.tipo}` },
    el('span', { class: 'mov-qtd' }, `${sinal}${formatarQtd(mov.quantidade, unidade)}`),
    el('span', {}, mov.pedido_id ? `${mov.motivo} · pedido #${mov.pedido_id}` : mov.motivo),
    el('time', { datetime: mov.criado_em, class: 'suave' }, formatarDataHora(mov.criado_em)));
}

async function carregarExtrato(continuar) {
  maisExtrato.disabled = true;
  try {
    const resposta = await servico.api.listarMovimentacoes(extrato.insumo.id, {
      limite: 20,
      cursor: continuar ? extrato.cursor : undefined
    });
    if (!continuar) listaExtrato.replaceChildren();
    listaExtrato.append(...resposta.dados.map((mov) => itemExtrato(mov, extrato.insumo.unidade)));
    if (listaExtrato.children.length === 0) listaExtrato.append(el('li', { class: 'suave' }, 'Sem movimentações.'));
    extrato.cursor = resposta.proximo_cursor;
    maisExtrato.hidden = !extrato.cursor;
  } catch (erro) {
    avisar(mensagemDeErro(erro), 'erro');
  } finally {
    maisExtrato.disabled = false;
  }
}

async function abrirExtrato(insumo) {
  extrato = { insumo, cursor: null };
  tituloExtrato.textContent = `Extrato: ${insumo.nome}`;
  listaExtrato.replaceChildren(el('li', { class: 'suave' }, 'Carregando…'));
  maisExtrato.hidden = true;
  dlgExtrato.showModal();
  await carregarExtrato(false);
}

maisExtrato.addEventListener('click', () => carregarExtrato(true));
for (const dialogo of [dlgInsumo, dlgEntrada, dlgExtrato]) ligarDialogo(dialogo);

async function iniciar() {
  servico = await obterServico();
  mostrarModo(servico);
  await carregar();
  document.querySelector('#insumos').setAttribute('aria-busy', 'false');
  botaoNovo.disabled = false;
}

iniciar();
