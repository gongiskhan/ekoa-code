import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './reservas.css';

// The public booking app is a single page that reads ?tipo=<id> from the query
// — no router needed. Served under /apps/legal-agenda-reservas/.
const root = createRoot(document.getElementById('root'));
root.render(<App />);
