import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { mountAssistant } from './lib/assistant/mount.js';
import './index.css';

// A app é servida em /apps/<slug>/ - o router monta nesse basename para as
// rotas planas resolverem e um reload de uma sub-rota cair no ecrã certo.
const m = (typeof window !== 'undefined' ? window.location.pathname : '/').match(/^(\/apps\/[^/]+)/);
const basename = m ? m[1] : '/';

const root = createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>,
);

// Painel do assistente da plataforma - monta no #ekoa-assistant-root do shell
// (no-op silencioso quando a plataforma não serve o asset). Nunca remover.
mountAssistant();
