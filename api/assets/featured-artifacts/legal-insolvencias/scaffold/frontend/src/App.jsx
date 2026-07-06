import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconTrendingDown } from './components/Icons.jsx';
import InsolvenciasPage from './pages/InsolvenciasPage.jsx';
import InsolvenciaDetailPage from './pages/InsolvenciaDetailPage.jsx';

// Insolvências - MVP do lado do CREDOR: registar a insolvência do devedor
// ligada ao crédito da espinha; o prazo de reclamação de créditos corre em
// 30 dias CONTÍNUOS, SEM suspensão nas férias judiciais (CIRE art. 9.º n.º 1 -
// regime 'cire' do motor de prazos, golden-testado); reclamação gerada;
// verificação/graduação acompanhadas; rateios lançados na conta corrente
// (legal-financas). O lado do administrador (apreensão, liquidação, rateios
// obrigatórios, contas) está FORA do âmbito - gatilho registado no decision
// log (procura validada).
const NAV = [
  { to: '/', label: 'Insolvências', icon: IconTrendingDown, end: true, testid: 'nav-insolvencias' },
];

const TITLES = { '/': 'Insolvências' };

export default function App() {
  return (
    <Layout
      appKey="legal-insolvencias"
      nav={NAV}
      titleMap={TITLES}
      sectionLabel="Créditos"
      meta="Reclamação de créditos, graduação e rateios do lado do credor."
    >
      <Routes>
        <Route path="/" element={<InsolvenciasPage />} />
        <Route path="/insolvencia/:id" element={<InsolvenciaDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
