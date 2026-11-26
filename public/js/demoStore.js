// Modo demonstração: as mesmas regras da API, executadas no navegador.
// Os códigos de erro e o formato das respostas espelham os do backend.
import { ApiError, ETAPAS, UNIDADES } from './dominio.js';

const CHAVE = 'orderflow-demo-v1';

// Quantidades em milésimos inteiros: 0.1 + 0.2 em float daria 0.30000000000000004.
const MIL = 1000;
const MAXIMO = 99999999999999; // numeric(14,3) do banco, em milésimos
const paraMil = (texto) => {
  const [inteiro, fracao = ''] = texto.split('.');
  return Number(inteiro) * MIL + Number(fracao.padEnd(3, '0'));
};
const deMil = (valor) => `${Math.trunc(valor / MIL)}.${String(valor % MIL).padStart(3, '0')}`;

// ---------- Validação (mesmas regras do zod no backend) ----------

const invalido = (campo, mensagem) => new ApiError(400, 'validacao', 'Dados inválidos.', [{ campo, mensagem }]);

function objeto(valor, permitidos) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) throw invalido('', 'Corpo inválido.');
  for (const chave of Object.keys(valor)) {
    if (!permitidos.includes(chave)) throw invalido(chave, 'Campo desconhecido.');
  }
  return valor;
}

function texto(valor, campo, max) {
  if (typeof valor !== 'string') throw invalido(campo, 'Informe um texto.');
  const limpo = valor.trim();
  if (limpo.length < 1 || limpo.length > max || limpo.includes('\0')) throw invalido(campo, `Use de 1 a ${max} caracteres.`);
  return limpo;
}

function decimal(valor, campo, { positivo = true } = {}) {
  const textoValor = typeof valor === 'number' ? String(valor) : valor;
  if (typeof textoValor !== 'string' || !/^\d{1,11}(\.\d{1,3})?$/.test(textoValor)) {
    throw invalido(campo, 'Use até 11 dígitos inteiros e 3 decimais.');
  }
  const milesimos = paraMil(textoValor);
  if (positivo && milesimos <= 0) throw invalido(campo, 'Deve ser maior que zero.');
  return milesimos;
}

function data(valor, campo) {
  if (valor === null) return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw invalido(campo, 'Data inválida.');
  const convertida = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(convertida.getTime()) || convertida.toISOString().slice(0, 10) !== valor) throw invalido(campo, 'Data inválida.');
  return valor;
}

function idValido(valor, campo = 'id') {
  if (!Number.isSafeInteger(valor) || valor <= 0) throw invalido(campo, 'Identificador inválido.');
  return valor;
}

function itensValidos(valor) {
  if (!Array.isArray(valor) || valor.length < 1 || valor.length > 100) throw invalido('itens', 'Informe de 1 a 100 insumos.');
  const vistos = new Set();
  return valor.map((item, indice) => {
    objeto(item, ['insumo_id', 'quantidade']);
    const insumoId = idValido(item.insumo_id, `itens.${indice}.insumo_id`);
    if (vistos.has(insumoId)) throw invalido('itens', 'Insumo repetido.');
    vistos.add(insumoId);
    return { insumo_id: insumoId, qtd: decimal(item.quantidade, `itens.${indice}.quantidade`) };
  });
}

function limiteValido(valor) {
  const limite = valor === undefined ? 20 : Number(valor);
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw invalido('limite', 'Use de 1 a 100.');
  return limite;
}

// ---------- Paginação por cursor, como no backend ----------

const ordemRecente = (a, b) => (a.criado_em === b.criado_em ? b.id - a.id : a.criado_em < b.criado_em ? 1 : -1);

function base64url(textoPuro) {
  return btoa(textoPuro).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodificarCursor(cursor) {
  try {
    const base = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const [criadoEm, id] = JSON.parse(atob(base + '='.repeat((4 - (base.length % 4)) % 4)));
    if (typeof criadoEm !== 'string' || !Number.isSafeInteger(id)) throw new Error('formato');
    return [criadoEm, id];
  } catch {
    throw new ApiError(400, 'cursor_invalido', 'Cursor inválido.');
  }
}

function paginar(lista, { limite, cursor }) {
  const tamanho = limiteValido(limite);
  let ordenada = [...lista].sort(ordemRecente);
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    const [criadoEm, id] = decodificarCursor(cursor);
    ordenada = ordenada.filter((x) => x.criado_em < criadoEm || (x.criado_em === criadoEm && x.id < id));
  }
  const pagina = ordenada.slice(0, tamanho);
  const ultimo = pagina.at(-1);
  return {
    pagina,
    proximo: ordenada.length > tamanho ? base64url(JSON.stringify([ultimo.criado_em, ultimo.id])) : null
  };
}

// ---------- Visões: mesmo formato JSON da API ----------

const verInsumo = (i) => ({
  id: i.id,
  nome: i.nome,
  unidade: i.unidade,
  saldo: deMil(i.saldo),
  estoque_minimo: deMil(i.minimo),
  abaixo_do_minimo: i.saldo < i.minimo,
  criado_em: i.criado_em,
  atualizado_em: i.atualizado_em
});

const verPedido = (p) => ({
  id: p.id,
  cliente: p.cliente,
  descricao: p.descricao,
  etapa: p.etapa,
  prazo: p.prazo,
  criado_em: p.criado_em,
  atualizado_em: p.atualizado_em
});

const verMovimentacao = (m) => ({
  id: m.id,
  insumo_id: m.insumo_id,
  pedido_id: m.pedido_id,
  tipo: m.tipo,
  quantidade: deMil(m.qtd),
  motivo: m.motivo,
  criado_em: m.criado_em
});

function verPedidoCompleto(db, pedido) {
  const itens = db.itens
    .filter((item) => item.pedido_id === pedido.id)
    .sort((a, b) => a.insumo_id - b.insumo_id)
    .map((item) => {
      const insumo = db.insumos.find((i) => i.id === item.insumo_id);
      return { insumo_id: item.insumo_id, nome: insumo.nome, unidade: insumo.unidade, quantidade: deMil(item.qtd) };
    });
  return { ...verPedido(pedido), itens };
}

// ---------- Regras de negócio sobre o estado ----------

function acharPedido(db, id) {
  const pedido = db.pedidos.find((p) => p.id === id);
  if (!pedido) throw new ApiError(404, 'nao_encontrado', 'Pedido não encontrado.');
  return pedido;
}

function acharInsumo(db, id) {
  const insumo = db.insumos.find((i) => i.id === id);
  if (!insumo) throw new ApiError(404, 'nao_encontrado', 'Insumo não encontrado.');
  return insumo;
}

function registrarEntrada(db, insumo, qtd, motivo, quando) {
  if (insumo.saldo + qtd > MAXIMO) throw new ApiError(422, 'valor_invalido', 'Um dos valores não é aceito pelo banco.');
  insumo.saldo += qtd;
  insumo.atualizado_em = quando;
  db.movs.push({ id: ++db.seq.mov, insumo_id: insumo.id, pedido_id: null, tipo: 'entrada', qtd, motivo, criado_em: quando });
}

function gravarItens(db, pedidoId, itens) {
  for (const item of itens) {
    if (!db.insumos.some((i) => i.id === item.insumo_id)) {
      throw new ApiError(422, 'insumo_inexistente', 'Um dos insumos não existe.');
    }
  }
  db.itens = db.itens.filter((item) => item.pedido_id !== pedidoId);
  for (const item of itens) db.itens.push({ pedido_id: pedidoId, insumo_id: item.insumo_id, qtd: item.qtd });
}

function novoPedido(db, { cliente, descricao, prazo, itens }, quando) {
  const pedido = { id: ++db.seq.pedido, cliente, descricao, etapa: 'fila', prazo, criado_em: quando, atualizado_em: quando };
  db.pedidos.push(pedido);
  gravarItens(db, pedido.id, itens);
  return pedido;
}

function avancar(db, pedido, etapa, quando) {
  const proxima = ETAPAS[ETAPAS.indexOf(pedido.etapa) + 1];
  if (etapa !== proxima) {
    throw new ApiError(409, 'transicao_invalida', `Não é possível ir de ${pedido.etapa} para ${etapa}.`,
      { etapa_atual: pedido.etapa, proxima_etapa: proxima ?? null });
  }
  if (etapa === 'preparo') {
    const itens = db.itens.filter((item) => item.pedido_id === pedido.id).sort((a, b) => a.insumo_id - b.insumo_id);
    if (itens.length === 0) throw new ApiError(409, 'pedido_sem_itens', 'O pedido não tem insumos.');
    const faltas = itens
      .map((item) => ({ item, insumo: db.insumos.find((i) => i.id === item.insumo_id) }))
      .filter(({ item, insumo }) => insumo.saldo < item.qtd)
      .map(({ item, insumo }) => ({ insumo_id: insumo.id, nome: insumo.nome, disponivel: deMil(insumo.saldo), necessario: deMil(item.qtd) }));
    if (faltas.length > 0) throw new ApiError(409, 'estoque_insuficiente', 'Estoque insuficiente.', faltas);
    for (const item of itens) {
      const insumo = db.insumos.find((i) => i.id === item.insumo_id);
      insumo.saldo -= item.qtd;
      insumo.atualizado_em = quando;
      db.movs.push({ id: ++db.seq.mov, insumo_id: insumo.id, pedido_id: pedido.id, tipo: 'saida', qtd: item.qtd, motivo: 'Início do preparo', criado_em: quando });
    }
  }
  pedido.etapa = etapa;
  pedido.atualizado_em = quando;
}

// ---------- Dados de exemplo, gerados pelas próprias regras ----------

function dadosDeExemplo(agora) {
  const db = { versao: 1, seq: { pedido: 0, insumo: 0, mov: 0 }, insumos: [], pedidos: [], itens: [], movs: [] };
  const atras = (dias, horas = 0) => new Date(agora.getTime() - (dias * 24 + horas) * 3600e3).toISOString();
  const emDias = (dias) => new Date(agora.getTime() + dias * 864e5).toISOString().slice(0, 10);

  const insumos = [
    ['Farinha de trigo', 'kg', '40', '10'],
    ['Açúcar refinado', 'kg', '25', '8'],
    ['Manteiga sem sal', 'kg', '12', '4'],
    ['Ovos', 'un', '120', '30'],
    ['Caixa kraft 20x20', 'un', '30', '15'],
    ['Fita de cetim', 'm', '50', '10']
  ];
  for (const [nome, unidade, saldo, minimo] of insumos) {
    const quando = atras(30);
    const insumo = { id: ++db.seq.insumo, nome, unidade, saldo: 0, minimo: paraMil(minimo), criado_em: quando, atualizado_em: quando };
    db.insumos.push(insumo);
    registrarEntrada(db, insumo, paraMil(saldo), 'Carga inicial', quando);
  }

  // [cliente, descrição, prazo em dias, criado há N dias, etapa final, itens]
  const pedidos = [
    ['Ana Souza', 'Bolo de aniversário 2 kg', 1, 6, 'entrega', [[1, '1.5'], [2, '0.8'], [3, '0.5'], [4, '12']]],
    ['Café Central', 'Cento de biscoitos amanteigados', 2, 4, 'acabamento', [[1, '2'], [2, '1'], [3, '1'], [5, '4']]],
    ['Bruno Lima', 'Torta de limão', 2, 3, 'preparo', [[1, '0.5'], [2, '0.4'], [3, '0.3'], [4, '6']]],
    ['Carla Dias', 'Docinhos para festa', -1, 5, 'fila', [[2, '1'], [3, '0.5']]],
    // Pede mais caixas do que há em estoque: mostra a validação ao iniciar o preparo.
    ['Escola Aurora', 'Kit lembrança com 30 caixas', 7, 2, 'fila', [[1, '3'], [2, '2'], [5, '30'], [6, '15']]],
    ['Marina Rocha', 'Bolo de casamento 3 andares', 10, 1, 'fila', [[1, '4'], [2, '3'], [3, '2'], [4, '36'], [6, '5']]],
    ['Padaria Sol', 'Pães doces (50 unidades)', 1, 0, 'fila', [[1, '5'], [2, '1.5'], [4, '10']]]
  ];
  for (const [cliente, descricao, prazo, dias, etapaFinal, itens] of pedidos) {
    const pedido = novoPedido(db, {
      cliente,
      descricao,
      prazo: emDias(prazo),
      itens: itens.map(([insumoId, qtd]) => ({ insumo_id: insumoId, qtd: paraMil(qtd) }))
    }, atras(dias));
    for (let passo = 1; passo <= ETAPAS.indexOf(etapaFinal); passo++) {
      avancar(db, pedido, ETAPAS[passo], atras(dias, -passo * 6));
    }
  }
  return db;
}

// ---------- Armazenamento e API pública ----------

function armazenamentoPadrao() {
  try {
    const storage = globalThis.localStorage;
    storage.getItem(CHAVE);
    return storage;
  } catch {
    return null; // Navegação privada ou bloqueio: os dados ficam só em memória.
  }
}

export function criarDemoStore({ storage = armazenamentoPadrao(), agora = () => new Date() } = {}) {
  let db = ler() ?? dadosDeExemplo(agora());
  salvar();

  function ler() {
    try {
      const textoSalvo = storage?.getItem(CHAVE);
      const salvo = textoSalvo ? JSON.parse(textoSalvo) : null;
      return salvo?.versao === 1 ? salvo : null;
    } catch {
      return null;
    }
  }

  function salvar() {
    try {
      storage?.setItem(CHAVE, JSON.stringify(db));
    } catch {
      // Sem espaço ou bloqueado: continua em memória.
    }
  }

  // Equivale à transação do banco: a operação roda numa cópia e só substitui o
  // estado se terminar sem erro. Um erro no meio não deixa estoque pela metade.
  function transacao(operacao) {
    const copia = structuredClone(db);
    const resultado = operacao(copia, agora().toISOString());
    db = copia;
    salvar();
    return resultado;
  }

  return {
    async listarPedidos({ etapa, limite, cursor } = {}) {
      if (!ETAPAS.includes(etapa)) throw invalido('etapa', 'Etapa inválida.');
      const { pagina, proximo } = paginar(db.pedidos.filter((p) => p.etapa === etapa), { limite, cursor });
      return { dados: pagina.map(verPedido), proximo_cursor: proximo };
    },

    async buscarPedido(id) {
      return verPedidoCompleto(db, acharPedido(db, idValido(id)));
    },

    async criarPedido(dados) {
      objeto(dados, ['cliente', 'descricao', 'prazo', 'itens']);
      const valido = {
        cliente: texto(dados.cliente, 'cliente', 120),
        descricao: texto(dados.descricao, 'descricao', 500),
        prazo: dados.prazo === undefined ? null : data(dados.prazo, 'prazo'),
        itens: itensValidos(dados.itens)
      };
      return transacao((estado, quando) => verPedidoCompleto(estado, novoPedido(estado, valido, quando)));
    },

    async editarPedido(id, dados) {
      idValido(id);
      objeto(dados, ['cliente', 'descricao', 'prazo', 'itens']);
      if (Object.keys(dados).length === 0) throw invalido('', 'Informe ao menos um campo.');
      const cliente = dados.cliente === undefined ? undefined : texto(dados.cliente, 'cliente', 120);
      const descricao = dados.descricao === undefined ? undefined : texto(dados.descricao, 'descricao', 500);
      const prazo = dados.prazo === undefined ? undefined : data(dados.prazo, 'prazo');
      const itens = dados.itens === undefined ? undefined : itensValidos(dados.itens);
      return transacao((estado, quando) => {
        const pedido = acharPedido(estado, id);
        if (pedido.etapa === 'entrega') throw new ApiError(409, 'pedido_entregue', 'Pedido em entrega não pode ser editado.');
        if (itens && pedido.etapa !== 'fila') {
          throw new ApiError(409, 'itens_ja_baixados', 'Os itens só podem mudar enquanto o pedido está na fila.');
        }
        if (cliente !== undefined) pedido.cliente = cliente;
        if (descricao !== undefined) pedido.descricao = descricao;
        if (prazo !== undefined) pedido.prazo = prazo;
        if (itens) gravarItens(estado, id, itens);
        pedido.atualizado_em = quando;
        return verPedidoCompleto(estado, pedido);
      });
    },

    async excluirPedido(id) {
      idValido(id);
      transacao((estado) => {
        const pedido = acharPedido(estado, id);
        if (pedido.etapa !== 'fila') throw new ApiError(409, 'pedido_iniciado', 'Só é possível excluir pedidos na fila.');
        estado.pedidos = estado.pedidos.filter((p) => p.id !== id);
        estado.itens = estado.itens.filter((item) => item.pedido_id !== id);
      });
      return null;
    },

    async mudarEtapa(id, etapa) {
      idValido(id);
      if (!ETAPAS.includes(etapa)) throw invalido('etapa', 'Etapa inválida.');
      return transacao((estado, quando) => {
        const pedido = acharPedido(estado, id);
        avancar(estado, pedido, etapa, quando);
        return verPedidoCompleto(estado, pedido);
      });
    },

    async listarInsumos() {
      const ordenados = [...db.insumos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id);
      return { dados: ordenados.map(verInsumo) };
    },

    async criarInsumo(dados) {
      objeto(dados, ['nome', 'unidade', 'estoque_minimo']);
      const nome = texto(dados.nome, 'nome', 120);
      if (!UNIDADES.includes(dados.unidade)) throw invalido('unidade', 'Unidade inválida.');
      const minimo = dados.estoque_minimo === undefined ? 0 : decimal(dados.estoque_minimo, 'estoque_minimo', { positivo: false });
      return transacao((estado, quando) => {
        if (estado.insumos.some((i) => i.nome === nome)) throw new ApiError(409, 'duplicado', 'Já existe um registro com esses dados.');
        const insumo = { id: ++estado.seq.insumo, nome, unidade: dados.unidade, saldo: 0, minimo, criado_em: quando, atualizado_em: quando };
        estado.insumos.push(insumo);
        return verInsumo(insumo);
      });
    },

    async registrarEntrada(id, dados) {
      idValido(id);
      objeto(dados, ['quantidade', 'motivo']);
      const qtd = decimal(dados.quantidade, 'quantidade');
      const motivo = texto(dados.motivo, 'motivo', 200);
      return transacao((estado, quando) => {
        const insumo = acharInsumo(estado, id);
        registrarEntrada(estado, insumo, qtd, motivo, quando);
        return verInsumo(insumo);
      });
    },

    async listarMovimentacoes(id, { limite, cursor } = {}) {
      acharInsumo(db, idValido(id));
      const { pagina, proximo } = paginar(db.movs.filter((m) => m.insumo_id === id), { limite, cursor });
      return { dados: pagina.map(verMovimentacao), proximo_cursor: proximo };
    },

    // Só existe no modo demonstração.
    async resetar() {
      db = dadosDeExemplo(agora());
      salvar();
    }
  };
}
