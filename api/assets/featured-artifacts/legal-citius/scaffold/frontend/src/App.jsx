import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconInbox, IconFileText, IconClock } from './components/Icons.jsx';
import InboxPage from './pages/InboxPage.jsx';
import NotificacaoPage from './pages/NotificacaoPage.jsx';
import ColarPage from './pages/ColarPage.jsx';
import HistoricoPage from './pages/HistoricoPage.jsx';

// A Caixa Citius NÃO semeia a espinha partilhada - só o Núcleo o faz. Lê os
// processos já existentes, tria as notificações (automáticas ou coladas) e
// escreve prazos, eventos e a própria notificação na espinha.
//
// A navegação (Caixa de entrada / Colar / Histórico) é passada ao Layout por
// prop - nunca se edita o registo partilhado do Layout.
const NAV = [
  { to: '/', label: 'Caixa de entrada', icon: IconInbox, end: true, testid: 'nav-inbox' },
  { to: '/colar', label: 'Colar notificação', icon: IconFileText, testid: 'nav-colar' },
  { to: '/historico', label: 'Histórico', icon: IconClock, testid: 'nav-historico' },
];

const TITLE_MAP = {
  '/': 'Caixa de entrada',
  '/colar': 'Colar notificação',
  '/historico': 'Histórico',
};

export default function App() {
  return (
    <Layout appKey="legal-citius" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<InboxPage />} />
        <Route path="/notificacao/:id" element={<NotificacaoPage />} />
        <Route path="/colar" element={<ColarPage />} />
        <Route path="/historico" element={<HistoricoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
