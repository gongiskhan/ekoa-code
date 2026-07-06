import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconFileText } from './components/Icons.jsx';
import GaleriaPage from './pages/GaleriaPage.jsx';
import ModeloEditorPage from './pages/ModeloEditorPage.jsx';
import GerarWizardPage from './pages/GerarWizardPage.jsx';

// O app de Contratos NÃO semeia a espinha partilhada - só o Núcleo o faz. Lê os
// clientes e processos existentes, mantém uma galeria de modelos (minutas com
// {{chaves}} mapeadas) e escreve um registo `documentos` por cada contrato
// gerado. O editor e o wizard são vistas profundas da galeria de modelos.
const NAV = [{ to: '/', label: 'Modelos', icon: IconFileText, end: true, testid: 'nav-modelos' }];
const TITLE_MAP = { '/': 'Modelos' };

export default function App() {
  return (
    <Layout appKey="legal-contratos" nav={NAV} titleMap={TITLE_MAP}>
      <Routes>
        <Route path="/" element={<GaleriaPage />} />
        <Route path="/modelos/:id" element={<ModeloEditorPage />} />
        <Route path="/gerar/:modeloId" element={<GerarWizardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
