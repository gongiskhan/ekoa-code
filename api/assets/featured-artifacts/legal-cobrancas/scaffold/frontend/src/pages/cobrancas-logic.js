/*
 * Adaptador de apresentação das Cobranças (rótulos, tons, ordenação). Sem regras
 * de negócio — essas vivem no motor `../engine/cobrancas.mjs`. Este ficheiro só
 * traduz estados/canais/escalões para o que a UI mostra e ordena as listas.
 */

import { diasAtraso, agingBucket, emAberto } from '../engine/cobrancas.mjs';

export const ESTADO_LABEL = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  paga: 'Paga',
  anulada: 'Anulada',
};

export const ESTADO_TONE = {
  pendente: 'warn',
  parcial: 'info',
  paga: 'ok',
  anulada: 'neutral',
};

export const METODO_LABEL = {
  stripe: 'Stripe (cartão)',
  'ifthenpay-mb': 'Multibanco',
  'ifthenpay-mbway': 'MB WAY',
  transferencia: 'Transferência',
};

export const CANAL_LABEL = {
  email: 'Email',
  whatsapp: 'WhatsApp',
};

/* Rótulo humano do atraso: "vence hoje", "vencida há N dias", "vence em N dias". */
export function atrasoLabel(dataVencimento, hoje = new Date()) {
  const d = diasAtraso(dataVencimento, hoje);
  if (!Number.isFinite(d)) return '—';
  if (d === 0) return 'vence hoje';
  if (d > 0) return `vencida há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  const n = -d;
  return `vence em ${n} ${n === 1 ? 'dia' : 'dias'}`;
}

/* Tom do distintivo de atraso, pelo escalão (0-30 aviso, 31-60 e 61+ perigo). */
export function atrasoTone(dataVencimento, hoje = new Date()) {
  const d = diasAtraso(dataVencimento, hoje);
  if (!Number.isFinite(d)) return 'neutral';
  if (d <= 0) return 'neutral';
  const bucket = agingBucket(d);
  if (bucket === '61+') return 'alta';
  if (bucket === '31-60') return 'media';
  return 'warn';
}

/*
 * Ordena a carteira para a tabela: primeiro as cobranças em aberto, das mais
 * vencidas para as menos; depois as restantes (pagas/anuladas) por vencimento
 * decrescente. Assim a primeira linha é sempre a mais crítica (âncora da demo).
 */
export function ordenarCobrancas(cobrancas, hoje = new Date()) {
  const lista = Array.isArray(cobrancas) ? [...cobrancas] : [];
  return lista.sort((a, b) => {
    const aAberto = emAberto(a);
    const bAberto = emAberto(b);
    if (aAberto !== bAberto) return aAberto ? -1 : 1;
    if (aAberto) {
      // Mais vencida primeiro (maior atraso).
      return (diasAtraso(b.dataVencimento, hoje) || 0) - (diasAtraso(a.dataVencimento, hoje) || 0);
    }
    return String(b.dataVencimento || '').localeCompare(String(a.dataVencimento || ''));
  });
}
