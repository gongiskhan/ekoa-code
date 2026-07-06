import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useSharedCollection,
  updateShared,
  createShared,
  notify,
  formatDate,
  appHref,
} from '../shared.js';
import {
  Button,
  Badge,
  DataTable,
  Select,
  SearchInput,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import {
  IconMailbox,
  IconMapPin,
  IconExternalLink,
  IconPlus,
  IconUpload,
  IconCheck,
  IconClose,
} from '../components/Icons.jsx';
import {
  tipoLabel,
  tipoTone,
  estadoLabel,
  estadoTone,
  hojeISO,
  tipoComprovativo,
  trackingStatusLabel,
} from './correio-logic.js';

function ekoaApi() {
  return typeof window !== 'undefined' ? window.__ekoa : null;
}

/* A suite não tem classe utilitária de monospace - usa-se a var de fonte inline,
 * como no Citius. */
const MONO = { fontFamily: 'var(--font-mono, ui-monospace, Menlo, Consolas, monospace)' };

/*
 * Gaveta de rastreio CTT. Consulta a rota de plataforma
 * `/api/tracking/consulta?tracking=<ref>` (via window.__ekoa.fetch, que injeta o
 * cabeçalho X-Ekoa-App-Id - legal-correio está na allowlist). A rota é um
 * ADAPTADOR: nesta máquina nenhum fornecedor CTT está configurado, pelo que
 * devolve `ok:false` com uma explicação; a gaveta trata os TRÊS desfechos -
 * cronologia de eventos (fornecedor ativo), nota "sem rastreio" (objetos Q/U/JA
 * ou sem informação) e indisponível (sem fornecedor). Em todos, o registo manual
 * mantém-se válido - é essa a mensagem honesta.
 */
function TrackingDrawer({ row, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, ok: false });

  useEffect(() => {
    let alive = true;
    (async () => {
      const api = ekoaApi();
      if (!api || typeof api.fetch !== 'function') {
        if (alive) setState({ loading: false, data: null, ok: false });
        return;
      }
      try {
        const res = await api.fetch(`/api/tracking/consulta?tracking=${encodeURIComponent(row.registoRef || '')}`);
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (alive) setState({ loading: false, data, ok: res.ok && !!(data && data.ok) });
      } catch {
        if (alive) setState({ loading: false, data: null, ok: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, [row.registoRef]);

  const events = state.data && Array.isArray(state.data.events) ? state.data.events : [];
  const hasEvents = state.ok && events.length > 0;
  const hasNota = state.ok && !hasEvents; // ok:true sem eventos -> objeto sem rastreio / sem info

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Rastreio do objeto" data-demo-target="correio-tracking" data-testid="correio-tracking-drawer">
        <div className="page-header" style={{ padding: 'var(--sp-5, 1.25rem)', marginBottom: 0 }}>
          <div>
            <h2 className="page-title" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>Rastreio do objeto</h2>
            <p className="page-subtitle" style={{ margin: 0 }}>
              <span style={MONO}>{row.registoRef || '—'}</span>
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Fechar" onClick={onClose}>
            <IconClose />
          </Button>
        </div>

        <div style={{ padding: '0 var(--sp-5, 1.25rem) var(--sp-5, 1.25rem)' }}>
          {state.loading ? (
            <div className="loading"><span className="spinner" aria-hidden="true" /><span>A consultar os CTT.</span></div>
          ) : hasEvents ? (
            <>
              <p className="resultado-ok" data-testid="correio-tracking-estado">
                Estado atual: {trackingStatusLabel(state.data.status)}
              </p>
              <ul className="dossie-timeline" data-testid="correio-tracking-timeline">
                {events.map((ev, i) => (
                  <li className="dossie-timeline-item" key={`${ev.date}-${i}`}>
                    <span className="dossie-timeline-date">{ev.date ? formatDate(ev.date) : '—'}</span>
                    <div className="dossie-timeline-body">
                      <span className="dossie-timeline-titulo">{ev.statusPt || '—'}</span>
                      {ev.location ? <span className="dossie-timeline-desc">{ev.location}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : hasNota ? (
            <p className="resultado-panel" data-testid="correio-tracking-nota" style={{ margin: 0 }}>
              {state.data.note || 'Este objeto não dispõe de informação de rastreio.'}
            </p>
          ) : (
            <div className="stack stack-3" data-testid="correio-tracking-indisponivel">
              <p className="resultado-erro" style={{ marginTop: 0 }}>
                Consulta CTT indisponível - o registo manual mantém-se válido.
              </p>
              {state.data && state.data.error ? (
                <p className="text-subtle text-xs" style={{ margin: 0 }}>{state.data.error}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ESTADOS = ['rascunho', 'expedido', 'entregue', 'devolvido'];

export default function ExpedientePage() {
  const { items: correio, loading, refresh } = useSharedCollection('correio');
  const { items: processos } = useSharedCollection('processos');

  const [fEstado, setFEstado] = useState('');
  const [texto, setTexto] = useState('');
  const [tracking, setTracking] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Um único input de ficheiro escondido; a linha-alvo é guardada antes de o abrir.
  const fileInputRef = useRef(null);
  const comprovativoRowRef = useRef(null);

  const processoById = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p));
    return map;
  }, [processos]);

  const rows = useMemo(() => {
    const needle = texto.trim().toLowerCase();
    let list = correio.slice();
    if (fEstado) list = list.filter((r) => (r.estado || 'rascunho') === fEstado);
    if (needle) {
      list = list.filter((r) => {
        const dest = (r.destinatario && r.destinatario.nome) || '';
        return (
          dest.toLowerCase().includes(needle) ||
          String(r.registoRef || '').toLowerCase().includes(needle) ||
          String(r.conteudoDescricao || '').toLowerCase().includes(needle)
        );
      });
    }
    return list.sort((a, b) => {
      const da = (a.datas && (a.datas.expedido || a.datas.entregue)) || '';
      const db = (b.datas && (b.datas.expedido || b.datas.entregue)) || '';
      return String(db).localeCompare(String(da));
    });
  }, [correio, fEstado, texto]);

  async function transicionar(row, novoEstado) {
    setBusyId(row.id);
    try {
      const datas = { ...(row.datas || {}) };
      if (novoEstado === 'expedido' && !datas.expedido) datas.expedido = hojeISO();
      if (novoEstado === 'entregue') datas.entregue = hojeISO();
      if (novoEstado === 'devolvido') datas.devolvido = hojeISO();
      await updateShared('correio', row.id, { estado: novoEstado, datas });
      await refresh();
      toast(`Estado atualizado para "${estadoLabel(novoEstado)}".`, { tone: 'ok' });
    } catch {
      toast('Não foi possível atualizar o estado.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  function pedirComprovativo(row) {
    comprovativoRowRef.current = row;
    if (fileInputRef.current) fileInputRef.current.click();
  }

  async function anexarComprovativo(fileList) {
    const row = comprovativoRowRef.current;
    comprovativoRowRef.current = null;
    const file = (fileList && fileList[0]) || null;
    if (!row || !file) return;
    const api = ekoaApi();
    if (!api || typeof api.uploadFile !== 'function') {
      toast('Carregamento indisponível neste contexto.', { tone: 'error' });
      return;
    }
    setBusyId(row.id);
    let uploaded = null;
    try {
      uploaded = await api.uploadFile(file);
      const doc = {
        nome: `Comprovativo ${row.registoRef || 'de registo'}`,
        tipo: tipoComprovativo(file),
        origem: 'legal-correio',
        data: hojeISO(),
        ficheiro: {
          fileId: uploaded.id,
          appId: window.__EKOA_APP_ID,
          url: uploaded.url,
          mime: uploaded.type,
          size: uploaded.size,
        },
        versao: 1,
      };
      if (row.processoId) doc.processoId = row.processoId;
      if (row.clienteId) doc.clienteId = row.clienteId;
      const created = await createShared('documentos', doc);
      await updateShared('correio', row.id, { comprovativoDocumentoId: created && created.id });
      // Notifica a espinha; se houver processo, a notificação liga ao dossiê.
      await notify({
        titulo: 'Comprovativo de registo arquivado',
        corpo: `${doc.nome} associado à carta para ${(row.destinatario && row.destinatario.nome) || 'destinatário'}.`,
        ...(row.processoId ? { href: appHref('legal-dossie', `processo/${row.processoId}`) } : {}),
      });
      await refresh();
      toast('Comprovativo arquivado no dossiê.', { tone: 'ok' });
    } catch {
      // Ficheiro subiu mas a linha falhou -> apaga o blob órfão (o registo é a verdade).
      if (uploaded && uploaded.id) {
        try {
          await api.deleteFile(uploaded.id);
        } catch {
          /* melhor-esforço */
        }
      }
      toast('Não foi possível arquivar o comprovativo.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const columns = [
    {
      key: 'tipo',
      label: 'Tipo',
      render: (r) => <Badge tone={tipoTone(r.tipo)}>{tipoLabel(r.tipo)}</Badge>,
    },
    {
      key: 'destinatario',
      label: 'Destinatário',
      render: (r) => (
        <div className="stack stack-1">
          <span className="text-strong">{(r.destinatario && r.destinatario.nome) || '(sem destinatário)'}</span>
          {r.destinatario && r.destinatario.morada ? (
            <span className="text-subtle text-xs row" style={{ alignItems: 'center', gap: 4 }}>
              <IconMapPin size={12} /> {r.destinatario.morada}
            </span>
          ) : null}
          {r.conteudoDescricao ? (
            <span className="text-subtle text-xs">{r.conteudoDescricao}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'processo',
      label: 'Processo',
      render: (r) => {
        if (!r.processoId) return <span className="text-subtle">—</span>;
        const p = processoById.get(r.processoId);
        const label = (p && p.numeroProcesso) || 'Processo';
        return (
          <a
            className="stat-link text-xs"
            href={appHref('legal-dossie', `processo/${r.processoId}`)}
            data-testid={`correio-processo-${r.id}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...MONO }}
          >
            {label} <IconExternalLink size={12} />
          </a>
        );
      },
    },
    {
      key: 'registoRef',
      label: 'Referência',
      render: (r) => <span className="text-xs" style={MONO} data-testid={`correio-ref-${r.id}`}>{r.registoRef || '—'}</span>,
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (r) => (
        <Badge tone={estadoTone(r.estado)} data-testid={`correio-estado-${r.id}`}>
          {estadoLabel(r.estado)}
        </Badge>
      ),
    },
    {
      key: 'datas',
      label: 'Datas',
      render: (r) => {
        const d = r.datas || {};
        return (
          <div className="stack stack-1 text-xs text-subtle">
            {d.expedido ? <span>Expedido: {formatDate(d.expedido)}</span> : null}
            {d.entregue ? <span>Entregue: {formatDate(d.entregue)}</span> : null}
            {d.devolvido ? <span>Devolvido: {formatDate(d.devolvido)}</span> : null}
            {!d.expedido && !d.entregue && !d.devolvido ? <span>—</span> : null}
          </div>
        );
      },
    },
    {
      key: 'acoes',
      label: 'Ações',
      render: (r) => {
        const estado = r.estado || 'rascunho';
        const busy = busyId === r.id;
        const sent = estado === 'expedido' || estado === 'entregue' || estado === 'devolvido';
        return (
          <div className="row row-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
            {estado === 'rascunho' ? (
              <Button size="sm" variant="secondary" disabled={busy} data-testid={`correio-expedir-${r.id}`} onClick={() => transicionar(r, 'expedido')}>
                Marcar expedido
              </Button>
            ) : null}
            {estado === 'expedido' ? (
              <>
                <Button size="sm" variant="secondary" disabled={busy} data-testid={`correio-entregue-${r.id}`} onClick={() => transicionar(r, 'entregue')}>
                  Marcar entregue
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} data-testid={`correio-devolvido-${r.id}`} onClick={() => transicionar(r, 'devolvido')}>
                  Devolvido
                </Button>
              </>
            ) : null}
            {sent ? (
              <Button size="sm" variant="ghost" data-testid={`correio-tracking-btn-${r.id}`} onClick={() => setTracking(r)}>
                Consultar tracking
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              data-testid={`correio-comprovativo-${r.id}`}
              data-demo-target="correio-comprovativo"
              onClick={() => pedirComprovativo(r)}
            >
              {r.comprovativoDocumentoId ? <><IconCheck size={14} /> Comprovativo</> : <><IconUpload size={14} /> Anexar comprovativo</>}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div data-testid="correio-expediente-page" data-demo-page="correio/expediente">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expediente</h1>
          <p className="page-subtitle">
            Correio registado associado aos processos. As transições de estado são manuais e
            honestas; o rastreio consulta os CTT quando disponível e a referência de registo
            mantém-se válida mesmo sem rastreio automático.
          </p>
        </div>
        <Link className="btn btn-primary" to="/nova" data-testid="correio-nova-cta">
          <IconPlus /> Nova carta
        </Link>
      </div>

      <div className="filters" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <Select data-testid="correio-filtro-estado" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos os estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{estadoLabel(e)}</option>
          ))}
        </Select>
        <SearchInput
          value={texto}
          onChange={setTexto}
          placeholder="Destinatário, referência ou assunto…"
          data-testid="correio-filtro-texto"
        />
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar o expediente.</span></div>
      ) : (
        <DataTable
          data-testid="correio-tabela"
          columns={columns}
          rows={rows}
          rowKey="id"
          empty={
            <EmptyState
              icon={<IconMailbox />}
              title="Sem correio"
              hint={fEstado || texto ? 'Nenhuma carta corresponde a este filtro.' : 'Registe a primeira carta em "Nova carta".'}
            />
          }
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        data-testid="correio-comprovativo-input"
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,application/pdf,image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          anexarComprovativo(e.target.files);
          e.target.value = '';
        }}
      />

      {tracking ? <TrackingDrawer row={tracking} onClose={() => setTracking(null)} /> : null}
    </div>
  );
}
