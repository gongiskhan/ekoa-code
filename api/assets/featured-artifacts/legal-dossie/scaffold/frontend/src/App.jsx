import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import PickerPage from './pages/PickerPage.jsx';
import ProcessoPage from './pages/ProcessoPage.jsx';

// O Dossiê é o WORKSPACE por-processo: uma lista pesquisável de processos
// (PickerPage) que abre o workspace de cada um (ProcessoPage) com separadores -
// Visão geral, Documentos (carregar + notas + ciclo Office), Comunicações,
// Cronologia, Prazos e a versão compilada pronta a imprimir. Lê e escreve na
// espinha partilhada da conta (documentos, comunicações, eventos); a sementeira
// continua a ser exclusiva do Núcleo. O deep link /processo/:id sobrevive a um
// reload forçado (o cortex serve o index.html para rotas de navegação).
export default function App() {
  return (
    <Layout appKey="legal-dossie">
      <Routes>
        <Route path="/" element={<PickerPage />} />
        <Route path="/processo/:id" element={<ProcessoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
