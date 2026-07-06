/*
 * Cliente do serviço de cálculos (legal-calculos) - CANÓNICO, sincronizado por
 * scripts/sync-legal-shared.mjs. Editar AQUI, nunca as cópias nos scaffolds.
 *
 * FRONTEIRA (P2-001): os consumidores (cobranças, injunções, honorários, peças)
 * chamam ESTE cliente - `calcularJuros` / `calcularTaxaJustica` calculam NO
 * SERVIDOR (rota POST /api/legal/calculos) e NUNCA importam o motor de juros nem
 * duplicam constantes de taxa (a fronteira é testada por grep na suite). Só o app
 * dono (legal-calculos) vendoriza o motor e calcula do lado do cliente, obtendo a
 * tabela por `obterTabela()`.
 *
 * A plataforma injecta `window.__ekoa.fetch`, que acrescenta o cabeçalho
 * X-Ekoa-App-Id (a rota está limitada à allowlist da suite legal). Fora da
 * plataforma (sem `fetch`), as funções devolvem `{ ok:false, error }` - honestas,
 * nunca um total inventado.
 */
import { createShared, getShared } from './shared.js';

const ENDPOINT = '/api/legal/calculos';

function ekoaApi() {
  return (typeof window !== 'undefined' && window.__ekoa) ? window.__ekoa : null;
}

/* POST à rota de cálculos; normaliza os três desfechos (indisponível / erro do
 * servidor / sucesso) num único envelope `{ ok, ... }`. */
async function postCalculos(tipo, params) {
  const api = ekoaApi();
  if (!api || typeof api.fetch !== 'function') {
    return { ok: false, error: 'Serviço de cálculos indisponível fora da plataforma.' };
  }
  let res;
  let data = null;
  try {
    res = await api.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, params: params || {} }),
    });
    try { data = await res.json(); } catch { data = null; }
  } catch {
    return { ok: false, error: 'Falha ao contactar o serviço de cálculos.' };
  }
  if (!res.ok || !data || data.ok !== true) {
    return { ok: false, error: (data && data.error) || 'O cálculo falhou.' };
  }
  return data;
}

/*
 * Juros de mora calculados NO SERVIDOR (memória citada por troços). Para os
 * consumidores. Params: { valor|capitalCentavos, dataVencimento, dataFim,
 * tipoJuro:'civil'|'comercial'|'estado' }.
 * Devolve `{ ok, resultado, avisoTabelas }` ou `{ ok:false, error }`.
 */
export function calcularJuros(params) {
  return postCalculos('juros', params);
}

/*
 * Taxa de justiça calculada NO SERVIDOR. Params: { valorAcao, tabela:'I-A'|'I-B'|
 * 'I-C', ano }. Devolve `{ ok, resultado, avisoTabelas }` ou `{ ok:false, error }`.
 */
export function calcularTaxaJustica(params) {
  return postCalculos('custas', params);
}

/*
 * Tabela mergida (canónica + overlay do crawler) + alarme de atualização, para o
 * app dono calcular do lado do cliente com o motor vendorizado. Devolve
 * `{ ok, tabela, avisoTabelas }` ou `{ ok:false, error }`.
 */
export function obterTabela() {
  return postCalculos('tabela', {});
}

/*
 * Guarda a linha do cálculo na espinha partilhada (`calculos`): a memória fica
 * disponível para inserir numa peça/carta e para o histórico. `row` deve trazer
 * { tipo, input, resultado, trocos?, citas?, titulo? }; a data é carimbada aqui.
 */
export function guardarCalculo(row) {
  return createShared('calculos', { data: new Date().toISOString(), ...(row || {}) });
}

/* Lê uma linha de cálculo guardada, por id (para referenciar/inserir numa peça). */
export function referenciarCalculo(id) {
  return getShared('calculos', id);
}
