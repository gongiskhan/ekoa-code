import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import InvoicesPage from './pages/InvoicesPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import PaymentsPage from './pages/PaymentsPage.jsx';
import LineItemsPage from './pages/LineItemsPage.jsx';
import InvoicePrintPage from './pages/InvoicePrintPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/imprimir/:invoiceId" element={<InvoicePrintPage />} />
      <Route
        path="/*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/faturas" element={<InvoicesPage />} />
              <Route path="/clientes" element={<ClientsPage />} />
              <Route path="/pagamentos" element={<PaymentsPage />} />
              <Route path="/artigos" element={<LineItemsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}
