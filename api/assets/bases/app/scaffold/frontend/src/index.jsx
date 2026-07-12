import { createRoot } from 'react-dom/client';
import App from './App';
import { mountAssistant } from './lib/assistant/mount';
import './index.css';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

// Platform operator assistant panel - mounts into the shell's #ekoa-assistant-root
// (no-op when the node is absent, e.g. a standalone preview). Never remove this.
mountAssistant();
