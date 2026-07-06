import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconHome, IconUsers, IconFolder, IconCheckSquare } from './components/Icons.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ClientesPage from './pages/ClientesPage.jsx';
import ClienteDetailPage from './pages/ClienteDetailPage.jsx';
import ProcessosPage from './pages/ProcessosPage.jsx';
import ProcessoDetailPage from './pages/ProcessoDetailPage.jsx';
import TarefasPage from './pages/TarefasPage.jsx';
import { seedSpine } from './shared.js';

// Navegação e títulos do Núcleo, expandidos com Tarefas. Passados ao Layout
// partilhado (que os sobrepõe ao registo por-app) para que a barra lateral e o
// título superior reflictam o CRM multi-vista.
const NAV = [
  { to: '/', label: 'Início', icon: IconHome, end: true, testid: 'nav-inicio' },
  { to: '/clientes', label: 'Clientes', icon: IconUsers, testid: 'nav-clientes' },
  { to: '/processos', label: 'Processos', icon: IconFolder, testid: 'nav-processos' },
  { to: '/tarefas', label: 'Tarefas', icon: IconCheckSquare, testid: 'nav-tarefas' },
];

const TITLE_MAP = {
  '/': 'Painel do escritório',
  '/clientes': 'Clientes',
  '/processos': 'Processos',
  '/tarefas': 'Tarefas',
};

export default function App() {
  // O Núcleo (e só o Núcleo) semeia a espinha partilhada uma vez, quando vazia.
  useEffect(() => {
    seedSpine();
  }, []);

  return (
    <Layout appKey="legal-nucleo" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/clientes/:id" element={<ClienteDetailPage />} />
        <Route path="/processos" element={<ProcessosPage />} />
        <Route path="/processos/:id" element={<ProcessoDetailPage />} />
        <Route path="/tarefas" element={<TarefasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
