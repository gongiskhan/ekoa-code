import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconChartBar } from './components/Icons.jsx';
import JurimetriaPage from './pages/JurimetriaPage.jsx';

// Jurimetria ESTATÍSTICA (nunca preditiva - §3.2.3, auditado por teste de
// strings): durações médias públicas por área (fonte + período SEMPRE citados;
// veredicto R-G: nacionais - os dados abertos DGPJ não têm desagregação por
// comarca) comparadas com os processos findos do próprio escritório, e uma
// ficha de expectativas exportável para o cliente. A linguagem é sempre
// "médias", "estatística" - o desfecho de um caso concreto nunca é antecipado.
const NAV = [
  { to: '/', label: 'Jurimetria', icon: IconChartBar, end: true, testid: 'nav-jurimetria' },
];

const TITLES = { '/': 'Jurimetria' };

export default function App() {
  return (
    <Layout
      appKey="legal-jurimetria"
      nav={NAV}
      titleMap={TITLES}
      sectionLabel="Estatística"
      meta="Durações médias por área com fonte citada e comparação interna - estatística, nunca antecipação do desfecho."
    >
      <Routes>
        <Route path="/" element={<JurimetriaPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
