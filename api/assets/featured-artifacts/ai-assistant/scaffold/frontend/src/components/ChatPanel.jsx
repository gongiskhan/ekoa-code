import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-avatar" aria-hidden="true">
        <Icon name={isUser ? 'user' : 'sparkle'} size={16} />
      </div>
      <div className="message-content">
        <div className="message-meta">
          <span className="message-role">
            {isUser ? 'O seu pedido' : 'Assistente'}
          </span>
          <span className="message-time">{formatTime(message.createdAt)}</span>
        </div>
        <div className="message-body">
          {String(message.body || '')
            .split('\n')
            .map((line, i) => (
              <p key={i}>{line || ' '}</p>
            ))}
        </div>
      </div>
    </div>
  );
}

const PROMPT_SUGGESTIONS = [
  'Quais são os horários de atendimento?',
  'Como funciona a política de devoluções?',
  'Resuma o último relatório mensal.',
];

export function ChatPanel({ conversation, messages, thinking, onSend }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, thinking]);

  function submit(text) {
    const body = (text ?? draft).trim();
    if (!body) return;
    onSend(body);
    setDraft('');
    if (inputRef.current) inputRef.current.focus();
  }

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <h1 className="chat-title">{conversation.title || 'Conversa'}</h1>
        {conversation.summary && (
          <p className="chat-subtitle">{conversation.summary}</p>
        )}
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-intro">
            <div className="chat-intro-icon">
              <Icon name="sparkle" size={28} />
            </div>
            <h2 className="chat-intro-title">Em que posso ajudar?</h2>
            <p className="chat-intro-text">
              Faça uma pergunta. Veja os documentos guardados no separador
              Conhecimento ou ajuste o comportamento em Instruções.
            </p>
            <div className="chat-suggestions">
              {PROMPT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="suggestion"
                  onClick={() => submit(s)}
                >
                  <span>{s}</span>
                  <Icon name="chevron-right" size={14} />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {thinking && (
          <div className="message message-assistant" aria-live="polite">
            <div className="message-avatar" aria-hidden="true">
              <Icon name="sparkle" size={16} />
            </div>
            <div className="message-content">
              <div className="message-meta">
                <span className="message-role">Assistente</span>
              </div>
              <div className="thinking-indicator">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-label">A pensar...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          className="composer-input"
          placeholder="Escreva uma mensagem..."
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          className="primary-button"
          disabled={!draft.trim() || thinking}
          aria-label="Enviar"
        >
          <Icon name="send" />
          <span className="desktop-only">Enviar</span>
        </button>
      </form>
    </section>
  );
}
