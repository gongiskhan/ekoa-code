import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconDoor, IconFolder } from './components/Icons.jsx';
import AcessosPage from './pages/AcessosPage.jsx';
import PartilhasPage from './pages/PartilhasPage.jsx';
import ClientePage from './cliente/ClientePage.jsx';
import DefinirPage from './cliente/DefinirPage.jsx';

// Duas faces no MESMO app (mesmo appId, mesma espinha, mesmo contexto injectado):
//
//  - FACE DO ESCRITÓRIO (rotas por omissão): dentro do Layout partilhado. Gere
//    acessos (convites) e o que cada cliente vê (partilhas explícitas).
//  - FACE DO CLIENTE (/cliente*): FORA do Layout - a sua própria casca mínima
//    (clara, Inter, cantos arredondados, linhas ténues), autenticada pela sessão
//    de app (palavra-passe), a mostrar SÓ o que lhe foi explicitamente partilhado.
//
// A face do cliente é decidida pela rota ANTES do <Routes> do escritório, para
// que o Layout (barra lateral, lançador, sino) nunca envolva o portal do cliente.
const NAV = [
  { to: '/', label: 'Acessos', icon: IconDoor, end: true, testid: 'nav-acessos' },
  { to: '/partilhas', label: 'Partilhas', icon: IconFolder, testid: 'nav-partilhas' },
];

const TITLE_MAP = {
  '/': 'Acessos',
  '/partilhas': 'Partilhas',
};

export default function App() {
  const location = useLocation();
  const isCliente = location.pathname === '/cliente' || location.pathname.startsWith('/cliente/');

  if (isCliente) {
    return (
      <>
        <Routes>
          <Route path="/cliente" element={<ClientePage />} />
          <Route path="/cliente/definir" element={<DefinirPage />} />
        </Routes>
        <ToastHost />
      </>
    );
  }

  return (
    <Layout appKey="legal-portal" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<AcessosPage />} />
        <Route path="/partilhas" element={<PartilhasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
