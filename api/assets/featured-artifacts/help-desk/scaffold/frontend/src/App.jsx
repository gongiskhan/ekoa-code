import { useState, useEffect, useMemo } from 'react';
import { TicketList } from './components/TicketList.jsx';
import { TicketDetail } from './components/TicketDetail.jsx';
import { IntegrationStatus } from './components/IntegrationStatus.jsx';
import { IntegrationNeededCTA } from './components/IntegrationNeededCTA.jsx';
import { ManageDialog } from './components/ManageDialog.jsx';
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

async function listAppData(collection) {
  const f = ekoa();
  if (!f) return [];
  const res = await f(`/api/app-data/${collection}`);
  if (!res.ok) return [];
  const items = unwrap(await res.json());
  return Array.isArray(items) ? items : [];
}

async function createAppData(collection, data) {
  const res = await ekoa()(`/api/app-data/${collection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return unwrap(await res.json());
}

async function updateAppData(collection, id, patch) {
  await ekoa()(`/api/app-data/${collection}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

async function removeAppData(collection, id) {
  await ekoa()(`/api/app-data/${collection}/${id}`, { method: 'DELETE' });
}

/**
 * Wrapper around the platform's callIntegration contract. Returns:
 *   { ok: true, data }
 * or
 *   { ok: false, status: 'needs_integration', integration, options, message }
 */
async function callIntegration(category, action, args = {}) {
  const f = ekoa();
  if (!f)
    return {
      ok: false,
      status: 'needs_integration',
      integration: category,
      message: 'O ambiente Ekoa ainda não está pronto.',
    };
  const res = await f('/api/v1/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: 'ekoa.integrations',
      intent: 'call',
      params: { category, action, args },
    }),
  });
  if (!res.ok) {
    return {
      ok: false,
      status: 'needs_integration',
      integration: category,
      message: `Não foi possível executar a acção (${res.status}).`,
    };
  }
  const body = await res.json();
  if (body && body.type === 'action_error') {
    return {
      ok: false,
      status: 'needs_integration',
      integration: category,
      message: body.error || 'Erro inesperado.',
    };
  }
  return body && body.data
    ? body.data
    : {
        ok: false,
        status: 'needs_integration',
        integration: category,
        message: 'Resposta sem dados.',
      };
}

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'open', label: 'Abertos' },
  { value: 'in_progress', label: 'Em curso' },
  { value: 'waiting_customer', label: 'Aguarda cliente' },
  { value: 'resolved', label: 'Resolvidos' },
  { value: 'closed', label: 'Fechados' },
];

export default function App() {
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [agents, setAgents] = useState([]);
  const [responses, setResponses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');
  const [emailStatus, setEmailStatus] = useState({ kind: 'idle' });
  const [showCTA, setShowCTA] = useState(false);
  const [showMobileList, setShowMobileList] = useState(true);
  const [manageOpen, setManageOpen] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, c, a, r] = await Promise.all([
        listAppData('tickets'),
        listAppData('categories'),
        listAppData('agents'),
        listAppData('responses'),
      ]);
      if (cancelled) return;
      const sorted = [...t].sort(
        (a, b) =>
          (b.updatedAt || b.createdAt || '').localeCompare(
            a.updatedAt || a.createdAt || '',
          ),
      );
      setTickets(sorted);
      setCategories(c);
      setAgents(a);
      setResponses(r);
      setActiveId(sorted[0] ? sorted[0].id : null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe email integration on first load (without blocking the UI).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEmailStatus({ kind: 'checking' });
      const r = await callIntegration('email', 'status', {});
      if (cancelled) return;
      if (r.ok) {
        setEmailStatus({
          kind: 'connected',
          unread:
            (r.data && typeof r.data.unread === 'number' && r.data.unread) || 0,
          provider:
            (r.data && r.data.provider) || (r.data && r.data.account) || 'email',
        });
      } else if (r.status === 'needs_integration') {
        setEmailStatus({
          kind: 'needs_integration',
          options: r.options || ['gmail', 'outlook'],
          message: r.message,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filter !== 'all' && t.status !== filter) return false;
      if (!q) return true;
      return (
        (t.subject || '').toLowerCase().includes(q) ||
        (t.requesterName || '').toLowerCase().includes(q) ||
        (t.requesterEmail || '').toLowerCase().includes(q) ||
        (t.body || '').toLowerCase().includes(q)
      );
    });
  }, [tickets, filter, query]);

  const counts = useMemo(() => {
    const map = { all: tickets.length };
    for (const s of [
      'open',
      'in_progress',
      'waiting_customer',
      'resolved',
      'closed',
    ]) {
      map[s] = tickets.filter((t) => t.status === s).length;
    }
    return map;
  }, [tickets]);

  const activeTicket = useMemo(
    () => tickets.find((t) => t.id === activeId) || null,
    [tickets, activeId],
  );

  function showToast(message, variant = 'info') {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 3200);
  }

  async function updateTicket(id, patch) {
    await updateAppData('tickets', id, patch);
    setTickets((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, ...patch, updatedAt: new Date().toISOString() }
          : t,
      ),
    );
  }

  async function replyToTicket(ticket, body) {
    const text = (body || '').trim();
    if (!text) return;

    const sendResult = await callIntegration('email', 'send', {
      to: ticket.requesterEmail,
      subject: `Re: ${ticket.subject}`,
      body: text,
      inReplyTo: ticket.messageId,
    });

    if (!sendResult.ok && sendResult.status === 'needs_integration') {
      setShowCTA({
        category: sendResult.integration,
        options: sendResult.options,
        message: sendResult.message,
      });
      return;
    }

    const newReply = {
      id: `reply-${Date.now()}`,
      author: 'agent',
      body: text,
      createdAt: new Date().toISOString(),
    };
    const updatedReplies = [...(ticket.replies || []), newReply];
    const nextStatus =
      ticket.status === 'open' ? 'waiting_customer' : ticket.status;
    await updateTicket(ticket.id, {
      replies: updatedReplies,
      status: nextStatus,
      lastReplyAt: newReply.createdAt,
    });
    showToast('Resposta enviada por correio electrónico.');
  }

  async function createTicket(payload) {
    const created = await createAppData('tickets', {
      ...payload,
      status: 'open',
      replies: [],
    });
    setTickets((prev) => [created, ...prev]);
    setActiveId(created.id);
    setShowMobileList(false);
  }

  async function saveCategory(value) {
    if (value.id) {
      await updateAppData('categories', value.id, value);
      setCategories((prev) =>
        prev.map((c) => (c.id === value.id ? { ...c, ...value } : c)),
      );
    } else {
      const created = await createAppData('categories', value);
      setCategories((prev) => [...prev, created]);
    }
  }
  async function deleteCategory(id) {
    await removeAppData('categories', id);
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }

  async function saveAgent(value) {
    if (value.id) {
      await updateAppData('agents', value.id, value);
      setAgents((prev) =>
        prev.map((a) => (a.id === value.id ? { ...a, ...value } : a)),
      );
    } else {
      const created = await createAppData('agents', value);
      setAgents((prev) => [...prev, created]);
    }
  }
  async function deleteAgent(id) {
    await removeAppData('agents', id);
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }

  async function saveResponse(value) {
    if (value.id) {
      await updateAppData('responses', value.id, value);
      setResponses((prev) =>
        prev.map((r) => (r.id === value.id ? { ...r, ...value } : r)),
      );
    } else {
      const created = await createAppData('responses', value);
      setResponses((prev) => [...prev, created]);
    }
  }
  async function deleteResponse(id) {
    await removeAppData('responses', id);
    setResponses((prev) => prev.filter((r) => r.id !== id));
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
        <div className="brand">
          <div className="brand-mark">
            <Icon name="lifebuoy" />
          </div>
          <div className="brand-text">
            <span className="brand-title">Helpdesk</span>
            <span className="brand-subtitle">Suporte a clientes</span>
          </div>
        </div>
        <IntegrationStatus status={emailStatus} onConnect={() => setShowCTA({
          category: 'email',
          options: emailStatus.options || ['gmail', 'outlook'],
          message: emailStatus.message,
        })} />
        <div className="top-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setManageOpen('categories')}
          >
            <Icon name="tag" />
            <span>Categorias</span>
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setManageOpen('agents')}
          >
            <Icon name="users" />
            <span>Agentes</span>
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setManageOpen('responses')}
          >
            <Icon name="book" />
            <span>Respostas</span>
          </button>
        </div>
      </header>

      <div className={`layout ${showMobileList ? 'show-list' : 'show-detail'}`}>
        <section className="list-pane">
          <div className="list-toolbar">
            <div className="search-field">
              <Icon name="search" size={16} />
              <input
                type="text"
                placeholder="Procurar"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="new-button compact"
              onClick={() =>
                createTicket({
                  subject: 'Novo pedido',
                  requesterName: 'Cliente',
                  requesterEmail: 'cliente@exemplo.pt',
                  categoryId: categories[0] ? categories[0].id : null,
                  priority: 'normal',
                  body: 'Descreva o pedido recebido.',
                })
              }
            >
              <Icon name="plus" />
              <span>Novo</span>
            </button>
          </div>
          <div className="filter-row" role="tablist">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value}
                type="button"
                role="tab"
                aria-selected={filter === s.value}
                className={`filter-chip ${filter === s.value ? 'active' : ''}`}
                onClick={() => setFilter(s.value)}
              >
                <span>{s.label}</span>
                <span className="filter-count">{counts[s.value] || 0}</span>
              </button>
            ))}
          </div>
          <TicketList
            tickets={filteredTickets}
            categories={categories}
            agents={agents}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
              setShowMobileList(false);
            }}
          />
        </section>

        <section className="detail-pane">
          {activeTicket ? (
            <TicketDetail
              ticket={activeTicket}
              categories={categories}
              agents={agents}
              responses={responses}
              onChange={(patch) => updateTicket(activeTicket.id, patch)}
              onReply={(body) => replyToTicket(activeTicket, body)}
              onBack={() => setShowMobileList(true)}
            />
          ) : (
            <div className="empty-pane">
              <div className="empty-card">
                <div className="empty-icon">
                  <Icon name="inbox" size={32} />
                </div>
                <h2 className="empty-title">Sem ticket selecionado</h2>
                <p className="empty-text">
                  Escolha um ticket à esquerda ou crie um novo para começar.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {toast && (
        <div className={`toast toast-${toast.variant}`} role="status">
          <Icon name="check" />
          <span>{toast.message}</span>
        </div>
      )}

      {showCTA && (
        <IntegrationNeededCTA
          category={showCTA.category}
          options={showCTA.options}
          message={showCTA.message}
          onClose={() => setShowCTA(false)}
        />
      )}

      {manageOpen && (
        <ManageDialog
          mode={manageOpen}
          categories={categories}
          agents={agents}
          responses={responses}
          onSaveCategory={saveCategory}
          onDeleteCategory={deleteCategory}
          onSaveAgent={saveAgent}
          onDeleteAgent={deleteAgent}
          onSaveResponse={saveResponse}
          onDeleteResponse={deleteResponse}
          onClose={() => setManageOpen(null)}
        />
      )}
    </div>
  );
}
