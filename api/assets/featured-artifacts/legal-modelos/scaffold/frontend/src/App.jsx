import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconLibrary, IconFileText } from './components/Icons.jsx';
import BibliotecaPage from './pages/BibliotecaPage.jsx';
import ModelosPage from './pages/ModelosPage.jsx';

// O app de Modelos é SATÉLITE da espinha - NUNCA a semeia. Traz uma biblioteca
// estática de minutas de fonte oficial (código, não espinha) que o utilizador
// importa para a colecção partilhada `modelos`; a partir daí a mesma linha é
// consumida pelo app de Contratos (galeria/editor/wizard). Os campos aditivos
// (categoria, fonte, licenca, versao) convivem com o esquema legado do Núcleo.
const NAV = [
  { to: '/', label: 'Biblioteca', icon: IconLibrary, end: true, testid: 'nav-biblioteca' },
  { to: '/modelos', label: 'Os meus modelos', icon: IconFileText, testid: 'nav-modelos' },
];

const TITLE_MAP = {
  '/': 'Biblioteca',
  '/modelos': 'Os meus modelos',
};

export default function App() {
  return (
    <Layout appKey="legal-modelos" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<BibliotecaPage />} />
        <Route path="/modelos" element={<ModelosPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
