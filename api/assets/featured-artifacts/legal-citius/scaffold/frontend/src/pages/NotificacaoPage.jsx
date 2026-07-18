import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getShared,
  updateShared,
  useSharedCollection,
  appHref,
  formatDate,
} from '../shared.js';
import { computePrazo } from '../engine/prazo.mjs';
import { Button, Badge, Select, ConfirmDialog, EmptyState, toast } from '../components/ui.jsx';
import { IconInbox, IconCalendar, IconCheck, IconAlertTriangle, IconChevronRight, IconExternalLink, IconFolder } from '../components/Icons.jsx';
import { estadoMeta, isNeedsReview, regraForAto, isValidDateStr, ATO_OPTIONS } from './triage.js';
import { confirmarTriagem, origemNotif } from './triage-commit.js';

/*
 * Triagem de uma notificação Citius. Mostra o texto recebido e o que o parser
 * conseguiu ler (processo, ato, data do acto). O advogado confirma o processo
 * (emparelhado automaticamente ou escolhido) e o ato, e o motor calcula o prazo
 * mostrando o seu trabalho.
 *
 * REGRA ABSOLUTA: se a data do acto não veio (ou não é válida), o botão
 * Confirmar fica DESLIGADO até o utilizador a preencher à mão - nunca se
 * confirma um prazo a partir de uma data adivinhada.
 *
 * Confirmar: cria o prazo + um evento no processo, marca a notificação como
 * processada (com o(s) prazoId), e escreve uma notificação no sino.
 */
export default function NotificacaoPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { items: processos, loading: processosLoading } = useSharedCollection('processos');

  const [notif, setNotif] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'notfound'

  const [processoId, setProcessoId] = useState('');
  const [atoKey, setAtoKey] = useState('');
  const [dataActo, setDataActo] = useState('');
  const [saving, setSaving] = useState(false);
  const [rejeitarOpen, setRejeitarOpen] = useState(false);
  // Guarda o id já inicializado (não um booleano): assim uma navegação SPA entre
  // notificações reinicializa o formulário em vez de mostrar estado obsoleto.
  const lastInitIdRef = useRef(null);

  // Carrega a linha da caixa (sobrevive a um refresh do deep link). Ao mudar de
  // :id, limpa o formulário para não piscar valores da notificação anterior.
  useEffect(() => {
    let alive = true;
    setStatus('loading');
    setProcessoId('');
    setAtoKey('');
    setDataActo('');
    getShared('citius_notificacoes', id)
      .then((row) => {
        if (!alive) return;
        setNotif(row || null);
        setStatus(row ? 'ok' : 'notfound');
      })
      .catch(() => { if (alive) setStatus('notfound'); });
    return () => { alive = false; };
  }, [id]);

  // Preenche os controlos uma vez por :id, depois de a linha (a que corresponde
  // ao :id actual) E os processos estarem carregados - para o emparelhamento
  // automático por número do processo.
  useEffect(() => {
    if (!notif || notif.id !== id || processosLoading || lastInitIdRef.current === id) return;
    lastInitIdRef.current = id;
    setAtoKey(regraForAto(notif.ato) ? notif.ato : '');
    setDataActo(isValidDateStr(notif.dataActo) ? notif.dataActo : '');
    let pid = notif.processoId || '';
    if (!pid && notif.numeroProcesso) {
      const match = (processos || []).find((p) => (p.numeroProcesso || '').trim() === notif.numeroProcesso);
      if (match) pid = match.id;
    }
    setProcessoId(pid);
  }, [id, notif, processos, processosLoading]);

  const regra = regraForAto(atoKey);
  const selectedProcesso = useMemo(
    () => (processos || []).find((p) => p.id === processoId) || null,
    [processos, processoId],
  );

  // Proposta de prazo - só quando há processo, ato com regra e uma data válida.
  // Sem estes três, não há proposta e Confirmar fica desligado (a regra de ouro).
  const proposal = useMemo(() => {
    if (!processoId || !regra || !isValidDateStr(dataActo)) return null;
    try {
      return computePrazo({ dataNotificacao: dataActo, dias: regra.dias, contagem: regra.contagem });
    } catch {
      return null;
    }
  }, [processoId, regra, dataActo]);

  const pending = isNeedsReview(notif);
  const canConfirm = pending && !!proposal && !saving;

  async function onConfirmar() {
    if (!canConfirm || !selectedProcesso) return;
    setSaving(true);
    try {
      // A sequência de escritas (prazo + evento + 'matched' + sino) e a guarda
      // de idempotência vivem em confirmarTriagem - partilhadas com a
      // confirmação em lote da caixa de entrada, uma só fonte de verdade.
      const r = await confirmarTriagem({
        notifId: notif.id,
        processoId,
        ato: atoKey,
        dataActo,
        numeroProcesso: selectedProcesso.numeroProcesso,
      });
      if (r.status === 'ja-tratada') {
        setNotif(r.notif || notif);
        toast('Esta notificação já foi tratada noutra sessão.', { tone: 'info' });
        return;
      }
      setNotif(r.notif);
      toast('Prazo criado e notificação processada.', { tone: 'ok' });
    } catch (e) {
      toast(e && e.message ? e.message : 'Não foi possível confirmar o prazo.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function onRejeitar() {
    setRejeitarOpen(false);
    setSaving(true);
    try {
      // Mesma guarda de idempotência do Confirmar: nunca marcar como rejeitada
      // uma notificação que outra sessão já confirmou (prazo/evento criados).
      const current = await getShared('citius_notificacoes', notif.id);
      if (!current || current.estado !== 'needs-review') {
        setNotif(current || notif);
        toast('Esta notificação já foi tratada noutra sessão.', { tone: 'info' });
        return;
      }
      await updateShared('citius_notificacoes', notif.id, {
        estado: 'rejeitada',
        motivo: notif.motivo || 'Rejeitada na triagem',
      });
      const fresh = await getShared('citius_notificacoes', notif.id);
      setNotif(fresh || { ...notif, estado: 'rejeitada' });
      toast('Notificação rejeitada.', { tone: 'info' });
    } catch (e) {
      toast(e && e.message ? e.message : 'Não foi possível rejeitar.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') {
    return (
      <div data-testid="notificacao-page">
        <BackLink navigate={navigate} />
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar a notificação.</span></div>
      </div>
    );
  }

  if (status === 'notfound' || !notif) {
    return (
      <div data-testid="notificacao-page">
        <BackLink navigate={navigate} />
        <EmptyState
          icon={<IconInbox />}
          title="Notificação não encontrada"
          hint="A notificação pode ter sido removida. Volte à caixa de entrada."
        />
      </div>
    );
  }

  const meta = estadoMeta(notif.estado);

  return (
    <div data-testid="notificacao-page">
      <BackLink navigate={navigate} />

      <div className="page-header">
        <div>
          <h1 className="page-title">{notif.numeroProcesso || 'Notificação Citius'}</h1>
          <p className="page-subtitle">{notif.ato || 'Ato por reconhecer'}</p>
        </div>
        <div className="page-actions">
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
      </div>

      <div className="citius-layout">
        {/* -------- Notificação recebida -------- */}
        <section className="card" aria-label="Notificação recebida">
          <h2 className="card-title">Notificação recebida</h2>
          <p className="card-subtitle">Texto tal como chegou, e o que o parser conseguiu ler.</p>

          <div
            data-testid="notificacao-texto"
            style={{
              marginTop: 'var(--space-3, 0.75rem)',
              padding: 'var(--space-3, 0.75rem)',
              border: '1px solid var(--color-border, #E2E8F0)',
              borderRadius: 'var(--radius-md, 0.5rem)',
              background: 'var(--color-surface, #F8FAFC)',
              fontFamily: 'var(--font-mono, ui-monospace, Menlo, Consolas, monospace)',
              fontSize: 'var(--text-sm, 0.875rem)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {notif.texto || 'Sem texto.'}
          </div>

          <div className="divider" style={{ margin: 'var(--space-4, 1rem) 0' }} />

          <div className="stack stack-2">
            <ParsedRow label="Número do processo" value={notif.numeroProcesso} />
            <ParsedRow label="Ato" value={notif.ato} />
            <ParsedRow
              label="Data do acto"
              value={notif.dataActo ? `${notif.dataActo} · ${formatDate(notif.dataActo)}` : null}
            />
            {origemNotif(notif) ? (
              <ParsedRow
                label="Origem"
                value={origemNotif(notif) === 'email' ? 'Email (intake automática)' : 'Colada à mão'}
              />
            ) : null}
            {notif.motivo ? <ParsedRow label="Motivo da revisão" value={notif.motivo} warn /> : null}
          </div>
        </section>

        {/* -------- Triagem OU resultado -------- */}
        {pending ? (
          <section className="card" aria-label="Triagem">
            <h2 className="card-title">Triagem</h2>
            <p className="card-subtitle">Confirme o processo e o ato; o motor calcula o prazo e mostra o seu trabalho.</p>

            {/* Processo */}
            <div className="field" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              <span className="field-label">Processo</span>
              {selectedProcesso ? (
                <span className="text-small" style={{ color: 'var(--color-success, #16A34A)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <IconCheck size={14} /> Emparelhado: {selectedProcesso.numeroProcesso}
                </span>
              ) : (
                <span className="text-small" style={{ color: 'var(--color-warning, #D97706)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <IconAlertTriangle size={14} /> O processo não consta da espinha - associe o processo correto.
                </span>
              )}
              <Select
                data-testid="triage-processo"
                value={processoId}
                onChange={(e) => setProcessoId(e.target.value)}
              >
                <option value="">Selecione o processo…</option>
                {(processos || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.numeroProcesso}{p.tribunal ? ` - ${p.tribunal}` : ''}
                  </option>
                ))}
              </Select>
            </div>

            {/* Ato */}
            <div className="field" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              <span className="field-label">Ato</span>
              <Select
                data-testid="triage-ato"
                value={atoKey}
                onChange={(e) => setAtoKey(e.target.value)}
              >
                <option value="">Selecione o ato…</option>
                {ATO_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </Select>
            </div>

            {/* Data do acto */}
            <div className="field" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              <span className="field-label">Data do acto</span>
              <input
                type="date"
                className="input field-input"
                data-testid="triage-data"
                value={dataActo}
                onChange={(e) => setDataActo(e.target.value)}
              />
              {!isValidDateStr(dataActo) ? (
                <span className="field-hint" style={{ color: 'var(--color-warning, #D97706)' }}>
                  A data do acto não foi lida da notificação. Preencha-a para calcular e confirmar o prazo - nunca a adivinhamos.
                </span>
              ) : null}
            </div>

            {/* Proposta (mostra o seu trabalho) */}
            {proposal ? (
              <PrazoProposal proposal={proposal} regra={regra} ato={atoKey} />
            ) : (
              <p className="text-muted text-small" style={{ marginTop: 'var(--space-4, 1rem)' }} data-testid="prazo-proposta-vazia">
                Escolha processo e ato e indique a data do acto para ver a proposta de prazo.
              </p>
            )}

            <div className="citius-actions" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              <Button variant="primary" data-testid="confirmar-notificacao" disabled={!canConfirm} onClick={onConfirmar}>
                <IconCheck /> {saving ? 'A confirmar…' : 'Confirmar prazo'}
              </Button>
              <Button variant="ghost" data-testid="rejeitar-notificacao" disabled={saving} onClick={() => setRejeitarOpen(true)}>
                Rejeitar
              </Button>
            </div>
          </section>
        ) : (
          <ResultadoTriada notif={notif} navigate={navigate} />
        )}
      </div>

      <ConfirmDialog
        open={rejeitarOpen}
        title="Rejeitar notificação"
        message="A notificação sai da fila de revisão e passa a rejeitada. Não é criado nenhum prazo. Pode confirmar mais tarde a partir do histórico."
        confirmLabel="Rejeitar"
        cancelLabel="Cancelar"
        danger
        onConfirm={onRejeitar}
        onCancel={() => setRejeitarOpen(false)}
      />
    </div>
  );
}

function BackLink({ navigate }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      data-testid="voltar-caixa"
      onClick={() => navigate('/')}
      style={{ marginBottom: 'var(--space-3, 0.75rem)' }}
    >
      Voltar à caixa de entrada
    </button>
  );
}

function ParsedRow({ label, value, warn }) {
  return (
    <div className="row row-space-between row-3" style={{ alignItems: 'baseline' }}>
      <span className="text-small text-subtle">{label}</span>
      <span
        className={`text-small${warn ? '' : ' text-strong'}`}
        style={{ textAlign: 'right', ...(warn ? { color: 'var(--color-warning, #D97706)' } : null) }}
      >
        {value || 'Não reconhecido'}
      </span>
    </div>
  );
}

function PrazoProposal({ proposal, regra, ato }) {
  return (
    <div className="resultado-panel" data-testid="prazo-proposta">
      <div className="resultado-grid">
        <div className="resultado-tile">
          <span className="stat-label">Notificação</span>
          <span className="resultado-value">{proposal.dataNotificacao}</span>
        </div>
        <div className="resultado-tile is-limite">
          <span className="stat-label">Data-limite</span>
          <span className="resultado-value" data-testid="proposta-datalimite">{proposal.dataLimite}</span>
        </div>
        <div className="resultado-tile is-multa">
          <span className="stat-label">Multa até (art. 139.º)</span>
          <span className="resultado-value">{proposal.multaAte}</span>
        </div>
      </div>
      <span className="text-small text-subtle">
        Regra aplicada: {ato} - {regra.dias} dias {regra.contagem}. O prazo começa no dia seguinte à notificação (art. 138.º CPC).
      </span>
      <ol className="passos-list" data-testid="proposta-passos">
        {proposal.passos.map((p, i) => (
          <PassoItem key={i} passo={p} />
        ))}
      </ol>
    </div>
  );
}

function PassoItem({ passo }) {
  const isUtil = passo.util === true;
  const isSkip = passo.util === false;
  return (
    <li className={`passo-item${isUtil ? ' passo-util' : ''}`}>
      {passo.dia != null ? (
        <span className="passo-num">{passo.dia}</span>
      ) : (
        <span className="passo-num" aria-hidden="true">·</span>
      )}
      <span className={`passo-data${isSkip ? ' passo-skip' : ''}`}>{passo.data}</span>
      {passo.nota ? <span className="passo-nota">{passo.nota}</span> : null}
      {passo.motivo ? <span className="passo-nota">{passo.motivo}</span> : null}
    </li>
  );
}

function ResultadoTriada({ notif, navigate }) {
  const rejeitada = notif.estado === 'rejeitada';
  const prazoIds = Array.isArray(notif.prazoIds) ? notif.prazoIds : (notif.prazoId ? [notif.prazoId] : []);
  return (
    <section className="card" aria-label="Resultado da triagem">
      <h2 className="card-title">Resultado</h2>
      {rejeitada ? (
        <div className="citius-resultado is-review" data-testid="resultado-triada">
          <span className="citius-resultado-icon" aria-hidden="true"><IconAlertTriangle /></span>
          <span className="citius-resultado-text">
            <span className="citius-resultado-strong">Notificação rejeitada</span>
            <span className="citius-resultado-meta">Não foi criado nenhum prazo.</span>
          </span>
        </div>
      ) : (
        <div className="citius-resultado is-matched" data-testid="resultado-triada">
          <span className="citius-resultado-icon" aria-hidden="true"><IconCalendar /></span>
          <span className="citius-resultado-text">
            <span className="citius-resultado-strong">
              {notif.dataLimite ? `Prazo criado - data-limite ${notif.dataLimite}` : 'Prazo criado'}
            </span>
            {notif.dataLimite ? <span className="citius-resultado-meta">{formatDate(notif.dataLimite)}</span> : null}
          </span>
        </div>
      )}

      {!rejeitada && prazoIds.length > 0 ? (
        <a
          href={appHref('legal-prazos')}
          className="nav-link nav-launcher"
          data-testid="abrir-prazos"
          style={{ marginTop: 'var(--space-4, 1rem)' }}
        >
          <IconCalendar />
          <span>Ver no Prazos</span>
          <span className="nav-launcher-mark" aria-hidden="true"><IconExternalLink /></span>
        </a>
      ) : null}

      {!rejeitada && notif.processoId ? (
        <a
          href={appHref('legal-dossie', `processo/${notif.processoId}`)}
          className="nav-link nav-launcher"
          data-testid="abrir-dossie"
          style={{ marginTop: 'var(--space-2, 0.5rem)' }}
        >
          <IconFolder />
          <span>Abrir no Dossiê do processo</span>
          <span className="nav-launcher-mark" aria-hidden="true"><IconExternalLink /></span>
        </a>
      ) : null}

      <div className="citius-actions" style={{ marginTop: 'var(--space-4, 1rem)' }}>
        <Button variant="secondary" onClick={() => navigate('/historico')}>
          <IconChevronRight /> Ver no histórico
        </Button>
      </div>
    </section>
  );
}
