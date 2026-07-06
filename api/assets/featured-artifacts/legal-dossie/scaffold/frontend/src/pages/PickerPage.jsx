import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSharedCollection,
  useDebounced,
  diasRestantes,
} from '../shared.js';
import { Badge, SearchInput, EmptyState, Skeleton } from '../components/ui.jsx';
import { IconFolder, IconChevronRight, IconUsers } from '../components/Icons.jsx';
import { urgenciaDeDias } from './doc-helpers.jsx';

/* Estado do processo -> tom do badge. */
function estadoTone(estado) {
  if (estado === 'ativo') return 'ok';
  if (estado === 'suspenso') return 'media';
  if (estado === 'arquivado') return 'neutral';
  return 'neutral';
}

/*
 * Página inicial do Dossiê: um seletor de processos pesquisável. Cada cartão
 * mostra o número, o cliente, a área, o estado e o próximo prazo pendente, e
 * abre o workspace do processo (/processo/:id). É a nova aterragem do app - a
 * antiga lista com dropdown deu lugar a esta grelha.
 */
export default function PickerPage() {
  const navigate = useNavigate();
  const { items: processos, loading } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: prazos } = useSharedCollection('prazos');

  const [query, setQuery] = useState('');
  const q = useDebounced(query, 200).trim().toLowerCase();

  const clienteById = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c));
    return map;
  }, [clientes]);

  // Próximo prazo pendente por processo (o de data-limite mais próxima ainda por
  // cumprir). Devolve { dias, dataLimite } ou null.
  const proximoPrazo = useMemo(() => {
    const byProcesso = new Map();
    for (const p of prazos) {
      if (!p || p.estado === 'cumprido') continue;
      const dias = diasRestantes(p.dataLimite);
      if (!Number.isFinite(dias)) continue;
      const prev = byProcesso.get(p.processoId);
      if (!prev || dias < prev.dias) byProcesso.set(p.processoId, { dias, dataLimite: p.dataLimite });
    }
    return byProcesso;
  }, [prazos]);

  const cards = useMemo(() => {
    const rows = processos.map((p) => {
      const cli = clienteById.get(p.clienteId) || null;
      return { processo: p, cliente: cli, prazo: proximoPrazo.get(p.id) || null };
    });
    if (!q) return rows;
    return rows.filter(({ processo, cliente }) => {
      const hay = [
        processo.numeroProcesso,
        processo.area,
        processo.estado,
        processo.tribunal,
        cliente && cliente.nome,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [processos, clienteById, proximoPrazo, q]);

  return (
    <div data-testid="picker-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dossiês</h1>
          <p className="page-subtitle">
            Escolha um processo para abrir o seu dossiê - documentos, comunicações, cronologia, prazos e
            a versão pronta a imprimir, tudo num só sítio.
          </p>
        </div>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por número, cliente, área…"
          data-testid="picker-search"
        />
        {processos.length > 0 && (
          <span className="text-subtle text-small">
            {cards.length} de {processos.length} processos
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton lines={4} />
      ) : processos.length === 0 ? (
        <EmptyState
          icon={<IconFolder />}
          title="Sem processos"
          hint="Abra um processo no Núcleo para começar a compilar o seu dossiê."
        />
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<IconFolder />}
          title="Sem resultados"
          hint="Nenhum processo corresponde à pesquisa. Ajuste os termos e tente de novo."
        />
      ) : (
        <div className="launcher-grid">
          {cards.map(({ processo, cliente, prazo }) => (
            <button
              key={processo.id}
              type="button"
              data-testid="picker-card" data-demo-target="dossie-card"
              data-processo-id={processo.id}
              className="launcher-card card-hover"
              style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
              onClick={() => navigate(`/processo/${processo.id}`)}
            >
              <span className="launcher-icon" aria-hidden="true">
                <IconFolder />
              </span>
              <span className="launcher-body">
                <span className="launcher-title" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {processo.numeroProcesso || '(sem número)'}
                </span>
                <span className="launcher-desc row row-2" style={{ gap: 'var(--sp-2)' }}>
                  <IconUsers size={14} />
                  {cliente ? cliente.nome : 'Sem cliente associado'}
                </span>
                <span className="row row-2" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  {processo.area ? <Badge tone="neutral">{processo.area}</Badge> : null}
                  <Badge tone={estadoTone(processo.estado)}>{processo.estado || '—'}</Badge>
                  {prazo ? (
                    <Badge tone={urgenciaDeDias(prazo.dias)}>
                      {prazo.dias < 0
                        ? `Prazo vencido há ${Math.abs(prazo.dias)}d`
                        : prazo.dias === 0
                        ? 'Prazo hoje'
                        : `Prazo em ${prazo.dias}d`}
                    </Badge>
                  ) : null}
                </span>
              </span>
              <span className="launcher-mark" aria-hidden="true">
                <IconChevronRight />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
