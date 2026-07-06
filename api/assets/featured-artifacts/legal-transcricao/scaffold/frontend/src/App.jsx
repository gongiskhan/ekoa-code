import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import { IconMic } from './components/Icons.jsx';
import TranscricoesPage from './pages/TranscricoesPage.jsx';
import TranscricaoDetailPage from './pages/TranscricaoDetailPage.jsx';

// Transcrição de audiências: carrega a gravação (MP3/WAV), transcreve com
// diarização e tempos por palavra (STT da plataforma; simulado até à sessão de
// configuração), revê num editor sincronizado com o áudio e gera excertos
// prontos para recurso (art. 640.º CPC) - EXPORTÁVEIS APENAS DEPOIS DE
// REVISTOS (§3.2.2, regra testada). RGPD: a voz é dado pessoal de terceiros -
// acesso restrito, retenção definida por trabalho, sinalização de segredo de
// justiça nos processos penais.
const NAV = [
  { to: '/', label: 'Transcrições', icon: IconMic, end: true, testid: 'nav-transcricoes' },
];

const TITLES = {
  '/': 'Transcrições',
};

export default function App() {
  return (
    <Layout
      appKey="legal-transcricao"
      nav={NAV}
      titleMap={TITLES}
      sectionLabel="Audiências"
      meta="Transcrição de gravações de audiência com excertos prontos para recurso."
    >
      <Routes>
        <Route path="/" element={<TranscricoesPage />} />
        <Route path="/trabalho/:id" element={<TranscricaoDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </Layout>
  );
}
