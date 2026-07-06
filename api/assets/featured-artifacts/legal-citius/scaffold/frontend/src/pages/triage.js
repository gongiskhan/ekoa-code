/*
 * Auxiliares partilhados pelas páginas da Caixa Citius (inbox / triagem /
 * histórico). Nenhuma lógica de prazos aqui: a contagem é sempre do motor
 * (`engine/prazo.mjs`) e o reconhecimento do ato vem do parser (`ATOS`).
 */
import { ATOS } from '../engine/citius-parser.mjs';

/* Uma notificação por triar (o único estado que aparece em "A rever"). */
export function isNeedsReview(n) {
  return !!n && n.estado === 'needs-review';
}

/*
 * Estado da notificação -> rótulo + tom do distintivo (PT-PT, sem emoji).
 *   needs-review -> "A rever" (âmbar)    matched/processada -> verde
 *   rejeitada    -> "Rejeitada" (neutro)
 */
export function estadoMeta(estado) {
  if (estado === 'matched') return { label: 'Prazo criado', tone: 'ok' };
  if (estado === 'processada') return { label: 'Processada', tone: 'ok' };
  if (estado === 'rejeitada') return { label: 'Rejeitada', tone: 'neutral' };
  if (estado === 'needs-review') return { label: 'A rever', tone: 'media' };
  return { label: estado || 'Por triar', tone: 'neutral' };
}

/*
 * Atos com prazo automático bem estabelecido (dias != null) -> opções do
 * seletor da triagem. A "Audiência" (dias null) fica de fora: não gera prazo.
 */
export const ATO_OPTIONS = ATOS
  .filter((a) => a.dias != null)
  .map((a) => ({ value: a.ato, label: `${a.ato} - ${a.dias} dias ${a.contagem}`, dias: a.dias, contagem: a.contagem }));

/* Regra de contagem (dias + contagem) de um ato, ou null se não gerar prazo. */
export function regraForAto(ato) {
  return ATO_OPTIONS.find((a) => a.value === ato) || null;
}

/* Uma data 'YYYY-MM-DD' bem formada (o input date só produz este formato). */
export function isValidDateStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* Excerto de uma linha do texto da notificação para a lista da caixa. */
export function excerpt(texto, max = 160) {
  const t = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
  if (!t) return 'Sem texto.';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/* Ordenação por recência (createdAt) descendente - mais recentes primeiro. */
export function byRecent(a, b) {
  const ta = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return tb - ta;
}
