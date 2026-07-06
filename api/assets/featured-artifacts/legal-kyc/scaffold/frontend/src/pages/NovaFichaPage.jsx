import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, createShared, listShared } from '../shared.js';
import { useDemoResult } from '../demo.js';
import { buildRcbeDeepLink, parseRcbeExtract } from '../rcbe.js';
import { avaliarRisco, aplicabilidade } from '../engine/kyc.mjs';
import {
  Button,
  Badge,
  Field,
  Select,
  Input,
  Textarea,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import {
  IconShieldCheck,
  IconShieldAlert,
  IconExternalLink,
  IconIdCard,
  IconCheck,
} from '../components/Icons.jsx';
import {
  RISCO_TONE,
  RISCO_LABEL,
  TIPO_CLIENTE_OPCOES,
  PAIS_RISCO_OPCOES,
  NATUREZA_OPCOES,
  SERVICO_OPCOES,
  tipoClienteDoCliente,
  todayStr,
  nowIso,
  temRcbe,
} from './kyc-helpers.js';

const STEP_LABELS = ['Aplicabilidade', 'Identificação', 'Risco', 'RCBE', 'Guardar'];

const EMPTY_FORM = {
  clienteId: '',
  tipoCliente: 'particular',
  pep: false,
  paisRisco: 'baixo',
  naturezaOperacao: 'outro',
  relacaoPresencial: true,
};

/* Cabeçalho do assistente: os cinco passos, com o atual em destaque. */
function Stepper({ step }) {
  return (
    <ol className="row row-2" data-testid="kyc-stepper" style={{ flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: '0 0 var(--sp-5, 1.25rem)' }}>
      {STEP_LABELS.map((label, i) => (
        <li key={label} className="row row-1" style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)' }}>
          <Badge tone={i === step ? 'info' : i < step ? 'ok' : 'neutral'}>
            {i < step ? <IconCheck size={12} /> : `${i + 1}`}
          </Badge>
          <span className={i === step ? 'text-strong' : 'text-subtle'} style={{ fontSize: 'var(--text-sm, 0.875rem)' }}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/* Painel de risco (mostra o trabalho): base + cada fator + total, e a narrativa
 * passo a passo. É o resultado destacado do assistente (kyc-risco/kyc-explicacao). */
function RiscoPanel({ risco }) {
  return (
    <div className="resultado-panel" data-testid="kyc-risco" data-demo-target="kyc-risco">
      <div className="row row-space-between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-2, 0.5rem)' }}>
        <span className="text-strong">Pontuação de risco</span>
        <Badge tone={RISCO_TONE[risco.banda] || 'neutral'} data-testid="kyc-banda">
          {RISCO_LABEL[risco.banda]}
        </Badge>
      </div>

      <table className="data-table" data-testid="kyc-breakdown" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
        <tbody>
          <tr>
            <td>Valor-base</td>
            <td className="numeric" data-testid="kyc-base">10</td>
          </tr>
          {risco.fatores.map((f, i) => (
            <tr key={f.fator} data-testid={`kyc-fator-${i}`} className={f.peso > 0 ? 'text-strong' : undefined}>
              <td>
                {f.fator}
                <span className="text-subtle text-xs" style={{ display: 'block' }}>{f.nota}</span>
              </td>
              <td className="numeric">{f.peso > 0 ? `+${f.peso}` : '0'}</td>
            </tr>
          ))}
          <tr className="text-strong">
            <td>Total</td>
            <td className="numeric" data-testid="kyc-score">{risco.score}</td>
          </tr>
        </tbody>
      </table>

      <div className="stack stack-2" data-testid="kyc-explicacao" data-demo-target="kyc-explicacao" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
        <span className="nav-section-label" style={{ padding: 0 }}>Como se chegou aqui</span>
        <ul className="passos-list">
          {risco.passos.map((p, i) => (
            <li key={i} className="passo-item">
              <span className="passo-nota" style={{ flex: 1 }}>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function NovaFichaPage() {
  const navigate = useNavigate();
  const { items: clientes, loading } = useSharedCollection('clientes');

  const [step, setStep] = useState(0);
  const [tipoServico, setTipoServico] = useState('imobiliario');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [rcbeTexto, setRcbeTexto] = useState('');
  const [rcbeParsed, setRcbeParsed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);

  const aplic = useMemo(() => aplicabilidade(tipoServico), [tipoServico]);
  const cliente = useMemo(() => clientes.find((c) => c.id === form.clienteId) || null, [clientes, form.clienteId]);

  const risco = useMemo(() => {
    try {
      return avaliarRisco(form);
    } catch {
      return null;
    }
  }, [form]);

  // Sinaliza à ponte de demonstração que o resultado do risco está no ecrã.
  useDemoResult('kyc-risco', step === 2 && !!risco);

  function onSelectCliente(id) {
    const c = clientes.find((x) => x.id === id) || null;
    setForm((prev) => ({
      ...prev,
      clienteId: id,
      // Prefill do tipo a partir do cliente; o advogado pode sobrepor.
      tipoCliente: c ? tipoClienteDoCliente(c) : prev.tipoCliente,
    }));
  }

  function parseRcbe() {
    setRcbeParsed(parseRcbeExtract(rcbeTexto));
  }

  function updateBeneficiario(i, field, value) {
    setRcbeParsed((prev) => {
      if (!prev) return prev;
      const beneficiarios = prev.beneficiarios.map((b, j) => (j === i ? { ...b, [field]: value } : b));
      return { ...prev, beneficiarios };
    });
  }

  async function onGuardar() {
    if (!form.clienteId || !risco) {
      setErro('Selecione o cliente antes de guardar.');
      setStep(1);
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      const temBeneficiarios = !!(rcbeParsed && rcbeParsed.beneficiarios && rcbeParsed.beneficiarios.length > 0);
      const rcbe = temBeneficiarios
        ? { estado: 'consultado', dataConsulta: todayStr(), beneficiarios: rcbeParsed.beneficiarios }
        : { estado: 'pendente' };
      const created = await createShared('kyc_fichas', {
        clienteId: form.clienteId,
        tipoCliente: form.tipoCliente,
        tipoServico,
        pep: form.pep,
        paisRisco: form.paisRisco,
        naturezaOperacao: form.naturezaOperacao,
        relacaoPresencial: form.relacaoPresencial,
        risco: risco.banda,
        score: risco.score,
        riscoBreakdown: risco.fatores,
        estado: 'em_analise',
        rcbe,
        // Só carimbado na aprovação (prazoArquivo). Antes disso não há prazo.
        arquivarAte: null,
      });
      if (created && created.id) {
        // P2-007: UMA estrutura de beneficiários efetivos, duas apps - os BOs
        // apurados na diligência entram na colecção PARTILHADA
        // `beneficiarios_efetivos` (legal-rcbe lê exatamente as mesmas linhas).
        // Upsert por (nipc|clienteId, nome) - best-effort, nunca trava a ficha.
        if (temBeneficiarios) {
          try {
            const cliente = clientes.find((c) => c.id === form.clienteId) || {};
            const nipc = (rcbeParsed && rcbeParsed.nipc) || cliente.nif || null;
            const existentes = await listShared('beneficiarios_efetivos');
            for (const b of rcbeParsed.beneficiarios) {
              const ja = existentes.some((x) => x && x.nome === b.nome && ((nipc && x.entidadeNipc === nipc) || x.clienteId === form.clienteId));
              if (!ja) {
                await createShared('beneficiarios_efetivos', {
                  entidadeNipc: nipc, clienteId: form.clienteId,
                  nome: b.nome, nif: b.nif || null, natureza: b.natureza || 'capital',
                  origem: 'kyc-rcbe-consulta',
                });
              }
            }
          } catch { /* partilha best-effort */ }
        }
        await createShared('kyc_eventos', {
          fichaId: created.id,
          tipo: 'criada',
          data: nowIso(),
          detalhe: `Ficha criada - ${RISCO_LABEL[risco.banda].toLowerCase()} (score ${risco.score}).`,
        });
        toast('Ficha de diligência criada.', { tone: 'ok' });
        navigate(`/ficha/${created.id}`);
      } else {
        setErro('Não foi possível guardar a ficha.');
      }
    } catch (e) {
      setErro((e && e.message) || 'Não foi possível guardar a ficha.');
    } finally {
      setSaving(false);
    }
  }

  const podeAvancarIdent = !!form.clienteId;
  const clienteRcbe = temRcbe(form.tipoCliente);

  return (
    <div data-testid="nova-ficha-page" data-demo-page="kyc/nova" data-demo-target="kyc-nova">
      <div className="page-header">
        <div>
          <h1 className="page-title">Nova ficha de diligência</h1>
          <p className="page-subtitle">
            Avaliação de risco determinística e apoio ao RCBE, passo a passo (Lei n.º 83/2017).
          </p>
        </div>
      </div>

      <Stepper step={step} />

      {/* ---------- (0) APLICABILIDADE ---------- */}
      {step === 0 ? (
        <section className="card" aria-label="Aplicabilidade dos deveres">
          <h2 className="card-title">O serviço está sujeito aos deveres?</h2>
          <p className="card-subtitle">
            Os deveres de diligência não se aplicam à consulta jurídica nem ao patrocínio; aplicam-se
            às operações praticadas por conta do cliente (art. 4.º).
          </p>
          <div className="form" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <Field label="Tipo de serviço">
              <Select
                data-testid="kyc-servico"
                data-demo-target="kyc-servico"
                value={tipoServico}
                onChange={(e) => setTipoServico(e.target.value)}
              >
                {SERVICO_OPCOES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>

            <div
              className={`citius-resultado ${aplic.aplica ? 'is-review' : 'is-erro'}`}
              data-testid="kyc-aplicabilidade"
              role="note"
            >
              <span className="citius-resultado-icon" aria-hidden="true">
                {aplic.aplica ? <IconShieldCheck /> : <IconShieldAlert />}
              </span>
              <span className="citius-resultado-text">
                <span className="citius-resultado-strong" data-testid="kyc-aplica">
                  {aplic.aplica ? 'Sujeito aos deveres de diligência' : 'Fora do âmbito dos deveres'}
                </span>
                <span className="citius-resultado-meta" data-testid="kyc-fundamento">{aplic.fundamento}</span>
              </span>
            </div>
          </div>

          <div className="row row-2" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
            <Button
              data-testid="kyc-servico-avancar"
              data-demo-target="kyc-servico-avancar"
              onClick={() => setStep(1)}
            >
              {aplic.aplica ? 'Avançar' : 'Registar mesmo assim'}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ---------- (1) IDENTIFICAÇÃO ---------- */}
      {step === 1 ? (
        <section className="card" aria-label="Identificação e fatores de risco">
          <h2 className="card-title">Identificação e fatores de risco</h2>
          <p className="card-subtitle">Estes fatores alimentam a pontuação de risco no passo seguinte.</p>

          {loading ? (
            <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar clientes.</span></div>
          ) : clientes.length === 0 ? (
            <EmptyState icon={<IconIdCard />} title="Sem clientes" hint="Abra primeiro um cliente no Núcleo." />
          ) : (
            <div className="form" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
              <Field label="Cliente" required>
                <Select data-testid="kyc-cliente" data-demo-target="kyc-cliente" value={form.clienteId} onChange={(e) => onSelectCliente(e.target.value)}>
                  <option value="">Selecione o cliente.</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}{c.nif ? ` - ${c.nif}` : ''}</option>
                  ))}
                </Select>
              </Field>

              <div className="form-grid">
                <Field label="Tipo de cliente">
                  <Select data-testid="kyc-tipo" data-demo-target="kyc-tipo" value={form.tipoCliente} onChange={(e) => setForm((p) => ({ ...p, tipoCliente: e.target.value }))}>
                    {TIPO_CLIENTE_OPCOES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </Field>
                <Field label="País de risco">
                  <Select data-testid="kyc-pais" data-demo-target="kyc-pais" value={form.paisRisco} onChange={(e) => setForm((p) => ({ ...p, paisRisco: e.target.value }))}>
                    {PAIS_RISCO_OPCOES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label="Natureza da operação">
                <Select data-testid="kyc-natureza" data-demo-target="kyc-natureza" value={form.naturezaOperacao} onChange={(e) => setForm((p) => ({ ...p, naturezaOperacao: e.target.value }))}>
                  {NATUREZA_OPCOES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>

              <div className="row row-4" style={{ flexWrap: 'wrap', gap: 'var(--sp-5, 1.25rem)' }}>
                <label className="row row-2" style={{ alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    data-testid="kyc-pep"
                    checked={form.pep}
                    onChange={(e) => setForm((p) => ({ ...p, pep: e.target.checked }))}
                  />
                  <span>Pessoa politicamente exposta (PEP)</span>
                </label>
                <label className="row row-2" style={{ alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    data-testid="kyc-presencial"
                    checked={form.relacaoPresencial}
                    onChange={(e) => setForm((p) => ({ ...p, relacaoPresencial: e.target.checked }))}
                  />
                  <span>Cliente identificado presencialmente</span>
                </label>
              </div>
            </div>
          )}

          <div className="row row-2" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
            <Button variant="ghost" data-testid="kyc-voltar" onClick={() => setStep(0)}>Voltar</Button>
            <Button data-testid="kyc-avancar" data-demo-target="kyc-avancar" onClick={() => setStep(2)} disabled={!podeAvancarIdent}>
              Avaliar risco
            </Button>
          </div>
        </section>
      ) : null}

      {/* ---------- (2) RISCO ---------- */}
      {step === 2 ? (
        <section className="card" aria-label="Avaliação de risco">
          <h2 className="card-title">Avaliação de risco</h2>
          <p className="card-subtitle">
            Cálculo determinístico: cada fator soma pontos à base e a banda resulta do total.
          </p>
          {risco ? <div style={{ marginTop: 'var(--sp-4, 1rem)' }}><RiscoPanel risco={risco} /></div> : null}

          <div className="row row-2" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
            <Button variant="ghost" data-testid="kyc-voltar" onClick={() => setStep(1)}>Voltar</Button>
            <Button data-testid="kyc-risco-avancar" onClick={() => setStep(3)}>
              Continuar {clienteRcbe ? 'para o RCBE' : ''}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ---------- (3) RCBE ---------- */}
      {step === 3 ? (
        <section className="card" aria-label="Beneficiário efetivo (RCBE)">
          <h2 className="card-title">Registo Central do Beneficiário Efetivo</h2>
          <p className="card-subtitle">
            O RCBE não tem API pública. Consulte o portal, copie o extrato e cole-o aqui para
            confirmar os beneficiários efetivos.
          </p>

          {!clienteRcbe ? (
            <div className="citius-resultado is-review" role="note" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
              <span className="citius-resultado-icon" aria-hidden="true"><IconShieldCheck /></span>
              <span className="citius-resultado-text">
                <span className="citius-resultado-strong">RCBE não aplicável</span>
                <span className="citius-resultado-meta">
                  O RCBE identifica os beneficiários efetivos de pessoas coletivas. Para uma pessoa
                  singular não há consulta a fazer.
                </span>
              </span>
            </div>
          ) : (
            <div className="form" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
              <div className="row row-2">
                <a
                  className="btn btn-secondary"
                  href={buildRcbeDeepLink({ nipc: cliente ? cliente.nif : '' })}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="kyc-rcbe-link"
                >
                  <IconExternalLink size={14} /> Abrir consulta RCBE
                </a>
              </div>

              <Field label="Extrato colado do portal" hint="Cole o texto da consulta; os beneficiários são extraídos automaticamente.">
                <Textarea
                  data-testid="kyc-rcbe-texto"
                  rows={6}
                  value={rcbeTexto}
                  onChange={(e) => setRcbeTexto(e.target.value)}
                  placeholder="Entidade: ...&#10;NIPC: ...&#10;Beneficiário efetivo n.º 1&#10;Nome: ...&#10;NIF: ..."
                />
              </Field>

              <div className="row row-2">
                <Button variant="secondary" data-testid="kyc-rcbe-parse" onClick={parseRcbe} disabled={!rcbeTexto.trim()}>
                  Extrair beneficiários
                </Button>
              </div>

              {rcbeParsed ? (
                <div className="resultado-panel" data-testid="kyc-rcbe" data-demo-target="kyc-rcbe">
                  <div className="stack stack-1">
                    <span className="text-strong">Beneficiários efetivos ({rcbeParsed.beneficiarios.length})</span>
                    {rcbeParsed.entidade ? <span className="text-subtle text-xs">{rcbeParsed.entidade}{rcbeParsed.nipc ? ` - ${rcbeParsed.nipc}` : ''}</span> : null}
                  </div>
                  {rcbeParsed.beneficiarios.length === 0 ? (
                    <p className="field-hint" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                      Nenhum beneficiário reconhecido no texto. Reveja o extrato colado.
                    </p>
                  ) : (
                    <ul className="stack stack-3" data-testid="kyc-rcbe-lista" style={{ listStyle: 'none', padding: 0, marginTop: 'var(--sp-3, 0.75rem)' }}>
                      {rcbeParsed.beneficiarios.map((b, i) => (
                        <li key={i} className="form-grid" data-testid={`kyc-beneficiario-${i}`}>
                          <Field label="Nome">
                            <Input data-testid={`kyc-beneficiario-nome-${i}`} value={b.nome || ''} onChange={(e) => updateBeneficiario(i, 'nome', e.target.value)} />
                          </Field>
                          <Field label="NIF">
                            <Input value={b.nif || ''} onChange={(e) => updateBeneficiario(i, 'nif', e.target.value)} />
                          </Field>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <div className="row row-2" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
            <Button variant="ghost" data-testid="kyc-voltar" onClick={() => setStep(2)}>Voltar</Button>
            <Button data-testid="kyc-rcbe-avancar" onClick={() => setStep(4)}>Continuar</Button>
          </div>
        </section>
      ) : null}

      {/* ---------- (4) GUARDAR ---------- */}
      {step === 4 ? (
        <section className="card" aria-label="Confirmar e guardar">
          <h2 className="card-title">Confirmar e guardar</h2>
          <p className="card-subtitle">A ficha fica em análise, à espera de aprovação ou recusa.</p>

          <table className="data-table" data-testid="kyc-resumo" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <tbody>
              <tr><td>Cliente</td><td>{cliente ? cliente.nome : '—'}</td></tr>
              <tr><td>Serviço</td><td>{SERVICO_OPCOES.find((o) => o.value === tipoServico)?.label}</td></tr>
              <tr>
                <td>Risco</td>
                <td>{risco ? <Badge tone={RISCO_TONE[risco.banda]}>{RISCO_LABEL[risco.banda]} (score {risco.score})</Badge> : '—'}</td>
              </tr>
              <tr>
                <td>RCBE</td>
                <td>{rcbeParsed && rcbeParsed.beneficiarios.length > 0 ? `${rcbeParsed.beneficiarios.length} beneficiário(s) confirmado(s)` : 'Pendente'}</td>
              </tr>
            </tbody>
          </table>

          {erro ? <p className="resultado-erro" data-testid="kyc-erro">{erro}</p> : null}

          <div className="row row-2" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
            <Button variant="ghost" data-testid="kyc-voltar" onClick={() => setStep(3)}>Voltar</Button>
            <Button data-testid="kyc-guardar" onClick={onGuardar} disabled={saving || !form.clienteId}>
              {saving ? 'A guardar.' : 'Guardar ficha'}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
