import { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatPanel } from './components/ChatPanel.jsx';
import { KnowledgeDialog } from './components/KnowledgeDialog.jsx';
import { InstructionsDialog } from './components/InstructionsDialog.jsx';
import { EmptyState } from './components/EmptyState.jsx';
import { Icon } from './components/Icon.jsx';

const ekoa = () =>
  (typeof window !== 'undefined' && window.__ekoa && window.__ekoa.fetch) ||
  (typeof window !== 'undefined' ? window.fetch.bind(window) : null);

// The app-data REST endpoint wraps its payload in a { success, data } envelope.
// Unwrap it here so callers always receive the bare array / record.
function unwrap(body) {
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
}

async function list(collection) {
  const f = ekoa();
  if (!f) return [];
  const res = await f(`/api/app-data/${collection}`);
  if (!res.ok) return [];
  const items = unwrap(await res.json());
  return Array.isArray(items) ? items : [];
}

async function create(collection, data) {
  const res = await ekoa()(`/api/app-data/${collection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return unwrap(await res.json());
}

async function update(collection, id, patch) {
  await ekoa()(`/api/app-data/${collection}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

async function remove(collection, id) {
  await ekoa()(`/api/app-data/${collection}/${id}`, { method: 'DELETE' });
}

// Fire-and-forget agent request. The platform streams the answer back via SSE
// on /api/v1/events. For this Starting Point we render a synthesised reply
// drawn from the knowledge base so the demo reads coherently before the user
// wires their own agent.
async function sendToAgent(message, sessionId) {
  const traceId =
    (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
    `trace-${Date.now()}`;
  try {
    await fetch('/api/v1/request', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${window.__EKOA_TOKEN || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        session_id: sessionId,
        mode: 'chat',
        trace_id: traceId,
      }),
    });
  } catch (err) {
    // The Starting Point demo continues with its canned reply regardless.
  }
  return traceId;
}

function tokens(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
}

function pickKnowledge(message, docs) {
  if (!docs.length) return null;
  const qt = tokens(message);
  let best = null;
  let bestScore = 0;
  for (const d of docs) {
    const body = `${d.title || ''} ${d.body || ''}`;
    const dt = tokens(body);
    const set = new Set(dt);
    let score = 0;
    for (const t of qt) if (set.has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore > 0 ? best : null;
}

function composeReply(message, docs) {
  const doc = pickKnowledge(message, docs);
  if (doc) {
    const excerpt = (doc.body || '').split(/\n\s*\n/)[0].slice(0, 320);
    return `Encontrei informação relevante em "${doc.title}":\n\n${excerpt}\n\nDeseja consultar o documento completo?`;
  }
  return 'Não localizei um documento da base de conhecimento que respondesse com confiança. Pode reformular o pedido ou adicionar um documento sobre o tema na base de conhecimento.';
}

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [instructions, setInstructions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const thinkingTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, m, d, i] = await Promise.all([
        list('conversations'),
        list('messages'),
        list('documents'),
        list('instructions'),
      ]);
      if (cancelled) return;
      const sortedConvos = [...c].sort((a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || ''),
      );
      setConversations(sortedConvos);
      setMessages(m);
      setDocuments(d);
      setInstructions(i);
      setActiveId(sortedConvos[0] ? sortedConvos[0].id : null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
      if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    };
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  const activeMessages = useMemo(
    () =>
      messages
        .filter((m) => m.conversationId === activeId)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
    [messages, activeId],
  );

  async function startNewConversation() {
    const created = await create('conversations', {
      title: 'Nova conversa',
      summary: '',
    });
    setConversations((prev) => [created, ...prev]);
    setActiveId(created.id);
    setShowSidebar(false);
  }

  async function deleteConversation(id) {
    await remove('conversations', id);
    const toRemove = messages.filter((m) => m.conversationId === id);
    await Promise.all(toRemove.map((m) => remove('messages', m.id)));
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setMessages((prev) => prev.filter((m) => m.conversationId !== id));
    if (activeId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveId(remaining[0] ? remaining[0].id : null);
    }
  }

  async function renameConversation(id, title) {
    const trimmed = title.trim();
    if (!trimmed) return;
    await update('conversations', id, { title: trimmed });
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
    );
  }

  async function sendMessage(text) {
    const body = text.trim();
    if (!body) return;
    let convoId = activeId;
    if (!convoId) {
      const created = await create('conversations', {
        title: body.slice(0, 60),
        summary: '',
      });
      setConversations((prev) => [created, ...prev]);
      convoId = created.id;
      setActiveId(convoId);
    }
    const userMsg = await create('messages', {
      conversationId: convoId,
      role: 'user',
      body,
    });
    setMessages((prev) => [...prev, userMsg]);

    // Surface a title from the very first user message in a thread.
    const activeMsgs = messages.filter((m) => m.conversationId === convoId);
    if (activeMsgs.length === 0) {
      const newTitle = body.slice(0, 60);
      await update('conversations', convoId, { title: newTitle });
      setConversations((prev) =>
        prev.map((c) => (c.id === convoId ? { ...c, title: newTitle } : c)),
      );
    }

    // Kick off the real agent call (fire-and-forget) and synthesise the demo
    // reply from the knowledge base while it streams in the background.
    sendToAgent(body, convoId);
    setThinking(true);
    thinkingTimer.current = setTimeout(async () => {
      const replyText = composeReply(body, documents);
      const assistantMsg = await create('messages', {
        conversationId: convoId,
        role: 'assistant',
        body: replyText,
      });
      setMessages((prev) => [...prev, assistantMsg]);
      await update('conversations', convoId, {
        summary: replyText.slice(0, 120),
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convoId
            ? {
                ...c,
                summary: replyText.slice(0, 120),
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );
      setThinking(false);
    }, 900);
  }

  async function saveDocument(doc) {
    if (doc.id) {
      await update('documents', doc.id, { title: doc.title, body: doc.body });
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, ...doc } : d)),
      );
    } else {
      const created = await create('documents', {
        title: doc.title,
        body: doc.body,
      });
      setDocuments((prev) => [created, ...prev]);
    }
  }

  async function deleteDocument(id) {
    await remove('documents', id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  async function saveInstruction(instruction) {
    if (instruction.id) {
      await update('instructions', instruction.id, {
        name: instruction.name,
        body: instruction.body,
      });
      setInstructions((prev) =>
        prev.map((i) => (i.id === instruction.id ? { ...i, ...instruction } : i)),
      );
    } else {
      const created = await create('instructions', {
        name: instruction.name,
        body: instruction.body,
      });
      setInstructions((prev) => [created, ...prev]);
    }
  }

  async function deleteInstruction(id) {
    await remove('instructions', id);
    setInstructions((prev) => prev.filter((i) => i.id !== id));
  }

  if (!loaded) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="top-bar">
        <button
          type="button"
          className="icon-button mobile-only"
          onClick={() => setShowSidebar(true)}
          aria-label="Abrir histórico"
        >
          <Icon name="menu" />
        </button>
        <div className="brand">
          <div className="brand-mark">
            <Icon name="sparkle" />
          </div>
          <div className="brand-text">
            <span className="brand-title">Assistente IA</span>
            <span className="brand-subtitle">Base de conhecimento ligada</span>
          </div>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowInstructions(true)}
          >
            <Icon name="rules" />
            <span>Instruções</span>
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowKnowledge(true)}
          >
            <Icon name="book" />
            <span>Conhecimento</span>
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className={`sidebar ${showSidebar ? 'sidebar-open' : ''}`}>
          <Sidebar
            conversations={conversations}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
              setShowSidebar(false);
            }}
            onNew={startNewConversation}
            onRename={renameConversation}
            onDelete={deleteConversation}
            onClose={() => setShowSidebar(false)}
          />
        </aside>
        {showSidebar && (
          <div
            className="sidebar-scrim"
            onClick={() => setShowSidebar(false)}
            aria-hidden="true"
          />
        )}

        <main className="main-area">
          {activeConversation ? (
            <ChatPanel
              conversation={activeConversation}
              messages={activeMessages}
              thinking={thinking}
              onSend={sendMessage}
            />
          ) : (
            <EmptyState onStart={startNewConversation} />
          )}
        </main>
      </div>

      {showKnowledge && (
        <KnowledgeDialog
          documents={documents}
          onSave={saveDocument}
          onDelete={deleteDocument}
          onClose={() => setShowKnowledge(false)}
        />
      )}
      {showInstructions && (
        <InstructionsDialog
          instructions={instructions}
          onSave={saveInstruction}
          onDelete={deleteInstruction}
          onClose={() => setShowInstructions(false)}
        />
      )}
    </div>
  );
}
