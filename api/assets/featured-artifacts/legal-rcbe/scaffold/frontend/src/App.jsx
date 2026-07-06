import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconBuilding } from './components/Icons.jsx';
import EntidadesPage from './pages/EntidadesPage.jsx';
import EntidadeDetailPage from './pages/EntidadeDetailPage.jsx';

// RCBE - o lado DECLARATIVO do beneficiário efetivo (serviço ao cliente):
// entidades com BOs estruturados (regra >= 25% capital/votos; fallback da
// direção de topo), UMA estrutura de BOs partilhada com o legal-kyc
// (colecção `beneficiarios_efetivos`, P2-007), calendário de obrigações
// (inicial 30d, atualização 30d, confirmação anual até 31-12 - Lei 89/2017),
// declaração pré-preenchida e submissão ASSISTIDA no Portal da Justiça (sem
// API - checklist com um evento de proveniência por passo, §3.2.5). O lado
// consultivo (diligência AML) continua no legal-kyc.
const NAV = [
  { to: '/', label: 'Entidades', icon: IconBuilding, end: true, testid: 'nav-entidades' },
];

const TITLES = { '/': 'Entidades' };

export default function App() {
  return (
    <Layout
      appKey="legal-rcbe"
      nav={NAV}
      titleMap={TITLES}
      sectionLabel="Conformidade"
      meta="Obrigações RCBE das entidades clientes, com declarações preparadas."
    >
      <Routes>
        <Route path="/" element={<EntidadesPage />} />
        <Route path="/entidade/:id" element={<EntidadeDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
