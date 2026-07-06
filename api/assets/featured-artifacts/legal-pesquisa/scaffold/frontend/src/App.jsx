import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconSearchText, IconClock } from './components/Icons.jsx';
import PesquisarPage from './pages/PesquisarPage.jsx';
import HistoricoPage from './pages/HistoricoPage.jsx';

// Pesquisa Jurídica fundamentada — pesquisa DGSI/DRE com citações VERIFICÁVEIS
// sobre a espinha partilhada. O app NÃO semeia a espinha: lê a colecção
// `pesquisas` (semeada pelo Núcleo), executa pesquisas fundamentadas contra a
// rota de plataforma /api/legal-research (que consulta a base de conhecimento e
// confirma cada ligação), e arquiva a pesquisa como linha `pesquisas` + nota do
// dossiê (documentos, origem 'legal-pesquisa'). Nunca inventa fontes; quando o
// índice local está vazio, di-lo e permite o registo manual.
const NAV = [
  { to: '/', label: 'Pesquisar', icon: IconSearchText, end: true, testid: 'nav-pesquisar' },
  { to: '/historico', label: 'Histórico', icon: IconClock, testid: 'nav-historico' },
];

const TITLE_MAP = {
  '/': 'Pesquisar',
  '/historico': 'Histórico',
};

export default function App() {
  return (
    <Layout appKey="legal-pesquisa" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<PesquisarPage />} />
        <Route path="/historico" element={<HistoricoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
