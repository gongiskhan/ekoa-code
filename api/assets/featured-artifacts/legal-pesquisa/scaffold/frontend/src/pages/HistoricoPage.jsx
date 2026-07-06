import { useMemo, useState } from 'react';
import {
  useSharedCollection,
  formatDateTime,
  appHref,
} from '../shared.js';
import { useDemoResult } from '../demo.js';
import { Badge, EmptyState } from '../components/ui.jsx';
import {
  IconClock,
  IconSearchText,
  IconExternalLink,
  IconChevronRight,
  IconChevronDown,
} from '../components/Icons.jsx';
import {
  DISCLAIMER,
  fonteLabel,
  fonteTone,
  citacoesComUrl,
} from './pesquisa-logic.js';

/* Uma linha de histórico. O cabeçalho é o alvo de demonstração
 * (data-demo-target="pesquisa-historico-item"): ao expandir, mostra as citações
 * guardadas como CHIPS que são ligações reais. O estado de verificação NÃO é
 * guardado (uma ligação pode morrer depois de arquivada), por isso o histórico
 * mostra apenas o distintivo da fonte, nunca "verificada". */
function HistoricoRow({ pesquisa, processo }) {
  const [aberta, setAberta] = useState(false);
  const citacoes = citacoesComUrl(pesquisa.citacoes);
  const nCitacoes = citacoes.length;

  return (
    <li className="card" data-testid={`pesquisa-row-${pesquisa.id}`} style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        className="row row-space-between"
        data-demo-target="pesquisa-historico-item"
        data-testid={`pesquisa-toggle-${pesquisa.id}`}
        aria-expanded={aberta}
        onClick={() => setAberta((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 'var(--sp-4, 1rem)',
          alignItems: 'flex-start',
          gap: 'var(--sp-3)',
        }}
      >
        <span className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-2)', minWidth: 0 }}>
          <span className="row-icon" aria-hidden="true" style={{ marginTop: 2 }}>
            {aberta ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </span>
          <span className="stack stack-1" style={{ minWidth: 0 }}>
            <span className="text-strong">{pesquisa.pergunta || '(sem pergunta)'}</span>
            <span className="text-subtle text-xs row row-2" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
              <span>{formatDateTime(pesquisa.executadaEm || pesquisa.createdAt)}</span>
            </span>
          </span>
        </span>
        <Badge tone={nCitacoes ? 'info' : 'neutral'}>
          {nCitacoes ? `${nCitacoes} citação${nCitacoes === 1 ? '' : 'ões'}` : 'sem citações'}
        </Badge>
      </button>

      {aberta ? (
        <div className="stack stack-3" style={{ padding: '0 var(--sp-4, 1rem) var(--sp-4, 1rem)' }}>
          {processo ? (
            <a
              className="stat-link text-xs"
              href={appHref('legal-dossie', `processo/${processo.id}`)}
              data-testid={`pesquisa-processo-${pesquisa.id}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {processo.numeroProcesso || 'Processo'} <IconExternalLink size={12} />
            </a>
          ) : null}

          {nCitacoes > 0 ? (
            <div className="chip-row" data-demo-target="pesquisa-citacoes" data-testid={`pesquisa-citacoes-${pesquisa.id}`}>
              {citacoes.map((c, i) => (
                <a
                  key={`${c.url}-${i}`}
                  className="chip as-button"
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="pesquisa-historico-citacao"
                  title={c.titulo || c.url}
                >
                  <Badge tone={fonteTone(c.fonte)}>{fonteLabel(c.fonte)}</Badge>
                  <span style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.titulo || c.url}
                  </span>
                  <IconExternalLink size={12} />
                </a>
              ))}
            </div>
          ) : (
            <p
              className="text-subtle text-xs"
              data-demo-target="pesquisa-citacoes"
              data-testid={`pesquisa-citacoes-${pesquisa.id}`}
              style={{ margin: 0 }}
            >
              Sem citações verificáveis guardadas (pesquisa manual sobre índice vazio).
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function HistoricoPage() {
  const { items: pesquisas, loading } = useSharedCollection('pesquisas');
  const { items: processos } = useSharedCollection('processos');

  const processoById = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p));
    return map;
  }, [processos]);

  const rows = useMemo(
    () =>
      pesquisas
        .slice()
        .sort((a, b) => String(b.executadaEm || b.createdAt || '').localeCompare(String(a.executadaEm || a.createdAt || ''))),
    [pesquisas],
  );

  // A seguir à história semeada estar visível, sinaliza a ponte de demonstração.
  useDemoResult('pesquisa-resultados', rows.length > 0);

  return (
    <div data-testid="pesquisa-historico-page" data-demo-page="pesquisa/historico">
      <div className="page-header">
        <div>
          <h1 className="page-title">Histórico de pesquisas</h1>
          <p className="page-subtitle">
            Pesquisas jurídicas guardadas nos processos. Expanda uma linha para ver as citações; cada
            citação é uma ligação real para a fonte.
          </p>
        </div>
      </div>

      <p
        className="resultado-ok"
        data-demo-target="pesquisa-disclaimer"
        data-testid="pesquisa-disclaimer"
        style={{ marginTop: 0 }}
      >
        {DISCLAIMER}
      </p>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar o histórico.</span></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconClock />}
          title="Sem pesquisas guardadas"
          hint="Faça uma pesquisa em Pesquisar e guarde-a num processo para a ver aqui."
        />
      ) : (
        <ul className="stack stack-3" style={{ listStyle: 'none', margin: 'var(--sp-5, 1.25rem) 0 0', padding: 0 }}>
          {rows.map((p) => (
            <HistoricoRow key={p.id} pesquisa={p} processo={p.processoId ? processoById.get(p.processoId) : null} />
          ))}
        </ul>
      )}
    </div>
  );
}
