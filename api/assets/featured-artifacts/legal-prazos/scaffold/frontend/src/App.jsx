import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconClock, IconCalendar, IconCheckSquare } from './components/Icons.jsx';
import RadarPage from './pages/RadarPage.jsx';
import CalculadoraPage from './pages/CalculadoraPage.jsx';
import PrazosListPage from './pages/PrazosListPage.jsx';

// Prazos é agora o centro de comando de prazos: RADAR (por urgência),
// CALCULADORA (motor CPC determinístico) e a LISTA completa. NÃO semeia a
// espinha partilhada - só o Núcleo o faz; lê processos/clientes já existentes e
// escreve prazos.
const NAV = [
  { to: '/', label: 'Radar', icon: IconClock, end: true, testid: 'nav-radar' },
  { to: '/calculadora', label: 'Calculadora', icon: IconCalendar, testid: 'nav-calculadora' },
  { to: '/prazos', label: 'Todos os prazos', icon: IconCheckSquare, testid: 'nav-prazos' },
];

const TITLES = {
  '/': 'Radar de prazos',
  '/calculadora': 'Calculadora',
  '/prazos': 'Todos os prazos',
};

export default function App() {
  return (
    <Layout
      appKey="legal-prazos"
      nav={NAV}
      titleMap={TITLES}
      sectionLabel="Prazos"
      meta="Radar, calculadora e registo de prazos processuais."
    >
      <Routes>
        <Route path="/" element={<RadarPage />} />
        <Route path="/calculadora" element={<CalculadoraPage />} />
        <Route path="/prazos" element={<PrazosListPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
