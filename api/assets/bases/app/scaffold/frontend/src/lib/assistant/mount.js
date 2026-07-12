/*
 * Operator assistant panel mount - platform-shipped for the `app` base (operator-run D2).
 *
 * Mounts <AssistantPanel/> into the shell's reserved <div id="ekoa-assistant-root">.
 * Called once from index.jsx after the app renders. Guarded three ways:
 *
 *   - It WAITS for the node. The mount point is rendered BY the app (inside App.jsx),
 *     and React 18's createRoot().render() commits the initial tree asynchronously,
 *     so the node is NOT in the DOM the instant index.jsx calls this. We poll a
 *     bounded number of animation frames until it appears (typically frame 1-2).
 *   - It only mounts once per document (the node carries a flag), so a repeat call
 *     (or a hot reload) never double-mounts.
 *   - It gives up quietly after the bounded retries when the node never appears
 *     (a standalone preview / a non-app shell) - a no-op, never a crash or a spin.
 *
 * The panel is a SEPARATE React root from the app, rendered into a node the app
 * leaves permanently empty, so it never blocks or re-renders the product and
 * survives the app's own re-renders. The coding agent never calls this itself and
 * never renders into #ekoa-assistant-root.
 */
import { createRoot } from 'react-dom/client';
import { AssistantPanel } from './AssistantPanel';

const MOUNT_ID = 'ekoa-assistant-root';
const MAX_FRAMES = 60; // ~1s worth of frames; past this the mount point isn't coming

function schedule(fn) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 16);
  }
}

export function mountAssistant() {
  if (typeof document === 'undefined') return;

  let frames = 0;
  const attempt = () => {
    const node = document.getElementById(MOUNT_ID);
    if (node) {
      if (node.__ekoaAssistantMounted) return; // already mounted - never mount twice
      node.__ekoaAssistantMounted = true;
      createRoot(node).render(<AssistantPanel />);
      return;
    }
    frames += 1;
    if (frames >= MAX_FRAMES) return; // no mount point (standalone preview) - no-op
    schedule(attempt);
  };

  attempt();
}

export default mountAssistant;
