import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, formatDate } from '../shared.js';
import { Badge, Button, EmptyState } from '../components/ui.jsx';
import { IconInbox, IconChevronRight, IconCheck, IconMail } from '../components/Icons.jsx';
import { estadoMeta, isNeedsReview, excerpt, byRecent } from './triage.js';
import { confirmarTriagem, propostaAutomatica, origemNotif } from './triage-commit.js';

/*
 * Caixa de entrada Citius - a fila de triagem viva. Alimentada tanto pela
 * intake automática de email (motor, no backend) como pelo "Colar notificação"
 * - a UI trabalha as linhas independentemente de quem as escreveu.
 *
 * "A rever" (needs-review) é a secção que exige acção - em destaque no topo,
 * com selecção múltipla para confirmar em lote as que estão PRONTAS (processo
 * emparelhado + ato com regra + data válida). As restantes ficam para revisão
 * individual - a confirmação em lote nunca adivinha nada.
 * "Processadas" reúne o que já foi triado. Clicar numa linha abre a triagem.
 */
export default function InboxPage() {
  const navigate = useNavigate();
  const { items, loading, refresh } = useSharedCollection('citius_notificacoes');
  const { items: processos } = useSharedCollection('processos');

  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [aProcessar, setAProcessar] = useState(false);
  const [bulkResumo, setBulkResumo] = useState(null);

  const { aRever, processadas } = useMemo(() => {
    const sorted = [...(items || [])].sort(byRecent);
    return {
      aRever: sorted.filter(isNeedsReview),
      processadas: sorted.filter((n) => !isNeedsReview(n)),
    };
  }, [items]);

  // As linhas em revisão cuja confirmação seria inequívoca (a mesma regra de
  // ouro da triagem individual). Só estas entram na confirmação em lote.
  const prontasIds = useMemo(
    () => new Set(aRever.filter((n) => propostaAutomatica(n, processos)).map((n) => n.id)),
    [aRever, processos],
  );

  const open = (n) => navigate(`/notificacao/${n.id}`);

  function onToggle(id) {
    setBulkResumo(null);
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const todasSelecionadas = aRever.length > 0 && aRever.every((n) => selecionadas.has(n.id));

  function onToggleTodas() {
    setBulkResumo(null);
    setSelecionadas(todasSelecionadas ? new Set() : new Set(aRever.map((n) => n.id)));
  }

  const prontasSelecionadas = aRever.filter((n) => selecionadas.has(n.id) && prontasIds.has(n.id)).length;

  async function onBulkConfirmar() {
    const alvo = aRever.filter((n) => selecionadas.has(n.id));
    if (alvo.length === 0 || aProcessar) return;
    setAProcessar(true);
    let confirmadas = 0;
    let semDados = 0;
    let jaTratadas = 0;
    let falhas = 0;
    try {
      for (const n of alvo) {
        const proposta = propostaAutomatica(n, processos);
        if (!proposta) {
          semDados += 1;
          continue;
        }
        try {
          const r = await confirmarTriagem(proposta);
          if (r.status === 'confirmada') confirmadas += 1;
          else jaTratadas += 1;
        } catch {
          falhas += 1;
        }
      }
    } finally {
      setAProcessar(false);
    }
    // Resumo honesto: diz exactamente o que aconteceu a cada linha selecionada.
    const partes = [`${confirmadas} confirmada${confirmadas === 1 ? '' : 's'}`];
    if (semDados > 0) {
      partes.push(`${semDados} mantida${semDados === 1 ? '' : 's'} para revisão individual (falta processo, ato ou data - nunca adivinhamos)`);
    }
    if (jaTratadas > 0) partes.push(`${jaTratadas} já tratada${jaTratadas === 1 ? '' : 's'} noutra sessão`);
    if (falhas > 0) partes.push(`${falhas} falhou${falhas === 1 ? '' : 'aram'} ao gravar`);
    setBulkResumo(partes.join(' · '));
    setSelecionadas(new Set());
    await refresh();
  }

  return (
    <div data-testid="inbox-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Caixa de entrada</h1>
          <p className="page-subtitle">
            As notificações Citius chegam aqui - da intake automática de email ou coladas à mão. Confirme cada
            uma para gerar o prazo; o que for ambíguo espera pela sua revisão e nunca gera um prazo adivinhado.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar a caixa.</span></div>
      ) : aRever.length === 0 && processadas.length === 0 ? (
        <EmptyState
          icon={<IconInbox />}
          title="Caixa vazia"
          hint="Assim que uma notificação Citius chegar por email - ou for colada em Colar notificação - aparece aqui para triagem."
        />
      ) : (
        <div className="stack stack-6">
          {aRever.length > 0 ? (
            <div
              className="card"
              data-testid="bulk-bar"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4, 1rem)', flexWrap: 'wrap', padding: 'var(--space-3, 0.75rem) var(--space-4, 1rem)' }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="bulk-select-todas"
                  checked={todasSelecionadas}
                  onChange={onToggleTodas}
                />
                <span className="text-small">Selecionar todas</span>
              </label>
              <span className="text-small text-subtle" data-testid="bulk-selecionadas">
                {selecionadas.size} selecionada{selecionadas.size === 1 ? '' : 's'} · {prontasSelecionadas} pronta{prontasSelecionadas === 1 ? '' : 's'} para confirmar
              </span>
              <Button
                variant="primary"
                size="sm"
                data-testid="bulk-confirmar"
                disabled={prontasSelecionadas === 0 || aProcessar}
                onClick={onBulkConfirmar}
              >
                <IconCheck /> {aProcessar ? 'A confirmar…' : 'Confirmar prontas'}
              </Button>
              {bulkResumo ? (
                <span className="text-small" data-testid="bulk-resultado">{bulkResumo}</span>
              ) : null}
            </div>
          ) : null}
          <Section
            testid="inbox-a-rever"
            title="A rever"
            emphasis
            count={aRever.length}
            rows={aRever}
            onOpen={open}
            emptyText="Nada por rever. Boa."
            selecionadas={selecionadas}
            onToggle={onToggle}
            prontasIds={prontasIds}
          />
          <Section
            testid="inbox-processadas"
            title="Processadas"
            count={processadas.length}
            rows={processadas}
            onOpen={open}
            emptyText="Ainda não há notificações processadas."
          />
        </div>
      )}

      <section
        className="card"
        aria-label="Intake automática de email"
        data-testid="citius-email-canal"
        style={{ marginTop: 'var(--space-6, 1.5rem)' }}
      >
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconMail /> Intake automática de email
        </h2>
        <p className="card-subtitle">O que o canal de email faz - e o que recusa fazer - com toda a honestidade.</p>
        <ul className="text-small" style={{ margin: 'var(--space-3, 0.75rem) 0 0', paddingLeft: '1.2em', lineHeight: 1.7 }}>
          <li>
            Cada email novo da caixa ligada passa pelo MESMO motor determinístico do "Colar notificação". Email que
            não seja uma notificação Citius é ignorado sem criar nada.
          </li>
          <li>
            Remetente autenticado (@citius.mj.pt): quando processo, ato e data do acto são inequívocos, o prazo e o
            evento são criados automaticamente e o sino avisa.
          </li>
          <li>
            Email reconhecido apenas pelo texto (origem não autenticada, forjável por terceiros): vai SEMPRE para
            revisão humana - "Origem não autenticada" - mesmo que tudo o resto seja inequívoco. Nunca cria prazo.
          </li>
          <li>
            Reentregas do mesmo email não duplicam prazos nem voltam a alertar depois de o primeiro alerta ter sido
            registado (carimbo alertedAt na própria linha).
          </li>
        </ul>
      </section>
    </div>
  );
}

function Section({ testid, title, emphasis, count, rows, onOpen, emptyText, selecionadas, onToggle, prontasIds }) {
  return (
    <section aria-label={title}>
      <div className="row row-space-between" style={{ marginBottom: 'var(--space-3, 0.75rem)' }}>
        <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>{title}</h2>
        <Badge tone={emphasis && count > 0 ? 'media' : 'neutral'}>{count}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted text-small" data-testid={testid}>{emptyText}</p>
      ) : (
        <ul className="citius-inbox" data-testid={testid}>
          {rows.map((n) => (
            <InboxRow
              key={n.id}
              n={n}
              onOpen={onOpen}
              selecionada={selecionadas ? selecionadas.has(n.id) : null}
              onToggle={onToggle}
              pronta={prontasIds ? prontasIds.has(n.id) : false}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxRow({ n, onOpen, selecionada, onToggle, pronta }) {
  const meta = estadoMeta(n.estado);
  const origem = origemNotif(n);
  const go = () => onOpen(n);
  return (
    <li
      className="citius-item is-clickable"
      data-testid="citius-item"
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      }}
    >
      {onToggle ? (
        <input
          type="checkbox"
          data-testid={`bulk-select-${n.id}`}
          aria-label={`Selecionar ${n.numeroProcesso || 'notificação'}`}
          checked={!!selecionada}
          title={pronta ? 'Pronta para confirmar em lote' : 'Fica para revisão individual (falta processo, ato ou data)'}
          style={{ marginRight: 'var(--space-3, 0.75rem)', flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={() => onToggle(n.id)}
        />
      ) : null}
      <div className="citius-item-main">
        <span className="citius-item-processo">{n.numeroProcesso || '(sem número de processo)'}</span>
        <span className="citius-item-ato">{n.ato || 'Ato não reconhecido'}</span>
        <span className="citius-item-detail">{excerpt(n.texto)}</span>
        {n.estado === 'matched' || n.estado === 'processada' ? (
          n.dataLimite ? (
            <span className="citius-item-detail is-limite">
              Data-limite {n.dataLimite} · {formatDate(n.dataLimite)}
            </span>
          ) : null
        ) : n.estado === 'needs-review' && n.motivo ? (
          <span className="citius-item-detail is-motivo">{n.motivo}</span>
        ) : null}
      </div>
      <div className="citius-item-side">
        {origem ? (
          <Badge tone="neutral" data-testid={`citius-origem-${n.id}`}>
            {origem === 'email' ? 'Email' : 'Colada'}
          </Badge>
        ) : null}
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="row-icon" aria-hidden="true" style={{ color: 'var(--color-text-subtle, #64748B)' }}><IconChevronRight /></span>
      </div>
    </li>
  );
}
