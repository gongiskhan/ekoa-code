import { NavLink, useLocation } from 'react-router-dom';
import { IconDashboard, IconPackage, IconShoppingBag, IconUsers, IconBox } from './Icons.jsx';

const NAV = [
  { to: '/', label: 'Painel', icon: IconDashboard, end: true, section: 'Visão geral' },
  { to: '/produtos', label: 'Produtos', icon: IconPackage, section: 'Catálogo' },
  { to: '/encomendas', label: 'Encomendas', icon: IconShoppingBag, section: 'Catálogo' },
  { to: '/clientes', label: 'Clientes', icon: IconUsers, section: 'Catálogo' },
];

const TITLES = {
  '/': 'Painel da loja',
  '/produtos': 'Produtos',
  '/encomendas': 'Encomendas',
  '/clientes': 'Clientes',
};

export default function Layout({ children }) {
  const location = useLocation();
  const title = TITLES[location.pathname] || 'Catálogo E-commerce';

  // Group NAV by section to render labels.
  const sections = NAV.reduce((acc, item) => {
    const last = acc[acc.length - 1];
    if (!last || last.section !== item.section) {
      acc.push({ section: item.section, items: [item] });
    } else {
      last.items.push(item);
    }
    return acc;
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon" aria-hidden="true">
            <IconBox />
          </div>
          <div>
            <span className="sidebar-brand-text">Catálogo</span>
            <span className="sidebar-brand-tagline">Comércio digital</span>
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
            <span className="top-bar-meta">Veja o desempenho da sua loja em tempo real.</span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
