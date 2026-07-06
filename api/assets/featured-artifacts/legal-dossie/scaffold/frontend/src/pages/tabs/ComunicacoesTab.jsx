import { useMemo, useState } from 'react';
import { updateShared, formatDateTime } from '../../shared.js';
import { Button, Badge, EmptyState, ConfirmDialog, toast } from '../../components/ui.jsx';
import { IconWhatsApp, IconMail, IconChevronDown, IconChevronRight } from '../../components/Icons.jsx';

/* Só dígitos de um endereço/telefone, para comparar contactos de forma robusta
 * a prefixos de país e espaços. */
function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}
/* Últimos 9 dígitos (número nacional significativo) - ignora o indicativo. */
function nationalTail(digits) {
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/* Uma mensagem "por associar" é PROVÁVEL deste cliente quando já traz o seu
 * clienteId, ou quando o remetente bate certo com o email/telefone do cliente
 * do processo. Serve apenas para ORDENAR/rotular candidatas - a associação em si
 * exige sempre confirmação explícita. */
function isProvavelDoCliente(com, processo, cliente) {
  if (processo.clienteId && com.clienteId === processo.clienteId) return true;
  if (!cliente) return false;
  const addr = String(com.fromAddr || '').trim().toLowerCase();
  const email = String(cliente.email || '').trim().toLowerCase();
  if (addr && email && addr === email) return true;
  const from = digitsOf(com.fromAddr);
  const tel = digitsOf(cliente.telefone);
  if (from && tel && nationalTail(from) === nationalTail(tel)) return true;
  return false;
}

/* Resumo curto de uma mensagem para o diálogo de confirmação (quem + excerto). */
function resumoCandidato(com) {
  const quem = com.fromName || com.fromAddr || 'Remetente desconhecido';
  const corpo = String(com.subject || com.body || '').trim();
  if (!corpo) return quem;
  const excerto = corpo.length > 80 ? `${corpo.slice(0, 80)}…` : corpo;
  return `${quem} - "${excerto}"`;
}

function CanalIcon({ canal, ...props }) {
  return canal === 'whatsapp' ? <IconWhatsApp {...props} /> : <IconMail {...props} />;
}

function canalLabel(canal) {
  return canal === 'whatsapp' ? 'WhatsApp' : 'Email';
}

function directionLabel(direction) {
  if (direction === 'out') return 'Enviada';
  if (direction === 'in') return 'Recebida';
  return '';
}

/* Uma mensagem na timeline: canal, remetente, assunto, excerto expansível. */
function ComunicacaoRow({ com }) {
  const [open, setOpen] = useState(false);
  const body = com.body || '';
  const long = body.length > 160;
  const shown = open || !long ? body : `${body.slice(0, 160)}…`;

  return (
    <li className="citius-item" data-testid="comunicacao-row" style={{ alignItems: 'flex-start' }}>
      <div className="citius-item-main" style={{ flex: 1 }}>
        <span className="row row-2" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <span className="row-icon" aria-hidden="true">
            <CanalIcon canal={com.canal} size={16} />
          </span>
          <span className="citius-item-processo" style={{ fontVariantNumeric: 'normal' }}>
            {com.fromName || com.fromAddr || 'Remetente desconhecido'}
          </span>
          <Badge tone="neutral">{canalLabel(com.canal)}</Badge>
          {directionLabel(com.direction) ? (
            <span className="text-xs text-subtle">{directionLabel(com.direction)}</span>
          ) : null}
          {/* Mensagem ao nível do cliente (sem processo): marcada para o advogado
              perceber que não pertence a ESTA matéria, só ao cliente. */}
          {!com.processoId ? (
            <Badge tone="media" data-testid="com-sem-processo">
              Cliente sem processo
            </Badge>
          ) : null}
        </span>
        {com.subject ? <span className="text-strong text-small">{com.subject}</span> : null}
        {body ? (
          <span className="text-muted text-small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {shown}
          </span>
        ) : null}
        <span className="row row-2" style={{ gap: 'var(--sp-2)' }}>
          <span className="citius-item-detail">{formatDateTime(com.receivedAt || com.createdAt)}</span>
          {long ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setOpen((v) => !v)}
              style={{ paddingLeft: 0 }}
            >
              {open ? 'Menos' : 'Mais'}
            </button>
          ) : null}
        </span>
      </div>
    </li>
  );
}

/*
 * Separador Comunicações: a timeline de mensagens (WhatsApp/email) ligadas a
 * este processo ou ao seu cliente, mais uma gaveta de triagem das mensagens
 * "por associar" (de qualquer origem). Associar liga a mensagem a este processo
 * e cliente e marca-a como associada. Só lê e faz PATCH de status/vínculos.
 */
export default function ComunicacoesTab({ processo, cliente, comunicacoesProcesso, todas, refresh }) {
  const [openTriagem, setOpenTriagem] = useState(true);
  const [busy, setBusy] = useState(null);
  // Mensagem à espera de confirmação de associação (abre o ConfirmDialog).
  const [pendingAssoc, setPendingAssoc] = useState(null);
  const [outrasAbertas, setOutrasAbertas] = useState(false);

  const timeline = useMemo(() => {
    return comunicacoesProcesso
      .slice()
      .sort((a, b) => String(b.receivedAt || b.createdAt || '').localeCompare(String(a.receivedAt || a.createdAt || '')));
  }, [comunicacoesProcesso]);

  const porAssociar = useMemo(() => {
    return (todas || [])
      .filter((c) => c.status === 'por-associar')
      .slice()
      .sort((a, b) => String(b.receivedAt || b.createdAt || '').localeCompare(String(a.receivedAt || a.createdAt || '')));
  }, [todas]);

  // Divide as candidatas: prováveis deste cliente primeiro (contacto bate certo),
  // o resto depois. Reduz o risco de associar por engano uma mensagem alheia.
  const { provaveis, outras } = useMemo(() => {
    const prov = [];
    const out = [];
    for (const com of porAssociar) {
      (isProvavelDoCliente(com, processo, cliente) ? prov : out).push(com);
    }
    return { provaveis: prov, outras: out };
  }, [porAssociar, processo, cliente]);

  async function associar(com) {
    setBusy(com.id);
    try {
      const patch = { processoId: processo.id, status: 'associada' };
      if (processo.clienteId) patch.clienteId = processo.clienteId;
      // matchInfo é um objecto estruturado, consistente com a correspondência
      // automática dos backends de captura (rule + timestamp) - nunca uma string
      // livre, que baralharia a proveniência.
      patch.matchInfo = { rule: 'manual', matchedAt: new Date().toISOString() };
      await updateShared('comunicacoes', com.id, patch);
      await refresh();
      toast('Mensagem associada a este processo.', { tone: 'ok' });
    } catch {
      toast('Não foi possível associar a mensagem.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  // Uma linha de candidata na gaveta. O botão NÃO associa directamente - abre o
  // diálogo de confirmação, para nunca ligar uma mensagem por um clique perdido.
  const renderCandidato = (com) => (
    <li key={com.id} className="documento-item" style={{ alignItems: 'flex-start' }}>
      <span className="row-icon" style={{ marginTop: 2 }} aria-hidden="true">
        <CanalIcon canal={com.canal} size={16} />
      </span>
      <div className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-strong text-small">{com.fromName || com.fromAddr || 'Desconhecido'}</span>
        {com.subject ? <span className="text-small">{com.subject}</span> : null}
        {com.body ? (
          <span className="text-muted text-small" style={{ lineHeight: 1.5 }}>
            {com.body.length > 140 ? `${com.body.slice(0, 140)}…` : com.body}
          </span>
        ) : null}
        <span className="citius-item-detail">{formatDateTime(com.receivedAt || com.createdAt)}</span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        data-testid={`associar-${com.id}`}
        disabled={busy === com.id}
        onClick={() => setPendingAssoc(com)}
      >
        Associar a este processo
      </Button>
    </li>
  );

  return (
    <div className="stack stack-6" data-testid="comunicacoes-tab">
      {/* ---- Por associar ---- */}
      <div className="card stack stack-3" data-testid="por-associar-section">
        <button
          type="button"
          className="row row-space-between"
          onClick={() => setOpenTriagem((v) => !v)}
          style={{ background: 'transparent', border: 0, padding: 0, width: '100%', textAlign: 'left' }}
        >
          <span className="row row-2" style={{ gap: 'var(--sp-2)' }}>
            <span className="row-icon" aria-hidden="true">
              {openTriagem ? <IconChevronDown /> : <IconChevronRight />}
            </span>
            <h2 className="card-title" style={{ margin: 0 }}>
              Por associar
            </h2>
            {porAssociar.length > 0 ? <Badge tone="media">{porAssociar.length}</Badge> : null}
          </span>
        </button>
        {openTriagem ? (
          porAssociar.length === 0 ? (
            <p className="text-muted text-small" style={{ margin: 0 }}>
              Sem mensagens por associar. As novas mensagens sem correspondência automática aparecem aqui.
            </p>
          ) : (
            <div className="stack stack-3">
              {provaveis.length > 0 ? (
                <div className="stack stack-1" data-testid="grupo-provaveis">
                  <h3 className="text-strong text-small" style={{ margin: 0 }}>
                    Prováveis deste cliente
                  </h3>
                  <ul className="documentos-list">{provaveis.map(renderCandidato)}</ul>
                </div>
              ) : null}
              {outras.length > 0 ? (
                <div className="stack stack-1" data-testid="grupo-outras">
                  {/* Recolhido por omissão: mensagens sem afinidade com este
                      cliente não expõem remetente/conteúdo neste processo até
                      o advogado as pedir explicitamente. (Dentro da mesma
                      conta - a triagem global vive no Núcleo.) */}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="outras-toggle"
                    onClick={() => setOutrasAbertas((v) => !v)}
                  >
                    {outrasAbertas
                      ? 'Ocultar mensagens de outros contactos'
                      : `Mostrar mensagens de outros contactos (${outras.length})`}
                  </Button>
                  {outrasAbertas ? (
                    <ul className="documentos-list">{outras.map(renderCandidato)}</ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </div>

      {/* ---- Timeline ---- */}
      <div className="stack stack-3">
        <h2 className="card-title" style={{ margin: 0 }}>
          Timeline{cliente ? ` · ${cliente.nome}` : ''}
        </h2>
        {timeline.length === 0 ? (
          <EmptyState
            icon={<IconMail />}
            title="Sem comunicações"
            hint="As mensagens WhatsApp e email ligadas a este processo ou ao seu cliente aparecem aqui."
          />
        ) : (
          <ul className="citius-inbox" data-testid="comunicacoes-timeline">
            {timeline.map((com) => (
              <ComunicacaoRow key={com.id} com={com} />
            ))}
          </ul>
        )}
      </div>

      {/* Confirmação explícita antes de ligar a mensagem a este processo - diz
          quem enviou e a que processo vai, para não associar por engano. */}
      <ConfirmDialog
        open={!!pendingAssoc}
        title="Associar a este processo?"
        message={
          pendingAssoc
            ? `Associar a mensagem de ${resumoCandidato(pendingAssoc)} ao processo ${
                processo.numeroProcesso || '(sem número)'
              }?`
            : ''
        }
        confirmLabel="Associar"
        cancelLabel="Cancelar"
        onConfirm={() => {
          const com = pendingAssoc;
          setPendingAssoc(null);
          if (com) associar(com);
        }}
        onCancel={() => setPendingAssoc(null)}
      />
    </div>
  );
}
