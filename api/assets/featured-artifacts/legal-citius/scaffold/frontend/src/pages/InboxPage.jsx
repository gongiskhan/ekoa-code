import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, formatDate } from '../shared.js';
import { Badge, EmptyState } from '../components/ui.jsx';
import { IconInbox, IconChevronRight } from '../components/Icons.jsx';
import { estadoMeta, isNeedsReview, excerpt, byRecent } from './triage.js';

/*
 * Caixa de entrada Citius - a fila de triagem viva. Alimentada tanto pela
 * intake automática de email (motor, no backend) como pelo "Colar notificação"
 * - a UI trabalha as linhas independentemente de quem as escreveu.
 *
 * "A rever" (needs-review) é a secção que exige acção - em destaque no topo.
 * "Processadas" reúne o que já foi triado (prazo criado, processada ou
 * rejeitada). Clicar numa linha abre a triagem/detalhe.
 */
export default function InboxPage() {
  const navigate = useNavigate();
  const { items, loading } = useSharedCollection('citius_notificacoes');

  const { aRever, processadas } = useMemo(() => {
    const sorted = [...(items || [])].sort(byRecent);
    return {
      aRever: sorted.filter(isNeedsReview),
      processadas: sorted.filter((n) => !isNeedsReview(n)),
    };
  }, [items]);

  const open = (n) => navigate(`/notificacao/${n.id}`);

  return (
    <div data-testid="inbox-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Caixa de entrada</h1>
          <p className="page-subtitle">
            As notificações Citius chegam aqui - da intake automática de email ou coladas à mão. Confirme cada
            uma para gerar o prazo; o que for ambíguo espera pela sua revisão e nunca gera um prazo adivinhado.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar a caixa.</span></div>
      ) : aRever.length === 0 && processadas.length === 0 ? (
        <EmptyState
          icon={<IconInbox />}
          title="Caixa vazia"
          hint="Assim que uma notificação Citius chegar por email - ou for colada em Colar notificação - aparece aqui para triagem."
        />
      ) : (
        <div className="stack stack-6">
          <Section
            testid="inbox-a-rever"
            title="A rever"
            emphasis
            count={aRever.length}
            rows={aRever}
            onOpen={open}
            emptyText="Nada por rever. Boa."
          />
          <Section
            testid="inbox-processadas"
            title="Processadas"
            count={processadas.length}
            rows={processadas}
            onOpen={open}
            emptyText="Ainda não há notificações processadas."
          />
        </div>
      )}
    </div>
  );
}

function Section({ testid, title, emphasis, count, rows, onOpen, emptyText }) {
  return (
    <section aria-label={title}>
      <div className="row row-space-between" style={{ marginBottom: 'var(--space-3, 0.75rem)' }}>
        <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>{title}</h2>
        <Badge tone={emphasis && count > 0 ? 'media' : 'neutral'}>{count}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted text-small" data-testid={testid}>{emptyText}</p>
      ) : (
        <ul className="citius-inbox" data-testid={testid}>
          {rows.map((n) => (
            <InboxRow key={n.id} n={n} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxRow({ n, onOpen }) {
  const meta = estadoMeta(n.estado);
  const go = () => onOpen(n);
  return (
    <li
      className="citius-item is-clickable"
      data-testid="citius-item"
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      }}
    >
      <div className="citius-item-main">
        <span className="citius-item-processo">{n.numeroProcesso || '(sem número de processo)'}</span>
        <span className="citius-item-ato">{n.ato || 'Ato não reconhecido'}</span>
        <span className="citius-item-detail">{excerpt(n.texto)}</span>
        {n.estado === 'matched' || n.estado === 'processada' ? (
          n.dataLimite ? (
            <span className="citius-item-detail is-limite">
              Data-limite {n.dataLimite} · {formatDate(n.dataLimite)}
            </span>
          ) : null
        ) : n.estado === 'needs-review' && n.motivo ? (
          <span className="citius-item-detail is-motivo">{n.motivo}</span>
        ) : null}
      </div>
      <div className="citius-item-side">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="row-icon" aria-hidden="true" style={{ color: 'var(--color-text-subtle, #64748B)' }}><IconChevronRight /></span>
      </div>
    </li>
  );
}
