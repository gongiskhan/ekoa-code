import { NavLink, useLocation } from 'react-router-dom';
import { IconDashboard, IconFileText, IconUsers, IconCoins, IconList, IconReceipt } from './Icons.jsx';

const NAV = [
  { to: '/', label: 'Painel', icon: IconDashboard, end: true, section: 'Visão geral' },
  { to: '/faturas', label: 'Faturas', icon: IconFileText, section: 'Faturação' },
  { to: '/pagamentos', label: 'Pagamentos', icon: IconCoins, section: 'Faturação' },
  { to: '/clientes', label: 'Clientes', icon: IconUsers, section: 'Cadastro' },
  { to: '/artigos', label: 'Artigos', icon: IconList, section: 'Cadastro' },
];

const TITLES = {
  '/': 'Painel de faturação',
  '/faturas': 'Faturas',
  '/pagamentos': 'Pagamentos',
  '/clientes': 'Clientes',
  '/artigos': 'Artigos faturáveis',
};

export default function Layout({ children }) {
  const location = useLocation();
  const title = TITLES[location.pathname] || 'Gestor de Faturas';

  const sections = NAV.reduce((acc, item) => {
    const last = acc[acc.length - 1];
    if (!last || last.section !== item.section) acc.push({ section: item.section, items: [item] });
    else last.items.push(item);
    return acc;
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon" aria-hidden="true">
            <IconReceipt />
          </div>
          <div>
            <span className="sidebar-brand-text">Faturas</span>
            <span className="sidebar-brand-tagline">Faturação simples</span>
          </div>
        </div>
        {sections.map((group) => (
          <div key={group.section} className="stack stack-2">
            <span className="nav-section-label">{group.section}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
                >
                  <Icon />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </aside>
      <div className="main-area">
        <header className="top-bar">
          <span className="top-bar-title">{title}</span>
          <div className="top-bar-actions">
            <span className="top-bar-meta">Mantenha a sua faturação organizada.</span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
