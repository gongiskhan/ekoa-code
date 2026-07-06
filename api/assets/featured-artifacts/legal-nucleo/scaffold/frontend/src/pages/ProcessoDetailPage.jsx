import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useSharedCollection, updateShared, appHref, formatDate,
} from '../shared.js';
import {
  Button, Badge, ConfirmDialog, EmptyState, Skeleton, useToast,
} from '../components/ui.jsx';
import {
  IconChevronRight, IconEdit, IconTrash, IconBook, IconFolder, IconExternalLink,
} from '../components/Icons.jsx';
import { ProcessoFormModal } from './forms.jsx';
import { EstadoBadge, DeadlineBadge } from './widgets.jsx';

export default function ProcessoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { items: processos, loading, refresh } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: prazos } = useSharedCollection('prazos');
  const { items: tarefas } = useSharedCollection('tarefas');
  const { items: eventos } = useSharedCollection('eventos');

  const processo = useMemo(() => processos.find((p) => p.id === id) || null, [processos, id]);
  const cliente = useMemo(() => (processo ? clientes.find((c) => c.id === processo.clienteId) : null), [clientes, processo]);

  const [editing, setEditing] = useState(false);
  const [confirmArquivar, setConfirmArquivar] = useState(false);

  const proximoPrazo = useMemo(() => (
    prazos
      .filter((p) => p.processoId === id && (p.estado || 'pendente') === 'pendente')
      .slice()
      .sort((a, b) => String(a.dataLimite).localeCompare(String(b.dataLimite)))[0] || null
  ), [prazos, id]);

  const minhasTarefas = useMemo(() => tarefas.filter((t) => t.processoId === id && t.estado !== 'concluida'), [tarefas, id]);
  const meusEventos = useMemo(() => (
    eventos.filter((e) => e.processoId === id)
      .slice()
      .sort((a, b) => String(b.data).localeCompare(String(a.data)))
      .slice(0, 6)
  ), [eventos, id]);

  if (loading && !processo) {
    return <div data-testid="processo-detail"><Skeleton lines={6} /></div>;
  }

  if (!processo) {
    return (
      <div data-testid="processo-detail">
        <EmptyState
          icon={<IconFolder />}
          title="Processo não encontrado"
          hint="O processo pode ter sido removido."
          action={<Link to="/processos" className="btn btn-primary">Voltar aos processos</Link>}
        />
      </div>
    );
  }

  const arquivar = async () => {
    setConfirmArquivar(false);
    try {
      await updateShared('processos', processo.id, { estado: 'arquivado' });
      await refresh();
      toast('Processo arquivado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível arquivar o processo.', { tone: 'error' });
    }
  };

  return (
    <div data-testid="processo-detail">
      <nav className="row row-2 text-small text-subtle" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
        <Link to="/processos" className="text-muted">Processos</Link>
        <IconChevronRight />
        <span className="text-strong numeric">{processo.numeroProcesso || 'Sem número'}</span>
      </nav>

      <div className="page-header">
        <div>
          <h1 className="page-title numeric">{processo.numeroProcesso || 'Sem número'}</h1>
          <p className="page-subtitle row row-2">
            <EstadoBadge estado={processo.estado || 'ativo'} />
            {processo.area ? <Badge tone="neutral">{processo.area}</Badge> : null}
            {cliente ? <Link to={`/clientes/${cliente.id}`} className="text-muted">{cliente.nome}</Link> : null}
          </p>
        </div>
        <div className="page-actions">
          <a
            href={appHref('legal-dossie', `processo/${processo.id}`)}
            className="btn btn-primary"
            data-testid="abrir-dossie"
          >
            <IconBook /> Abrir dossiê <IconExternalLink />
          </a>
          <Button variant="secondary" data-testid="processo-editar" onClick={() => setEditing(true)}><IconEdit /> Editar</Button>
          {(processo.estado || 'ativo') !== 'arquivado' ? (
            <Button variant="danger" data-testid="processo-arquivar" onClick={() => setConfirmArquivar(true)}><IconTrash /> Arquivar</Button>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 'var(--sp-6, 1.5rem)', alignItems: 'start' }} className="dashboard-columns">
        <div className="stack stack-6">
          {/* Resumo */}
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>Resumo do processo</h2>
            <div className="dossie-id-grid">
              <div className="dossie-id-row"><span className="dossie-id-label">Cliente</span><span className="dossie-id-value">{cliente ? cliente.nome : '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Tribunal</span><span className="dossie-id-value">{processo.tribunal || '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Comarca</span><span className="dossie-id-value">{processo.comarca || '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Área</span><span className="dossie-id-value">{processo.area || '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Advogado responsável</span><span className="dossie-id-value">{processo.advogadoResponsavel || '—'}</span></div>
            </div>
            {processo.descricao ? <p className="dossie-descricao">{processo.descricao}</p> : null}
          </section>

          {/* Últimos eventos */}
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>Últimos eventos</h2>
            {meusEventos.length === 0 ? (
              <p className="text-small text-subtle" style={{ margin: 0 }}>Sem eventos registados.</p>
            ) : (
              <ul className="dossie-timeline">
                {meusEventos.map((e) => (
                  <li key={e.id} className="dossie-timeline-item">
                    <span className="dossie-timeline-date numeric">{formatDate(e.data)}</span>
                    <span className="dossie-timeline-body">
                      <span className="dossie-timeline-titulo">{e.titulo}</span>
                      {e.tipo ? <span className="dossie-timeline-tipo">{e.tipo}</span> : null}
                      {e.descricao ? <span className="dossie-timeline-desc">{e.descricao}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack stack-6">
          {/* Próximo prazo */}
          <section className="card" data-testid="proximo-prazo">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>Próximo prazo</h2>
            {!proximoPrazo ? (
              <p className="text-small text-subtle" style={{ margin: 0 }}>Sem prazos pendentes.</p>
            ) : (
              <div className="stack stack-2">
                <span className="text-strong">{proximoPrazo.descricao || proximoPrazo.titulo || 'Prazo'}</span>
                <div className="row row-2">
                  <span className="text-small text-muted numeric">{formatDate(proximoPrazo.dataLimite)}</span>
                  <DeadlineBadge date={proximoPrazo.dataLimite} />
                </div>
                <a href={appHref('legal-prazos')} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
                  Ver em Prazos <IconExternalLink />
                </a>
              </div>
            )}
          </section>

          {/* Tarefas do processo */}
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

      <ProcessoFormModal
        open={editing}
        processo={processo}
        clientes={clientes}
        onClose={() => setEditing(false)}
        onSaved={async () => { setEditing(false); await refresh(); }}
      />

      <ConfirmDialog
        open={confirmArquivar}
        title="Arquivar processo"
        message={`Arquivar o processo "${processo.numeroProcesso || 'sem número'}"? Passa ao estado arquivado.`}
        confirmLabel="Arquivar"
        danger
        onConfirm={arquivar}
        onCancel={() => setConfirmArquivar(false)}
      />
    </div>
  );
}
