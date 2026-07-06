import { useMemo, useState } from 'react';
import {
  useSharedCollection,
  updateShared,
  diasRestantes,
  formatDate,
  appHref,
  useDebounced,
} from '../shared.js';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  Select,
  SearchInput,
  Skeleton,
  toast,
} from '../components/ui.jsx';
import { IconCheck, IconChevronDown } from '../components/Icons.jsx';
import {
  prazoDescricao,
  prazoOrigem,
  estadoDerivado,
  diasLabel,
  diasTone,
} from './prazo-view.js';

const ESTADO_META = {
  pendente: { tone: 'info', label: 'Pendente' },
  vencido: { tone: 'alta', label: 'Vencido' },
  cumprido: { tone: 'ok', label: 'Cumprido' },
};

export default function PrazosListPage() {
  const { items: prazos, loading, refresh } = useSharedCollection('prazos');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');

  const [query, setQuery] = useState('');
  const [processoFiltro, setProcessoFiltro] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [origemFiltro, setOrigemFiltro] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [confirming, setConfirming] = useState(null);

  const debouncedQuery = useDebounced(query, 200);

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '';
  }, [clientes]);

  const processoNumero = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || '(sem número)'));
    return (id) => map.get(id) || '';
  }, [processos]);

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const rows = prazos.filter((pr) => {
      if (processoFiltro && pr.processoId !== processoFiltro) return false;
      if (estadoFiltro && estadoDerivado(pr) !== estadoFiltro) return false;
      if (origemFiltro && prazoOrigem(pr) !== origemFiltro) return false;
      if (q && !prazoDescricao(pr).toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const av = a.dataLimite || '';
      const bv = b.dataLimite || '';
      if (av === bv) return 0;
      return av < bv ? -dir : dir;
    });
  }, [prazos, processoFiltro, estadoFiltro, origemFiltro, debouncedQuery, sortDir]);

  const columns = useMemo(() => [
    {
      key: 'descricao',
      label: 'Prazo',
      render: (pr) => <span className="text-strong">{prazoDescricao(pr)}</span>,
    },
    {
      key: 'processo',
      label: 'Processo',
      render: (pr) => {
        const numero = processoNumero(pr.processoId);
        if (!numero) return <span className="text-subtle">Sem processo</span>;
        return (
          <a href={appHref('legal-nucleo', `processos/${pr.processoId}`)} style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {numero}
          </a>
        );
      },
    },
    {
      key: 'dataLimite',
      align: 'right',
      label: (
        <button
          type="button"
          data-testid="sort-datalimite"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          style={{ background: 'transparent', border: 0, font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
          title="Ordenar por data-limite"
        >
          Data-limite
          <IconChevronDown size={14} style={{ transform: sortDir === 'asc' ? 'rotate(180deg)' : 'none' }} />
        </button>
      ),
      render: (pr) => <span className="numeric text-strong">{formatDate(pr.dataLimite)}</span>,
    },
    {
      key: 'quando',
      label: 'Quando',
      render: (pr) => {
        const d = diasRestantes(pr.dataLimite);
        return <Badge tone={diasTone(d)}>{diasLabel(d)}</Badge>;
      },
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (pr) => {
        const meta = ESTADO_META[estadoDerivado(pr)] || ESTADO_META.pendente;
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    {
      key: 'origem',
      label: 'Origem',
      render: (pr) => {
        const origem = prazoOrigem(pr);
        return <Badge tone={origem === 'citius' ? 'info' : 'neutral'}>{origem === 'citius' ? 'Citius' : 'Manual'}</Badge>;
      },
    },
    {
      key: 'acoes',
      label: '',
      align: 'right',
      render: (pr) => (
        estadoDerivado(pr) !== 'cumprido' ? (
          <Button variant="ghost" size="sm" data-testid={`marcar-cumprido-${pr.id}`} onClick={() => setConfirming(pr)}>
            <IconCheck /> Marcar cumprido
          </Button>
        ) : <span className="text-subtle text-xs">—</span>
      ),
    },
  ], [processoNumero, sortDir]);

  async function doCumprir() {
    const pr = confirming;
    if (!pr) return;
    setConfirming(null);
    try {
      await updateShared('prazos', pr.id, { estado: 'cumprido' });
      toast('Prazo marcado como cumprido.', { tone: 'ok' });
      await refresh();
    } catch {
      toast('Não foi possível marcar o prazo como cumprido.', { tone: 'error' });
    }
  }

  return (
    <div data-testid="prazos-list-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Todos os prazos</h1>
          <p className="page-subtitle">O registo completo de prazos da espinha partilhada, com filtros e ordenação.</p>
        </div>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por descrição…"
          data-testid="prazos-search"
        />
        <Field label="Processo">
          <Select value={processoFiltro} onChange={(e) => setProcessoFiltro(e.target.value)} data-testid="filtro-processo">
            <option value="">Todos os processos</option>
            {processos.map((p) => {
              const nome = clienteNome(p.clienteId);
              return (
                <option key={p.id} value={p.id}>
                  {(p.numeroProcesso || '(sem número)') + (nome ? ` - ${nome}` : '')}
                </option>
              );
            })}
          </Select>
        </Field>
        <Field label="Estado">
          <Select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)} data-testid="filtro-estado">
            <option value="">Todos os estados</option>
            <option value="pendente">Pendente</option>
            <option value="vencido">Vencido</option>
            <option value="cumprido">Cumprido</option>
          </Select>
        </Field>
        <Field label="Origem">
          <Select value={origemFiltro} onChange={(e) => setOrigemFiltro(e.target.value)} data-testid="filtro-origem">
            <option value="">Todas as origens</option>
            <option value="manual">Manual</option>
            <option value="citius">Citius</option>
          </Select>
        </Field>
      </div>

      {loading ? (
        <Skeleton lines={8} />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          empty="Sem prazos para os filtros escolhidos."
        />
      )}

      <ConfirmDialog
        open={!!confirming}
        title="Marcar prazo como cumprido"
        message={confirming ? `Confirma que "${prazoDescricao(confirming)}" foi cumprido?` : ''}
        confirmLabel="Marcar cumprido"
        onConfirm={doCumprir}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
