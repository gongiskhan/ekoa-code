import { Icon } from './Icon.jsx';

function formatRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diffMs < min) return 'há instantes';
  if (diffMs < hr) return `há ${Math.floor(diffMs / min)} min`;
  if (diffMs < day) return `há ${Math.floor(diffMs / hr)} h`;
  if (diffMs < day * 7) return `há ${Math.floor(diffMs / day)} dias`;
  return d.toLocaleDateString('pt-PT');
}

const STATUS_LABEL = {
  open: 'Aberto',
  in_progress: 'Em curso',
  waiting_customer: 'Aguarda cliente',
  resolved: 'Resolvido',
  closed: 'Fechado',
};

const PRIORITY_LABEL = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

function statusClass(status) {
  return `status status-${status}`;
}

function priorityClass(p) {
  return `priority priority-${p}`;
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TicketList({
  tickets,
  categories,
  agents,
  activeId,
  onSelect,
}) {
  if (tickets.length === 0) {
    return (
      <div className="ticket-list-empty">
        <Icon name="inbox" size={28} />
        <p>Sem tickets nesta vista.</p>
      </div>
    );
  }
  return (
    <ul className="ticket-list">
      {tickets.map((t) => {
        const category = categories.find((c) => c.id === t.categoryId);
        const agent = agents.find((a) => a.id === t.assigneeId);
        return (
          <li
            key={t.id}
            className={`ticket-row ${t.id === activeId ? 'active' : ''}`}
          >
            <button
              type="button"
              className="ticket-button"
              onClick={() => onSelect(t.id)}
            >
              <div className="ticket-row-top">
                <div className="avatar">{initials(t.requesterName)}</div>
                <div className="ticket-row-body">
                  <div className="ticket-row-head">
                    <span className="ticket-subject">{t.subject}</span>
                    <span className="ticket-time">
                      {formatRelative(t.updatedAt || t.createdAt)}
                    </span>
                  </div>
                  <div className="ticket-row-meta">
                    <span className="ticket-requester">{t.requesterName}</span>
                    <span className="meta-dot">·</span>
                    <span className={statusClass(t.status)}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                    {category && (
                      <>
                        <span className="meta-dot">·</span>
                        <span
                          className="category-pill"
                          style={
                            category.color
                              ? {
                                  borderColor: 'var(--color-border, #E2E8F0)',
                                  color: 'var(--color-text-muted, #475569)',
                                }
                              : undefined
                          }
                        >
                          {category.name}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="ticket-row-preview">{t.body}</div>
                  <div className="ticket-row-foot">
                    <span className={priorityClass(t.priority)}>
                      <Icon
                        name={t.priority === 'low' ? 'priority-low' : 'priority-high'}
                        size={12}
                      />
                      <span>{PRIORITY_LABEL[t.priority] || 'Normal'}</span>
                    </span>
                    {agent && (
                      <span className="ticket-agent">
                        <span>Atribuído a</span>
                        <strong>{agent.name}</strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
