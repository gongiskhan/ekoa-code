import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconClipboardForm, IconEdit, IconClock } from './components/Icons.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';
import PreencherPage from './pages/PreencherPage.jsx';
import OverlayEditorPage from './pages/OverlayEditorPage.jsx';
import HistoricoPage from './pages/HistoricoPage.jsx';

// O app de Formulários NÃO semeia a espinha partilhada - só o Núcleo o faz. Lê
// os clientes/processos existentes, mantém a sua própria coleção de modelos de
// formulário (`form_templates`, com o PDF-base e a impressão digital) e escreve
// um registo `documentos` por cada PDF preenchido. Todo o trabalho de PDF corre
// no browser (pdf-lib); os PDF do utilizador nunca saem da página até serem
// exportados para o dossiê.
const NAV = [
  { to: '/', label: 'Modelos', icon: IconClipboardForm, end: true, testid: 'nav-forms' },
  { to: '/preencher', label: 'Preencher', icon: IconEdit, testid: 'nav-preencher' },
  { to: '/historico', label: 'Histórico', icon: IconClock, testid: 'nav-historico' },
];
const TITLE_MAP = {
  '/': 'Modelos',
  '/preencher': 'Preencher',
  '/historico': 'Histórico',
};

export default function App() {
  return (
    <Layout appKey="legal-forms" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<TemplatesPage />} />
        <Route path="/preencher" element={<PreencherPage />} />
        <Route path="/editar/:id" element={<OverlayEditorPage />} />
        <Route path="/historico" element={<HistoricoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
