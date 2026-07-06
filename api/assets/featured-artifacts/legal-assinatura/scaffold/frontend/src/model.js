/*
 * Rótulos, tons e utilitários de apresentação partilhados pelas páginas de
 * legal-assinatura. A lógica de estados vive no motor (engine/assinatura.mjs);
 * aqui só o vocabulário de UI (PT-PT) e um par de utilitários do browser.
 */

/** Rótulo humano do estado do envelope. */
export const ESTADO_LABEL = {
  rascunho: 'Rascunho',
  pronto: 'Pronto a assinar',
  em_assinatura: 'Em assinatura',
  concluido: 'Concluído',
  recusado: 'Recusado',
  anulado: 'Anulado',
};

/** Tom do distintivo (Badge) por estado do envelope. */
export const ESTADO_TONE = {
  rascunho: 'neutral',
  pronto: 'info',
  em_assinatura: 'media',
  concluido: 'ok',
  recusado: 'alta',
  anulado: 'neutral',
};

/** Rótulo do estado de um signatário. */
export const SIG_ESTADO_LABEL = {
  pendente: 'Pendente',
  assinado: 'Assinado',
  recusado: 'Recusou',
};

export const SIG_ESTADO_TONE = {
  pendente: 'media',
  assinado: 'ok',
  recusado: 'alta',
};

/** Impressão digital SHA-256 (hex) de bytes ou texto. Usa a Web Crypto API. */
export async function sha256Hex(input) {
  let data;
  if (typeof input === 'string') data = new TextEncoder().encode(input);
  else if (input instanceof Uint8Array) data = input;
  else data = new Uint8Array(input);

  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback determinístico (contextos sem Web Crypto - nunca em localhost/https).
  // FNV-1a de 32 bits expandido para 64 hex, só para manter a forma de hash válida.
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const base = h.toString(16).padStart(8, '0');
  return base.repeat(8).slice(0, 64);
}

/** ISO agora. */
export function agoraISO() {
  return new Date().toISOString();
}
