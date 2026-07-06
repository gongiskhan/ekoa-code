import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconLifeBuoy, IconPlus } from './components/Icons.jsx';
import PedidosPage from './pages/PedidosPage.jsx';
import NovoPedidoPage from './pages/NovoPedidoPage.jsx';
import PedidoDetailPage from './pages/PedidoDetailPage.jsx';

// Apoio Judiciário é o satélite de SADT/SinOA da suite jurídica: organiza e
// prepara pedidos de protecção jurídica, nomeações e escusas. NÃO semeia a
// espinha partilhada - só o Núcleo o faz; lê `clientes`/`processos`/`correio` e
// escreve `apoio_judiciario` e `prazos` (origem 'apoio').
//
// REGRA DURA: o SinOA não tem API. Este app prepara e organiza; NUNCA finge
// submeter. A submissão é sempre feita pelo advogado no portal SinOA.
const NAV = [
  { to: '/', label: 'Pedidos', icon: IconLifeBuoy, end: true, testid: 'nav-pedidos' },
  { to: '/novo', label: 'Novo pedido', icon: IconPlus, testid: 'nav-novo' },
];

const TITLE_MAP = {
  '/': 'Pedidos de apoio judiciário',
  '/novo': 'Novo pedido',
};

export default function App() {
  return (
    <Layout appKey="legal-apoio" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<PedidosPage />} />
        <Route path="/novo" element={<NovoPedidoPage />} />
        <Route path="/pedido/:id" element={<PedidoDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
