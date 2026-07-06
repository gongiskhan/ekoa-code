import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// The app is served under /apps/<slug>/ — mount the router at that basename so
// the flat routes (path="/", "/cobranca/:id", "/sequencias") and NavLink resolve
// correctly, and a hard reload of a sub-route still lands on the right screen.
const m = (typeof window !== 'undefined' ? window.location.pathname : '/').match(/^(\/apps\/[^/]+)/);
const basename = m ? m[1] : '/';

const root = createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>,
);
