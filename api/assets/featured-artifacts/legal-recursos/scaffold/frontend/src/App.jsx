import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconIdCard, IconCalendar, IconFolder } from './components/Icons.jsx';
import PessoasPage from './pages/PessoasPage.jsx';
import PessoaDetailPage from './pages/PessoaDetailPage.jsx';
import AusenciasPage from './pages/AusenciasPage.jsx';
import AlocacoesPage from './pages/AlocacoesPage.jsx';

// Recursos Humanos é o satélite de equipa da suite jurídica: fichas das pessoas,
// direito e saldo de férias (motor determinístico do Código do Trabalho) e a
// alocação da equipa aos processos. NÃO semeia a espinha partilhada - só o
// Núcleo o faz; lê as colecções `pessoas`, `ausencias`, `alocacoes` e
// `processos` já existentes e escreve ausências e alocações.
const NAV = [
  { to: '/', label: 'Pessoas', icon: IconIdCard, end: true, testid: 'nav-recursos' },
  { to: '/ausencias', label: 'Ausências', icon: IconCalendar, testid: 'nav-ausencias' },
  { to: '/alocacoes', label: 'Alocações', icon: IconFolder, testid: 'nav-alocacoes' },
];

const TITLE_MAP = {
  '/': 'Pessoas',
  '/ausencias': 'Mapa de ausências',
  '/alocacoes': 'Alocações',
};

export default function App() {
  return (
    <Layout
      appKey="legal-recursos"
      nav={NAV}
      titleMap={TITLE_MAP}
      sectionLabel="Equipa"
      meta="Fichas, férias e ausências e alocação da equipa aos processos."
    >
      <Routes>
        <Route path="/" element={<PessoasPage />} />
        <Route path="/pessoa/:id" element={<PessoaDetailPage />} />
        <Route path="/ausencias" element={<AusenciasPage />} />
        <Route path="/alocacoes" element={<AlocacoesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
