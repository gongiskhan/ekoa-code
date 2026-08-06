/* Componentes e helpers de DOMÍNIO partilhados pelas páginas. */
import { Badge } from './ui.jsx';
import { tr, useLang } from '../i18n.js';
import { formatEur } from '../engine/dinheiro.mjs';
import { diasAtraso, parseDia } from '../engine/datas.mjs';

/** Rótulo + tom visual de cada estado de dívida/prestação. */
export const ESTADOS = {
  aberta: { pt: 'Em aberto', en: 'Open', tone: 'info' },
  parcial: { pt: 'Parcialmente paga', en: 'Partially paid', tone: 'accent' },
  paga: { pt: 'Paga', en: 'Paid', tone: 'ok' },
  promessa: { pt: 'Promessa de pagamento', en: 'Promise to pay', tone: 'warn' },
  disputada: { pt: 'Disputada', en: 'Disputed', tone: 'warn' },
  litigio: { pt: 'Em contencioso', en: 'In litigation', tone: 'danger' },
  incobravel: { pt: 'Incobrável', en: 'Written off', tone: 'neutral' },
  pausada: { pt: 'Pausada', en: 'Paused', tone: 'neutral' },
};

export function rotuloEstado(estado) {
  const e = ESTADOS[estado] || { pt: estado || '—', en: estado || '—', tone: 'neutral' };
  return tr(e.pt, e.en);
}

export function EstadoBadge({ estado, vencida = false }) {
  useLang();
  const e = ESTADOS[estado] || { pt: estado || '—', en: estado || '—', tone: 'neutral' };
  if (vencida && (estado === 'aberta' || estado === 'parcial')) {
    return <Badge tone="danger">{tr('Vencida', 'Overdue')}</Badge>;
  }
  return <Badge tone={e.tone}>{tr(e.pt, e.en)}</Badge>;
}

/** True quando o item conta como vencido (em aberto e passado do prazo). */
export function estaVencida(item, hoje = new Date()) {
  if (!item) return false;
  if (item.estado !== 'aberta' && item.estado !== 'parcial') return false;
  const atraso = diasAtraso(item.dataVencimento, hoje);
  return Number.isFinite(atraso) && atraso > 0;
}

/** Data 'YYYY-MM-DD'/ISO em formato local do idioma atual. */
export function formatData(value) {
  const d = parseDia(value);
  if (!d) return '—';
  return d.toLocaleDateString(tr('pt-PT', 'en-GB'), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Data + hora locais. */
export function formatDataHora(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(tr('pt-PT', 'en-GB'), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Euros no idioma atual. */
export function eur(value) {
  return formatEur(value, tr('pt', 'en'));
}

/** Resolve o perfil de um cliente: overlay -> perfil; sem overlay, o 1.º perfil. */
export function resolverPerfil(overlayPorCliente, perfis, clienteId) {
  const overlay = overlayPorCliente.get ? overlayPorCliente.get(clienteId) : null;
  if (overlay && overlay.perfilId) {
    const p = perfis.find((x) => x.id === overlay.perfilId);
    if (p) return p;
  }
  return perfis[0] || null;
}

/** Mapa clienteId -> overlay (clientes_cobranca). */
export function indexarOverlay(overlays) {
  return new Map((overlays || []).map((o) => [o.clienteId, o]));
}

/** Mapa id -> cliente (espinha partilhada). */
export function indexarClientes(clientes) {
  return new Map((clientes || []).map((c) => [c.id, c]));
}

const TIPO_EVENTO = {
  'email-enviado': { pt: 'Email enviado', en: 'Email sent', tom: 'ok' },
  'email-rascunho': { pt: 'Email em rascunho', en: 'Email drafted', tom: null },
  'erro-envio': { pt: 'Falha no envio', en: 'Send failure', tom: 'erro' },
  'tarefa-criada': { pt: 'Tarefa criada', en: 'Task created', tom: null },
  'tarefa-concluida': { pt: 'Tarefa concluída', en: 'Task completed', tom: 'ok' },
  contacto: { pt: 'Contacto registado', en: 'Contact logged', tom: null },
  promessa: { pt: 'Promessa de pagamento', en: 'Promise to pay', tom: null },
  pagamento: { pt: 'Pagamento registado', en: 'Payment recorded', tom: 'ok' },
  estado: { pt: 'Alteração de estado', en: 'Status change', tom: null },
  sync: { pt: 'Sincronização Honorários', en: 'Fees sync', tom: null },
  match: { pt: 'Correspondência bancária', en: 'Bank match', tom: 'ok' },
  'match-revertido': { pt: 'Correspondência revertida', en: 'Match reversed', tom: 'erro' },
  juros: { pt: 'Juros aplicados', en: 'Interest applied', tom: null },
  ignorado: { pt: 'Passo ignorado', en: 'Step skipped', tom: null },
};

/** Linha do tempo imutável (por dívida ou por cliente). */
export function LinhaTempo({ eventos, vazio }) {
  useLang();
  const lista = [...(eventos || [])].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  if (!lista.length) return vazio || null;
  return (
    <div className="tempo" data-demo-target="linha-tempo">
      {lista.map((ev) => {
        const t = TIPO_EVENTO[ev.tipo] || { pt: ev.tipo, en: ev.tipo, tom: null };
        return (
          <div key={ev.id} className="tempo__item">
            <span className={`tempo__ponto ${t.tom === 'erro' ? 'tempo__ponto--erro' : t.tom === 'ok' ? 'tempo__ponto--ok' : ''}`} />
            <div className="tempo__corpo">
              <p className="tempo__titulo">{ev.titulo || tr(t.pt, t.en)}</p>
              {ev.detalhe ? <p className="tempo__detalhe">{ev.detalhe}</p> : null}
              {ev.conteudo ? <div className="tempo__conteudo">{ev.conteudo}</div> : null}
              <p className="tempo__data">{formatDataHora(ev.data)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
