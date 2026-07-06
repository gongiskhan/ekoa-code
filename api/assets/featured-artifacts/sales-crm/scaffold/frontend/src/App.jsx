import { useState, useEffect, useMemo } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useParams,
  useNavigate,
} from 'react-router-dom';

import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import ContactDetail from './pages/ContactDetail.jsx';
import Deals from './pages/Deals.jsx';
import DealDetail from './pages/DealDetail.jsx';
import Activities from './pages/Activities.jsx';
import { DataProvider } from './components/DataContext.jsx';

const Router = typeof window !== 'undefined' && window.location.protocol === 'file:'
  ? HashRouter
  : BrowserRouter;

function NavIcon({ children }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 14l3-3 4 4 5-7" />
          </svg>
        </div>
        <div className="brand-text">
          <span className="brand-title">CRM de Vendas</span>
          <span className="brand-subtitle">Pipeline comercial</span>
        </div>
      </div>

      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' is-active' : '')}>
          <NavIcon>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
          </NavIcon>
          <span>Resumo</span>
        </NavLink>

        <NavLink to="/contactos" className={({ isActive }) => 'nav-link' + (isActive ? ' is-active' : '')}>
          <NavIcon>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </NavIcon>
          <span>Contactos</span>
        </NavLink>

        <NavLink to="/negocios" className={({ isActive }) => 'nav-link' + (isActive ? ' is-active' : '')}>
          <NavIcon>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1v22" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </NavIcon>
          <span>Negócios</span>
        </NavLink>

        <NavLink to="/atividade" className={({ isActive }) => 'nav-link' + (isActive ? ' is-active' : '')}>
          <NavIcon>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </NavIcon>
          <span>Atividade</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <span className="status-dot" aria-hidden="true" />
        <span>Os seus dados estão guardados em segurança</span>
      </div>
    </aside>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-search">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <span>Pesquise contactos ou negócios</span>
      </div>
      <div className="topbar-user">
        <span className="topbar-user-name">A sua equipa</span>
        <span className="topbar-user-avatar" aria-hidden="true">EV</span>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <DataProvider>
      <Router>
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">
            <TopBar />
            <main className="app-content">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/contactos" element={<Contacts />} />
                <Route path="/contactos/:id" element={<ContactDetail />} />
                <Route path="/negocios" element={<Deals />} />
                <Route path="/negocios/:id" element={<DealDetail />} />
                <Route path="/atividade" element={<Activities />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
          </div>
        </div>
      </Router>
    </DataProvider>
  );
}

function NotFound() {
  return (
    <div className="empty-state">
      <h2>Página não encontrada</h2>
      <p>A página que procura não existe. <Link to="/">Volte ao resumo</Link>.</p>
    </div>
  );
}
