import { useMemo, useState } from 'react';
import {
  useSharedCollection,
  updateShared,
  diasRestantes,
  formatDate,
  appHref,
} from '../shared.js';
import { Badge, Button, ConfirmDialog, DataTable, Skeleton, toast } from '../components/ui.jsx';
import { IconCheck, IconAlertTriangle, IconClock, IconCalendar } from '../components/Icons.jsx';
import {
  prazoDescricao,
  prazoOrigem,
  diasLabel,
  diasTone,
  multaAteOf,
} from './prazo-view.js';

/* Distintivo de origem: Citius (azul) ou Manual (neutro). */
function OrigemBadge({ prazo }) {
  const origem = prazoOrigem(prazo);
  return (
    <Badge tone={origem === 'citius' ? 'info' : 'neutral'} data-testid={`prazo-origem-${prazo.id}`}>
      {origem === 'citius' ? 'Citius' : 'Manual'}
    </Badge>
  );
}

/*
 * Colunas do radar. `processoNumero` resolve o número do processo (com deep link
 * para o Núcleo); `onCumprir` abre a confirmação de "marcar cumprido".
 */
function buildColumns(processoNumero, onCumprir) {
  return [
    {
      key: 'descricao',
      label: 'Prazo',
      render: (pr) => {
        const d = diasRestantes(pr.dataLimite);
        const multaAte = d < 0 ? multaAteOf(pr) : null;
        // A janela do art. 139.º n.º 5 CPC (3 dias úteis com multa) só se afirma
        // ABERTA enquanto multaAte não passou; depois disso o texto muda para o
        // passado - nunca dizer a um advogado que ainda pode praticar o acto
        // quando a janela já fechou.
        const multaAberta = multaAte ? diasRestantes(multaAte) >= 0 : false;
        return (
          <div className="stack stack-1">
            <span className="text-strong" data-testid={`prazo-desc-${pr.id}`}>{prazoDescricao(pr)}</span>
            {multaAte ? (
              <span
                className="text-xs"
                style={{ color: multaAberta ? 'var(--warn)' : 'var(--ink-3, #6b7280)' }}
                data-testid={`prazo-multa-${pr.id}`}
              >
                {multaAberta
                  ? `Ainda pode praticar-se com multa até ${formatDate(multaAte)} (art. 139.º n.º 5 CPC)`
                  : `Janela de multa encerrada em ${formatDate(multaAte)} (art. 139.º n.º 5 CPC)`}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'processo',
      label: 'Processo',
      render: (pr) => {
        const numero = processoNumero(pr.processoId);
        if (!numero) return <span className="text-subtle">Sem processo</span>;
        return (
          <a
            href={appHref('legal-nucleo', `processos/${pr.processoId}`)}
            data-testid={`prazo-processo-link-${pr.id}`}
            style={{ color: 'var(--accent)', fontWeight: 600 }}
          >
            {numero}
          </a>
        );
      },
    },
    {
      key: 'quando',
      label: 'Quando',
      render: (pr) => {
        const d = diasRestantes(pr.dataLimite);
        return (
          <div className="stack stack-1">
            <Badge tone={diasTone(d)} data-testid={`prazo-dias-${pr.id}`}>{diasLabel(d)}</Badge>
            <span className="text-xs text-subtle">{formatDate(pr.dataLimite)}</span>
          </div>
        );
      },
    },
    { key: 'origem', label: 'Origem', render: (pr) => <OrigemBadge prazo={pr} /> },
    {
      key: 'acoes',
      label: '',
      align: 'right',
      render: (pr) => (
        <Button variant="ghost" size="sm" data-testid={`marcar-cumprido-${pr.id}`} onClick={() => onCumprir(pr)}>
          <IconCheck /> Marcar cumprido
        </Button>
      ),
    },
  ];
}

/*
 * Uma secção do radar: cabeçalho com ícone, título e contagem, seguido da tabela
 * de prazos do balde (ou um vazio próprio).
 */
function RadarBucket({ testid, icon, title, tone, rows, columns, emptyText }) {
  return (
    <section data-testid={testid} aria-label={title} style={{ marginBottom: 'var(--space-8, 2rem)' }}>
      <div className="row row-space-between" style={{ marginBottom: 'var(--space-3, 0.75rem)' }}>
        <div className="row row-2">
          <span className="row-icon" aria-hidden="true">{icon}</span>
          <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)', margin: 0 }}>{title}</h2>
        </div>
        <Badge tone={tone}>{rows.length}</Badge>
      </div>
      <DataTable columns={columns} rows={rows} empty={emptyText} />
    </section>
  );
}

export default function RadarPage() {
  const { items: prazos, loading, refresh } = useSharedCollection('prazos');
  const { items: processos } = useSharedCollection('processos');

  const [proxWindow, setProxWindow] = useState(7);
  const [confirming, setConfirming] = useState(null);

  const processoNumero = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || ''));
    return (id) => map.get(id) || '';
  }, [processos]);

  const pendentes = useMemo(
    () => prazos.filter((p) => (p.estado || 'pendente') !== 'cumprido'),
    [prazos],
  );

  const withDias = useMemo(
    () => pendentes.map((p) => ({ p, d: diasRestantes(p.dataLimite) })),
    [pendentes],
  );

  const vencidos = useMemo(
    () => withDias.filter((x) => Number.isFinite(x.d) && x.d < 0).sort((a, b) => a.d - b.d).map((x) => x.p),
    [withDias],
  );
  const hoje = useMemo(() => withDias.filter((x) => x.d === 0).map((x) => x.p), [withDias]);
  const proximos = useMemo(
    () => withDias.filter((x) => Number.isFinite(x.d) && x.d > 0 && x.d <= proxWindow).sort((a, b) => a.d - b.d).map((x) => x.p),
    [withDias, proxWindow],
  );

  const columns = useMemo(
    () => buildColumns(processoNumero, (pr) => setConfirming(pr)),
    [processoNumero],
  );

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
    <div data-testid="radar-page" data-demo-page="prazos/radar" data-demo-target="prazos-radar">
      <div className="page-header">
        <div>
          <h1 className="page-title">Radar de prazos</h1>
          <p className="page-subtitle">
            Os prazos pendentes por urgência. Os prazos são sagrados - o que está vencido ou a terminar aparece primeiro.
          </p>
        </div>
        <div className="chip-row" role="group" aria-label="Janela dos próximos prazos">
          <button
            type="button"
            className={`chip as-button${proxWindow === 7 ? ' is-active' : ''}`}
            data-testid="radar-window-7"
            onClick={() => setProxWindow(7)}
          >
            Próximos 7 dias
          </button>
          <button
            type="button"
            className={`chip as-button${proxWindow === 30 ? ' is-active' : ''}`}
            data-testid="radar-window-30"
            onClick={() => setProxWindow(30)}
          >
            Próximos 30 dias
          </button>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 'var(--space-8, 2rem)' }}>
        <div className="kpi-card">
          <span className="kpi-label">Vencidos</span>
          <span className="kpi-value is-danger" data-testid="kpi-vencidos">{vencidos.length}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Hoje</span>
          <span className="kpi-value is-warn" data-testid="kpi-hoje">{hoje.length}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Próximos {proxWindow} dias</span>
          <span className="kpi-value is-accent" data-testid="kpi-proximos">{proximos.length}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Total pendentes</span>
          <span className="kpi-value" data-testid="kpi-pendentes">{pendentes.length}</span>
        </div>
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <RadarBucket
            testid="radar-vencidos"
            icon={<IconAlertTriangle />}
            title="Vencidos"
            tone="alta"
            rows={vencidos}
            columns={columns}
            emptyText="Nada vencido. Todos os prazos pendentes estão dentro do prazo."
          />
          <RadarBucket
            testid="radar-hoje"
            icon={<IconClock />}
            title="Hoje"
            tone="media"
            rows={hoje}
            columns={columns}
            emptyText="Nada com prazo para hoje."
          />
          <RadarBucket
            testid="radar-proximos"
            icon={<IconCalendar />}
            title={`Próximos ${proxWindow} dias`}
            tone="info"
            rows={proximos}
            columns={columns}
            emptyText={`Nada a terminar nos próximos ${proxWindow} dias.`}
          />
        </>
      )}

      <ConfirmDialog
        open={!!confirming}
        title="Marcar prazo como cumprido"
        message={confirming ? `Confirma que "${prazoDescricao(confirming)}" foi cumprido? Sai do radar de prazos pendentes.` : ''}
        confirmLabel="Marcar cumprido"
        onConfirm={doCumprir}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
