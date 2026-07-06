import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import {
  IconCoins,
  IconTasks,
  IconGavel,
  IconFilePdf,
} from './components/Icons.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LancamentosPage from './pages/LancamentosPage.jsx';
import AcordosPage from './pages/AcordosPage.jsx';
import PreFaturasPage from './pages/PreFaturasPage.jsx';

// Navegação multi-vista do módulo de Honorários. O app NÃO semeia a espinha -
// lê processos/clientes/lançamentos/acordos e escreve lançamentos, acordos e as
// pré-faturas (como documentos origem 'honorarios').
const NAV = [
  { to: '/', label: 'Resumo', icon: IconCoins, end: true, testid: 'nav-resumo' },
  { to: '/lancamentos', label: 'Lançamentos', icon: IconTasks, testid: 'nav-lancamentos' },
  { to: '/acordos', label: 'Acordos', icon: IconGavel, testid: 'nav-acordos' },
  { to: '/pre-faturas', label: 'Pré-faturas', icon: IconFilePdf, testid: 'nav-prefaturas' },
];

const TITLE_MAP = {
  '/': 'Resumo',
  '/lancamentos': 'Lançamentos',
  '/acordos': 'Acordos',
  '/pre-faturas': 'Pré-faturas',
};

export default function App() {
  return (
    <Layout appKey="legal-honorarios" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/lancamentos" element={<LancamentosPage />} />
        <Route path="/acordos" element={<AcordosPage />} />
        <Route path="/pre-faturas" element={<PreFaturasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
