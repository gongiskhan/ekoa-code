import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconEuro, IconGavel, IconFileText } from './components/Icons.jsx';
import JurosPage from './pages/JurosPage.jsx';
import CustasPage from './pages/CustasPage.jsx';
import MemoriasPage from './pages/MemoriasPage.jsx';

// Cálculos é o app de SERVIÇO da suite: calcula juros de mora (por troços, um
// Aviso por semestre) e taxa de justiça (RCP), sempre com a fonte citada e uma
// memória de cálculo exportável. NÃO semeia a espinha - lê a tabela de taxas do
// serviço (canónica + overlay do crawler) e escreve as suas próprias linhas
// `calculos`. Os outros apps consomem-no pela sua app API (calculos-cliente).
const NAV = [
  { to: '/', label: 'Juros de mora', icon: IconEuro, end: true, testid: 'nav-juros' },
  { to: '/custas', label: 'Taxa de justiça', icon: IconGavel, testid: 'nav-custas' },
  { to: '/memorias', label: 'Memórias', icon: IconFileText, testid: 'nav-memorias' },
];

const TITLES = {
  '/': 'Juros de mora',
  '/custas': 'Taxa de justiça',
  '/memorias': 'Memórias de cálculo',
};

export default function App() {
  return (
    <Layout
      appKey="legal-calculos"
      nav={NAV}
      titleMap={TITLES}
      sectionLabel="Cálculo"
      meta="Juros de mora, taxa de justiça e memórias de cálculo - todo o cálculo cita a fonte."
    >
      <Routes>
        <Route path="/" element={<JurosPage />} />
        <Route path="/custas" element={<CustasPage />} />
        <Route path="/memorias" element={<MemoriasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
