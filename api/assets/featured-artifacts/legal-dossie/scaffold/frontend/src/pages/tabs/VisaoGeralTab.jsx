import { useMemo } from 'react';
import { formatDate, formatEur, diasRestantes, appHref } from '../../shared.js';
import { EmptyState } from '../../components/ui.jsx';
import {
  IconUserCircle,
  IconCalendar,
  IconFileText,
  IconMail,
  IconCoins,
  IconExternalLink,
} from '../../components/Icons.jsx';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/*
 * Separador Visão Geral: um retrato do processo num relance - cliente, estado,
 * próximo prazo, últimos eventos, resumo de honorários e contagens. Só leitura;
 * os cartões ligam aos separadores de detalhe.
 */
export default function VisaoGeralTab({
  processo,
  cliente,
  prazos,
  eventos,
  documentos,
  comunicacoes,
  lancamentos,
  onNavigateTab,
}) {
  const proximoPrazo = useMemo(() => {
    let best = null;
    for (const p of prazos) {
      if (!p || p.estado === 'cumprido') continue;
      const dias = diasRestantes(p.dataLimite);
      if (!Number.isFinite(dias)) continue;
      if (!best || dias < best.dias) best = { prazo: p, dias };
    }
    return best;
  }, [prazos]);

  const ultimosEventos = useMemo(() => {
    return eventos
      .slice()
      .sort((a, b) => String(b.data || b.createdAt || '').localeCompare(String(a.data || a.createdAt || '')))
      .slice(0, 4);
  }, [eventos]);

  const honorarios = useMemo(() => {
    let total = 0;
    let porFaturar = 0;
    for (const l of lancamentos) {
      const v = Number(l.valor);
      const valor = Number.isFinite(v) ? v : 0;
      total += valor;
      if (l.faturado !== true) porFaturar += valor;
    }
    return { total: round2(total), porFaturar: round2(porFaturar), count: lancamentos.length };
  }, [lancamentos]);

  return (
    <div className="stack stack-6" data-testid="visao-geral">
      {/* ---- KPIs ---- */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Próximo prazo</span>
          {proximoPrazo ? (
            <>
              <span
                className={`kpi-value ${proximoPrazo.dias < 0 ? 'is-danger' : proximoPrazo.dias <= 7 ? 'is-warn' : ''}`}
              >
                {proximoPrazo.dias < 0
                  ? `Vencido há ${Math.abs(proximoPrazo.dias)}d`
                  : proximoPrazo.dias === 0
                  ? 'Hoje'
                  : `${proximoPrazo.dias} dias`}
              </span>
              <span className="stat-foot">
                {proximoPrazo.prazo.titulo || proximoPrazo.prazo.descricao || 'Prazo'} ·{' '}
                {formatDate(proximoPrazo.prazo.dataLimite)}
              </span>
            </>
          ) : (
            <>
              <span className="kpi-value">—</span>
              <span className="stat-foot">Sem prazos pendentes.</span>
            </>
          )}
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Honorários por faturar</span>
          <span className="kpi-value is-accent">{formatEur(honorarios.porFaturar)}</span>
          <span className="stat-foot">
            {honorarios.count} lançamento{honorarios.count === 1 ? '' : 's'} · {formatEur(honorarios.total)} no total
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Documentos</span>
          <span className="kpi-value">{documentos.length}</span>
          <span className="stat-foot">no dossiê do processo</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Comunicações</span>
          <span className="kpi-value">{comunicacoes.length}</span>
          <span className="stat-foot">mensagens ligadas</span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 'var(--sp-4)',
          alignItems: 'start',
        }}
      >
        {/* ---- Cliente ---- */}
        <div className="card stack stack-3">
          <div className="row row-2" style={{ gap: 'var(--sp-2)' }}>
            <span className="row-icon">
              <IconUserCircle />
            </span>
            <h2 className="card-title" style={{ margin: 0 }}>
              Cliente
            </h2>
          </div>
          {cliente ? (
            <div className="dossie-id-grid">
              <div className="dossie-id-row">
                <span className="dossie-id-label">Nome</span>
                <span className="dossie-id-value">{cliente.nome || '—'}</span>
              </div>
              <div className="dossie-id-row">
                <span className="dossie-id-label">NIF</span>
                <span className="dossie-id-value">{cliente.nif || '—'}</span>
              </div>
              <div className="dossie-id-row">
                <span className="dossie-id-label">Email</span>
                <span className="dossie-id-value">{cliente.email || '—'}</span>
              </div>
              <div className="dossie-id-row">
                <span className="dossie-id-label">Telefone</span>
                <span className="dossie-id-value">{cliente.telefone || '—'}</span>
              </div>
            </div>
          ) : (
            <p className="text-muted text-small" style={{ margin: 0 }}>
              Sem cliente associado a este processo.
            </p>
          )}
        </div>

        {/* ---- Processo ---- */}
        <div className="card stack stack-3">
          <h2 className="card-title" style={{ margin: 0 }}>
            Processo
          </h2>
          <div className="dossie-id-grid">
            <div className="dossie-id-row">
              <span className="dossie-id-label">Tribunal</span>
              <span className="dossie-id-value">{processo.tribunal || '—'}</span>
            </div>
            <div className="dossie-id-row">
              <span className="dossie-id-label">Comarca</span>
              <span className="dossie-id-value">{processo.comarca || '—'}</span>
            </div>
            <div className="dossie-id-row">
              <span className="dossie-id-label">Área</span>
              <span className="dossie-id-value">{processo.area || '—'}</span>
            </div>
            <div className="dossie-id-row">
              <span className="dossie-id-label">Advogado responsável</span>
              <span className="dossie-id-value">{processo.advogadoResponsavel || '—'}</span>
            </div>
          </div>
          {processo.descricao ? (
            <p className="text-muted text-small" style={{ margin: 0, lineHeight: 1.6 }}>
              {processo.descricao}
            </p>
          ) : null}
        </div>
      </div>

      {/* ---- Últimos eventos ---- */}
      <div className="card stack stack-3">
        <div className="row row-space-between">
          <div className="row row-2" style={{ gap: 'var(--sp-2)' }}>
            <span className="row-icon">
              <IconCalendar />
            </span>
            <h2 className="card-title" style={{ margin: 0 }}>
              Últimos eventos
            </h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigateTab && onNavigateTab('cronologia')}>
            Ver cronologia
          </button>
        </div>
        {ultimosEventos.length === 0 ? (
          <p className="text-muted text-small" style={{ margin: 0 }}>
            Sem eventos registados.
          </p>
        ) : (
          <ul className="dossie-timeline">
            {ultimosEventos.map((e) => (
              <li key={e.id} className="dossie-timeline-item">
                <span className="dossie-timeline-date">{formatDate(e.data)}</span>
                <div className="dossie-timeline-body">
                  <span className="dossie-timeline-titulo">{e.titulo || '(sem título)'}</span>
                  {e.tipo ? <span className="dossie-timeline-tipo">{e.tipo}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Atalhos ---- */}
      <div className="row row-3" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigateTab && onNavigateTab('documentos')}>
          <IconFileText size={14} /> Abrir documentos
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigateTab && onNavigateTab('comunicacoes')}>
          <IconMail size={14} /> Ver comunicações
        </button>
        <a className="btn btn-secondary btn-sm" href={appHref('legal-honorarios')}>
          <IconCoins size={14} /> Honorários <IconExternalLink size={12} />
        </a>
        <a className="btn btn-secondary btn-sm" href={appHref('legal-prazos')}>
          <IconCalendar size={14} /> Radar de prazos <IconExternalLink size={12} />
        </a>
      </div>

      {prazos.length === 0 && eventos.length === 0 && documentos.length === 0 ? (
        <EmptyState
          title="Dossiê ainda vazio"
          hint="Carregue documentos, associe comunicações e registe eventos para começar a construir o dossiê deste processo."
        />
      ) : null}
    </div>
  );
}
