import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconShieldAlert, IconClock } from './components/Icons.jsx';
import VerificarPage from './pages/VerificarPage.jsx';
import HistoricoPage from './pages/HistoricoPage.jsx';

// Verificação de Conflitos — satélite de conformidade da suite jurídica. NÃO
// semeia a espinha partilhada (só o Núcleo o faz); lê clientes/processos e
// escreve as suas próprias verificações (colecção `conflitos_check`). É apoio à
// decisão nos termos do art. 99.º do EOA — nunca emite um veredicto.
const NAV = [
  { to: '/', label: 'Verificar', icon: IconShieldAlert, end: true, testid: 'nav-verificar' },
  { to: '/historico', label: 'Histórico', icon: IconClock, testid: 'nav-historico' },
];

const TITLE_MAP = {
  '/': 'Verificação de conflitos',
  '/historico': 'Histórico de verificações',
};

export default function App() {
  return (
    <Layout
      appKey="legal-conflitos"
      nav={NAV}
      titleMap={TITLE_MAP}
      sectionLabel="Conformidade"
      meta="Verificação de conflitos de interesses na abertura de dossiês."
    >
      <Routes>
        <Route path="/" element={<VerificarPage />} />
        <Route path="/historico" element={<HistoricoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
