// Gráficos em SVG montados com a API do DOM: sem biblioteca externa (a CSP só
// permite scripts do próprio site) e sem innerHTML.
import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, atributos = {}, ...filhos) {
  const node = document.createElementNS(NS, tag);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor !== undefined && valor !== null) node.setAttribute(chave, String(valor));
  }
  for (const filho of filhos.flat()) {
    if (filho !== undefined && filho !== null) node.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return node;
}

const escala = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

// Marcas "redondas" no eixo: 0, 10, 20… em vez de 0, 9,7, 19,4…
function marcas(maximo, quantidade = 5) {
  if (!(maximo > 0)) return [0, 1];
  const bruto = maximo / quantidade;
  const ordem = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * ordem).find((p) => p >= bruto);
  const lista = [];
  for (let v = 0; v < maximo + passo; v += passo) {
    lista.push(Number(v.toPrecision(12)));
    if (v >= maximo) break;
  }
  return lista;
}

// Barra horizontal com as pontas de dados arredondadas e a base reta, ancorada no eixo.
function barraH(x0, y, largura, altura, raio = 4) {
  const r = Math.min(raio, largura / 2, altura / 2);
  const x1 = x0 + largura;
  return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + altura - r}Q${x1},${y + altura} ${x1 - r},${y + altura}H${x0}Z`;
}

function legenda(series, forma) {
  return el('ul', { class: 'legenda' }, series.map((serie) =>
    el('li', {}, el('span', { class: `chave chave-${forma} ${serie.classe}`, 'aria-hidden': 'true' }), serie.nome)));
}

function criarDica(container) {
  const dica = el('div', { class: 'dica', role: 'presentation', hidden: true });
  container.append(dica);
  return {
    mostrar(linhas, x, y) {
      dica.replaceChildren(...linhas.map(({ valor, rotulo, classe }) =>
        el('div', { class: 'dica-linha' },
          classe ? el('span', { class: `chave chave-linha ${classe}`, 'aria-hidden': 'true' }) : null,
          el('strong', {}, valor), rotulo ? el('span', {}, rotulo) : null)));
      dica.hidden = false;
      const largura = container.clientWidth;
      const esquerda = Math.min(Math.max(x + 12, 0), largura - dica.offsetWidth - 4);
      dica.style.left = `${Math.max(0, esquerda)}px`;
      dica.style.top = `${Math.max(0, y - dica.offsetHeight - 8)}px`;
    },
    esconder() { dica.hidden = true; }
  };
}

// Redesenha na largura real do contêiner: o texto mantém o tamanho no celular.
function responsivo(container, desenhar) {
  let largura = 0;
  const observador = new ResizeObserver(() => {
    const nova = Math.round(container.clientWidth);
    if (nova > 0 && nova !== largura) {
      largura = nova;
      desenhar(nova);
    }
  });
  observador.observe(container);
}

/**
 * Linhas com eixo x numérico.
 * series: [{ nome, classe, pontos: [{ x, y }] }]
 */
export function graficoLinhas(container, { series, rotuloX, rotuloY, formatarX, formatarY, descricao }) {
  const area = el('div', { class: 'grafico' });
  container.append(legenda(series, 'linha'), area);
  const dica = criarDica(area);
  const xs = series[0].pontos.map((p) => p.x);

  responsivo(area, (largura) => {
    const altura = 300;
    const m = { topo: 16, direita: 72, base: 48, esquerda: 56 };
    const maxX = Math.max(...xs);
    const maxY = Math.max(...series.flatMap((serie) => serie.pontos.map((p) => p.y)));
    const marcasY = marcas(maxY);
    const marcasX = marcas(maxX, largura < 480 ? 3 : 5);
    const x = escala(0, marcasX.at(-1), m.esquerda, largura - m.direita);
    const y = escala(0, marcasY.at(-1), altura - m.base, m.topo);

    const svg = s('svg', { width: largura, height: altura, role: 'img', 'aria-label': descricao, class: 'svg' });
    svg.append(
      ...marcasY.map((v) => s('g', {},
        s('line', { x1: m.esquerda, x2: largura - m.direita, y1: y(v), y2: y(v), class: 'grade' }),
        s('text', { x: m.esquerda - 8, y: y(v), class: 'eixo-texto', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, formatarY(v)))),
      ...marcasX.map((v) => s('text', { x: x(v), y: altura - m.base + 18, class: 'eixo-texto', 'text-anchor': 'middle' }, formatarX(v))),
      s('line', { x1: m.esquerda, x2: largura - m.direita, y1: y(0), y2: y(0), class: 'eixo' }),
      s('text', { x: (m.esquerda + largura - m.direita) / 2, y: altura - 6, class: 'eixo-titulo', 'text-anchor': 'middle' }, rotuloX),
      s('text', { x: 14, y: altura / 2, class: 'eixo-titulo', 'text-anchor': 'middle', transform: `rotate(-90 14 ${altura / 2})` }, rotuloY));

    const finais = [];
    for (const serie of series) {
      const d = serie.pontos.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join('');
      svg.append(s('path', { d, class: `linha ${serie.classe}` }));
      for (const p of serie.pontos) svg.append(s('circle', { cx: x(p.x), cy: y(p.y), r: 4, class: `marcador ${serie.classe}` }));
      const ultimo = serie.pontos.at(-1);
      finais.push({ serie, py: y(ultimo.y), px: x(ultimo.x) });
    }
    // Rótulos diretos no fim de cada linha, afastados se ficarem próximos.
    finais.sort((a, b) => a.py - b.py);
    for (let i = 1; i < finais.length; i++) finais[i].py = Math.max(finais[i].py, finais[i - 1].py + 16);
    for (const f of finais) {
      svg.append(s('text', { x: f.px + 10, y: f.py, class: 'rotulo-direto', 'dominant-baseline': 'middle' }, f.serie.nome));
    }

    const guia = s('line', { y1: m.topo, y2: altura - m.base, class: 'guia', visibility: 'hidden' });
    const captura = s('rect', { x: m.esquerda, y: m.topo, width: largura - m.esquerda - m.direita, height: altura - m.topo - m.base, class: 'captura' });
    svg.append(guia, captura);
    captura.addEventListener('pointermove', (evento) => {
      const caixa = svg.getBoundingClientRect();
      const px = evento.clientX - caixa.left;
      let indice = 0;
      xs.forEach((valor, i) => { if (Math.abs(x(valor) - px) < Math.abs(x(xs[indice]) - px)) indice = i; });
      guia.setAttribute('x1', x(xs[indice]));
      guia.setAttribute('x2', x(xs[indice]));
      guia.setAttribute('visibility', 'visible');
      dica.mostrar([
        { valor: formatarX(xs[indice]), rotulo: rotuloX },
        ...series.map((serie) => ({ valor: formatarY(serie.pontos[indice].y), rotulo: serie.nome, classe: serie.classe }))
      ], x(xs[indice]), evento.clientY - caixa.top);
    });
    captura.addEventListener('pointerleave', () => {
      guia.setAttribute('visibility', 'hidden');
      dica.esconder();
    });
    area.replaceChildren(svg, area.querySelector('.dica'));
  });
}

/**
 * Barras horizontais agrupadas.
 * grupos: [{ rotulo, barras: [{ nome, classe, valor, detalhe }] }]
 * referencia: { valor, rotulo } desenha uma linha vertical de comparação.
 */
export function graficoBarras(container, { grupos, series, formatar, rotuloX, descricao, referencia }) {
  const area = el('div', { class: 'grafico' });
  container.append(legenda(series, 'barra'), area);
  const dica = criarDica(area);

  responsivo(area, (largura) => {
    const alturaBarra = 20;
    const vao = 2;
    const m = { topo: 8, direita: 64, base: 44, esquerda: 12 };
    const alturaGrupo = (g) => 22 + g.barras.length * (alturaBarra + vao);
    const altura = m.topo + grupos.reduce((t, g) => t + alturaGrupo(g) + 14, 0) + m.base;
    const maximo = Math.max(...grupos.flatMap((g) => g.barras.map((b) => b.valor)), referencia?.valor ?? 0);
    const marcasX = marcas(maximo, largura < 480 ? 3 : 5);
    const x = escala(0, marcasX.at(-1), m.esquerda, largura - m.direita);
    const base = altura - m.base;

    const svg = s('svg', { width: largura, height: altura, role: 'img', 'aria-label': descricao, class: 'svg' });
    svg.append(...marcasX.map((v) => s('g', {},
      s('line', { x1: x(v), x2: x(v), y1: m.topo, y2: base, class: 'grade' }),
      s('text', { x: x(v), y: base + 18, class: 'eixo-texto', 'text-anchor': 'middle' }, formatar(v)))),
    s('text', { x: (m.esquerda + largura - m.direita) / 2, y: altura - 6, class: 'eixo-titulo', 'text-anchor': 'middle' }, rotuloX));

    let topo = m.topo;
    for (const grupo of grupos) {
      svg.append(s('text', { x: m.esquerda, y: topo + 14, class: 'grupo-titulo' }, grupo.rotulo));
      let yb = topo + 22;
      for (const barra of grupo.barras) {
        const comprimento = Math.max(1, x(barra.valor) - x(0));
        const marca = s('path', { d: barraH(x(0), yb, comprimento, alturaBarra), class: `barra ${barra.classe}`, tabindex: 0, 'aria-label': `${grupo.rotulo}, ${barra.nome}: ${formatar(barra.valor)}` });
        const alvo = s('rect', { x: m.esquerda, y: yb - 1, width: comprimento + 60, height: alturaBarra + 2, class: 'captura' });
        const linhas = [{ valor: formatar(barra.valor), rotulo: barra.nome, classe: barra.classe }, ...(barra.detalhe ? [{ valor: '', rotulo: barra.detalhe }] : [])];
        const mostrar = (px, py) => { marca.classList.add('ativa'); dica.mostrar(linhas, px, py); };
        const esconder = () => { marca.classList.remove('ativa'); dica.esconder(); };
        const posicao = (evento) => { const c = svg.getBoundingClientRect(); return [evento.clientX - c.left, evento.clientY - c.top]; };
        alvo.addEventListener('pointermove', (evento) => mostrar(...posicao(evento)));
        alvo.addEventListener('pointerleave', esconder);
        const centro = [x(0) + comprimento, yb];
        marca.addEventListener('focus', () => mostrar(...centro));
        marca.addEventListener('blur', esconder);
        svg.append(marca,
          s('text', { x: x(0) + comprimento + 6, y: yb + alturaBarra / 2, class: 'valor-barra', 'dominant-baseline': 'middle' }, formatar(barra.valor)),
          alvo);
        yb += alturaBarra + vao;
      }
      topo += alturaGrupo(grupo) + 14;
    }
    svg.append(s('line', { x1: x(0), x2: x(0), y1: m.topo, y2: base, class: 'eixo' }));
    if (referencia) {
      svg.append(
        s('line', { x1: x(referencia.valor), x2: x(referencia.valor), y1: m.topo, y2: base, class: 'referencia' }),
        s('text', { x: x(referencia.valor) + 4, y: base - 6, class: 'rotulo-referencia' }, referencia.rotulo));
    }
    area.replaceChildren(svg, area.querySelector('.dica'));
  });
}

export function tabela(colunas, linhas, legendaTabela) {
  return el('div', { class: 'tabela-rolagem' },
    el('table', {},
      el('caption', { class: 'visualmente-oculto' }, legendaTabela),
      el('thead', {}, el('tr', {}, colunas.map((c) => el('th', { scope: 'col', class: c.num ? 'num' : undefined }, c.titulo)))),
      el('tbody', {}, linhas.map((linha) => el('tr', {}, colunas.map((c, i) =>
        el(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : undefined, class: c.num ? 'num' : undefined }, linha[c.chave])))))));
}
