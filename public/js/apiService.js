import { API_URL } from '../config.js';
import { criarDemoStore } from './demoStore.js';
import { ApiError } from './dominio.js';

// Os dois modos expõem exatamente os mesmos métodos.
export function criarClienteHttp(urlBase, fetchFn = globalThis.fetch.bind(globalThis)) {
  const base = urlBase.replace(/\/+$/, '');

  async function requisitar(metodo, caminho, corpo) {
    let res;
    try {
      res = await fetchFn(base + caminho, {
        method: metodo,
        headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
      });
    } catch {
      throw new ApiError(0, 'sem_conexao', 'Não foi possível falar com a API.');
    }
    if (res.status === 204) return null;
    let dados = null;
    try {
      dados = await res.json();
    } catch {
      // Corpo vazio ou não JSON: tratado abaixo pelo status.
    }
    if (!res.ok) {
      const erro = dados?.erro;
      throw new ApiError(res.status, erro?.codigo ?? 'erro_http', erro?.mensagem ?? `Erro HTTP ${res.status}.`, erro?.detalhes);
    }
    return dados;
  }

  function consulta(params = {}) {
    const busca = new URLSearchParams();
    for (const [chave, valor] of Object.entries(params)) {
      if (valor !== undefined && valor !== null && valor !== '') busca.set(chave, String(valor));
    }
    const texto = busca.toString();
    return texto ? `?${texto}` : '';
  }

  const id = (valor) => encodeURIComponent(String(valor));

  return {
    listarPedidos: (params) => requisitar('GET', `/api/pedidos${consulta(params)}`),
    buscarPedido: (pedidoId) => requisitar('GET', `/api/pedidos/${id(pedidoId)}`),
    criarPedido: (dados) => requisitar('POST', '/api/pedidos', dados),
    editarPedido: (pedidoId, dados) => requisitar('PATCH', `/api/pedidos/${id(pedidoId)}`, dados),
    excluirPedido: (pedidoId) => requisitar('DELETE', `/api/pedidos/${id(pedidoId)}`),
    mudarEtapa: (pedidoId, etapa) => requisitar('PATCH', `/api/pedidos/${id(pedidoId)}/etapa`, { etapa }),
    listarInsumos: () => requisitar('GET', '/api/insumos'),
    criarInsumo: (dados) => requisitar('POST', '/api/insumos', dados),
    registrarEntrada: (insumoId, dados) => requisitar('POST', `/api/insumos/${id(insumoId)}/entradas`, dados),
    listarMovimentacoes: (insumoId, params) =>
      requisitar('GET', `/api/insumos/${id(insumoId)}/movimentacoes${consulta(params)}`)
  };
}

// ready, e não live: com o banco fora do ar, a API não serve para nada.
export async function detectarApi(urlBase, { fetchFn = globalThis.fetch.bind(globalThis), timeoutMs = 2500 } = {}) {
  if (!urlBase) return { ok: false, motivo: 'Nenhuma API configurada.' };
  try {
    const res = await fetchFn(`${urlBase.replace(/\/+$/, '')}/health/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store'
    });
    return res.ok ? { ok: true } : { ok: false, motivo: `A API respondeu ${res.status}.` };
  } catch {
    return { ok: false, motivo: 'A API não respondeu.' };
  }
}

// O modo é decidido uma vez por carregamento de página. Trocar no meio misturaria
// dados reais e locais na mesma tela.
let servico;
export function obterServico() {
  servico ??= (async () => {
    const deteccao = await detectarApi(API_URL);
    if (deteccao.ok) return { modo: 'api', api: criarClienteHttp(API_URL) };
    return { modo: 'demo', motivo: deteccao.motivo, api: criarDemoStore() };
  })();
  return servico;
}
