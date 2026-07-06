import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useSharedCollection, updateShared, appHref, diasRestantes, formatDate,
} from '../shared.js';
import { instalarDemo, removerDemo } from '../demo-spine.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import {
  IconFolder, IconAlertTriangle, IconClock, IconCheckSquare, IconCheck, IconInbox,
  IconBell, IconChevronRight, IconExternalLink,
} from '../components/Icons.jsx';
import { GlobalSearch, DeadlineBadge } from './widgets.jsx';

/* Verdadeiro se a tarefa está por concluir e a data-limite é hoje ou passou. */
function isTarefaParaHoje(t) {
  if (!t || t.estado === 'concluida') return false;
  const d = diasRestantes(t.prazo);
  return !Number.isNaN(d) && d <= 0;
}

export default function DashboardPage() {
  const toast = useToast();
  const { items: processos } = useSharedCollection('processos');
  const { items: prazos } = useSharedCollection('prazos');
  const { items: tarefas, refresh: refreshTarefas } = useSharedCollection('tarefas');
  const { items: comunicacoes } = useSharedCollection('comunicacoes');
  const { items: notificacoes } = useSharedCollection('notificacoes');

  const numeroPorProcesso = useMemo(() => {
    const map = new Map(processos.map((p) => [p.id, p.numeroProcesso || 'Sem número']));
    return (id) => map.get(id) || 'Processo';
  }, [processos]);

  const kpis = useMemo(() => {
    const pendentes = prazos.filter((p) => (p.estado || 'pendente') === 'pendente');
    const vencidos = pendentes.filter((p) => { const d = diasRestantes(p.dataLimite); return !Number.isNaN(d) && d < 0; });
    const hoje = pendentes.filter((p) => diasRestantes(p.dataLimite) === 0);
    const sete = pendentes.filter((p) => { const d = diasRestantes(p.dataLimite); return d >= 1 && d <= 7; });
    return {
      processosAtivos: processos.filter((p) => (p.estado || 'ativo') === 'ativo').length,
      prazosVencidos: vencidos.length,
      prazosHoje: hoje.length,
      prazos7d: sete.length,
      // KPI conta SÓ as que vencem hoje (dias===0). O painel "Hoje" abaixo é que
      // mostra vencidas+hoje (o seu rótulo já o diz).
      tarefasHoje: tarefas.filter((t) => t.estado !== 'concluida' && diasRestantes(t.prazo) === 0).length,
      comunicacoes: comunicacoes.filter((c) => (c.status || 'por-associar') === 'por-associar').length,
    };
  }, [processos, prazos, tarefas, comunicacoes]);

  const radar = useMemo(() => (
    prazos
      .filter((p) => (p.estado || 'pendente') === 'pendente')
      .map((p) => ({ ...p, dias: diasRestantes(p.dataLimite) }))
      .filter((p) => !Number.isNaN(p.dias))
      .sort((a, b) => a.dias - b.dias)
      .slice(0, 5)
  ), [prazos]);

  const hoje = useMemo(() => (
    tarefas
      .filter(isTarefaParaHoje)
      .map((t) => ({ ...t, dias: diasRestantes(t.prazo) }))
      .sort((a, b) => a.dias - b.dias)
  ), [tarefas]);

  const notifs = useMemo(() => (
    [...notificacoes]
      .sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime())
      .slice(0, 6)
  ), [notificacoes]);

  const concluir = async (t) => {
    try {
      await updateShared('tarefas', t.id, { estado: 'concluida', concluidaEm: new Date().toISOString() });
      await refreshTarefas();
      toast('Tarefa marcada como concluída.', { tone: 'ok' });
    } catch {
      toast('Não foi possível concluir a tarefa.', { tone: 'error' });
    }
  };

  const kpiCards = [
    { key: 'processos-ativos', label: 'Processos ativos', value: kpis.processosAtivos, tone: 'is-accent', icon: <IconFolder /> },
    { key: 'prazos-vencidos', label: 'Prazos vencidos', value: kpis.prazosVencidos, tone: 'is-danger', icon: <IconAlertTriangle /> },
    { key: 'prazos-hoje', label: 'Prazos para hoje', value: kpis.prazosHoje, tone: 'is-warn', icon: <IconClock /> },
    { key: 'prazos-7d', label: 'Prazos a 7 dias', value: kpis.prazos7d, tone: '', icon: <IconClock /> },
    { key: 'tarefas-hoje', label: 'Tarefas para hoje', value: kpis.tarefasHoje, tone: 'is-warn', icon: <IconCheckSquare /> },
    { key: 'comunicacoes', label: 'Comunicações por associar', value: kpis.comunicacoes, tone: 'is-accent', icon: <IconInbox /> },
  ];

  return (
    <div data-testid="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">Painel do escritório</h1>
          <p className="page-subtitle">Prazos, tarefas e comunicações do dia - o núcleo partilhado da sua edição jurídica.</p>
        </div>
        <GlobalSearch />
      </div>

      <div className="kpi-grid" data-testid="kpi-row" data-demo-target="nucleo-kpis" style={{ marginBottom: 'var(--sp-6, 1.5rem)' }}>
        {kpiCards.map((k) => (
          <div className="kpi-card" key={k.key} data-testid={`kpi-${k.key}`}>
            <span className="kpi-label row row-2">
              <span className="row-icon" aria-hidden="true">{k.icon}</span>
              {k.label}
            </span>
            <span className={`kpi-value ${k.tone}`} data-testid={`kpi-${k.key}-value`}>{k.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 'var(--sp-6, 1.5rem)', alignItems: 'start' }} className="dashboard-columns">
        <div className="stack stack-6">
          {/* Radar de prazos */}
          <section className="card" data-testid="radar-widget" data-demo-target="nucleo-radar">
            <div className="row row-space-between" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>
              <div>
                <h2 className="card-title">Radar de prazos</h2>
                <p className="card-subtitle">Os prazos pendentes mais próximos, por ordem de urgência.</p>
              </div>
              <a href={appHref('legal-prazos')} className="btn btn-secondary btn-sm" data-testid="radar-ver-todos">
                Abrir Prazos <IconExternalLink />
              </a>
            </div>
            {radar.length === 0 ? (
              <p className="text-small text-subtle" style={{ margin: 0 }}>Sem prazos pendentes.</p>
            ) : (
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {radar.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/processos/${p.processoId}`}
                      data-testid="radar-item"
                      className="row row-space-between"
                      style={{ gap: 'var(--sp-3, 0.75rem)', padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)' }}
                    >
                      <span className="stack stack-1" style={{ minWidth: 0 }}>
                        <span className="text-strong">{p.descricao || p.titulo || 'Prazo'}</span>
                        <span className="text-xs text-subtle numeric">{numeroPorProcesso(p.processoId)}</span>
                      </span>
                      <span className="row row-2" style={{ flexShrink: 0 }}>
                        <span className="text-xs text-subtle">{formatDate(p.dataLimite)}</span>
                        <DeadlineBadge date={p.dataLimite} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Hoje - tarefas a vencer */}
          <section className="card" data-testid="hoje-panel">
            <div className="row row-space-between" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>
              <div>
                <h2 className="card-title">Hoje</h2>
                <p className="card-subtitle">Tarefas vencidas ou a terminar hoje. Conclua com um clique.</p>
              </div>
              <Link to="/tarefas" className="btn btn-secondary btn-sm" data-testid="hoje-ver-tarefas">
                Ver tarefas <IconChevronRight />
              </Link>
            </div>
            {hoje.length === 0 ? (
              <div className="row row-2 text-small" style={{ color: 'var(--ok)' }}>
                <IconCheck /> Sem tarefas por concluir para hoje.
              </div>
            ) : (
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {hoje.map((t) => (
                  <li key={t.id} className="row row-3" data-testid="hoje-item" style={{ padding: 'var(--sp-2, 0.5rem) var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', gap: 'var(--sp-3, 0.75rem)' }}>
                    <input
                      type="checkbox"
                      aria-label={`Concluir tarefa: ${t.titulo}`}
                      data-testid="hoje-concluir"
                      onChange={() => concluir(t)}
                      style={{ width: 18, height: 18, accentColor: 'var(--accent)', flexShrink: 0 }}
                    />
                    <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
                      <span className="text-strong">{t.titulo}</span>
                      <span className="text-xs text-subtle">{t.responsavel || 'Sem responsável'}</span>
                    </span>
                    <DeadlineBadge date={t.prazo} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Notificações recentes */}
        <section className="card" data-testid="notificacoes-recentes">
          <div className="row row-2" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>
            <span className="row-icon" aria-hidden="true"><IconBell /></span>
            <h2 className="card-title" style={{ margin: 0 }}>Notificações recentes</h2>
          </div>
          {notifs.length === 0 ? (
            <EmptyState title="Tudo em dia" hint="Sem notificações recentes." />
          ) : (
            <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {notifs.map((n) => {
                const content = (
                  <span className="stack stack-1" style={{ width: '100%' }}>
                    <span className="row row-2">
                      {!n.lida ? <Badge tone="info">Nova</Badge> : null}
                      <span className="text-strong">{n.titulo || 'Notificação'}</span>
                    </span>
                    {n.corpo ? <span className="text-xs text-muted">{n.corpo}</span> : null}
                    <span className="text-xs text-subtle numeric">{formatDate(n.data)}</span>
                  </span>
                );
                const style = { display: 'block', padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)' };
                return (
                  <li key={n.id} data-testid="notificacao-item">
                    {n.href ? <a href={n.href} style={style}>{content}</a> : <div style={style}>{content}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Conjunto de demonstração Fonseca & Associados */}
        <DemoSpineCard />
      </div>
    </div>
  );
}

/*
 * Cartão de gestão do conjunto de demonstração (espinha demo). Instala/remove o
 * conjunto Fonseca & Associados; a remoção apaga exclusivamente registos
 * demo-marcados. Enquanto instalado, todas as apps mostram a faixa transversal.
 */
function DemoSpineCard() {
  const toast = useToast();
  const { items: demoEstado, refresh } = useSharedCollection('demo_estado');
  const [aCorrer, setACorrer] = useState(false);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const instalada = demoEstado.some((r) => r && r.ativo);

  const instalar = async () => {
    setACorrer(true);
    try {
      const r = await instalarDemo();
      toast(r.jaInstalada ? 'O conjunto de demonstração já se encontra instalado.' : 'Conjunto de demonstração instalado.');
      window.location.reload();
    } catch {
      toast('Não foi possível instalar o conjunto de demonstração.');
      setACorrer(false);
    }
  };

  const remover = async () => {
    setACorrer(true);
    setConfirmarRemocao(false);
    try {
      await removerDemo();
      toast('Registos de demonstração removidos.');
      window.location.reload();
    } catch {
      toast('Não foi possível remover o conjunto de demonstração.');
      setACorrer(false);
    }
  };

  return (
    <section className="card" data-testid="demo-spine-card" data-demo-target="nucleo-demonstracao">
      <div className="stack stack-2">
        <h2 className="card-title" style={{ margin: 0 }}>Demonstração</h2>
        <p className="card-subtitle" style={{ margin: 0 }}>
          Conjunto de demonstração Fonseca &amp; Associados - dados fictícios para explorar a suite completa.
          Nenhuma ação de demonstração toca sistemas externos reais.
        </p>
        <div className="row row-2" data-testid="demo-estado">
          {instalada
            ? <Badge tone="media">Instalado</Badge>
            : <Badge>Não instalado</Badge>}
        </div>
        {!instalada ? (
          <Button data-testid="demo-instalar" disabled={aCorrer} onClick={instalar}>
            Instalar dados de demonstração
          </Button>
        ) : confirmarRemocao ? (
          <div className="stack stack-2">
            <p className="text-small" style={{ margin: 0 }}>
              A remoção apaga exclusivamente os registos de demonstração; os dados reais permanecem intactos. Confirmar?
            </p>
            <div className="row row-2">
              <Button data-testid="demo-remover-confirmar" disabled={aCorrer} onClick={remover}>Remover</Button>
              <Button variant="secondary" onClick={() => setConfirmarRemocao(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" data-testid="demo-remover" disabled={aCorrer} onClick={() => setConfirmarRemocao(true)}>
            Remover dados de demonstração
          </Button>
        )}
      </div>
    </section>
  );
}
