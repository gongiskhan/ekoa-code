/*
 * Operator assistant panel runtime ENTRY - the self-mounting entry of the platform
 * panel-runtime asset (operator-run G2). Compiled platform-side into ONE
 * self-contained IIFE (React INCLUDED, styles injected) and served at
 * /__ekoa/panel-runtime.js next to the C3 action runtime.
 *
 * Since G2 the panel LAZY-loads: the app bundle carries only a tiny plain-DOM
 * launcher (the scaffold's mount.js). On the first launcher interaction (or an idle
 * preload) that launcher injects THIS asset; the asset self-mounts <AssistantPanel/>
 * into the shell's reserved <div id="ekoa-assistant-root">, exactly as the old
 * in-bundle mount.js did, and takes over the launcher. The three mount guards are
 * UNCHANGED from that mount.js:
 *
 *   - It WAITS for the node. The mount point is rendered BY the app (inside App.jsx),
 *     and React's createRoot().render() commits asynchronously, so the node is NOT in
 *     the DOM the instant this asset runs. We poll a bounded number of animation
 *     frames until it appears (typically frame 1-2).
 *   - It only mounts once per document (the node carries a flag), so a repeat load
 *     (or an old app that still bakes the panel) never double-mounts.
 *   - It gives up quietly after the bounded retries when the node never appears
 *     (a standalone preview / a non-app shell) - a no-op, never a crash or a spin.
 *
 * The panel is a SEPARATE React root from the app - its OWN React is bundled here, so
 * there is ZERO interop with the app's React. The launcher hands off its "open"
 * intent via window.__ekoaAssistantAutoOpen (true when the visitor clicked, absent
 * when idle-preloaded); on mount this asset removes the launcher and takes over.
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

/** Remove the plain-DOM boot launcher the app bundle rendered: once the React panel
 *  is mounted it owns the launcher (its own collapsed state), so the boot launcher
 *  hands off and disappears - never two launchers on screen. */
function removeBootLauncher() {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll('[data-ekoa-boot-launcher]');
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n && n.parentNode) n.parentNode.removeChild(n);
  }
}

function mountPanel() {
  if (typeof document === 'undefined') return;

  let frames = 0;
  const attempt = () => {
    const node = document.getElementById(MOUNT_ID);
    if (node) {
      if (node.__ekoaAssistantMounted) {
        removeBootLauncher(); // already mounted (e.g. an old app baking the panel) - still hand off
        return;
      }
      node.__ekoaAssistantMounted = true;
      // Open intent handed off by the launcher: open now if the visitor clicked,
      // stay collapsed if this was an idle preload.
      const autoOpen = typeof window !== 'undefined' && !!window.__ekoaAssistantAutoOpen;
      createRoot(node).render(<AssistantPanel defaultOpen={autoOpen} />);
      removeBootLauncher();
      return;
    }
    frames += 1;
    if (frames >= MAX_FRAMES) return; // no mount point (standalone preview) - no-op
    schedule(attempt);
  };

  attempt();
}

mountPanel();
