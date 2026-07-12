/**
 * App shell - platform-provided for the `app` base. Pre-built and pixel-tested.
 *
 * AGENT: this is the left-nav multi-page shell. Build your product by adding
 * pages - register each in the PAGES array below and write its component under
 * frontend/src/pages/. Do NOT rebuild the shell, the top bar, the nav, or the
 * assistant mount.
 *
 * Already wired for you (see frontend/src/lib/):
 *  - Auth      -> ./lib/auth            getCurrentUser() (null when logged out / no runtime), signIn, signOut.
 *  - Data      -> ./lib/jsonStore       per-app persistence: list/get/create/update/remove.
 *  - Protocol  -> ./lib/protocol-client typed wrappers over the injected runtime: whoami/signIn/signOut,
 *                 graphFetch (visitor M365), exportPdf, cloudFiles.
 *  - Errors    -> ./lib/ErrorBoundary   shipped recoverable error UI, mounted at the root and per page.
 *  - Assistant -> the empty <div id="ekoa-assistant-root"> below. The platform's
 *                 operator assistant panel runtime mounts INTO it in a later slice.
 *                 It ships EMPTY on purpose. Never remove it, and never remove the
 *                 data-demo-target attributes on the shell landmarks.
 */
import { useState, useEffect } from 'react';
import { getCurrentUser } from './lib/auth';
import { ErrorBoundary } from './lib/ErrorBoundary';

// The default starting page. Replace this with the first real screen of the
// product, or add more pages and register them in PAGES below. It uses no mock
// data - real pages read/write through ./lib/jsonStore and ./lib/protocol-client.
function HomePage() {
  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">Início</h1>
        <p className="page-subtitle">
          Esta é a página inicial da aplicação. Substitua este conteúdo pelo primeiro ecrã do produto.
        </p>
      </header>
      <div className="empty-state" data-demo-target="home-empty">
        <h2 className="empty-state-title">Comece por aqui</h2>
        <p className="empty-state-subtitle">
          Adicione páginas ao registo <code>PAGES</code> e construa os componentes correspondentes
          em <code>frontend/src/pages/</code>.
        </p>
      </div>
    </section>
  );
}

// Register one entry per page. The shell renders the active page inside the
// content region. Keep ids stable and unique; the first entry is the default.
const PAGES = [
  { id: 'home', label: 'Início', component: HomePage },
];

export default function App() {
  const [activeId, setActiveId] = useState(PAGES[0].id);
  const [user, setUser] = useState(null);

  useEffect(() => {
    let alive = true;
    getCurrentUser()
      .then((u) => { if (alive) setUser(u); })
      .catch(() => { /* best-effort personalisation only */ });
    return () => { alive = false; };
  }, []);

  const appName = (typeof document !== 'undefined' && document.title) || 'App';
  const active = PAGES.find((p) => p.id === activeId) ?? PAGES[0];
  const ActivePage = active.component;

  return (
    <div className="app-shell" data-demo-target="app-shell">
      <header className="app-topbar" data-demo-target="app-topbar">
        <span className="app-topbar-name">{appName}</span>
        <span className="app-topbar-user">{user ? (user.name || user.email) : ''}</span>
      </header>

      <div className="app-body">
        <nav className="app-nav" data-demo-target="app-nav" aria-label="Navegação principal">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === activeId ? 'app-nav-item is-active' : 'app-nav-item'}
              aria-current={p.id === activeId ? 'page' : undefined}
              onClick={() => setActiveId(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <main className="app-content" data-demo-target="app-content">
          <ErrorBoundary>
            <ActivePage />
          </ErrorBoundary>
        </main>
      </div>

      {/*
        Assistant panel mount point. The platform's operator assistant runtime
        mounts INTO this node in a later slice; it ships EMPTY here - no panel
        implementation, no chat UI. Do not remove this node and do not render
        children into it from the app.
      */}
      <div id="ekoa-assistant-root" data-demo-target="assistant-root" />
    </div>
  );
}
