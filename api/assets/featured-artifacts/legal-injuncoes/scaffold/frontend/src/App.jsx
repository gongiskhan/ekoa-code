import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconGavel } from './components/Icons.jsx';
import InjuncoesPage from './pages/InjuncoesPage.jsx';
import InjuncaoDetailPage from './pages/InjuncaoDetailPage.jsx';

// Injunções: a fase JUDICIAL da recuperação de créditos (a extrajudicial vive
// em legal-cobrancas, que propõe a escalada quando a sequência se esgota).
// Elegibilidade citada (DL 269/98 / DL 62/2013), juros e taxa de justiça vêm
// SEMPRE do serviço legal-calculos, submissão BNI assistida (sem API oficial -
// cada passo emite um evento de proveniência), fórmula executória abre a
// tarefa de preparação da execução. Formatos do requerimento: Portaria
// 220-A/2008 (red. 267/2018) - verificação P2-010 do decision log.
const NAV = [
  { to: '/', label: 'Injunções', icon: IconGavel, end: true, testid: 'nav-injuncoes' },
];

const TITLES = { '/': 'Injunções' };

export default function App() {
  return (
    <Layout
      appKey="legal-injuncoes"
      nav={NAV}
      titleMap={TITLES}
      sectionLabel="Recuperação"
      meta="Da interpelação à fórmula executória - a fase judicial da cobrança."
    >
      <Routes>
        <Route path="/" element={<InjuncoesPage />} />
        <Route path="/injuncao/:id" element={<InjuncaoDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
