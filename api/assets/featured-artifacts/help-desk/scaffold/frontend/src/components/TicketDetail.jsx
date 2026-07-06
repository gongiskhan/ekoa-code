import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Aberto' },
  { value: 'in_progress', label: 'Em curso' },
  { value: 'waiting_customer', label: 'Aguarda cliente' },
  { value: 'resolved', label: 'Resolvido' },
  { value: 'closed', label: 'Fechado' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-PT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TicketDetail({
  ticket,
  categories,
  agents,
  responses,
  onChange,
  onReply,
  onBack,
}) {
  const [draft, setDraft] = useState('');
  const [showResponses, setShowResponses] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    setDraft('');
    setShowResponses(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [ticket.id]);

  function insertResponse(r) {
    setDraft((prev) => (prev ? `${prev}\n\n${r.body}` : r.body));
    setShowResponses(false);
  }

  function submitReply() {
    const text = draft.trim();
    if (!text) return;
    onReply(text);
    setDraft('');
  }

  const replies = ticket.replies || [];

  return (
    <article className="ticket-detail">
      <header className="detail-header">
        <button
          type="button"
          className="icon-button mobile-only"
          onClick={onBack}
          aria-label="Voltar à lista"
        >
          <Icon name="arrow-left" />
        </button>
        <div className="detail-header-main">
          <h1 className="detail-title">{ticket.subject}</h1>
          <div className="detail-meta">
            <span>{ticket.requesterName}</span>
            <span className="meta-dot">·</span>
            <span>{ticket.requesterEmail}</span>
            <span className="meta-dot">·</span>
            <span>Aberto em {formatDateTime(ticket.createdAt)}</span>
          </div>
        </div>
      </header>

      <div className="detail-controls">
        <label className="control">
          <span className="control-label">Estado</span>
          <select
            value={ticket.status}
            onChange={(e) => onChange({ status: e.target.value })}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          <span className="control-label">Prioridade</span>
          <select
            value={ticket.priority || 'normal'}
            onChange={(e) => onChange({ priority: e.target.value })}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          <span className="control-label">Categoria</span>
          <select
            value={ticket.categoryId || ''}
            onChange={(e) => onChange({ categoryId: e.target.value || null })}
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          <span className="control-label">Atribuição</span>
          <select
            value={ticket.assigneeId || ''}
            onChange={(e) => onChange({ assigneeId: e.target.value || null })}
          >
            <option value="">Sem atribuição</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="detail-thread" ref={scrollRef}>
        <div className="thread-message thread-message-customer">
          <div className="avatar lg">{initials(ticket.requesterName)}</div>
          <div className="thread-bubble">
            <div className="thread-bubble-head">
              <strong>{ticket.requesterName}</strong>
              <span className="thread-time">
                {formatDateTime(ticket.createdAt)}
              </span>
            </div>
            <div className="thread-body">
              {String(ticket.body || '')
                .split('\n')
                .map((line, i) => (
                  <p key={i}>{line || ' '}</p>
                ))}
            </div>
          </div>
        </div>

        {replies.map((r) => {
          const isAgent = r.author === 'agent';
          return (
            <div
              key={r.id}
              className={`thread-message ${
                isAgent ? 'thread-message-agent' : 'thread-message-customer'
              }`}
            >
              <div className="avatar lg">
                {isAgent ? 'AG' : initials(ticket.requesterName)}
              </div>
              <div className="thread-bubble">
                <div className="thread-bubble-head">
                  <strong>{isAgent ? 'Equipa de suporte' : ticket.requesterName}</strong>
                  <span className="thread-time">{formatDateTime(r.createdAt)}</span>
                </div>
                <div className="thread-body">
                  {String(r.body || '')
                    .split('\n')
                    .map((line, i) => (
                      <p key={i}>{line || ' '}</p>
                    ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="reply-panel">
        <div className="reply-toolbar">
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => setShowResponses((v) => !v)}
          >
            <Icon name="book" size={14} />
            <span>Respostas guardadas</span>
          </button>
          <span className="reply-hint">A resposta segue por correio electrónico ao cliente.</span>
        </div>
        {showResponses && (
          <ul className="saved-responses">
            {responses.length === 0 && (
              <li className="saved-empty">Sem respostas guardadas.</li>
            )}
            {responses.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="saved-button"
                  onClick={() => insertResponse(r)}
                >
                  <strong>{r.title}</strong>
                  <span>{r.body.slice(0, 90)}...</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="reply-input"
          placeholder="Escreva a resposta..."
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="reply-actions">
          <span className="reply-counter">{draft.length} carateres</span>
          <button
            type="button"
            className="primary-button"
            disabled={!draft.trim()}
            onClick={submitReply}
          >
            <Icon name="send" />
            <span>Enviar resposta</span>
          </button>
        </div>
      </footer>
    </article>
  );
}
