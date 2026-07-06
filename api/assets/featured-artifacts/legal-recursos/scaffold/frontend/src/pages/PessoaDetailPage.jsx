import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useSharedCollection, createShared, updateShared, formatDate,
} from '../shared.js';
import {
  Badge, Button, Field, Input, Select, Textarea, EmptyState, Skeleton, useToast,
} from '../components/ui.jsx';
import {
  IconChevronRight, IconIdCard, IconMail, IconPlus, IconCheck, IconCalendar, IconShieldCheck,
} from '../components/Icons.jsx';
import { direitoFerias, saldoFerias, expandirFeriadosFixos } from '../engine/ferias.mjs';
import { useDemoResult } from '../demo.js';
import {
  papelLabel, papelTone, descontaCpas,
  AUSENCIA_TIPOS, tipoLabel, tipoTone, estadoLabel, estadoTone, notasSuprimidas,
} from './recursos-logic.js';

const CPAS_TEXTO = 'Advogados e advogados estagiários descontam para a CPAS, não para a Segurança Social.';

const EMPTY_FORM = { tipo: 'ferias', dataInicio: '', dataFim: '', notas: '' };

export default function PessoaDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { items: pessoas, loading } = useSharedCollection('pessoas');
  const { items: ausencias, refresh: refreshAusencias } = useSharedCollection('ausencias');

  const pessoa = useMemo(() => pessoas.find((p) => p.id === id) || null, [pessoas, id]);
  const minhasAusencias = useMemo(
    () => ausencias
      .filter((a) => a.pessoaId === id)
      .slice()
      .sort((a, b) => String(b.dataInicio || '').localeCompare(String(a.dataInicio || ''))),
    [ausencias, id],
  );

  // O ano civil corrente alimenta o motor (que é determinístico dado o ano). Os
  // feriados de data fixa expandem-se para esse ano; os móveis são omitidos de
  // propósito (o motor documenta que são responsabilidade do chamador).
  const ano = new Date().getFullYear();

  const calculo = useMemo(() => {
    if (!pessoa || !pessoa.dataAdmissao) return null;
    try {
      const feriados = expandirFeriadosFixos(ano);
      const direito = direitoFerias({ dataAdmissao: pessoa.dataAdmissao, ano });
      const saldo = saldoFerias({
        direito: direito.dias,
        ausenciasAprovadas: minhasAusencias,
        ano,
        feriados,
      });
      return { direito, saldo };
    } catch (e) {
      return { erro: (e && e.message) || 'Não foi possível calcular as férias.' };
    }
  }, [pessoa, minhasAusencias, ano]);

  // Demonstração: sinaliza "resultado pronto" quando o saldo está calculado.
  useDemoResult('recursos-saldo-ferias', Boolean(calculo && calculo.saldo));

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [aprovando, setAprovando] = useState(null);

  if (loading && !pessoa) {
    return <div data-testid="pessoa-detail"><Skeleton lines={6} /></div>;
  }

  if (!pessoa) {
    return (
      <div data-testid="pessoa-detail">
        <EmptyState
          icon={<IconIdCard />}
          title="Pessoa não encontrada"
          hint="A ficha pode ter sido removida. As pessoas vêm do Núcleo partilhado."
          action={<Link to="/" className="btn btn-primary">Voltar às pessoas</Link>}
        />
      </div>
    );
  }

  async function onAdicionar(e) {
    e.preventDefault();
    if (!form.dataInicio || !form.dataFim) {
      toast('Indique as datas de início e fim.', { tone: 'error' });
      return;
    }
    if (form.dataFim < form.dataInicio) {
      toast('A data de fim não pode ser anterior à de início.', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      // MINIMIZAÇÃO de dados de saúde: numa baixa, o campo de notas nunca é
      // pedido nem persistido - a chave `notas` fica de fora do objecto criado.
      const payload = {
        pessoaId: pessoa.id,
        tipo: form.tipo,
        dataInicio: form.dataInicio,
        dataFim: form.dataFim,
        estado: 'pedida',
      };
      if (!notasSuprimidas(form.tipo) && form.notas.trim()) {
        payload.notas = form.notas.trim();
      }
      await createShared('ausencias', payload);
      await refreshAusencias();
      setForm({ ...EMPTY_FORM });
      toast('Ausência registada (pedida).', { tone: 'ok' });
    } catch {
      toast('Não foi possível registar a ausência.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function onAprovar(a) {
    setAprovando(a.id);
    try {
      await updateShared('ausencias', a.id, { estado: 'aprovada' });
      await refreshAusencias();
      toast('Ausência aprovada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível aprovar a ausência.', { tone: 'error' });
    } finally {
      setAprovando(null);
    }
  }

  const cpas = descontaCpas(pessoa);
  const notasEscondidas = notasSuprimidas(form.tipo);

  return (
    <div data-testid="pessoa-detail" data-demo-page="recursos/pessoa">
      <nav className="row row-2 text-small text-subtle" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
        <Link to="/" className="text-muted">Pessoas</Link>
        <IconChevronRight />
        <span className="text-strong">{pessoa.nome}</span>
      </nav>

      <div className="page-header">
        <div className="row row-3">
          <span className="row-icon" aria-hidden="true"><IconIdCard size={22} /></span>
          <div>
            <h1 className="page-title">{pessoa.nome}</h1>
            <p className="page-subtitle row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
              <Badge tone={papelTone(pessoa.papel)}>{papelLabel(pessoa.papel)}</Badge>
              {pessoa.ativo === false ? <Badge tone="neutral">Inativo</Badge> : <Badge tone="ok">Ativo</Badge>}
            </p>
          </div>
        </div>
      </div>

      <div
        className="dashboard-columns"
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 'var(--sp-6, 1.5rem)', alignItems: 'start' }}
      >
        {/* ---------- Coluna principal: ficha + ausências ---------- */}
        <div className="stack stack-6">
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>Ficha</h2>
            <div className="dossie-id-grid">
              <div className="dossie-id-row"><span className="dossie-id-label">Nome completo</span><span className="dossie-id-value">{pessoa.nomeCompleto || pessoa.nome || '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Papel</span><span className="dossie-id-value">{papelLabel(pessoa.papel)}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Email</span><span className="dossie-id-value row row-2">{pessoa.email ? (<><IconMail /> {pessoa.email}</>) : '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Data de admissão</span><span className="dossie-id-value numeric">{formatDate(pessoa.dataAdmissao)}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">Cédula</span><span className="dossie-id-value numeric">{pessoa.cedula || '—'}</span></div>
              <div className="dossie-id-row"><span className="dossie-id-label">CPAS</span><span className="dossie-id-value">{cpas ? 'Sim' : 'Não'}</span></div>
            </div>
          </section>

          <section className="card" aria-label="Ausências">
            <div className="row row-space-between" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
              <h2 className="card-title" style={{ margin: 0 }}>Ausências ({minhasAusencias.length})</h2>
            </div>

            {minhasAusencias.length === 0 ? (
              <p className="text-small text-subtle" style={{ margin: 0 }}>Sem ausências registadas.</p>
            ) : (
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="ausencias-lista">
                {minhasAusencias.map((a) => (
                  <li
                    key={a.id}
                    className="row row-space-between"
                    data-testid="ausencia-row"
                    style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', gap: 'var(--sp-3, 0.75rem)', alignItems: 'center' }}
                  >
                    <span className="row row-3" style={{ gap: 'var(--sp-3, 0.75rem)', minWidth: 0, alignItems: 'center' }}>
                      <Badge tone={tipoTone(a.tipo)}>{tipoLabel(a.tipo)}</Badge>
                      <span className="stack stack-1" style={{ minWidth: 0 }}>
                        <span className="text-small numeric">{formatDate(a.dataInicio)} a {formatDate(a.dataFim)}</span>
                        {a.notas ? <span className="text-xs text-subtle">{a.notas}</span> : null}
                      </span>
                    </span>
                    <span className="row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
                      <Badge tone={estadoTone(a.estado)}>{estadoLabel(a.estado)}</Badge>
                      {a.estado === 'pedida' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`aprovar-${a.id}`}
                          data-demo-target="recursos-aprovar"
                          disabled={aprovando === a.id}
                          onClick={() => onAprovar(a)}
                        >
                          <IconCheck /> {aprovando === a.id ? 'A aprovar…' : 'Aprovar'}
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Nova ausência */}
            <form className="form stack stack-4" data-testid="nova-ausencia-form" style={{ marginTop: 'var(--sp-5, 1.25rem)' }} onSubmit={onAdicionar}>
              <h3 className="card-subtitle" style={{ margin: 0 }}>Nova ausência</h3>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-3, 0.75rem)' }}>
                <Field label="Tipo">
                  <Select
                    data-testid="ausencia-tipo"
                    value={form.tipo}
                    onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                  >
                    {AUSENCIA_TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </Field>
                <Field label="Início">
                  <Input type="date" data-testid="ausencia-inicio" value={form.dataInicio} onChange={(e) => setForm((f) => ({ ...f, dataInicio: e.target.value }))} />
                </Field>
                <Field label="Fim">
                  <Input type="date" data-testid="ausencia-fim" value={form.dataFim} onChange={(e) => setForm((f) => ({ ...f, dataFim: e.target.value }))} />
                </Field>
              </div>

              {/* Numa baixa, o campo de notas é escondido (minimização de dados de saúde). */}
              {notasEscondidas ? (
                <p className="text-xs text-subtle" data-testid="baixa-nota-privacidade" style={{ margin: 0 }}>
                  Numa baixa não se registam notas: são dados de saúde e aplica-se a minimização.
                </p>
              ) : (
                <Field label="Notas (opcional)">
                  <Textarea
                    data-testid="ausencia-notas"
                    rows={2}
                    value={form.notas}
                    onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                    placeholder="Observações internas."
                  />
                </Field>
              )}

              <div className="row">
                <Button type="submit" data-testid="ausencia-submit" disabled={saving}>
                  <IconPlus /> {saving ? 'A registar…' : 'Registar ausência'}
                </Button>
              </div>
            </form>
          </section>
        </div>

        {/* ---------- Coluna lateral: férias + CPAS ---------- */}
        <div className="stack stack-6">
          <section className="card" aria-label="Férias" data-testid="ferias-panel" data-demo-target="recursos-saldo-ferias">
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-1, 0.25rem)' }}>Férias {ano}</h2>
            {calculo && calculo.saldo ? (
              <>
                <p className="card-subtitle row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center', marginBottom: 'var(--sp-4, 1rem)' }}>
                  <IconCalendar size={14} />
                  <span>Regra aplicada: <span className="text-strong" data-testid="ferias-regra">{calculo.direito.regra}</span></span>
                </p>
                <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                  <div className="kpi-card">
                    <span className="kpi-label">Direito</span>
                    <span className="kpi-value" data-testid="direito-valor">{calculo.direito.dias}</span>
                    <span className="field-hint">dias úteis</span>
                  </div>
                  <div className="kpi-card">
                    <span className="kpi-label">Gozados</span>
                    <span className="kpi-value" data-testid="gozados-valor">{calculo.saldo.gozados}</span>
                    <span className="field-hint">aprovados</span>
                  </div>
                  <div className="kpi-card">
                    <span className="kpi-label">Saldo</span>
                    <span className="kpi-value is-accent" data-testid="saldo-valor">{calculo.saldo.saldo}</span>
                    <span className="field-hint">por gozar</span>
                  </div>
                </div>

                <details className="ferias-explicacao" data-testid="ferias-explicacao" data-demo-target="recursos-explicacao" open style={{ marginTop: 'var(--sp-4, 1rem)' }}>
                  <summary className="text-small text-strong" style={{ cursor: 'pointer' }}>Como se chega a estes números</summary>
                  <ul className="passos-list" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
                    {[...calculo.direito.passos, ...calculo.saldo.passos].map((p, i) => (
                      <li key={i} className="passo-item">
                        <span className="passo-nota">{p}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="resultado-erro" data-testid="ferias-erro">
                {(calculo && calculo.erro) || 'Sem data de admissão: não é possível calcular o direito a férias.'}
              </p>
            )}
          </section>

          <section className="card" aria-label="CPAS" data-testid="cpas-note" data-demo-target="recursos-cpas">
            <div className="row row-3" style={{ gap: 'var(--sp-3, 0.75rem)', alignItems: 'flex-start' }}>
              <span className="row-icon" aria-hidden="true"><IconShieldCheck size={20} /></span>
              <div className="stack stack-1">
                <h2 className="card-title" style={{ margin: 0 }}>CPAS</h2>
                <p className="text-small text-subtle" style={{ margin: 0 }}>{CPAS_TEXTO}</p>
                <p className="text-xs" style={{ margin: 0 }} data-testid="cpas-estado">
                  {cpas
                    ? 'Esta pessoa desconta para a CPAS.'
                    : 'Esta pessoa desconta para a Segurança Social.'}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
