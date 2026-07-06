import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconShieldCheck, IconPlus } from './components/Icons.jsx';
import FichasPage from './pages/FichasPage.jsx';
import NovaFichaPage from './pages/NovaFichaPage.jsx';
import FichaDetailPage from './pages/FichaDetailPage.jsx';

// KYC é o satélite de conformidade da suite jurídica: fichas de identificação e
// diligência de clientes (Lei n.º 83/2017), risco determinístico (motor kyc.mjs),
// prazo de conservação de 7 anos (art. 51.º) e apoio manual ao RCBE. NÃO semeia a
// espinha partilhada - só o Núcleo o faz; lê `clientes`/`processos`/`kyc_fichas` e
// escreve `kyc_fichas`, `kyc_eventos` e `documentos` (origem 'legal-kyc').
const NAV = [
  { to: '/', label: 'Fichas', icon: IconShieldCheck, end: true, testid: 'nav-fichas' },
  { to: '/nova', label: 'Nova ficha', icon: IconPlus, testid: 'nav-nova' },
];

const TITLE_MAP = {
  '/': 'Fichas de diligência',
  '/nova': 'Nova ficha',
};

export default function App() {
  return (
    <Layout appKey="legal-kyc" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<FichasPage />} />
        <Route path="/nova" element={<NovaFichaPage />} />
        <Route path="/ficha/:id" element={<FichaDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
