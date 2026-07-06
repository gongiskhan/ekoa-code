import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconCalendarClock, IconFileText, IconClock, IconInbox } from './components/Icons.jsx';
import AgendaPage from './pages/AgendaPage.jsx';
import SessaoTiposPage from './pages/SessaoTiposPage.jsx';
import DisponibilidadesPage from './pages/DisponibilidadesPage.jsx';
import ReservasPage from './pages/ReservasPage.jsx';

// Agenda é o satélite de marcações da suite jurídica: a semana partilhada
// (eventos + reservas confirmadas), os tipos de sessão (com ligação pública de
// reserva), as disponibilidades semanais da equipa e a caixa de reservas. NÃO
// semeia a espinha — lê `eventos`, `reservas`, `sessao_tipos`,
// `disponibilidades`, `ausencias` e `pessoas`, e escreve as suas próprias.
const NAV = [
  { to: '/', label: 'Agenda', icon: IconCalendarClock, end: true, testid: 'nav-agenda' },
  { to: '/tipos', label: 'Tipos de sessão', icon: IconFileText, testid: 'nav-tipos' },
  { to: '/disponibilidades', label: 'Disponibilidades', icon: IconClock, testid: 'nav-disponibilidades' },
  { to: '/reservas', label: 'Reservas', icon: IconInbox, testid: 'nav-reservas' },
];

const TITLE_MAP = {
  '/': 'Agenda',
  '/tipos': 'Tipos de sessão',
  '/disponibilidades': 'Disponibilidades',
  '/reservas': 'Reservas',
};

export default function App() {
  return (
    <Layout
      appKey="legal-agenda"
      nav={NAV}
      titleMap={TITLE_MAP}
      sectionLabel="Agenda"
      meta="Agenda partilhada, audiências e marcações com reserva pública."
    >
      <Routes>
        <Route path="/" element={<AgendaPage />} />
        <Route path="/tipos" element={<SessaoTiposPage />} />
        <Route path="/disponibilidades" element={<DisponibilidadesPage />} />
        <Route path="/reservas" element={<ReservasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
