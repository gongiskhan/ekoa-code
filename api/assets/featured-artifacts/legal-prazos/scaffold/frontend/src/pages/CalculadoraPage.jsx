import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { computePrazo } from '../engine/prazo.mjs';
import { useSharedCollection, createShared, formatDate } from '../shared.js';
import { useDemoResult } from '../demo.js';
import { Badge } from '../components/ui.jsx';
import { IconCalendar, IconFolder, IconPlus, IconChevronRight } from '../components/Icons.jsx';
import { prazoDescricao, estadoDerivado } from './prazo-view.js';

const CONTAGENS = [
  { value: 'uteis', label: 'Dias úteis' },
  { value: 'corridos', label: 'Dias corridos' },
];

const ESTADO_META = {
  pendente: { tone: 'info', label: 'Pendente' },
  vencido: { tone: 'alta', label: 'Vencido' },
  cumprido: { tone: 'ok', label: 'Cumprido' },
};

const EMPTY = {
  processoId: '',
  dataNotificacao: '',
  titulo: '',
  dias: '',
  contagem: 'uteis',
  suspendeFerias: true,
  responsavel: '',
};

/*
 * Condensa a lista de passos para leitura. Cada passo do motor é um dia: úteis
 * com `dia` (número contado), não úteis com `motivo`, e notas avulsas. Mantemos
 * os dias úteis um a um (são o que o advogado quer validar) mas agrupamos corridas
 * consecutivas do MESMO motivo não-útil (sobretudo as longas férias judiciais)
 * numa só linha - em vez de listar 47 linhas de férias.
 */
function condensarPassos(passos) {
  const out = [];
  let run = null; // { motivo, count, from, to }

  const flush = () => {
    if (!run) return;
    out.push({
      kind: 'skip',
      motivo: run.motivo,
      count: run.count,
      from: run.from,
      to: run.to,
    });
    run = null;
  };

  for (const p of passos) {
    if (p.nota !== undefined) {
      flush();
      out.push({ kind: 'nota', data: p.data, nota: p.nota });
      continue;
    }
    if (p.util) {
      flush();
      out.push({ kind: 'util', data: p.data, dia: p.dia });
      continue;
    }
    // dia não útil (saltado): agrupa corridas do mesmo motivo
    if (run && run.motivo === p.motivo) {
      run.count += 1;
      run.to = p.data;
    } else {
      flush();
      run = { motivo: p.motivo, count: 1, from: p.data, to: p.data };
    }
  }
  flush();
  return out;
}

export default function CalculadoraPage() {
  const { items: prazos, refresh: refreshPrazos } = useSharedCollection('prazos');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');

  const [form, setForm] = useState({ ...EMPTY });
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // Tutorial Bridge: sinaliza ao anfitrião que o resultado do cálculo está
  // visível (passo annotate-result). No-op fora de uma demonstração activa.
  useDemoResult('prazos-resultado', Boolean(resultado));

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '';
  }, [clientes]);

  const processoLabel = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || '(sem número)'));
    return (id) => map.get(id) || '—';
  }, [processos]);

  const condensados = useMemo(() => (resultado ? condensarPassos(resultado.passos) : []), [resultado]);

  // Guardados recentemente: os últimos 5, o mais recente primeiro. A gestão
  // completa (filtros, ordenação) vive em "Todos os prazos".
  const recentes = useMemo(() => {
    return prazos
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 5);
  }, [prazos]);

  function setField(patch) {
    // Qualquer alteração a um campo INVALIDA o resultado já calculado: nunca se
    // mostra nem se guarda um prazo calculado a partir de dados que entretanto
    // mudaram. O utilizador volta a "Calcular".
    setResultado(null);
    setErro(null);
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // Por omissão, suspende férias para dias úteis; corridos não suspendem.
      if (patch.contagem) next.suspendeFerias = patch.contagem === 'uteis';
      return next;
    });
  }

  function onCalcular() {
    setErro(null);
    setResultado(null);
    if (!form.processoId) { setErro('Seleccione o processo a que o prazo respeita.'); return; }
    if (!form.titulo.trim()) { setErro('Indique o título do prazo (ex.: Contestação).'); return; }
    try {
      const dias = Number.parseInt(form.dias, 10);
      const r = computePrazo({
        dataNotificacao: (form.dataNotificacao || '').trim(),
        dias,
        contagem: form.contagem,
        suspendeFerias: form.contagem === 'uteis' ? Boolean(form.suspendeFerias) : false,
      });
      // Snapshot COMPLETO dos dados do cálculo (inclui processo/título/responsável).
      // "Guardar" usa exclusivamente este snapshot - nunca mistura o formulário
      // actual com um resultado antigo.
      setResultado({
        ...r,
        processoId: form.processoId,
        titulo: form.titulo.trim(),
        responsavel: form.responsavel.trim() || null,
      });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível calcular o prazo.');
    }
  }

  async function onGuardar() {
    if (!resultado) return;
    setErro(null);
    setGuardando(true);
    try {
      const titulo = resultado.titulo;
      const contagemLabel = (CONTAGENS.find((c) => c.value === resultado.contagem) || {}).label || resultado.contagem;
      const payload = {
        processoId: resultado.processoId,
        // Esquema partilhado do radar/lista: `descricao` + `origem`. `titulo`
        // mantém-se por compatibilidade com as linhas antigas.
        descricao: titulo,
        titulo,
        origem: 'manual',
        dataNotificacao: resultado.dataNotificacao,
        regraAplicada: `${titulo} - ${resultado.dias} ${contagemLabel.toLowerCase()}`,
        dataLimite: resultado.dataLimite,
        multaAte: resultado.multaAte,
        tipoContagem: resultado.contagem,
        estado: 'pendente',
        responsavel: resultado.responsavel,
        showWork: { passos: resultado.passos, multaDias: resultado.multaDias },
      };
      await createShared('prazos', payload);
      await refreshPrazos();
      // Limpa o formulário e o resultado para o próximo cálculo.
      setForm({ ...EMPTY });
      setResultado(null);
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível guardar o prazo.');
    } finally {
      setGuardando(false);
    }
  }

  const semProcessos = processos.length === 0;
  const calcularDisabled = !form.dataNotificacao.trim() || !String(form.dias).trim();

  return (
    <div data-testid="calculadora-page" data-demo-page="prazos/calculadora">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calculadora de prazos</h1>
          <p className="page-subtitle">
            Conte o prazo a partir da notificação. O motor mostra cada dia útil contado e salta
            fins-de-semana, feriados nacionais e férias judiciais.
          </p>
        </div>
      </div>

      <div className="prazos-layout">
        {/* ---------- (A) CALCULAR PRAZO ---------- */}
        <section className="card" aria-label="Calcular prazo">
          <h2 className="card-title">Calcular prazo</h2>
          <p className="card-subtitle">Datas no formato AAAA-MM-DD. O dia da notificação não conta.</p>

          <form
            className="form"
            data-testid="calcular-form"
            data-demo-target="prazos-form"
            style={{ marginTop: 'var(--space-4, 1rem)' }}
            onSubmit={(e) => { e.preventDefault(); onCalcular(); }}
          >
            <label className="field">
              <span className="field-label">Processo</span>
              <select
                className="field-select"
                data-testid="prazo-processo"
                data-demo-target="prazos-processo"
                value={form.processoId}
                onChange={(e) => setField({ processoId: e.target.value })}
              >
                <option value="">{semProcessos ? 'Sem processos - abra um no Núcleo.' : 'Seleccione o processo.'}</option>
                {processos.map((p) => {
                  const nome = clienteNome(p.clienteId);
                  const label = `${p.numeroProcesso || '(sem número)'}${nome ? ` - ${nome}` : ''}`;
                  return <option key={p.id} value={p.id}>{label}</option>;
                })}
              </select>
            </label>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Data da notificação</span>
                <input
                  className="field-input"
                  type="text"
                  inputMode="numeric"
                  data-testid="prazo-data"
                  data-demo-target="prazos-data"
                  placeholder="AAAA-MM-DD"
                  value={form.dataNotificacao}
                  onChange={(e) => setField({ dataNotificacao: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Título</span>
                <input
                  className="field-input"
                  type="text"
                  data-testid="prazo-titulo"
                  data-demo-target="prazos-titulo"
                  placeholder="Contestação"
                  value={form.titulo}
                  onChange={(e) => setField({ titulo: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Dias</span>
                <input
                  className="field-input"
                  type="number"
                  min="1"
                  step="1"
                  data-testid="prazo-dias"
                  data-demo-target="prazos-dias"
                  placeholder="30"
                  value={form.dias}
                  onChange={(e) => setField({ dias: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Contagem</span>
                <select
                  className="field-select"
                  data-testid="prazo-contagem"
                  value={form.contagem}
                  onChange={(e) => setField({ contagem: e.target.value })}
                >
                  {CONTAGENS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            </div>

            <label className="checkbox-field">
              <input
                type="checkbox"
                data-testid="prazo-ferias"
                checked={form.contagem === 'uteis' ? Boolean(form.suspendeFerias) : false}
                disabled={form.contagem !== 'uteis'}
                onChange={(e) => setField({ suspendeFerias: e.target.checked })}
              />
              <span>Suspende-se em férias judiciais</span>
            </label>

            <label className="field">
              <span className="field-label">Responsável (opcional)</span>
              <input
                className="field-input"
                type="text"
                data-testid="prazo-responsavel"
                placeholder="Dra. Marília"
                value={form.responsavel}
                onChange={(e) => setField({ responsavel: e.target.value })}
              />
            </label>

            <div className="row row-2">
              <button
                type="submit"
                className="btn btn-primary"
                data-testid="calcular"
                data-demo-target="prazos-calcular"
                disabled={calcularDisabled}
              >
                <IconCalendar /> Calcular
              </button>
            </div>
          </form>

          {erro ? (
            <p className="resultado-erro" data-testid="resultado-erro">{erro}</p>
          ) : null}

          {resultado ? (
            <div className="resultado-panel" data-testid="resultado" data-demo-target="prazos-resultado">
              <div className="resultado-grid">
                <div className="resultado-tile is-limite">
                  <span className="stat-label">Data-limite</span>
                  <span className="resultado-value" data-testid="resultado-datalimite">{resultado.dataLimite}</span>
                  <span className="text-xs text-subtle">{formatDate(resultado.dataLimite)}</span>
                </div>
                <div className="resultado-tile is-multa">
                  <span className="stat-label">Com multa até</span>
                  <span className="resultado-value" data-testid="resultado-multaate">{resultado.multaAte}</span>
                  <span className="text-xs text-subtle">3 dias úteis (art. 139.º n.º 5)</span>
                </div>
              </div>

              <div className="stack stack-2">
                <span className="nav-section-label" style={{ padding: 0 }}>Mostra o seu trabalho</span>
                <ul className="passos-list" data-testid="resultado-passos">
                  {condensados.map((step, idx) => {
                    if (step.kind === 'nota') {
                      return (
                        <li key={`n-${idx}`} className="passo-item">
                          <span className="passo-data">{step.data}</span>
                          <span className="passo-nota">{step.nota}</span>
                        </li>
                      );
                    }
                    if (step.kind === 'util') {
                      return (
                        <li key={`u-${idx}`} className="passo-item passo-util">
                          <span className="passo-num">{step.dia}</span>
                          <span className="passo-data">{step.data}</span>
                          <span className="passo-nota">dia útil contado</span>
                        </li>
                      );
                    }
                    // skip (corrida de dias não úteis do mesmo motivo)
                    const intervalo = step.count > 1 ? `${step.from} a ${step.to}` : step.from;
                    const resumo = step.count > 1
                      ? `${step.motivo} (${step.count} dias)`
                      : step.motivo;
                    return (
                      <li key={`s-${idx}`} className="passo-item passo-skip">
                        <span className="passo-num">—</span>
                        <span className="passo-data">{intervalo}</span>
                        <span className="passo-nota">{resumo}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="row row-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="guardar-prazo"
                  onClick={onGuardar}
                  disabled={guardando}
                >
                  <IconPlus /> {guardando ? 'A guardar.' : 'Guardar prazo'}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* ---------- (B) GUARDADOS RECENTEMENTE ---------- */}
        <section aria-label="Guardados recentemente">
          <div className="page-header" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
            <div>
              <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>Guardados recentemente</h2>
              <p className="page-subtitle">Os últimos prazos que guardou. Veja o radar e a lista completa para gerir todos.</p>
            </div>
            <Link className="btn btn-secondary btn-sm" to="/prazos" data-testid="ver-todos-prazos">
              Todos os prazos <IconChevronRight />
            </Link>
          </div>

          {recentes.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true"><IconFolder /></span>
              <p className="empty-title">Sem prazos guardados</p>
              <p className="empty-text">
                Calcule um prazo e guarde-o para o acompanhar no radar. Os processos vêm do Núcleo partilhado.
              </p>
            </div>
          ) : (
            <div className="table-wrap" data-testid="prazos-lista">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Prazo</th>
                    <th>Processo</th>
                    <th>Data-limite</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {recentes.map((pr) => {
                    const meta = ESTADO_META[estadoDerivado(pr)] || ESTADO_META.pendente;
                    return (
                      <tr key={pr.id} data-testid="prazo-row">
                        <td><span className="text-strong">{prazoDescricao(pr)}</span></td>
                        <td>{processoLabel(pr.processoId)}</td>
                        <td className="numeric">
                          <div className="stack stack-1">
                            <span className="text-strong">{pr.dataLimite || '—'}</span>
                            {pr.multaAte ? <span className="text-subtle text-xs">multa até {pr.multaAte}</span> : null}
                          </div>
                        </td>
                        <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
