import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconSignature, IconPlus, IconShieldCheck, IconCalendarClock } from './components/Icons.jsx';
import EnvelopesPage from './pages/EnvelopesPage.jsx';
import NovoEnvelopePage from './pages/NovoEnvelopePage.jsx';
import EnvelopeDetailPage from './pages/EnvelopeDetailPage.jsx';
import VerificarPage from './pages/VerificarPage.jsx';
import CalendarioPage from './pages/CalendarioPage.jsx';

// legal-assinatura é DONO da assinatura na suite (envelopes, orquestração,
// arquivo probatório). NÃO semeia a espinha - lê `documentos`/`processos`
// existentes e escreve as suas colecções `envelopes`/`assinaturas`. O motor
// determinístico (máquina de estados + certificado) vive em engine/assinatura.mjs;
// os fornecedores (Adobe live, CMD orquestrada, stubs) são metadados em
// providers.js - as chamadas reais passam pelas rotas da plataforma.
const NAV = [
  { to: '/', label: 'Envelopes', icon: IconSignature, end: true, testid: 'nav-envelopes' },
  { to: '/novo', label: 'Novo envelope', icon: IconPlus, testid: 'nav-novo' },
  { to: '/verificar', label: 'Verificar', icon: IconShieldCheck, testid: 'nav-verificar' },
  { to: '/calendario', label: 'Calendário', icon: IconCalendarClock, testid: 'nav-calendario' },
];
const TITLE_MAP = {
  '/': 'Envelopes',
  '/novo': 'Novo envelope',
  '/verificar': 'Verificar documento assinado',
  '/calendario': 'Calendário da assinatura qualificada',
};

export default function App() {
  return (
    <Layout appKey="legal-assinatura" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<EnvelopesPage />} />
        <Route path="/novo" element={<NovoEnvelopePage />} />
        <Route path="/envelopes/:id" element={<EnvelopeDetailPage />} />
        <Route path="/verificar" element={<VerificarPage />} />
        <Route path="/calendario" element={<CalendarioPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
