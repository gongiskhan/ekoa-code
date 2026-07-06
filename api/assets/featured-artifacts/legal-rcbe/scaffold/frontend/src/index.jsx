import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// Servido em /apps/<slug>/ - montar o router nesse basename para que as rotas
// planas e um reload duro de uma sub-rota resolvam corretamente.
const m = (typeof window !== 'undefined' ? window.location.pathname : '/').match(/^(\/apps\/[^/]+)/);
const basename = m ? m[1] : '/';

const root = createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>,
);
