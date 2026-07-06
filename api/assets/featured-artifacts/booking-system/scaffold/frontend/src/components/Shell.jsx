import { NavLink } from 'react-router-dom';

function NavItem({ to, label, children }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'leftnav-link' + (isActive ? ' active' : '')}>
      {children}
      <span>{label}</span>
    </NavLink>
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export default function Shell({ children }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-brand-icon" aria-hidden="true">
            <svg {...ICON} width="18" height="18">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span>Sistema de Reservas</span>
        </div>
        <div className="topbar-meta">Agenda e marcações</div>
      </header>

      <nav className="leftnav" aria-label="Navegação principal">
        <div className="leftnav-section">Agenda</div>
        <NavItem to="/calendario" label="Calendário">
          <svg {...ICON}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </NavItem>
        <NavItem to="/marcacoes" label="Marcações">
          <svg {...ICON}>
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </NavItem>

        <div className="leftnav-section">Catálogo</div>
        <NavItem to="/servicos" label="Serviços">
          <svg {...ICON}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </NavItem>
        <NavItem to="/clientes" label="Clientes">
          <svg {...ICON}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </NavItem>

        <div className="leftnav-section">Configurações</div>
        <NavItem to="/disponibilidade" label="Disponibilidade">
          <svg {...ICON}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </NavItem>
      </nav>

      <main className="content">{children}</main>
    </div>
  );
}
