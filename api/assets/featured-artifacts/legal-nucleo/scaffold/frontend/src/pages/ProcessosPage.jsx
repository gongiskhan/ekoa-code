import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, useDebounced } from '../shared.js';
import { Button, DataTable, Select, SearchInput, EmptyState, Skeleton } from '../components/ui.jsx';
import { IconFolder, IconPlus, IconChevronRight } from '../components/Icons.jsx';
import { ProcessoFormModal } from './forms.jsx';
import { ESTADOS, EstadoBadge, fold } from './widgets.jsx';

export default function ProcessosPage() {
  const navigate = useNavigate();
  const { items: processos, loading, refresh } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const debounced = useDebounced(query, 180);

  const clienteNome = useMemo(() => {
    const map = new Map(clientes.map((c) => [c.id, c.nome]));
    return (id) => map.get(id) || '—';
  }, [clientes]);

  const areas = useMemo(() => {
    const set = new Set(processos.map((p) => p.area).filter(Boolean));
    return Array.from(set).sort();
  }, [processos]);

  const rows = useMemo(() => {
    const term = fold(debounced.trim());
    return processos.filter((p) => {
      if (estadoFilter !== 'all' && (p.estado || 'ativo') !== estadoFilter) return false;
      if (areaFilter !== 'all' && p.area !== areaFilter) return false;
      if (!term) return true;
      return (
        fold(p.numeroProcesso).includes(term) ||
        fold(p.tribunal).includes(term) ||
        fold(p.area).includes(term) ||
        fold(clienteNome(p.clienteId)).includes(term)
      );
    });
  }, [processos, debounced, estadoFilter, areaFilter, clienteNome]);

  const columns = [
    { key: 'numeroProcesso', label: 'Número', render: (p) => <span className="text-strong numeric">{p.numeroProcesso || '—'}</span> },
    { key: 'cliente', label: 'Cliente', render: (p) => clienteNome(p.clienteId) },
    {
      key: 'tribunal', label: 'Tribunal',
      render: (p) => (
        <div className="stack stack-1 text-small">
          <span>{p.tribunal || '—'}</span>
          {p.comarca ? <span className="text-subtle text-xs">{p.comarca}</span> : null}
        </div>
      ),
    },
    { key: 'area', label: 'Área', render: (p) => p.area || '—' },
    { key: 'estado', label: 'Estado', render: (p) => <EstadoBadge estado={p.estado || 'ativo'} /> },
    { key: 'abrir', label: '', align: 'right', width: '48px', render: () => <span className="row-icon" aria-hidden="true"><IconChevronRight /></span> },
  ];

  return (
    <div data-testid="processos-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Processos</h1>
          <p className="page-subtitle">As pastas processuais ligadas a cada cliente do registo partilhado.</p>
        </div>
        <Button
          data-testid="novo-processo"
          onClick={() => setCreating(true)}
          disabled={clientes.length === 0}
          title={clientes.length === 0 ? 'Adicione primeiro um cliente.' : undefined}
        >
          <IconPlus /> Novo processo
        </Button>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquise por número, cliente, tribunal ou área."
          data-testid="processos-pesquisa"
        />
        <div className="chip-row">
          <button type="button" className={`chip as-button${estadoFilter === 'all' ? ' is-active' : ''}`} onClick={() => setEstadoFilter('all')}>Todos</button>
          {ESTADOS.map((e) => (
            <button key={e.value} type="button" className={`chip as-button${estadoFilter === e.value ? ' is-active' : ''}`} onClick={() => setEstadoFilter(e.value)}>{e.label}</button>
          ))}
        </div>
        {areas.length > 1 ? (
          <Select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            data-testid="processos-area-filter"
            aria-label="Filtrar por área"
            style={{ width: 'auto', minWidth: 160 }}
          >
            <option value="all">Todas as áreas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        ) : null}
      </div>

      {loading ? (
        <Skeleton lines={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconFolder />}
          title={processos.length === 0 ? 'Sem processos registados' : 'Sem resultados'}
          hint={processos.length === 0
            ? (clientes.length === 0 ? 'Adicione primeiro um cliente e depois abra o processo.' : 'Abra o primeiro processo para um dos seus clientes.')
            : 'Ajuste a pesquisa ou os filtros.'}
          action={processos.length === 0 && clientes.length > 0 ? <Button onClick={() => setCreating(true)}><IconPlus /> Abrir processo</Button> : null}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          onRowClick={(p) => navigate(`/processos/${p.id}`)}
        />
      )}

      <ProcessoFormModal
        open={creating}
        processo={null}
        clientes={clientes}
        onClose={() => setCreating(false)}
        onSaved={async (saved) => {
          setCreating(false);
          await refresh();
          if (saved && saved.id) navigate(`/processos/${saved.id}`);
        }}
      />
    </div>
  );
}
