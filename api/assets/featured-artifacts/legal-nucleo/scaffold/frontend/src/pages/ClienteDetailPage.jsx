import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useSharedCollection, updateShared, formatDate, formatDateTime,
} from '../shared.js';
import {
  Button, Badge, Field, Input, Select, Textarea, ConfirmDialog, DataTable, EmptyState, Skeleton, useToast,
} from '../components/ui.jsx';
import {
  IconChevronRight, IconEdit, IconTrash, IconPlus, IconMail, IconPhone, IconMapPin,
  IconBuilding, IconUserCircle, IconWhatsApp,
} from '../components/Icons.jsx';
import { ClienteFormModal, ProcessoFormModal } from './forms.jsx';
import { tipoLabel, RGPD_BASES, DeadlineBadge, EstadoBadge } from './widgets.jsx';

function emptyRgpd(cliente) {
  const r = (cliente && cliente.rgpd) || {};
  return { baseLicitude: r.baseLicitude || '', consentimento: r.consentimento || '', nota: r.nota || '' };
}

export default function ClienteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { items: clientes, loading, refresh } = useSharedCollection('clientes');
  const { items: processos, refresh: refreshProcessos } = useSharedCollection('processos');
  const { items: comunicacoes } = useSharedCollection('comunicacoes');
  const { items: tarefas } = useSharedCollection('tarefas');

  const cliente = useMemo(() => clientes.find((c) => c.id === id) || null, [clientes, id]);

  const [editing, setEditing] = useState(false);
  const [novoProcesso, setNovoProcesso] = useState(false);
  const [confirmArquivar, setConfirmArquivar] = useState(false);
  const [rgpd, setRgpd] = useState(() => emptyRgpd(cliente));
  const [rgpdSaving, setRgpdSaving] = useState(false);

  useEffect(() => { setRgpd(emptyRgpd(cliente)); }, [cliente]);

  const meusProcessos = useMemo(() => processos.filter((p) => p.clienteId === id), [processos, id]);
  const minhasComunicacoes = useMemo(() => (
    comunicacoes.filter((c) => c.clienteId === id)
      .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime())
      .slice(0, 5)
  ), [comunicacoes, id]);
  const minhasTarefas = useMemo(() => (
    tarefas.filter((t) => t.clienteId === id && t.estado !== 'concluida')
  ), [tarefas, id]);

  if (loading && !cliente) {
    return <div data-testid="cliente-detail"><Skeleton lines={6} /></div>;
  }

  if (!cliente) {
    return (
      <div data-testid="cliente-detail">
        <EmptyState
          icon={<IconUserCircle />}
          title="Cliente não encontrado"
          hint="O cliente pode ter sido removido ou arquivado."
          action={<Link to="/clientes" className="btn btn-primary">Voltar aos clientes</Link>}
        />
      </div>
    );
  }

  const saveRgpd = async () => {
    setRgpdSaving(true);
    try {
      await updateShared('clientes', cliente.id, {
        rgpd: {
          baseLicitude: rgpd.baseLicitude || null,
          consentimento: rgpd.consentimento || null,
          nota: rgpd.nota.trim() || null,
        },
      });
      await refresh();
      toast('Registo de tratamento de dados guardado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar o registo RGPD.', { tone: 'error' });
    } finally {
      setRgpdSaving(false);
    }
  };

  const arquivar = async () => {
    setConfirmArquivar(false);
    try {
      await updateShared('clientes', cliente.id, { arquivado: true });
      toast('Cliente arquivado.', { tone: 'ok' });
      navigate('/clientes');
    } catch {
      toast('Não foi possível arquivar o cliente.', { tone: 'error' });
    }
  };

  const Icon = cliente.tipo === 'empresa' ? IconBuilding : IconUserCircle;

  return (
    <div data-testid="cliente-detail">
      <nav className="row row-2 text-small text-subtle" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
        <Link to="/clientes" className="text-muted">Clientes</Link>
        <IconChevronRight />
        <span className="text-strong">{cliente.nome}</span>
      </nav>

      <div className="page-header">
        <div className="row row-3">
          <span className="row-icon" aria-hidden="true"><Icon size={22} /></span>
          <div>
            <h1 className="page-title">{cliente.nome}</h1>
            <p className="page-subtitle row row-2">
              <Badge tone="neutral">{tipoLabel(cliente.tipo)}</Badge>
              {cliente.arquivado ? <Badge tone="alta">Arquivado</Badge> : null}
              {cliente.nif ? <span className="numeric">NIF {cliente.nif}</span> : null}
            </p>
          </div>
        </div>
        <div className="page-actions">
          <Button variant="secondary" data-testid="cliente-editar" onClick={() => setEditing(true)}><IconEdit /> Editar</Button>
          {!cliente.arquivado ? (
            <Button variant="danger" data-testid="cliente-arquivar" onClick={() => setConfirmArquivar(true)}><IconTrash /> Arquivar</Button>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 'var(--sp-6, 1.5rem)', alignItems: 'start' }} className="dashboard-columns">
        <div className="stack stack-6">
          {/* Dados + morada */}
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>Dados de contacto</h2>
            <div className="dossie-id-grid">
              <div className="dossie-id-row"><span className="dossie-id-label">Email</span><span className="dossie-id-value row row-2">{cliente.email ? (<><IconMail /> {cliente.email}</>) : '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Telefone</span><span className="dossie-id-value row row-2">{cliente.telefone ? (<><IconPhone /> {cliente.telefone}</>) : '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">NIF</span><span className="dossie-id-value numeric">{cliente.nif || '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Morada</span><span className="dossie-id-value row row-2">{cliente.morada ? (<><IconMapPin /> {cliente.morada}</>) : '—'}</span></div>
            </div>
            {cliente.notas ? <p className="dossie-descricao">{cliente.notas}</p> : null}
          </section>

          {/* Processos do cliente */}
          <section className="card">
            <div className="row row-space-between" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
              <h2 className="card-title" style={{ margin: 0 }}>Processos ({meusProcessos.length})</h2>
              <Button variant="secondary" size="sm" data-testid="cliente-novo-processo" onClick={() => setNovoProcesso(true)}><IconPlus /> Novo processo</Button>
            </div>
            {meusProcessos.length === 0 ? (
              <p className="text-small text-subtle" style={{ margin: 0 }}>Sem processos para este cliente.</p>
            ) : (
              <DataTable
                columns={[
                  { key: 'numeroProcesso', label: 'Número', render: (p) => <span className="text-strong numeric">{p.numeroProcesso || '—'}</span> },
                  { key: 'area', label: 'Área', render: (p) => p.area || '—' },
                  { key: 'estado', label: 'Estado', render: (p) => <EstadoBadge estado={p.estado || 'ativo'} /> },
                  { key: 'abrir', label: '', align: 'right', width: '40px', render: () => <IconChevronRight /> },
                ]}
                rows={meusProcessos}
                rowKey="id"
                onRowClick={(p) => navigate(`/processos/${p.id}`)}
              />
            )}
          </section>

          {/* Comunicações recentes */}
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>Comunicações recentes</h2>
            {minhasComunicacoes.length === 0 ? (
              <p className="text-small text-subtle" style={{ margin: 0 }}>Sem comunicações associadas.</p>
            ) : (
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {minhasComunicacoes.map((c) => (
                  <li key={c.id} className="row row-3" style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', gap: 'var(--sp-3, 0.75rem)', alignItems: 'flex-start' }}>
                    <span className="row-icon" aria-hidden="true">{c.canal === 'whatsapp' ? <IconWhatsApp /> : <IconMail />}</span>
                    <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
                      <span className="text-small text-strong">{c.subject || c.fromName || c.fromAddr || 'Mensagem'}</span>
                      <span className="text-xs text-muted">{c.body}</span>
                      <span className="text-xs text-subtle numeric">{formatDateTime(c.receivedAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack stack-6">
          {/* RGPD */}
          <section className="card" data-testid="rgpd-block">
            <h2 className="card-title">Tratamento de dados (RGPD)</h2>
            <p className="card-subtitle" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>Base de licitude e consentimento do titular.</p>
            <div className="stack stack-4">
              <Field label="Base de licitude" htmlFor="rgpd-base">
                <Select id="rgpd-base" data-testid="rgpd-base" value={rgpd.baseLicitude} onChange={(e) => setRgpd({ ...rgpd, baseLicitude: e.target.value })}>
                  <option value="">Não definida.</option>
                  {RGPD_BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </Select>
              </Field>
              <Field label="Data de consentimento" htmlFor="rgpd-consentimento">
                <Input id="rgpd-consentimento" type="date" data-testid="rgpd-consentimento" value={rgpd.consentimento} onChange={(e) => setRgpd({ ...rgpd, consentimento: e.target.value })} />
              </Field>
              <Field label="Nota" htmlFor="rgpd-nota">
                <Textarea id="rgpd-nota" data-testid="rgpd-nota" rows={3} value={rgpd.nota} onChange={(e) => setRgpd({ ...rgpd, nota: e.target.value })} placeholder="Finalidade, prazo de conservação, observações." />
              </Field>
              <div className="row row-space-between">
                <span className="text-xs text-subtle">
                  {cliente.rgpd && cliente.rgpd.baseLicitude
                    ? `Registado: ${cliente.rgpd.consentimento ? formatDate(cliente.rgpd.consentimento) : 'sem data'}`
                    : 'Ainda sem registo.'}
                </span>
                <Button data-testid="rgpd-guardar" onClick={saveRgpd} disabled={rgpdSaving}>{rgpdSaving ? 'A guardar…' : 'Guardar RGPD'}</Button>
              </div>
            </div>
          </section>

          {/* Tarefas do cliente */}
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>Tarefas em aberto</h2>
            {minhasTarefas.length === 0 ? (
              <p className="text-small text-subtle" style={{ margin: 0 }}>Sem tarefas em aberto.</p>
            ) : (
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {minhasTarefas.map((t) => (
                  <li key={t.id} className="row row-space-between" style={{ padding: 'var(--sp-2, 0.5rem) var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', gap: 'var(--sp-3, 0.75rem)' }}>
                    <span className="text-small text-strong" style={{ minWidth: 0 }}>{t.titulo}</span>
                    <DeadlineBadge date={t.prazo} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ClienteFormModal
        open={editing}
        cliente={cliente}
        onClose={() => setEditing(false)}
        onSaved={async () => { setEditing(false); await refresh(); }}
      />

      <ProcessoFormModal
        open={novoProcesso}
        processo={null}
        clientes={clientes}
        fixedClienteId={cliente.id}
        onClose={() => setNovoProcesso(false)}
        onSaved={async (saved) => {
          setNovoProcesso(false);
          await refreshProcessos();
          if (saved && saved.id) navigate(`/processos/${saved.id}`);
        }}
      />

      <ConfirmDialog
        open={confirmArquivar}
        title="Arquivar cliente"
        message={`Arquivar "${cliente.nome}"? Deixa de aparecer na lista principal, mas os processos mantêm-se.`}
        confirmLabel="Arquivar"
        danger
        onConfirm={arquivar}
        onCancel={() => setConfirmArquivar(false)}
      />
    </div>
  );
}
