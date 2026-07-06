import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconWallet, IconReceipt, IconCoins, IconFileText } from './components/Icons.jsx';
import ContaCorrentePage from './pages/ContaCorrentePage.jsx';
import DespesasPage from './pages/DespesasPage.jsx';
import ProvisoesPage from './pages/ProvisoesPage.jsx';
import FaturacaoPage from './pages/FaturacaoPage.jsx';

// Navegação do módulo de Finanças e Contabilidade. O app NÃO semeia a espinha -
// lê clientes/processos/despesas/conta_corrente/provisoes/lancamentos/documentos
// e escreve despesas, movimentos de conta corrente, provisões e pedidos de
// emissão certificada (faturacao_pedidos). NUNCA emite fatura nativamente.
const NAV = [
  { to: '/', label: 'Conta corrente', icon: IconWallet, end: true, testid: 'nav-conta' },
  { to: '/despesas', label: 'Despesas', icon: IconReceipt, testid: 'nav-despesas' },
  { to: '/provisoes', label: 'Provisões', icon: IconCoins, testid: 'nav-provisoes' },
  { to: '/faturacao', label: 'Faturação', icon: IconFileText, testid: 'nav-faturacao' },
];

const TITLE_MAP = {
  '/': 'Conta corrente',
  '/despesas': 'Despesas',
  '/provisoes': 'Provisões',
  '/faturacao': 'Faturação',
};

export default function App() {
  return (
    <Layout appKey="legal-financas" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<ContaCorrentePage />} />
        <Route path="/despesas" element={<DespesasPage />} />
        <Route path="/provisoes" element={<ProvisoesPage />} />
        <Route path="/faturacao" element={<FaturacaoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
