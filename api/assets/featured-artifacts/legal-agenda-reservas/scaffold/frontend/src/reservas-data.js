/*
 * Acesso à espinha PARTILHADA para a página pública de reservas — thin wrapper
 * sobre `window.__ekoa.shared` (injectado pela plataforma). Deliberadamente
 * INDEPENDENTE do `shared.js` da suite: o artefacto público não importa a
 * moldura partilhada nem a máquina de sementeira; só precisa de ler as colecções
 * para calcular horários e de criar/actualizar a SUA reserva.
 *
 * O owner é resolvido do lado do servidor a partir do X-Ekoa-App-Id (o app é
 * `sharedData: true`), pelo que estas chamadas atingem a mesma espinha que a
 * app de equipa `legal-agenda` — sem token, sem credenciais no cliente.
 */
function api() {
  if (typeof window !== 'undefined' && window.__ekoa && window.__ekoa.shared) return window.__ekoa.shared;
  return null;
}

export async function listShared(collection) {
  const a = api();
  if (!a || typeof a.list !== 'function') return [];
  const r = await a.list(collection);
  return Array.isArray(r) ? r : [];
}

export async function getShared(collection, id) {
  const a = api();
  if (!a || typeof a.get !== 'function') return null;
  return a.get(collection, id);
}

export async function createShared(collection, data) {
  const a = api();
  if (!a || typeof a.create !== 'function') return null;
  return a.create(collection, data);
}

export async function deleteShared(collection, id) {
  const a = api();
  if (!a || typeof a.delete !== 'function') return false;
  return a.delete(collection, id);
}

export async function updateShared(collection, id, patch) {
  const a = api();
  if (!a || typeof a.update !== 'function') return null;
  return a.update(collection, id, patch);
}

/* ---------- datas / horas (relógio de parede local) ---------- */

function pad2(n) { return String(n).padStart(2, '0'); }

export function ymdLocal(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/* Instante local 'YYYY-MM-DDTHH:mm:ss' — o referencial em que o motor compara `agora`. */
export function agoraLocal() {
  const d = new Date();
  return `${ymdLocal(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/* Instante local dentro de `minutos` a partir de agora (para expiraEm do hold). */
export function daquiA(minutos) {
  const d = new Date(Date.now() + minutos * 60000);
  return `${ymdLocal(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/* Os próximos `n` dias (hoje incluído) como 'YYYY-MM-DD'. */
export function proximosDias(n) {
  const hoje = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i);
    return ymdLocal(d);
  });
}

/* 'YYYY-MM-DDTHH:mm:ss' -> 'HH:MM'. */
export function horaDe(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function rotuloDataCurto(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return { dow: '', num: ymd };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return { dow: DOW[d.getDay()], num: String(Number(m[3])) };
}

export function rotuloDataLongo(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DOW[d.getDay()]}, ${Number(m[3])} de ${MES[d.getMonth()]}`;
}

/* Formata um valor em euros, PT-PT. */
export function formatEur(v) {
  if (v == null || Number.isNaN(Number(v))) return '';
  try { return Number(v).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }); }
  catch { return `${Number(v).toFixed(2)} €`; }
}
