import { useEffect, useMemo, useState } from 'react';
import { useSharedCollection, listShared, createShared, deleteShared, formatDate } from '../shared.js';
import { construirAgendaPublica } from '../engine/agenda.mjs';
import { useDemoResult } from '../demo.js';
import { Badge, Button, Skeleton, EmptyState, useToast } from '../components/ui.jsx';
import {
  IconCalendarClock, IconChevronRight, IconDownload, IconPrinter, IconAlertTriangle,
} from '../components/Icons.jsx';
import {
  semanaDe, ymdLocal, rotuloDia, ehHoje, horaDe, dataDe,
  eventoTipoLabel, eventoTipoTone, reservaEstadoLabel, reservaEstadoTone,
  sobreposicoesDeParticipantes,
} from './agenda-logic.js';
import { construirIcs, eventoParaVevent, reservaParaVevent, descarregarIcs } from './ics.js';
import { htmlAgendaPrint } from './agenda-print.js';

/*
 * Vista de semana da agenda partilhada: sete colunas (Segunda→Domingo) da semana
 * corrente, com os eventos do processo (dia inteiro) e as reservas confirmadas
 * (com hora) de cada dia. Por baixo, as próximas reservas em lista. Tudo lido da
 * espinha partilhada — a mesma que a Caixa Citius e o Núcleo alimentam.
 */
export default function AgendaPage() {
  const { items: eventos, loading: lE } = useSharedCollection('eventos');
  const { items: reservas, loading: lR } = useSharedCollection('reservas');
  const { items: tipos } = useSharedCollection('sessao_tipos');
  const { items: pessoas } = useSharedCollection('pessoas');
  const toast = useToast();
  const loading = lE || lR;

  const [refDate, setRefDate] = useState(() => new Date());
  const semana = useMemo(() => semanaDe(refDate), [refDate]);

  const tipoNome = useMemo(() => {
    const map = new Map();
    (tipos || []).forEach((t) => map.set(t.id, t.nome));
    return (id) => map.get(id) || 'Sessão';
  }, [tipos]);

  function shiftSemana(delta) {
    const d = new Date(refDate);
    d.setDate(d.getDate() + delta * 7);
    setRefDate(d);
  }

  // Itens por dia: eventos (data === dia) + reservas confirmadas (dia do início).
  const porDia = useMemo(() => {
    const map = new Map(semana.map((d) => [d, { eventos: [], reservas: [] }]));
    for (const e of eventos || []) {
      const cell = map.get(e && e.data);
      if (cell) cell.eventos.push(e);
    }
    for (const r of reservas || []) {
      if (!r || r.estado !== 'confirmada') continue;
      const cell = map.get(dataDe(r.inicio));
      if (cell) cell.reservas.push(r);
    }
    for (const cell of map.values()) {
      cell.reservas.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    }
    return map;
  }, [semana, eventos, reservas]);

  // Próximas reservas activas (confirmada/pendente) a partir de hoje.
  const proximas = useMemo(() => {
    const hoje = ymdLocal(new Date());
    return (reservas || [])
      .filter((r) => r && (r.estado === 'confirmada' || r.estado === 'pendente_pagamento') && dataDe(r.inicio) >= hoje)
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
      .slice(0, 8);
  }, [reservas]);

  const rotuloSemana = `${formatDate(semana[0])} – ${formatDate(semana[6])}`;

  const pessoaNome = useMemo(() => {
    const map = new Map((pessoas || []).map((p) => [p.id, p.nome]));
    return (id) => map.get(id) || 'Participante';
  }, [pessoas]);

  // Aviso de sobreposição por participante nas marcações COM hora desta semana.
  const sobreposicoes = useMemo(() => (
    loading ? [] : sobreposicoesDeParticipantes({ eventos, reservas, sessaoTipos: tipos, dias: semana })
  ), [loading, eventos, reservas, tipos, semana]);

  // .ics determinista da semana no ecrã: eventos + reservas confirmadas, pela
  // ordem dos dias (a mesma da grelha).
  const exportarIcsSemana = () => {
    const vevents = [];
    for (const dia of semana) {
      const cell = porDia.get(dia) || { eventos: [], reservas: [] };
      for (const e of cell.eventos) vevents.push(eventoParaVevent(e));
      for (const r of cell.reservas) vevents.push(reservaParaVevent(r, tipoNome(r.sessaoTipoId)));
    }
    descarregarIcs(`agenda-semana-${semana[0]}.ics`, construirIcs(vevents));
  };

  const exportarIcsReserva = (r) => {
    descarregarIcs(`reserva-${r.id}.ics`, construirIcs([reservaParaVevent(r, tipoNome(r.sessaoTipoId))]));
  };

  // Impressão via exportPdf da plataforma; sem a capacidade, falha com
  // honestidade (aviso, nunca um sucesso fingido).
  const imprimir = async (dias, titulo, { landscape, filename }) => {
    const api = typeof window !== 'undefined' ? window.__ekoa : null;
    if (!api || typeof api.exportPdf !== 'function') {
      toast('Exportação PDF indisponível neste ambiente.', { tone: 'error' });
      return;
    }
    try {
      const html = htmlAgendaPrint({
        titulo,
        subtitulo: 'Eventos dos processos e reservas confirmadas · agenda partilhada do escritório',
        dias,
        porDia,
        tipoNome,
      });
      await api.exportPdf({ html, format: 'A4', landscape, filename });
    } catch {
      toast('Não foi possível gerar o PDF.', { tone: 'error' });
    }
  };

  // Sinaliza à ponte de demonstração que a semana está no ecrã (annotate-result).
  useDemoResult('agenda-semana', !loading);

  // PRIVACIDADE: publica a agenda saneada (`agenda_publica`, só {tipo, inicio,
  // fim} dos horários livres públicos) que a página anónima de reservas lê -
  // essa página nunca pode ler reservas/eventos/disponibilidades/ausências.
  // O backend refresca o mesmo conteúdo em cada callback; aqui refresca-se
  // sempre que a equipa abre a agenda. Reconciliação por chave, não fatal.
  useEffect(() => {
    if (loading) return undefined;
    let cancelado = false;
    (async () => {
      try {
        const agora = new Date().toISOString();
        const [sessaoTipos, disponibilidades, evs, ausencias, res, atuais] = await Promise.all([
          listShared('sessao_tipos'), listShared('disponibilidades'), listShared('eventos'),
          listShared('ausencias'), listShared('reservas'), listShared('agenda_publica'),
        ]);
        if (cancelado) return;
        const deDate = agora.slice(0, 10);
        const ate = new Date(); ate.setDate(ate.getDate() + 14);
        const linhas = construirAgendaPublica({
          sessaoTipos, disponibilidades, eventos: evs, ausencias, reservas: res,
          deDate, ateDate: ymdLocal(ate), agora,
        });
        const chave = (l) => `${l.sessaoTipoId}|${l.inicio}|${l.fim}`;
        const desejadas = new Set(linhas.map(chave));
        const existentes = new Map((atuais || []).map((l) => [chave(l), l]));
        for (const [k, row] of existentes) {
          if (!desejadas.has(k)) { try { await deleteShared('agenda_publica', row.id); } catch { /* não fatal */ } }
        }
        for (const linha of linhas) {
          if (!existentes.has(chave(linha))) { try { await createShared('agenda_publica', linha); } catch { /* não fatal */ } }
        }
      } catch { /* não fatal - a agenda da equipa renderiza na mesma */ }
    })();
    return () => { cancelado = true; };
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="agenda-page" data-demo-page="agenda/semana">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agenda da semana</h1>
          <p className="page-subtitle">
            Eventos dos processos e reservas confirmadas, sobre a espinha partilhada. Barra de navegação para percorrer as semanas.
          </p>
        </div>
        <div className="page-actions row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
          <Button variant="secondary" size="sm" data-testid="semana-prev" onClick={() => shiftSemana(-1)} aria-label="Semana anterior">
            <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><IconChevronRight /></span>
          </Button>
          <span className="text-strong" data-testid="semana-label" style={{ minWidth: '12rem', textAlign: 'center' }}>{rotuloSemana}</span>
          <Button variant="secondary" size="sm" data-testid="semana-next" onClick={() => shiftSemana(1)} aria-label="Semana seguinte">
            <IconChevronRight />
          </Button>
          <Button variant="ghost" size="sm" data-testid="semana-hoje" onClick={() => setRefDate(new Date())}>Hoje</Button>
          <Button variant="secondary" size="sm" data-testid="agenda-exportar-ics" disabled={loading} onClick={exportarIcsSemana}>
            <IconDownload /> Exportar .ics
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="agenda-print-semana"
            disabled={loading}
            onClick={() => imprimir(semana, `Agenda da semana ${rotuloSemana}`, { landscape: true, filename: `agenda-semana-${semana[0]}.pdf` })}
          >
            <IconPrinter /> Imprimir semana
          </Button>
        </div>
      </div>

      {sobreposicoes.length > 0 ? (
        <section
          className="card"
          data-testid="agenda-sobreposicoes"
          aria-label="Sobreposições de participantes"
          style={{ marginBottom: 'var(--sp-4, 1rem)', borderColor: '#f0c36d', background: '#fef6e7' }}
        >
          <h2 className="card-title row row-2" style={{ marginBottom: 'var(--sp-2, 0.5rem)' }}>
            <IconAlertTriangle /> Sobreposições de participantes
          </h2>
          <p className="text-small text-subtle" style={{ margin: '0 0 var(--sp-2, 0.5rem)' }}>
            Marcações com hora desta semana em que o mesmo participante está em dois sítios ao mesmo tempo.
          </p>
          <ul className="stack stack-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sobreposicoes.map((c, i) => (
              <li key={i} data-testid="agenda-sobreposicao" className="text-small">
                <span className="text-strong">{pessoaNome(c.pessoaId)}</span>
                {': '}{c.a.rotulo} ({dataDe(c.a.inicio)} {horaDe(c.a.inicio)}-{horaDe(c.a.fim)}) sobrepõe-se a {c.b.rotulo} ({horaDe(c.b.inicio)}-{horaDe(c.b.fim)})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? (
        <Skeleton lines={6} />
      ) : (
        <section
          className="card"
          aria-label="Semana"
          data-testid="agenda-semana"
          data-demo-target="agenda-semana"
          style={{ overflowX: 'auto' }}
        >
          <div className="agenda-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(7.5rem, 1fr))', gap: 'var(--sp-2, 0.5rem)', minWidth: '56rem' }}>
            {semana.map((dia) => {
              const cell = porDia.get(dia) || { eventos: [], reservas: [] };
              const vazio = cell.eventos.length === 0 && cell.reservas.length === 0;
              return (
                <div
                  key={dia}
                  data-testid="agenda-dia"
                  data-dia={dia}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--r-2, 0.5rem)',
                    padding: 'var(--sp-2, 0.5rem)',
                    background: ehHoje(dia) ? 'var(--accent-weak, #eaeff4)' : 'var(--color-surface, #fff)',
                    minHeight: '9rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--sp-2, 0.5rem)',
                  }}
                >
                  <span className="row row-space-between" style={{ alignItems: 'center' }}>
                    <span className="text-xs text-strong" style={{ textTransform: 'capitalize' }}>{rotuloDia(dia)}</span>
                    <button
                      type="button"
                      data-testid="agenda-print-dia"
                      data-dia={dia}
                      aria-label={`Imprimir o dia ${dia}`}
                      title="Imprimir este dia"
                      onClick={() => imprimir([dia], `Agenda de ${rotuloDia(dia)} · ${dia}`, { landscape: false, filename: `agenda-dia-${dia}.pdf` })}
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--color-text-subtle, #6b7280)', display: 'inline-flex' }}
                    >
                      <IconPrinter />
                    </button>
                  </span>
                  {vazio ? (
                    <span className="text-xs text-subtle">—</span>
                  ) : (
                    <div className="stack" style={{ gap: 'var(--sp-1, 0.25rem)' }}>
                      {cell.eventos.map((e) => (
                        <span
                          key={e.id}
                          data-testid="agenda-chip"
                          data-tipo={e.tipo}
                          className="text-xs"
                          title={e.titulo}
                          style={chipStyle(eventoTipoTone(e.tipo))}
                        >
                          <strong style={{ fontWeight: 600 }}>{eventoTipoLabel(e.tipo)}</strong>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.titulo}</span>
                        </span>
                      ))}
                      {cell.reservas.map((r) => (
                        <span
                          key={r.id}
                          data-testid="agenda-reserva-chip"
                          className="text-xs"
                          title={`${horaDe(r.inicio)} · ${tipoNome(r.sessaoTipoId)}`}
                          style={chipStyle('ok')}
                        >
                          <strong style={{ fontWeight: 600 }}>{horaDe(r.inicio)} · {r.nome}</strong>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tipoNome(r.sessaoTipoId)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section style={{ marginTop: 'var(--sp-6, 1.5rem)' }} aria-label="Próximas reservas">
        <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)', marginBottom: 'var(--sp-3, 0.75rem)' }}>Próximas reservas</h2>
        {proximas.length === 0 ? (
          <EmptyState icon={<IconCalendarClock />} title="Sem reservas futuras" hint="As marcações confirmadas aparecem aqui, por ordem de data." />
        ) : (
          <ul className="stack stack-2" data-testid="agenda-proximas" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {proximas.map((r) => (
              <li
                key={r.id}
                data-testid="agenda-proxima"
                className="card"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3, 0.75rem)', padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)' }}
              >
                <div className="stack" style={{ gap: 2 }}>
                  <span className="text-strong">{r.nome}</span>
                  <span className="text-small text-subtle">{tipoNome(r.sessaoTipoId)} · {formatDate(dataDe(r.inicio))} às {horaDe(r.inicio)}</span>
                </div>
                <div className="row row-2" style={{ alignItems: 'center' }}>
                  <Badge tone={reservaEstadoTone(r.estado)}>{reservaEstadoLabel(r.estado)}</Badge>
                  <Button variant="ghost" size="sm" data-testid="agenda-proxima-ics" aria-label={`Descarregar .ics de ${r.nome}`} onClick={() => exportarIcsReserva(r)}>
                    <IconDownload /> .ics
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function chipStyle(tone) {
  const bg = {
    ok: 'var(--accent-weak, #eaeff4)',
    alta: '#fdecec',
    media: '#fef6e7',
    info: '#eef4fb',
    neutral: 'var(--color-surface-muted, #f1f5f9)',
  }[tone] || 'var(--color-surface-muted, #f1f5f9)';
  return {
    display: 'block',
    background: bg,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--r-1, 0.375rem)',
    padding: '2px 6px',
    lineHeight: 1.25,
  };
}
