import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconTimer, IconCalendar } from './components/Icons.jsx';
import RegistosPage from './pages/RegistosPage.jsx';
import SemanaPage from './pages/SemanaPage.jsx';

// Navegação do módulo de Tempos. O app é SATÉLITE da espinha - lê processos,
// clientes e pessoas, escreve os seus registos de tempo (`registos_tempo`) e,
// na transferência, cria lançamentos de honorários. NUNCA semeia a espinha.
const NAV = [
  { to: '/', label: 'Registos', icon: IconTimer, end: true, testid: 'nav-tempos' },
  { to: '/semana', label: 'Semana', icon: IconCalendar, testid: 'nav-semana' },
];

const TITLE_MAP = {
  '/': 'Registos',
  '/semana': 'Semana',
};

export default function App() {
  return (
    <Layout appKey="legal-tempos" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<RegistosPage />} />
        <Route path="/semana" element={<SemanaPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
