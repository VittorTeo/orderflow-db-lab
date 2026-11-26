import { ApiError } from './dominio.js';

// Cria elementos sem innerHTML: textos de usuários nunca viram HTML (sem XSS).
// A CSP também bloqueia estilos inline, por isso nada de atributo style.
export function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (chave === 'class') node.className = valor;
    else if (chave.startsWith('on')) node.addEventListener(chave.slice(2), valor);
    else if (chave === 'dataset') Object.assign(node.dataset, valor);
    else if (valor === true) node.setAttribute(chave, '');
    else node.setAttribute(chave, String(valor));
  }
  for (const filho of filhos.flat()) {
    if (filho === undefined || filho === null || filho === false) continue;
    node.append(filho instanceof Node ? filho : String(filho));
  }
  return node;
}

const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatarQtd = (valor, unidade) => `${numero.format(Number(valor))}${unidade ? ` ${unidade}` : ''}`;
export const formatarDataHora = (iso) => dataHora.format(new Date(iso));
// date chega como 'AAAA-MM-DD'; montar à mão evita o deslocamento de fuso do Date.
export const formatarDia = (dia) => dia.split('-').reverse().join('/');

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Aceita vírgula, como o usuário brasileiro digita.
export const normalizarDecimal = (texto) => texto.trim().replace(',', '.');

export function mensagemDeErro(erro) {
  if (!(erro instanceof ApiError)) return 'Erro inesperado. Tente novamente.';
  if (erro.codigo === 'estoque_insuficiente' && Array.isArray(erro.detalhes)) {
    const faltas = erro.detalhes.map((d) =>
      `${d.nome}: necessário ${formatarQtd(d.necessario)}, disponível ${formatarQtd(d.disponivel)}`);
    return `${erro.message} ${faltas.join('; ')}.`;
  }
  if (erro.codigo === 'validacao' && Array.isArray(erro.detalhes)) {
    return `${erro.message} ${erro.detalhes.map((d) => (d.campo ? `${d.campo}: ${d.mensagem}` : d.mensagem)).join('; ')}`;
  }
  return erro.message;
}

export function avisar(mensagem, tipo = 'ok') {
  const area = document.querySelector('#avisos');
  const aviso = el('div', { class: `aviso aviso-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' },
    el('span', {}, mensagem),
    el('button', { type: 'button', class: 'fechar', 'aria-label': 'Fechar aviso', onclick: () => aviso.remove() }, '×'));
  area.append(aviso);
  setTimeout(() => aviso.remove(), tipo === 'erro' ? 12000 : 5000);
}

export function mostrarModo(servico) {
  const caixa = document.querySelector('#modo');
  if (servico.modo === 'api') {
    caixa.className = 'modo modo-api';
    caixa.replaceChildren(el('span', {}, 'Conectado à API'));
  } else {
    caixa.className = 'modo modo-demo';
    caixa.replaceChildren(
      el('p', {},
        el('strong', {}, 'Modo demonstração — dados locais'),
        el('span', {}, ` ${servico.motivo} As alterações ficam só neste navegador.`)),
      el('button', {
        type: 'button',
        class: 'btn',
        onclick: async () => {
          if (!confirm('Restaurar os dados de exemplo? As alterações locais serão perdidas.')) return;
          await servico.api.resetar();
          location.reload();
        }
      }, 'Restaurar dados de exemplo'));
  }
  caixa.hidden = false;
}

export function ligarDialogo(dialogo) {
  for (const botao of dialogo.querySelectorAll('[data-fechar]')) {
    botao.addEventListener('click', () => dialogo.close());
  }
}

export function erroNoFormulario(elemento, mensagem) {
  elemento.textContent = mensagem ?? '';
  elemento.hidden = !mensagem;
}

// Evita duplo envio enquanto a operação está em andamento.
export async function ocupado(botao, operacao) {
  botao.disabled = true;
  try {
    return await operacao();
  } finally {
    botao.disabled = false;
  }
}
