import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconReceipt, IconClock } from './components/Icons.jsx';
import CobrancasPage from './pages/CobrancasPage.jsx';
import CobrancaDetailPage from './pages/CobrancaDetailPage.jsx';
import SequenciasPage from './pages/SequenciasPage.jsx';

// Cobranças é o satélite financeiro de recuperação de dívida da suite jurídica.
// NÃO semeia a espinha — lê `cobrancas`, `sequencias_lembrete`,
// `lembretes_enviados`, `clientes` e `processos` e escreve as suas transições
// (estado da cobrança, passos de sequência) + o crédito na `conta_corrente`
// quando um pagamento reconcilia. A reconciliação real chega pelo callback do
// fornecedor (Ifthenpay/Stripe) ao backend `onWebhook`; a app mostra a geração
// de referência em modo de demonstração.
const NAV = [
  { to: '/', label: 'Cobranças', icon: IconReceipt, end: true, testid: 'nav-cobrancas' },
  { to: '/sequencias', label: 'Sequências', icon: IconClock, testid: 'nav-sequencias' },
];

const TITLE_MAP = {
  '/': 'Cobranças',
  '/sequencias': 'Sequências de lembrete',
};

export default function App() {
  return (
    <Layout appKey="legal-cobrancas" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<CobrancasPage />} />
        <Route path="/cobranca/:id" element={<CobrancaDetailPage />} />
        <Route path="/sequencias" element={<SequenciasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
