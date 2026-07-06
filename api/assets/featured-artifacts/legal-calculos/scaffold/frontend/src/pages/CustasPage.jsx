import { useEffect, useMemo, useState } from 'react';
import { computeCustas } from '../engine/custas.mjs';
import { obterTabela, guardarCalculo } from '../calculos-cliente.js';
import { formatEur } from '../shared.js';
import { useDemoResult } from '../demo.js';
import { Badge, toast } from '../components/ui.jsx';
import { IconGavel, IconPlus, IconFileText } from '../components/Icons.jsx';
import { parseEuro, hojeISO, citasDeCustas, memoriaTexto } from './calculo-view.js';

const TABELAS = [
  { value: 'I-A', label: 'Tabela I-A (generalidade das acções)' },
  { value: 'I-B', label: 'Tabela I-B (art. 7.º, n.º 4 do RCP)' },
  { value: 'I-C', label: 'Tabela I-C (especial complexidade)' },
];

function anoCorrente() {
  return String(new Date().getFullYear());
}

const EMPTY = { valorAcao: '', tabela: 'I-A', ano: anoCorrente() };

export default function CustasPage() {
  const [tabela, setTabela] = useState(null);
  const [tabelaErro, setTabelaErro] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useDemoResult('calculos-custas-resultado', Boolean(resultado));

  async function ensureTabela() {
    if (tabela) return tabela;
    const r = await obterTabela();
    if (r && r.ok) { setTabela(r.tabela); setTabelaErro(false); return r.tabela; }
    setTabelaErro(true);
    return null;
  }
  useEffect(() => { ensureTabela(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function setField(patch) {
    setResultado(null);
    setErro(null);
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function onCalcular() {
    setErro(null);
    setResultado(null);
    const t = await ensureTabela();
    if (!t) { setErro('Serviço de cálculos indisponível. Não é possível calcular sem a tabela de UC.'); return; }
    let valorAcao;
    try {
      valorAcao = parseEuro(form.valorAcao);
    } catch {
      setErro('Indique um valor da acção válido em euros (ex.: 30000,00).');
      return;
    }
    const ano = Number.parseInt(form.ano, 10);
    try {
      const r = computeCustas({ valorAcao, tabela: form.tabela, ano, uc: t.uc });
      setResultado(r);
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível calcular a taxa de justiça.');
    }
  }

  async function onGuardar() {
    if (!resultado) return;
    setGuardando(true);
    try {
      await guardarCalculo({
        tipo: 'custas',
        titulo: `Taxa de justiça ${resultado.tabela} - ${formatEur(resultado.valorAcao)}`,
        input: { valorAcao: resultado.valorAcao, tabela: resultado.tabela, ano: resultado.ano },
        resultado: {
          valor: resultado.valor,
          ucCount: resultado.ucCount,
          uc: resultado.uc,
          escalao: resultado.escalao,
          showWork: resultado.showWork,
        },
        citas: citasDeCustas(resultado),
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

  const calcularDisabled = !form.valorAcao.trim() || !String(form.ano).trim();
  const memoria = useMemo(() => (resultado ? memoriaTexto(resultado, 'custas') : ''), [resultado]);

  return (
    <div data-testid="custas-page" data-demo-page="calculos/custas">
      <div className="page-header">
        <div>
          <h1 className="page-title">Taxa de justiça</h1>
          <p className="page-subtitle">
            A taxa de justiça é o número de UC do escalão da Tabela I (art. 6.º do RCP) vezes o valor da UC do
            ano. O escalão está por confirmar contra o DRE.
          </p>
        </div>
      </div>

      <div className="prazos-layout">
        <section className="card" aria-label="Calcular taxa de justiça">
          <h2 className="card-title">Calcular taxa de justiça</h2>
          <p className="card-subtitle">Indique o valor da acção, a tabela aplicável e o ano.</p>

          <form
            className="form"
            data-testid="custas-form"
            data-demo-target="calculos-custas-form"
            style={{ marginTop: 'var(--space-4, 1rem)' }}
            onSubmit={(e) => { e.preventDefault(); onCalcular(); }}
          >
            <label className="field">
              <span className="field-label">Valor da acção (EUR)</span>
              <input
                className="field-input"
                type="text"
                inputMode="decimal"
                data-testid="custas-valor"
                data-demo-target="calculos-valor-acao"
                placeholder="30000,00"
                value={form.valorAcao}
                onChange={(e) => setField({ valorAcao: e.target.value })}
              />
            </label>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Tabela</span>
                <select
                  className="field-select"
                  data-testid="custas-tabela"
                  value={form.tabela}
                  onChange={(e) => setField({ tabela: e.target.value })}
                >
                  {TABELAS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Ano</span>
                <input
                  className="field-input"
                  type="number"
                  min="2008"
                  max="2100"
                  step="1"
                  data-testid="custas-ano"
                  placeholder={anoCorrente()}
                  value={form.ano}
                  onChange={(e) => setField({ ano: e.target.value })}
                />
              </label>
            </div>

            <div className="row row-2">
              <button
                type="submit"
                className="btn btn-primary"
                data-testid="calcular-custas"
                data-demo-target="calculos-calcular-custas"
                disabled={calcularDisabled}
              >
                <IconGavel /> Calcular taxa
              </button>
            </div>
          </form>

          {tabelaErro ? <p className="resultado-erro" data-testid="custas-tabela-erro">Não foi possível obter a tabela de UC do serviço.</p> : null}
          {erro ? <p className="resultado-erro" data-testid="custas-erro">{erro}</p> : null}

          {resultado ? (
            <div className="resultado-panel" data-testid="custas-resultado" data-demo-target="calculos-custas-resultado">
              <div className="resultado-grid">
                <div className="resultado-tile is-limite">
                  <span className="stat-label">Taxa de justiça</span>
                  <span className="resultado-value" data-testid="custas-total">{formatEur(resultado.valor)}</span>
                  <span className="text-xs text-subtle">{resultado.ucCount} UC × {formatEur(resultado.uc)}</span>
                </div>
                <div className="resultado-tile">
                  <span className="stat-label">Escalão</span>
                  <span className="resultado-value" style={{ fontSize: 'var(--text-base, 1rem)' }}>{resultado.escalao.label}</span>
                  <span className="text-xs text-subtle">Tabela {resultado.tabela} · UC {resultado.ano}</span>
                </div>
              </div>

              <p className="text-subtle text-small" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Badge tone="media" data-testid="custas-nota">a confirmar</Badge>
                <span>{resultado.citacao}</span>
              </p>

              <div className="stack stack-2">
                <span className="nav-section-label" style={{ padding: 0 }}>Memória de cálculo</span>
                <pre
                  data-testid="custas-memoria"
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
                <button type="button" className="btn btn-primary" data-testid="guardar-custas" onClick={onGuardar} disabled={guardando}>
                  <IconPlus /> {guardando ? 'A guardar.' : 'Guardar memória'}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section aria-label="Sobre a taxa de justiça">
          <div className="card">
            <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>
              <IconFileText /> Escalões por confirmar
            </h2>
            <p className="text-subtle text-small" style={{ marginTop: '0.5rem' }}>
              A estrutura da Tabela I aqui usada segue a versão publicada do Regulamento das Custas Processuais
              (Decreto-Lei n.º 34/2008), mas não foi confirmada contra o corpus de conhecimento - por isso cada
              escalão fica marcado "a confirmar". O valor da UC é fixado anualmente pela Lei do Orçamento do Estado.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
