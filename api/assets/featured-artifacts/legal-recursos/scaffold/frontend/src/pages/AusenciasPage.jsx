import { useMemo, useState } from 'react';
import { useSharedCollection, formatDate } from '../shared.js';
import { Badge, Button, Skeleton, EmptyState, DataTable } from '../components/ui.jsx';
import { IconChevronRight, IconCalendar } from '../components/Icons.jsx';
import {
  diasNoMes, nomeMes, intersecaoNoMes, tipoLabel, tipoTone, estadoLabel, estadoTone,
} from './recursos-logic.js';

/*
 * Mapa de férias: uma faixa por mês (predefinição: mês corrente) com uma linha
 * por pessoa. As férias aprovadas aparecem como barras preenchidas; as pedidas
 * como barras contornadas. Por baixo, uma tabela simples das ausências de férias
 * que tocam o mês - o mesmo dado em texto, para leitura directa e para quem
 * prefere a lista à faixa visual.
 */
export default function AusenciasPage() {
  const { items: pessoas, loading } = useSharedCollection('pessoas');
  const { items: ausencias } = useSharedCollection('ausencias');

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());

  function shiftMes(delta) {
    const total = mes + delta;
    setAno(ano + Math.floor(total / 12));
    setMes(((total % 12) + 12) % 12);
  }

  const dias = diasNoMes(ano, mes);

  const pessoaNome = useMemo(() => {
    const map = new Map();
    pessoas.forEach((p) => map.set(p.id, p.nome));
    return (id) => map.get(id) || '—';
  }, [pessoas]);

  // Férias (aprovadas + pedidas) que tocam o mês, com a fatia 1-based no mês.
  const feriasDoMes = useMemo(() => {
    const out = [];
    for (const a of ausencias) {
      if (a.tipo !== 'ferias') continue;
      const inter = intersecaoNoMes(a, ano, mes);
      if (!inter) continue;
      out.push({ ...a, ...inter });
    }
    return out;
  }, [ausencias, ano, mes]);

  const porPessoa = useMemo(() => {
    const map = new Map();
    for (const f of feriasDoMes) {
      const arr = map.get(f.pessoaId) || [];
      arr.push(f);
      map.set(f.pessoaId, arr);
    }
    return map;
  }, [feriasDoMes]);

  // Linhas da faixa: todas as pessoas ordenadas por antiguidade, cada uma com as
  // suas barras (vazio quando não tem férias no mês).
  const linhas = useMemo(
    () => pessoas
      .slice()
      .sort((a, b) => String(a.dataAdmissao || '').localeCompare(String(b.dataAdmissao || '')))
      .map((p) => ({ pessoa: p, barras: porPessoa.get(p.id) || [] })),
    [pessoas, porPessoa],
  );

  return (
    <div data-testid="ausencias-page" data-demo-page="recursos/ausencias">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mapa de ausências</h1>
          <p className="page-subtitle">
            As férias da equipa mês a mês. Barra cheia: aprovada. Barra contornada: pedida.
          </p>
        </div>
        <div className="page-actions row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
          <Button variant="secondary" size="sm" data-testid="mapa-prev" onClick={() => shiftMes(-1)} aria-label="Mês anterior">
            <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><IconChevronRight /></span>
          </Button>
          <span className="text-strong" data-testid="mapa-mes-label" style={{ minWidth: '9rem', textAlign: 'center' }}>{nomeMes(ano, mes)}</span>
          <Button variant="secondary" size="sm" data-testid="mapa-next" onClick={() => shiftMes(1)} aria-label="Mês seguinte">
            <IconChevronRight />
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : pessoas.length === 0 ? (
        <EmptyState icon={<IconCalendar />} title="Sem pessoas" hint="As pessoas vêm do Núcleo partilhado." />
      ) : (
        <section className="card" aria-label="Mapa de férias" data-testid="mapa-ferias">
          <div className="row row-2" style={{ gap: 'var(--sp-4, 1rem)', marginBottom: 'var(--sp-4, 1rem)', flexWrap: 'wrap' }}>
            <span className="row row-2 text-xs text-subtle" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: 22, height: 12, borderRadius: 3, background: 'var(--accent)' }} /> Aprovada
            </span>
            <span className="row row-2 text-xs text-subtle" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: 22, height: 12, borderRadius: 3, border: '1.5px solid var(--accent)', background: 'transparent' }} /> Pedida
            </span>
          </div>

          <div className="stack stack-2">
            {linhas.map(({ pessoa, barras }) => (
              <div key={pessoa.id} className="row" data-testid="mapa-linha" style={{ gap: 'var(--sp-3, 0.75rem)', alignItems: 'center' }}>
                <span className="text-small text-strong" style={{ width: '9rem', flex: '0 0 9rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pessoa.nome}
                </span>
                <div
                  className="mapa-track"
                  style={{ position: 'relative', flex: 1, height: 22, borderRadius: 'var(--r-1, 0.25rem)', background: 'var(--surface-2, var(--color-surface-muted))', border: '1px solid var(--color-border)' }}
                >
                  {barras.map((b) => {
                    const left = ((b.startDay - 1) / dias) * 100;
                    const width = ((b.endDay - b.startDay + 1) / dias) * 100;
                    const aprovada = b.estado === 'aprovada';
                    return (
                      <span
                        key={b.id}
                        data-testid="mapa-bar"
                        data-estado={b.estado}
                        title={`${pessoa.nome}: ${formatDate(b.dataInicio)} a ${formatDate(b.dataFim)} (${estadoLabel(b.estado)})`}
                        style={{
                          position: 'absolute',
                          top: 3,
                          bottom: 3,
                          left: `${left}%`,
                          width: `${width}%`,
                          borderRadius: 3,
                          background: aprovada ? 'var(--accent)' : 'transparent',
                          border: aprovada ? 'none' : '1.5px solid var(--accent)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tabela simples (fallback textual do mesmo dado). */}
      <section style={{ marginTop: 'var(--sp-6, 1.5rem)' }} aria-label="Férias do mês (lista)">
        <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)', marginBottom: 'var(--sp-3, 0.75rem)' }}>
          Férias em {nomeMes(ano, mes)}
        </h2>
        <DataTable
          data-testid="ausencias-tabela"
          columns={[
            { key: 'pessoa', label: 'Pessoa', render: (r) => <span className="text-strong">{pessoaNome(r.pessoaId)}</span> },
            { key: 'periodo', label: 'Período', render: (r) => <span className="numeric">{formatDate(r.dataInicio)} a {formatDate(r.dataFim)}</span> },
            { key: 'tipo', label: 'Tipo', render: (r) => <Badge tone={tipoTone(r.tipo)}>{tipoLabel(r.tipo)}</Badge> },
            { key: 'estado', label: 'Estado', render: (r) => <Badge tone={estadoTone(r.estado)}>{estadoLabel(r.estado)}</Badge> },
          ]}
          rows={feriasDoMes.slice().sort((a, b) => String(a.dataInicio).localeCompare(String(b.dataInicio)))}
          rowKey="id"
          empty="Sem férias neste mês."
        />
      </section>
    </div>
  );
}
