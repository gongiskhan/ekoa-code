import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, useDebounced } from '../shared.js';
import { Button, Badge, DataTable, SearchInput, EmptyState, Skeleton } from '../components/ui.jsx';
import {
  IconUsers, IconUserCircle, IconBuilding, IconMail, IconPhone, IconPlus, IconChevronRight,
} from '../components/Icons.jsx';
import { ClienteFormModal } from './forms.jsx';
import { tipoLabel, fold } from './widgets.jsx';

const FILTROS = [
  { value: 'ativos', label: 'Ativos' },
  { value: 'particular', label: 'Particulares' },
  { value: 'empresa', label: 'Empresas' },
  { value: 'arquivados', label: 'Arquivados' },
];

export default function ClientesPage() {
  const navigate = useNavigate();
  const { items: clientes, loading, refresh } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [filtro, setFiltro] = useState('ativos');
  const debounced = useDebounced(query, 180);

  const rows = useMemo(() => {
    const term = fold(debounced.trim());
    const count = new Map();
    processos.forEach((p) => count.set(p.clienteId, (count.get(p.clienteId) || 0) + 1));
    return clientes
      .filter((c) => {
        if (filtro === 'arquivados') return Boolean(c.arquivado);
        if (c.arquivado) return false;
        if (filtro === 'particular' || filtro === 'empresa') return (c.tipo || 'particular') === filtro;
        return true;
      })
      .filter((c) => {
        if (!term) return true;
        return (
          fold(c.nome).includes(term) ||
          fold(c.nif).includes(term) ||
          fold(c.email).includes(term)
        );
      })
      .map((c) => ({ ...c, processosCount: count.get(c.id) || 0 }));
  }, [clientes, processos, debounced, filtro]);

  const columns = [
    {
      key: 'nome', label: 'Nome',
      render: (c) => (
        <div className="row row-3">
          <span className="row-icon" aria-hidden="true">{c.tipo === 'empresa' ? <IconBuilding /> : <IconUserCircle />}</span>
          <span className="text-strong">{c.nome || 'Sem nome'}</span>
        </div>
      ),
    },
    { key: 'tipo', label: 'Tipo', render: (c) => <Badge tone="neutral">{tipoLabel(c.tipo)}</Badge> },
    { key: 'nif', label: 'NIF', render: (c) => c.nif || '—' },
    {
      key: 'contacto', label: 'Contacto',
      render: (c) => (
        <div className="stack stack-1 text-small text-muted">
          {c.email ? <span className="row row-2"><IconMail /> {c.email}</span> : null}
          {c.telefone ? <span className="row row-2"><IconPhone /> {c.telefone}</span> : null}
          {!c.email && !c.telefone ? <span>—</span> : null}
        </div>
      ),
    },
    { key: 'processosCount', label: 'Processos', align: 'right', render: (c) => c.processosCount },
    { key: 'abrir', label: '', align: 'right', width: '48px', render: () => <span className="row-icon" aria-hidden="true"><IconChevronRight /></span> },
  ];

  return (
    <div data-testid="clientes-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">O registo central de entidades partilhado por toda a edição jurídica.</p>
        </div>
        <Button data-testid="novo-cliente" onClick={() => setCreating(true)}>
          <IconPlus /> Novo cliente
        </Button>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquise por nome, NIF ou email."
          data-testid="clientes-pesquisa"
        />
        <div className="chip-row">
          {FILTROS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`chip as-button${filtro === f.value ? ' is-active' : ''}`}
              onClick={() => setFiltro(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton lines={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconUsers />}
          title={clientes.length === 0 ? 'Sem clientes registados' : 'Sem resultados'}
          hint={clientes.length === 0 ? 'Adicione o seu primeiro cliente para começar a abrir processos.' : 'Ajuste a pesquisa ou os filtros.'}
          action={clientes.length === 0 ? <Button onClick={() => setCreating(true)}><IconPlus /> Adicionar cliente</Button> : null}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          onRowClick={(c) => navigate(`/clientes/${c.id}`)}
        />
      )}

      <ClienteFormModal
        open={creating}
        cliente={null}
        onClose={() => setCreating(false)}
        onSaved={async (saved) => {
          setCreating(false);
          await refresh();
          if (saved && saved.id) navigate(`/clientes/${saved.id}`);
        }}
      />
    </div>
  );
}
