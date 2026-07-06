import { useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useSharedCollection,
  updateShared,
  createShared,
  formatDate,
  formatDateTime,
} from '../shared.js';
import { prazoArquivo, aplicabilidade } from '../engine/kyc.mjs';
import {
  Button,
  Badge,
  Field,
  Input,
  EmptyState,
  Skeleton,
  toast,
} from '../components/ui.jsx';
import {
  IconChevronRight,
  IconShieldCheck,
  IconShieldAlert,
  IconCheck,
  IconUpload,
  IconDownload,
  IconFileText,
} from '../components/Icons.jsx';
import {
  RISCO_TONE,
  RISCO_LABEL,
  ESTADO_LABEL,
  ESTADO_TONE,
  RCBE_ESTADO_LABEL,
  RCBE_ESTADO_TONE,
  TIPO_CLIENTE_LABEL,
  PAIS_RISCO_LABEL,
  NATUREZA_LABEL,
  SERVICO_LABEL,
  todayStr,
  nowIso,
} from './kyc-helpers.js';

const EVENTO_LABEL = { criada: 'Criada', aprovada: 'Aprovada', recusada: 'Recusada' };
const EVENTO_TONE = { criada: 'info', aprovada: 'ok', recusada: 'neutral' };

function ekoa() {
  return typeof window !== 'undefined' ? window.__ekoa : null;
}
function appId() {
  return typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
}

/* Classificação mínima do tipo de um ficheiro (só para o ícone/rótulo). */
function tipoFromFile(file) {
  const mime = String((file && file.type) || '').toLowerCase();
  const name = String((file && file.name) || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'imagem';
  return 'outro';
}

/* Linha de um documento capturado: nome, descarga e um campo de validade
 * (data de validade do documento de identificação). */
function DocRow({ doc, onValidade }) {
  const ficheiro = doc.ficheiro || null;
  return (
    <li className="doc-entry" data-testid={`kyc-doc-${doc.id}`} style={{ borderTop: '1px solid var(--line-1)', padding: 'var(--sp-3, 0.75rem) 0' }}>
      <div className="documento-item" style={{ alignItems: 'flex-start' }}>
        <span className="row-icon" aria-hidden="true" style={{ marginTop: 2 }}><IconFileText size={18} /></span>
        <div className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
          <span className="documento-nome text-strong">{doc.nome || '(sem nome)'}</span>
          <span className="text-subtle text-xs">Capturado {formatDate(doc.data || doc.createdAt)}</span>
        </div>
        <div className="row row-2" style={{ flexShrink: 0, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Field label="Validade">
            <Input
              type="date"
              data-testid={`kyc-doc-validade-${doc.id}`}
              value={doc.validade || ''}
              onChange={(e) => onValidade(doc, e.target.value)}
            />
          </Field>
          {ficheiro && ficheiro.url ? (
            <a className="btn btn-ghost btn-sm" href={ficheiro.url} target="_blank" rel="noopener noreferrer" download={doc.nome || undefined} data-testid={`kyc-doc-download-${doc.id}`}>
              <IconDownload size={14} /> Descarregar
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function FichaDetailPage() {
  const { id } = useParams();
  const { items: fichas, loading, refresh } = useSharedCollection('kyc_fichas');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: eventos, refresh: refreshEventos } = useSharedCollection('kyc_eventos');
  const { items: documentos, refresh: refreshDocs } = useSharedCollection('documentos');

  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState(false);

  const ficha = useMemo(() => fichas.find((f) => f.id === id) || null, [fichas, id]);
  const cliente = useMemo(() => (ficha ? clientes.find((c) => c.id === ficha.clienteId) || null : null), [clientes, ficha]);

  const timeline = useMemo(
    () => eventos.filter((e) => e.fichaId === id).sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))),
    [eventos, id],
  );

  // Documentos capturados por este módulo para o cliente da ficha.
  const docs = useMemo(
    () => (ficha ? documentos.filter((d) => d.origem === 'legal-kyc' && d.clienteId === ficha.clienteId) : []),
    [documentos, ficha],
  );

  const aplic = ficha && ficha.tipoServico ? aplicabilidade(ficha.tipoServico) : null;
  const emAnalise = ficha && (ficha.estado || 'em_analise') === 'em_analise';

  async function registarEvento(tipo, detalhe) {
    await createShared('kyc_eventos', { fichaId: id, tipo, data: nowIso(), detalhe });
  }

  async function aprovar() {
    if (!ficha) return;
    setActing(true);
    try {
      const arquivarAte = prazoArquivo(todayStr());
      await updateShared('kyc_fichas', id, { estado: 'aprovada', arquivarAte });
      await registarEvento('aprovada', `Aprovada. Conservação até ${formatDate(arquivarAte)} (art. 51.º).`);
      await refresh();
      await refreshEventos();
      toast('Ficha aprovada.', { tone: 'ok' });
    } catch (e) {
      toast((e && e.message) || 'Não foi possível aprovar a ficha.', { tone: 'error' });
    } finally {
      setActing(false);
    }
  }

  async function recusar() {
    if (!ficha) return;
    setActing(true);
    try {
      await updateShared('kyc_fichas', id, { estado: 'recusada' });
      await registarEvento('recusada', 'Ficha recusada na diligência.');
      await refresh();
      await refreshEventos();
      toast('Ficha recusada.', { tone: 'ok' });
    } catch (e) {
      toast((e && e.message) || 'Não foi possível recusar a ficha.', { tone: 'error' });
    } finally {
      setActing(false);
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0 || !ficha) return;
    const api = ekoa();
    if (!api || typeof api.uploadFile !== 'function') {
      toast('Carregamento indisponível neste contexto.', { tone: 'error' });
      return;
    }
    setUploading(true);
    let ok = 0;
    for (const file of files) {
      let uploaded = null;
      try {
        uploaded = await api.uploadFile(file);
        await createShared('documentos', {
          nome: file.name,
          tipo: tipoFromFile(file),
          clienteId: ficha.clienteId,
          origem: 'legal-kyc',
          data: todayStr(),
          validade: '',
          ficheiro: { fileId: uploaded.id, appId: appId(), url: uploaded.url, mime: uploaded.type, size: uploaded.size },
          versao: 1,
        });
        ok += 1;
      } catch {
        if (uploaded && uploaded.id) {
          try { await api.deleteFile(uploaded.id); } catch { /* melhor-esforço */ }
        }
      }
    }
    setUploading(false);
    await refreshDocs();
    if (ok > 0) toast(ok === 1 ? 'Documento capturado.' : `${ok} documentos capturados.`, { tone: 'ok' });
    if (ok < files.length) toast('Alguns ficheiros não foram capturados.', { tone: 'error' });
  }

  async function setValidade(doc, value) {
    try {
      await updateShared('documentos', doc.id, { validade: value });
      await refreshDocs();
    } catch {
      toast('Não foi possível atualizar a validade.', { tone: 'error' });
    }
  }

  if (loading && !ficha) {
    return <div data-testid="ficha-detail"><Skeleton lines={6} /></div>;
  }

  if (!ficha) {
    return (
      <div data-testid="ficha-detail">
        <EmptyState
          icon={<IconShieldAlert />}
          title="Ficha não encontrada"
          hint="A ficha pode ter sido removida ou o endereço está incorreto."
          action={<Link className="btn btn-secondary" to="/">Voltar às fichas</Link>}
        />
      </div>
    );
  }

  const fatores = Array.isArray(ficha.riscoBreakdown) ? ficha.riscoBreakdown : [];
  const rcbe = ficha.rcbe || { estado: 'pendente' };

  return (
    <div data-testid="ficha-detail">
      {/* Migalhas + cabeçalho */}
      <nav className="row row-1 text-subtle text-xs" aria-label="Migalhas" style={{ alignItems: 'center', marginBottom: 'var(--sp-3, 0.75rem)' }}>
        <Link to="/" className="stat-link">Fichas</Link>
        <IconChevronRight size={12} />
        <span>{cliente ? cliente.nome : '(cliente removido)'}</span>
      </nav>

      <div className="page-header">
        <div>
          <h1 className="page-title">{cliente ? cliente.nome : 'Ficha de diligência'}</h1>
          <p className="page-subtitle row row-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={ESTADO_TONE[ficha.estado] || 'neutral'} data-testid="ficha-estado">{ESTADO_LABEL[ficha.estado] || ficha.estado}</Badge>
            <Badge tone={RISCO_TONE[ficha.risco] || 'neutral'} data-testid="ficha-risco">{RISCO_LABEL[ficha.risco] || ficha.risco}</Badge>
          </p>
        </div>
        {emAnalise ? (
          <div className="row row-2">
            <Button variant="secondary" data-testid="ficha-recusar" onClick={recusar} disabled={acting}>
              <IconShieldAlert size={14} /> Recusar
            </Button>
            <Button data-testid="ficha-aprovar" onClick={aprovar} disabled={acting}>
              <IconCheck size={14} /> {acting ? 'A processar.' : 'Aprovar'}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="prazos-layout" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        {/* ---- Coluna principal: risco + RCBE + documentos ---- */}
        <div className="stack stack-6">
          <section className="card" aria-label="Avaliação de risco">
            <h2 className="card-title">Avaliação de risco</h2>
            <table className="data-table" data-testid="ficha-breakdown" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <tbody>
                <tr><td>Valor-base</td><td className="numeric">10</td></tr>
                {fatores.map((f, i) => (
                  <tr key={i} className={f.peso > 0 ? 'text-strong' : undefined}>
                    <td>{f.fator}<span className="text-subtle text-xs" style={{ display: 'block' }}>{f.nota}</span></td>
                    <td className="numeric">{f.peso > 0 ? `+${f.peso}` : '0'}</td>
                  </tr>
                ))}
                <tr className="text-strong"><td>Total</td><td className="numeric" data-testid="ficha-score">{ficha.score ?? '—'}</td></tr>
              </tbody>
            </table>
          </section>

          <section className="card" aria-label="Beneficiário efetivo">
            <div className="row row-space-between" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h2 className="card-title">Beneficiário efetivo (RCBE)</h2>
              <Badge tone={RCBE_ESTADO_TONE[rcbe.estado] || 'neutral'}>{RCBE_ESTADO_LABEL[rcbe.estado] || rcbe.estado}</Badge>
            </div>
            {rcbe.dataConsulta ? <p className="field-hint">Consultado em {formatDate(rcbe.dataConsulta)}.</p> : null}
            {Array.isArray(rcbe.beneficiarios) && rcbe.beneficiarios.length > 0 ? (
              <ul className="passos-list" data-testid="ficha-beneficiarios" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
                {rcbe.beneficiarios.map((b, i) => (
                  <li key={i} className="passo-item">
                    <span className="passo-nota" style={{ flex: 1 }}>
                      <span className="text-strong">{b.nome}</span>
                      {b.nif ? <span className="text-subtle text-xs" style={{ display: 'block' }}>NIF {b.nif}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">{rcbe.notas || 'Sem beneficiários registados.'}</p>
            )}
          </section>

          <section className="card" aria-label="Documentos de identificação">
            <h2 className="card-title">Documentos de identificação</h2>
            <p className="card-subtitle">Capture cópias dos documentos de identificação e registe a respetiva validade.</p>
            <div className="row row-2" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <Button variant="secondary" data-testid="kyc-doc-upload" onClick={() => inputRef.current && inputRef.current.click()} disabled={uploading}>
                <IconUpload size={14} /> {uploading ? 'A carregar.' : 'Capturar documento'}
              </Button>
              <input
                ref={inputRef}
                data-testid="kyc-doc-input"
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
                style={{ display: 'none' }}
                onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
              />
            </div>
            {docs.length === 0 ? (
              <p className="field-hint" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>Sem documentos capturados.</p>
            ) : (
              <ul className="documentos-list" data-testid="kyc-docs-lista" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                {docs.map((d) => <DocRow key={d.id} doc={d} onValidade={setValidade} />)}
              </ul>
            )}
          </section>
        </div>

        {/* ---- Coluna lateral: dados + auditoria ---- */}
        <div className="stack stack-6">
          <section className="card" aria-label="Dados da ficha">
            <h2 className="card-title">Dados</h2>
            <table className="data-table" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <tbody>
                <tr><td>Tipo de cliente</td><td>{TIPO_CLIENTE_LABEL[ficha.tipoCliente] || ficha.tipoCliente}</td></tr>
                <tr><td>Serviço</td><td>{SERVICO_LABEL[ficha.tipoServico] || '—'}</td></tr>
                <tr><td>PEP</td><td>{ficha.pep ? 'Sim' : 'Não'}</td></tr>
                <tr><td>País de risco</td><td>{PAIS_RISCO_LABEL[ficha.paisRisco] || '—'}</td></tr>
                <tr><td>Natureza</td><td>{NATUREZA_LABEL[ficha.naturezaOperacao] || '—'}</td></tr>
                <tr><td>Relação</td><td>{ficha.relacaoPresencial === false ? 'À distância' : 'Presencial'}</td></tr>
                <tr>
                  <td>Arquivo até</td>
                  <td data-testid="ficha-arquivar-ate">{ficha.arquivarAte ? formatDate(ficha.arquivarAte) : 'Após aprovação'}</td>
                </tr>
              </tbody>
            </table>
            {aplic ? (
              <div className={`citius-resultado ${aplic.aplica ? 'is-review' : 'is-erro'}`} role="note" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
                <span className="citius-resultado-icon" aria-hidden="true">{aplic.aplica ? <IconShieldCheck /> : <IconShieldAlert />}</span>
                <span className="citius-resultado-text">
                  <span className="citius-resultado-strong">{aplic.aplica ? 'Sujeito aos deveres (art. 4.º)' : 'Fora do âmbito (art. 4.º)'}</span>
                  <span className="citius-resultado-meta">{aplic.fundamento}</span>
                </span>
              </div>
            ) : null}
          </section>

          <section className="card" aria-label="Registo de auditoria">
            <h2 className="card-title">Auditoria</h2>
            <p className="card-subtitle">Registo cronológico e imutável da ficha.</p>
            {timeline.length === 0 ? (
              <p className="field-hint">Sem eventos registados.</p>
            ) : (
              <ul className="passos-list" data-testid="kyc-timeline" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
                {timeline.map((ev) => (
                  <li key={ev.id} className="passo-item" data-testid={`kyc-evento-${ev.tipo}`}>
                    <span className="passo-nota" style={{ flex: 1 }}>
                      <Badge tone={EVENTO_TONE[ev.tipo] || 'neutral'}>{EVENTO_LABEL[ev.tipo] || ev.tipo}</Badge>
                      {ev.detalhe ? <span className="text-subtle text-xs" style={{ display: 'block', marginTop: 'var(--sp-1, 0.25rem)' }}>{ev.detalhe}</span> : null}
                    </span>
                    <span className="passo-data text-xs">{formatDateTime(ev.data)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
