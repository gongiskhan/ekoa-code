import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useSharedCollection, listShared, updateShared, createShared,
  formatEur, formatDate, formatDateTime,
} from '../shared.js';
import { Badge, Button, EmptyState, Skeleton, useToast } from '../components/ui.jsx';
import {
  IconReceipt, IconChevronRight, IconCheck, IconClock, IconAlertTriangle, IconWhatsApp, IconMail,
} from '../components/Icons.jsx';
import {
  reconcileCobranca, gerarReferenciaDemo, proximoPasso, previewTemplate, MB_ENTIDADE,
} from '../engine/cobrancas.mjs';
import {
  ESTADO_LABEL, ESTADO_TONE, METODO_LABEL, CANAL_LABEL, atrasoLabel, atrasoTone,
} from './cobrancas-logic.js';
import { calcularJuros, guardarCalculo } from '../calculos-cliente.js';

/* Está em modo de desenvolvimento? (?dev=1 destranca a simulação de callback.) */
function isDevMode() {
  try { return new URLSearchParams(window.location.search).get('dev') === '1'; }
  catch { return false; }
}

export default function CobrancaDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { items: cobrancas, loading, refresh: refreshCobrancas } = useSharedCollection('cobrancas');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: sequencias } = useSharedCollection('sequencias_lembrete');
  const { items: lembretes } = useSharedCollection('lembretes_enviados');

  const [busy, setBusy] = useState(false);
  const dev = isDevMode();
  const hoje = new Date();

  const cobranca = useMemo(() => cobrancas.find((c) => c.id === id) || null, [cobrancas, id]);
  const cliente = useMemo(
    () => (cobranca ? clientes.find((c) => c.id === cobranca.clienteId) || null : null),
    [clientes, cobranca],
  );
  const sequencia = useMemo(
    () => (cobranca && cobranca.sequenciaId ? sequencias.find((s) => s.id === cobranca.sequenciaId) || null : null),
    [sequencias, cobranca],
  );

  // Timeline: os lembretes já enviados ligam-se à cobrança pela descrição.
  const enviados = useMemo(() => {
    if (!cobranca) return [];
    return lembretes
      .filter((l) => l && l.cobrancaDescricao === cobranca.descricao)
      .slice()
      .sort((a, b) => String(a.enviadoEm || '').localeCompare(String(b.enviadoEm || '')));
  }, [lembretes, cobranca]);

  const passoSeguinte = useMemo(() => {
    if (!cobranca || !sequencia) return null;
    return proximoPasso(sequencia.passos, cobranca.dataVencimento, hoje);
  }, [cobranca, sequencia, hoje]);

  const templateVars = useMemo(() => ({
    nome: cliente?.nome || 'cliente',
    descricao: cobranca?.descricao || '',
    valor: cobranca ? formatEur(cobranca.valor) : '',
  }), [cliente, cobranca]);

  if (loading && !cobranca) {
    return <div data-testid="cobranca-detalhe"><Skeleton lines={6} /></div>;
  }

  if (!cobranca) {
    return (
      <div data-testid="cobranca-detalhe">
        <EmptyState
          icon={<IconReceipt />}
          title="Cobrança não encontrada"
          hint="Esta cobrança pode ter sido removida da espinha partilhada."
          action={<Link className="btn btn-ghost btn-sm" to="/">Voltar às cobranças</Link>}
        />
      </div>
    );
  }

  const refPag = cobranca.refPagamento || null;
  const paga = cobranca.estado === 'paga' || cobranca.estado === 'parcial';

  async function gerarReferencia() {
    setBusy(true);
    try {
      const ref = gerarReferenciaDemo(cobranca);
      await updateShared('cobrancas', cobranca.id, { refPagamento: ref });
      await refreshCobrancas();
      toast('Referência de demonstração gerada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível gerar a referência.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  // Simulação de DESENVOLVIMENTO: escreve a MESMA transição que o backend
  // `onWebhook` escreveria ao receber o callback do fornecedor — estado da
  // cobrança + crédito na conta corrente — passando pelo mesmo motor de
  // reconciliação. Idempotente por construção (o motor recusa duplicar o crédito).
  async function simularCallback() {
    if (!refPag || !refPag.referencia) {
      toast('Gere primeiro a referência de demonstração.', { tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      const contaCorrente = await listShared('conta_corrente');
      const plan = reconcileCobranca({
        cobranca,
        referencia: refPag.referencia,
        valor: cobranca.valor,
        // Chave de pagamento DETERMINÍSTICA na simulação: repetir o clique é
        // um replay (no-op), tal como um callback repetido do fornecedor.
        dataHoraPag: `SIM-${refPag.referencia}`,
        contaCorrente,
        agora: new Date().toISOString(),
      });
      if (!plan.matched) {
        toast('Callback não corresponde a esta cobrança.', { tone: 'error' });
        return;
      }
      if (plan.atualizarEstado) {
        await updateShared('cobrancas', cobranca.id, { estado: plan.estado, pagoEm: new Date().toISOString() });
      }
      if (plan.credito) {
        await createShared('conta_corrente', plan.credito);
      }
      await refreshCobrancas();
      toast(plan.alreadyReconciled ? 'Pagamento já estava reconciliado.' : 'Pagamento reconciliado na conta corrente.', { tone: 'ok' });
    } catch {
      toast('Falha ao simular o callback.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="cobranca-detalhe" data-demo-page="cobrancas-detalhe">
      <div className="row row-2" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>
        <Link className="stat-link" to="/">← Cobranças</Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{cobranca.descricao || '(sem descrição)'}</h1>
          <p className="page-subtitle">{cliente?.nome || '—'}</p>
        </div>
        <Badge tone={ESTADO_TONE[cobranca.estado] || 'neutral'}>{ESTADO_LABEL[cobranca.estado] || cobranca.estado}</Badge>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Valor</span>
          <span className="kpi-value is-accent" data-testid="cobranca-valor">{formatEur(cobranca.valor)}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Vencimento</span>
          <span className="kpi-value">{formatDate(cobranca.dataVencimento)}</span>
          <span className="field-hint">
            <Badge tone={atrasoTone(cobranca.dataVencimento, hoje)}>{atrasoLabel(cobranca.dataVencimento, hoje)}</Badge>
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Método</span>
          <span className="kpi-value" style={{ fontSize: 'var(--fs-4, 1.125rem)' }}>{METODO_LABEL[cobranca.metodo] || cobranca.metodo || '—'}</span>
        </div>
        <JurosAteHoje cobranca={cobranca} />
      </div>

      <div className="prazos-layout" style={{ marginTop: 'var(--sp-7, 2rem)' }}>
        {/* Timeline dos lembretes enviados + próximo passo devido. */}
        <section className="card" aria-label="Lembretes">
          <h2 className="card-title">Sequência de lembretes</h2>
          {sequencia
            ? <p className="field-hint" style={{ marginTop: 0 }}>Sequência: <strong>{sequencia.nome}</strong></p>
            : <p className="field-hint" style={{ marginTop: 0 }}>Sem sequência associada.</p>}

          <div data-testid="cobrancas-timeline" data-demo-target="cobrancas-timeline" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
            {enviados.length === 0 ? (
              <p className="text-subtle text-xs">Ainda não foram enviados lembretes para esta cobrança.</p>
            ) : (
              <ul className="passos-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {enviados.map((l, i) => (
                  <li
                    key={l.id || i}
                    className="passo-item"
                    data-testid="lembrete-enviado"
                    style={{ display: 'flex', gap: 'var(--sp-3, 0.75rem)', alignItems: 'flex-start', padding: 'var(--sp-2, 0.5rem) 0' }}
                  >
                    <span className="row-icon" aria-hidden="true">
                      {l.canal === 'whatsapp' ? <IconWhatsApp size={16} /> : <IconMail size={16} />}
                    </span>
                    <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
                      <span className="text-strong text-xs">
                        Passo {Number(l.passoIndex) + 1} · {CANAL_LABEL[l.canal] || l.canal}
                      </span>
                      <span className="text-subtle text-xs">
                        {formatDateTime(l.enviadoEm)} · {l.destinatario || '—'}
                      </span>
                    </span>
                    <Badge tone="ok">{l.estado === 'enviado' ? 'Enviado' : l.estado || 'Enviado'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="citius-resultado" data-testid="cobrancas-proximo-passo" role="note" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <span className="citius-resultado-icon" aria-hidden="true"><IconClock /></span>
            <span className="citius-resultado-text">
              {passoSeguinte ? (
                <>
                  <span className="citius-resultado-strong">
                    Próximo passo: dia +{passoSeguinte.offsetDias} ({CANAL_LABEL[passoSeguinte.canal] || passoSeguinte.canal})
                  </span>
                  <span className="citius-resultado-meta">
                    Agendado para {formatDate(passoSeguinte.dataAgendada)}
                    {passoSeguinte.diasAte === 0 ? ' (hoje)' : ` (em ${passoSeguinte.diasAte} dia(s))`}.
                  </span>
                  <span
                    className="text-xs"
                    data-testid="proximo-passo-preview"
                    style={{ display: 'block', marginTop: 'var(--sp-2, 0.5rem)', whiteSpace: 'pre-wrap' }}
                  >
                    {previewTemplate(passoSeguinte, templateVars)}
                  </span>
                </>
              ) : (
                <span className="citius-resultado-strong">Sequência concluída — não há passos por agendar.</span>
              )}
            </span>
          </div>
        </section>

        {/* Bloco de pagamento: referência de demonstração + reconciliação. */}
        <section className="card" aria-label="Pagamento">
          <h2 className="card-title">Pagamento</h2>

          {paga ? (
            <div className="citius-resultado is-ok" data-testid="cobranca-reconciliada" role="note">
              <span className="citius-resultado-icon" aria-hidden="true"><IconCheck /></span>
              <span className="citius-resultado-text">
                <span className="citius-resultado-strong">
                  Cobrança {cobranca.estado === 'parcial' ? 'parcialmente paga' : 'paga'} e reconciliada.
                </span>
                <span className="citius-resultado-meta">O crédito foi registado na conta corrente do cliente.</span>
              </span>
            </div>
          ) : (
            <p className="field-hint" style={{ marginTop: 0 }}>
              Gere a referência de pagamento e acompanhe a reconciliação automática pelo callback do fornecedor.
            </p>
          )}

          <div className="row row-2" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
            <Button
              variant="primary"
              size="sm"
              onClick={gerarReferencia}
              disabled={busy}
              data-demo-target="cobrancas-gerar-ref"
              data-testid="cobrancas-gerar-ref"
            >
              Gerar referência MB (demonstração)
            </Button>
          </div>

          {refPag && refPag.referencia && (
            <div className="rz-pay-method" data-testid="pay-multibanco" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
              <div className="row row-space-between">
                <span className="text-strong">Multibanco</span>
                <Badge tone="info">Demonstração</Badge>
              </div>
              <div className="stack stack-1" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                <span>Entidade <span className="rz-ref" data-testid="mb-entidade">{refPag.entidade || MB_ENTIDADE}</span></span>
                <span>Referência <span className="rz-ref" data-testid="mb-referencia">{refPag.referencia}</span></span>
                <span>Valor <span className="rz-ref">{formatEur(cobranca.valor)}</span></span>
              </div>
              <p className="field-hint" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                Referência de demonstração — a geração real ativa com as credenciais Ifthenpay.
              </p>
            </div>
          )}

          {dev && (
            <div className="stack stack-2" style={{ marginTop: 'var(--sp-4, 1rem)', paddingTop: 'var(--sp-3, 0.75rem)', borderTop: '1px dashed var(--color-border)' }}>
              <span className="row row-2 text-xs text-subtle" style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)' }}>
                <IconAlertTriangle size={14} /> Simulação de desenvolvimento
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={simularCallback}
                disabled={busy || !refPag || !refPag.referencia}
                data-testid="cobrancas-simular-callback"
              >
                Simular callback de pagamento
              </Button>
              <p className="field-hint" style={{ margin: 0 }}>
                Escreve a mesma transição que o callback real do fornecedor escreveria (estado pago + crédito na conta corrente).
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/*
 * "Juros até hoje" (fase 2, RET-CONS): juros de mora comerciais da cobrança
 * vencida, calculados PELO SERVIÇO legal-calculos (fronteira P2-001 - nunca
 * há fórmulas nem taxas nesta app). A memória citada por troços/Avisos fica
 * guardada em `calculos` e ligada à cobrança.
 */
function JurosAteHoje({ cobranca }) {
  const toast = useToast();
  const [resultado, setResultado] = useState(null);
  const [aCalcular, setACalcular] = useState(false);

  const vencida = cobranca.estado !== 'paga' && cobranca.dataVencimento
    && new Date(cobranca.dataVencimento) < new Date();
  if (!vencida) return null;

  async function calcular() {
    setACalcular(true);
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await calcularJuros({
        valor: cobranca.valor,
        dataVencimento: cobranca.dataVencimento,
        dataFim: hoje,
        tipoJuro: 'comercial',
      });
      if (!r.ok) { toast(r.error || 'O cálculo falhou.'); return; }
      setResultado(r.resultado);
      await guardarCalculo({
        tipo: 'juros', titulo: `Juros até hoje - ${cobranca.descricao || 'cobrança'}`,
        cobrancaId: cobranca.id, input: { valor: cobranca.valor, dataVencimento: cobranca.dataVencimento, dataFim: hoje, tipoJuro: 'comercial' },
        resultado: r.resultado,
      });
    } catch {
      toast('O serviço de cálculos não respondeu.');
    } finally {
      setACalcular(false);
    }
  }

  return (
    <div className="kpi-card" data-testid="cobranca-juros" data-demo-target="cobrancas-juros">
      <span className="kpi-label">Juros até hoje</span>
      {resultado ? (
        <>
          <span className="kpi-value is-accent" data-testid="cobranca-juros-total">{formatEur(resultado.totalJuros)}</span>
          <span className="field-hint">
            {resultado.trocos?.length || 0} troço(s) · cada um cita o seu Aviso · memória guardada
          </span>
        </>
      ) : (
        <Button size="sm" data-testid="cobranca-juros-calcular" disabled={aCalcular} onClick={calcular}>
          {aCalcular ? 'A calcular…' : 'Calcular juros'}
        </Button>
      )}
    </div>
  );
}
