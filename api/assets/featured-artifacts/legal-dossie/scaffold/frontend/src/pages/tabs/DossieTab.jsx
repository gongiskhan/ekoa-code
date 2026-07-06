import { useMemo } from 'react';
import { formatDate, formatDateTime, formatEur } from '../../shared.js';
import { Button } from '../../components/ui.jsx';
import { IconPrinter } from '../../components/Icons.jsx';
import { origemLabel } from '../doc-helpers.jsx';

function hojeFormatado() {
  return new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/*
 * Separador Dossiê (impressão): compila num só documento tudo o que está ligado
 * ao processo - cliente, processo, cronologia, prazos, documentos, comunicações
 * e honorários - pronto a guardar em PDF (window.print). A moldura da app e os
 * controlos são .no-print; só o artigo .dossie-print entra na folha.
 */
export default function DossieTab({ processo, cliente, eventos, prazos, documentos, comunicacoes, lancamentos }) {
  const numero = processo.numeroProcesso || '(sem número)';

  const eventosOrdenados = useMemo(() => {
    return eventos
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.data);
        const tb = Date.parse(b.data);
        const va = !Number.isNaN(ta);
        const vb = !Number.isNaN(tb);
        if (va && vb) return ta - tb;
        if (va) return -1;
        if (vb) return 1;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
  }, [eventos]);

  const honorarios = useMemo(() => {
    let total = 0;
    let faturado = 0;
    let porFaturar = 0;
    for (const l of lancamentos) {
      const v = Number(l.valor);
      const valor = Number.isFinite(v) ? v : 0;
      total += valor;
      if (l.faturado === true) faturado += valor;
      else porFaturar += valor;
    }
    return {
      count: lancamentos.length,
      total: round2(total),
      faturado: round2(faturado),
      porFaturar: round2(porFaturar),
    };
  }, [lancamentos]);

  const comunicacoesOrdenadas = useMemo(() => {
    return comunicacoes
      .slice()
      .sort((a, b) => String(b.receivedAt || b.createdAt || '').localeCompare(String(a.receivedAt || a.createdAt || '')));
  }, [comunicacoes]);

  function onImprimir() {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  }

  return (
    <div data-testid="dossie-tab">
      <div className="dossie-toolbar no-print">
        <p className="text-muted text-small" style={{ margin: 0, maxWidth: 560 }}>
          Esta é a versão compilada e pronta a imprimir do dossiê. Abre o diálogo de impressão do browser -
          escolha "Guardar como PDF".
        </p>
        <div className="dossie-toolbar-actions">
          <Button variant="primary" data-testid="guardar-pdf" onClick={onImprimir}>
            <IconPrinter /> Guardar PDF
          </Button>
        </div>
      </div>

      <article className="dossie-print" data-testid="ds-dossie">
        <header className="dossie-doc-header">
          <span className="dossie-doc-eyebrow">Dossiê do processo</span>
          <h2 className="dossie-doc-title" data-testid="ds-titulo">
            DOSSIÊ DO PROCESSO {numero}
          </h2>
          <p className="dossie-doc-meta">Compilado em {hojeFormatado()}</p>
        </header>

        {/* ----- CLIENTE ----- */}
        <section className="dossie-section" data-testid="ds-cliente">
          <h3 className="dossie-section-title">Cliente</h3>
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
              <div className="dossie-id-row">
                <span className="dossie-id-label">Morada</span>
                <span className="dossie-id-value">{cliente.morada || '—'}</span>
              </div>
            </div>
          ) : (
            <p className="dossie-empty">Cliente não associado a este processo.</p>
          )}
        </section>

        {/* ----- PROCESSO ----- */}
        <section className="dossie-section" data-testid="ds-processo-info">
          <h3 className="dossie-section-title">Processo</h3>
          <div className="dossie-id-grid">
            <div className="dossie-id-row">
              <span className="dossie-id-label">Número</span>
              <span className="dossie-id-value">{processo.numeroProcesso || '—'}</span>
            </div>
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
              <span className="dossie-id-label">Estado</span>
              <span className="dossie-id-value">{processo.estado || '—'}</span>
            </div>
            <div className="dossie-id-row">
              <span className="dossie-id-label">Advogado responsável</span>
              <span className="dossie-id-value">{processo.advogadoResponsavel || '—'}</span>
            </div>
          </div>
          {processo.descricao ? <p className="dossie-descricao">{processo.descricao}</p> : null}
        </section>

        {/* ----- CRONOLOGIA ----- */}
        <section className="dossie-section" data-testid="ds-eventos">
          <h3 className="dossie-section-title">Cronologia</h3>
          {eventosOrdenados.length === 0 ? (
            <p className="dossie-empty">Sem eventos registados neste processo.</p>
          ) : (
            <ul className="dossie-timeline">
              {eventosOrdenados.map((e) => (
                <li key={e.id} className="dossie-timeline-item" data-testid="ds-evento">
                  <span className="dossie-timeline-date">{formatDate(e.data)}</span>
                  <div className="dossie-timeline-body">
                    <span className="dossie-timeline-titulo">{e.titulo || '(sem título)'}</span>
                    {e.tipo ? <span className="dossie-timeline-tipo">{e.tipo}</span> : null}
                    {e.descricao ? <span className="dossie-timeline-desc">{e.descricao}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ----- PRAZOS ----- */}
        <section className="dossie-section" data-testid="ds-prazos">
          <h3 className="dossie-section-title">Prazos</h3>
          {prazos.length === 0 ? (
            <p className="dossie-empty">Sem prazos registados neste processo.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Prazo</th>
                    <th>Data-limite</th>
                    <th>Estado</th>
                    <th>Regra aplicada</th>
                  </tr>
                </thead>
                <tbody>
                  {prazos.map((p) => (
                    <tr key={p.id} data-testid="ds-prazo">
                      <td className="text-strong">{p.titulo || p.descricao || '(sem título)'}</td>
                      <td className="numeric">{formatDate(p.dataLimite)}</td>
                      <td>
                        <span className="badge">{p.estado || '—'}</span>
                      </td>
                      <td className="text-muted">{p.regraAplicada || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ----- DOCUMENTOS ----- */}
        <section className="dossie-section" data-testid="ds-documentos">
          <h3 className="dossie-section-title">Documentos</h3>
          {documentos.length === 0 ? (
            <p className="dossie-empty">Sem documentos registados neste processo.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Origem</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((d) => (
                    <tr key={d.id} data-testid="ds-documento">
                      <td className="text-strong">{d.nome || '(sem nome)'}</td>
                      <td>{d.tipo || '—'}</td>
                      <td>{origemLabel(d.origem)}</td>
                      <td className="numeric">{formatDate(d.data || d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ----- COMUNICAÇÕES ----- */}
        <section className="dossie-section" data-testid="ds-comunicacoes">
          <h3 className="dossie-section-title">Comunicações</h3>
          {comunicacoesOrdenadas.length === 0 ? (
            <p className="dossie-empty">Sem comunicações associadas a este processo.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th>Remetente</th>
                    <th>Assunto</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {comunicacoesOrdenadas.map((c) => (
                    <tr key={c.id} data-testid="ds-comunicacao">
                      <td>{c.canal === 'whatsapp' ? 'WhatsApp' : 'Email'}</td>
                      <td className="text-strong">{c.fromName || c.fromAddr || '—'}</td>
                      <td className="text-muted">{c.subject || (c.body ? `${c.body.slice(0, 60)}…` : '—')}</td>
                      <td className="numeric">{formatDateTime(c.receivedAt || c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ----- HONORÁRIOS (RESUMO) ----- */}
        <section className="dossie-section" data-testid="ds-honorarios">
          <h3 className="dossie-section-title">Honorários (resumo)</h3>
          <div className="dossie-resumo-grid">
            <div className="dossie-resumo-tile">
              <span className="dossie-resumo-label">Lançamentos</span>
              <span className="dossie-resumo-value">{honorarios.count}</span>
            </div>
            <div className="dossie-resumo-tile">
              <span className="dossie-resumo-label">Total</span>
              <span className="dossie-resumo-value">{formatEur(honorarios.total)}</span>
            </div>
            <div className="dossie-resumo-tile">
              <span className="dossie-resumo-label">Faturado</span>
              <span className="dossie-resumo-value">{formatEur(honorarios.faturado)}</span>
            </div>
            <div className="dossie-resumo-tile">
              <span className="dossie-resumo-label">Por faturar</span>
              <span className="dossie-resumo-value">{formatEur(honorarios.porFaturar)}</span>
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}
