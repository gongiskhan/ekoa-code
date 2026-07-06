import { useMemo } from 'react';
import {
  useSharedCollection,
  appHref,
  formatDate,
} from '../shared.js';
import { DataTable, EmptyState, Badge } from '../components/ui.jsx';
import { IconClock, IconDownload, IconExternalLink } from '../components/Icons.jsx';

export default function HistoricoPage() {
  const { items: documentos, loading } = useSharedCollection('documentos');
  const { items: clientes } = useSharedCollection('clientes');

  const nomeCliente = useMemo(() => {
    const m = new Map(clientes.map((c) => [c.id, c.nome]));
    return (id) => m.get(id) || '—';
  }, [clientes]);

  const linhas = useMemo(
    () => documentos
      .filter((d) => d.origem === 'legal-forms')
      .slice()
      .sort((a, b) => String(b.data || b.createdAt || '').localeCompare(String(a.data || a.createdAt || ''))),
    [documentos],
  );

  const columns = [
    {
      key: 'nome',
      label: 'Documento',
      render: (row) => (
        <span className="row" style={{ gap: 'var(--space-2, 0.5rem)', alignItems: 'center' }}>
          <Badge tone="ok">PDF</Badge>
          <span className="text-small" style={{ fontWeight: 600 }}>{row.nome || '(sem nome)'}</span>
        </span>
      ),
    },
    { key: 'cliente', label: 'Cliente', render: (row) => nomeCliente(row.clienteId) },
    { key: 'data', label: 'Data', render: (row) => formatDate(row.data || row.createdAt) },
    {
      key: 'acoes',
      label: 'Ações',
      align: 'right',
      render: (row) => (
        <span className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)', justifyContent: 'flex-end' }}>
          {row.ficheiro && row.ficheiro.url ? (
            <a className="btn btn-ghost btn-sm" href={`${row.ficheiro.url}?download=1`} download data-testid={`forms-hist-download-${row.id}`}>
              <IconDownload /> Descarregar
            </a>
          ) : null}
          {row.processoId ? (
            <a className="btn btn-ghost btn-sm" href={appHref('legal-dossie', `processo/${row.processoId}`)} data-testid={`forms-hist-dossie-${row.id}`}>
              <IconExternalLink /> Dossiê
            </a>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div data-testid="forms-historico-page" data-demo-page="forms/historico">
      <div className="page-header">
        <div>
          <h1 className="page-title">Histórico de formulários</h1>
          <p className="page-subtitle">
            Todos os formulários preenchidos e guardados no dossiê. Cada linha liga ao processo respetivo.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar histórico.</span></div>
      ) : linhas.length === 0 ? (
        <EmptyState
          icon={<IconClock />}
          title="Ainda não há formulários preenchidos"
          hint="Preencha um formulário a partir de um modelo para o ver aqui e no dossiê do processo."
        />
      ) : (
        <div data-testid="forms-historico-lista">
          <DataTable columns={columns} rows={linhas} rowKey="id" />
        </div>
      )}
    </div>
  );
}
