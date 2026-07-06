import { useEffect, useMemo, useState } from 'react';
import { computeJuros } from '../engine/juros.mjs';
import { obterTabela, guardarCalculo } from '../calculos-cliente.js';
import { formatEur, formatDate } from '../shared.js';
import { useDemoResult } from '../demo.js';
import { Badge, toast } from '../components/ui.jsx';
import { IconEuro, IconPlus, IconAlertTriangle, IconFileText } from '../components/Icons.jsx';
import { parseEuro, hojeISO, citasDeTrocos, memoriaTexto } from './calculo-view.js';

// O app dono calcula do lado do CLIENTE com o motor vendorizado (juros.mjs),
// obtendo a tabela (canónica + overlay do crawler) do serviço via obterTabela().
// Os consumidores (cobranças/injunções/…) usam a app API (calculos-cliente) que
// calcula no servidor - nunca importam o motor.

const TIPOS = [
  { value: 'comercial', label: 'Comerciais (transação comercial)' },
  { value: 'civil', label: 'Civis (4% - Portaria 291/2003)' },
  { value: 'estado', label: 'Entidade pública (transação comercial)' },
];

const EMPTY = { capital: '', dataVencimento: '', dataFim: hojeISO(), tipoJuro: 'comercial' };

export default function JurosPage() {
  const [tabela, setTabela] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [tabelaErro, setTabelaErro] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // Assinala à ponte de demonstrações que o resultado está visível (annotate-result).
  useDemoResult('calculos-resultado', Boolean(resultado));

  // Pré-carrega a tabela do serviço (canónica + overlay + alarme). Se falhar,
  // marca degradado - o cálculo fica indisponível (honesto, nunca inventa taxas).
  async function ensureTabela() {
    if (tabela) return tabela;
    const r = await obterTabela();
    if (r && r.ok) {
      setTabela(r.tabela);
      setAviso(r.avisoTabelas || null);
      setTabelaErro(false);
      return r.tabela;
    }
    setTabelaErro(true);
    return null;
  }
  useEffect(() => { ensureTabela(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function setField(patch) {
    // Qualquer alteração invalida o resultado calculado - nunca se guarda um
    // cálculo a partir de dados que entretanto mudaram.
    setResultado(null);
    setErro(null);
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function onCalcular() {
    setErro(null);
    setResultado(null);
    const t = await ensureTabela();
    if (!t) { setErro('Serviço de cálculos indisponível. Não é possível calcular sem a tabela de taxas.'); return; }
    let capital;
    try {
      capital = parseEuro(form.capital);
    } catch {
      setErro('Indique um capital válido em euros (ex.: 12500,00).');
      return;
    }
    try {
      const r = computeJuros({
        valor: capital,
        dataVencimento: (form.dataVencimento || '').trim(),
        dataFim: (form.dataFim || '').trim(),
        tipo: form.tipoJuro,
        tabela: t,
      });
      setResultado({ ...r, tipoJuro: form.tipoJuro });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível calcular os juros.');
    }
  }

  async function onGuardar() {
    if (!resultado) return;
    setGuardando(true);
    try {
      const citas = citasDeTrocos(resultado.trocos);
      await guardarCalculo({
        tipo: 'juros',
        titulo: `Juros de mora ${TIPOS.find((x) => x.value === resultado.tipoJuro)?.label || ''} - ${formatEur(resultado.capital)}`,
        input: {
          capital: resultado.capital,
          dataVencimento: resultado.dataVencimento,
          dataFim: resultado.dataFim,
          tipoJuro: resultado.tipoJuro,
        },
        resultado: {
          total: resultado.total,
          diasTotais: resultado.diasTotais,
          incompleto: resultado.incompleto,
          showWork: resultado.showWork,
        },
        trocos: resultado.trocos,
        citas,
      });
      toast('Memória de cálculo guardada.', { tone: 'ok' });
      setForm({ ...EMPTY });
      setResultado(null);
    } catch (e) {
      toast(e && e.message ? e.message : 'Não foi possível guardar.', { tone: 'alta' });
    } finally {
      setGuardando(false);
    }
  }

  const calcularDisabled = !form.capital.trim() || !form.dataVencimento.trim() || !form.dataFim.trim();
  const memoria = useMemo(() => (resultado ? memoriaTexto(resultado, 'juros') : ''), [resultado]);

  return (
    <div data-testid="juros-page" data-demo-page="calculos/juros">
      <div className="page-header">
        <div>
          <h1 className="page-title">Juros de mora</h1>
          <p className="page-subtitle">
            Os juros são divididos por troços nos limites de semestre; cada troço aplica a taxa em vigor e
            cita o seu Aviso da DGTF. Datas no formato AAAA-MM-DD.
          </p>
        </div>
      </div>

      {aviso && aviso.alarme ? (
        <div className="card" role="status" data-testid="aviso-tabelas" style={{ borderLeft: '3px solid var(--color-warn, #b45309)', marginBottom: 'var(--space-4, 1rem)' }}>
          <p className="text-strong" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <IconAlertTriangle /> Atualização de taxas em falta
          </p>
          <p className="text-subtle text-small" style={{ margin: '0.25rem 0 0' }}>{aviso.detalhe}</p>
        </div>
      ) : null}

      <div className="prazos-layout">
        <section className="card" aria-label="Calcular juros">
          <h2 className="card-title">Calcular juros</h2>
          <p className="card-subtitle">O dia do vencimento é o início da mora; a contagem é actual/365.</p>

          <form
            className="form"
            data-testid="juros-form"
            data-demo-target="calculos-form"
            style={{ marginTop: 'var(--space-4, 1rem)' }}
            onSubmit={(e) => { e.preventDefault(); onCalcular(); }}
          >
            <label className="field">
              <span className="field-label">Capital (EUR)</span>
              <input
                className="field-input"
                type="text"
                inputMode="decimal"
                data-testid="juros-capital"
                data-demo-target="calculos-capital"
                placeholder="12500,00"
                value={form.capital}
                onChange={(e) => setField({ capital: e.target.value })}
              />
            </label>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Data de vencimento</span>
                <input
                  className="field-input"
                  type="text"
                  inputMode="numeric"
                  data-testid="juros-vencimento"
                  data-demo-target="calculos-vencimento"
                  placeholder="AAAA-MM-DD"
                  value={form.dataVencimento}
                  onChange={(e) => setField({ dataVencimento: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Data final (até)</span>
                <input
                  className="field-input"
                  type="text"
                  inputMode="numeric"
                  data-testid="juros-fim"
                  data-demo-target="calculos-fim"
                  placeholder="AAAA-MM-DD"
                  value={form.dataFim}
                  onChange={(e) => setField({ dataFim: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Tipo de juro</span>
                <select
                  className="field-select"
                  data-testid="juros-tipo"
                  data-demo-target="calculos-tipo"
                  value={form.tipoJuro}
                  onChange={(e) => setField({ tipoJuro: e.target.value })}
                >
                  {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
            </div>

            <div className="row row-2">
              <button
                type="submit"
                className="btn btn-primary"
                data-testid="calcular-juros"
                data-demo-target="calculos-calcular"
                disabled={calcularDisabled}
              >
                <IconEuro /> Calcular juros
              </button>
            </div>
          </form>

          {tabelaErro ? (
            <p className="resultado-erro" data-testid="tabela-erro">
              Não foi possível obter a tabela de taxas do serviço. Verifique a ligação e tente novamente.
            </p>
          ) : null}
          {erro ? <p className="resultado-erro" data-testid="resultado-erro">{erro}</p> : null}

          {resultado ? (
            <div className="resultado-panel" data-testid="resultado" data-demo-target="calculos-resultado">
              <div className="resultado-grid">
                <div className="resultado-tile is-limite">
                  <span className="stat-label">Total de juros de mora</span>
                  <span className="resultado-value" data-testid="resultado-total">{formatEur(resultado.total)}</span>
                  <span className="text-xs text-subtle">{resultado.diasTotais} dias · {resultado.trocos.length} troço(s)</span>
                </div>
                <div className="resultado-tile">
                  <span className="stat-label">Capital</span>
                  <span className="resultado-value">{formatEur(resultado.capital)}</span>
                  <span className="text-xs text-subtle">{formatDate(resultado.dataVencimento)} a {formatDate(resultado.dataFim)}</span>
                </div>
              </div>

              <div className="stack stack-2">
                <span className="nav-section-label" style={{ padding: 0 }}>Troços (um Aviso por semestre)</span>
                <div className="table-wrap">
                  <table className="data-table" data-testid="trocos-tabela">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th className="numeric">Dias</th>
                        <th className="numeric">Taxa</th>
                        <th>Fonte</th>
                        <th className="numeric">Juros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.trocos.map((t, i) => (
                        <tr key={i} data-testid="troco-row">
                          <td>{formatDate(t.inicio)} a {formatDate(t.fim)}</td>
                          <td className="numeric">{t.dias}</td>
                          <td className="numeric">{t.taxa == null ? '-' : `${t.taxa}%`}</td>
                          <td>
                            <Badge tone={t.nota === 'confirmar' ? 'media' : 'info'} data-testid="troco-aviso">{t.aviso}</Badge>
                          </td>
                          <td className="numeric text-strong">{formatEur(t.juros)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="stack stack-2">
                <span className="nav-section-label" style={{ padding: 0 }}>Memória de cálculo</span>
                <pre
                  data-testid="memoria"
                  data-demo-target="calculos-explicacao"
                  style={{
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                    padding: 'var(--space-3, 0.75rem)',
                    background: 'var(--color-surface-2, #f8fafc)',
                    border: '1px solid var(--color-border, #e2e8f0)',
                    borderRadius: 'var(--radius-md, 8px)',
                    fontFamily: 'var(--font-mono, ui-monospace, Menlo, Consolas, monospace)',
                    fontSize: 'var(--text-xs, 0.8125rem)', lineHeight: 1.5,
                    color: 'var(--color-text, inherit)', maxHeight: '340px', overflow: 'auto',
                  }}
                >{memoria}</pre>
              </div>

              <div className="row row-2">
                <button type="button" className="btn btn-primary" data-testid="guardar-calculo" onClick={onGuardar} disabled={guardando}>
                  <IconPlus /> {guardando ? 'A guardar.' : 'Guardar memória'}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section aria-label="Como funciona">
          <div className="card">
            <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>
              <IconFileText /> Todo o cálculo cita a fonte
            </h2>
            <p className="text-subtle text-small" style={{ marginTop: '0.5rem' }}>
              Os juros comerciais aplicam a taxa supletiva semestral fixada por aviso da DGTF (art. 102.º, §§ 3.º
              a 5.º do Código Comercial; Decreto-Lei n.º 62/2013). Os juros civis correm à taxa de 4% (Portaria
              n.º 291/2003). Cada troço mostra o período, os dias, a taxa e o Aviso aplicado, e a memória de
              cálculo pode ser guardada e inserida numa peça ou carta de interpelação.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
