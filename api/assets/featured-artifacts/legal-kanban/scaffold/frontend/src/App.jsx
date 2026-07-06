import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconColumns, IconEdit } from './components/Icons.jsx';
import BoardPage from './pages/BoardPage.jsx';
import QuadrosPage from './pages/QuadrosPage.jsx';

// Quadro de Tarefas - um quadro kanban sobre as tarefas da espinha PARTILHADA.
// O app NÃO semeia a espinha: lê `tarefas` (estado canónico, escrito também pelo
// Núcleo) e `kanban_boards`, e escreve APENAS os campos de apresentação
// kanbanColuna/kanbanOrdem nos cartões, além de gerir os quadros. O estado da
// tarefa continua a ser a fonte de verdade - mover um cartão para uma coluna
// mapeada a um estado sincroniza o estado; mover para uma coluna sem mapa
// (ex.: "Em revisão") reposiciona sem tocar no estado.
const NAV = [
  { to: '/', label: 'Quadro', icon: IconColumns, end: true, testid: 'nav-kanban' },
  { to: '/quadros', label: 'Quadros', icon: IconEdit, testid: 'nav-quadros' },
];

const TITLE_MAP = {
  '/': 'Quadro',
  '/quadros': 'Quadros',
};

export default function App() {
  return (
    <Layout appKey="legal-kanban" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/quadros" element={<QuadrosPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
