import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconMailbox, IconPlus } from './components/Icons.jsx';
import ExpedientePage from './pages/ExpedientePage.jsx';
import NovaCartaPage from './pages/NovaCartaPage.jsx';

// Correio e Notificações — o expediente de correio registado sobre a espinha
// partilhada. O app NÃO semeia a espinha: lê a colecção `correio` (semeada pelo
// Núcleo), regista novas cartas, faz as transições manuais de estado, consulta o
// rastreio CTT (via rota de plataforma) e arquiva comprovativos como documentos
// do processo (origem 'legal-correio').
const NAV = [
  { to: '/', label: 'Expediente', icon: IconMailbox, end: true, testid: 'nav-expediente' },
  { to: '/nova', label: 'Nova carta', icon: IconPlus, testid: 'nav-nova-carta' },
];

const TITLE_MAP = {
  '/': 'Expediente',
  '/nova': 'Nova carta',
};

export default function App() {
  return (
    <Layout appKey="legal-correio" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<ExpedientePage />} />
        <Route path="/nova" element={<NovaCartaPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
