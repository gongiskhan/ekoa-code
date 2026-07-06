import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconPenLine, IconBook } from './components/Icons.jsx';
import PecasPage from './pages/PecasPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import PrecedentesPage from './pages/PrecedentesPage.jsx';

// O app de Peças NÃO semeia a espinha partilhada - só o Núcleo o faz. Lê os
// processos/clientes existentes, redige peças processuais a partir de esqueletos
// determinísticos (por tipo, compostos dos dados do processo e, opcionalmente, do
// corpo de um precedente), cita as pesquisas guardadas como fundamentação e
// exporta cada peça em .docx, gravando um registo `documentos` no dossiê.
//
// SEM assistente de IA: a redação é template-driven e determinística. O advogado
// revê sempre - o aviso fixo acompanha cada superfície de edição.
const NAV = [
  { to: '/', label: 'Peças', icon: IconPenLine, end: true, testid: 'nav-pecas' },
  { to: '/precedentes', label: 'Precedentes', icon: IconBook, testid: 'nav-precedentes' },
];
const TITLE_MAP = { '/': 'Peças', '/precedentes': 'Precedentes' };

export default function App() {
  return (
    <Layout appKey="legal-pecas" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<PecasPage />} />
        <Route path="/editar/:id" element={<EditorPage />} />
        <Route path="/precedentes" element={<PrecedentesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
