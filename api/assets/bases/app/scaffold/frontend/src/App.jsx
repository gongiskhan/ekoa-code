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
 *  - Brand     -> the top bar reads the runtime logo tokens (--logo-icon-url,
 *                 then --logo-url, published by /api/design-tokens.css) at mount
 *                 and renders the brand mark only when the organisation has one.
 *                 Never hardcode or invent a logo.
 */
import { useState, useEffect, useRef } from 'react';
import { getCurrentUser } from './lib/auth';
import { ErrorBoundary } from './lib/ErrorBoundary';

// The default starting page, shown LIVE to the end user while the agent is
// still building (the scaffold is compiled and served before the agent runs).
// Its visible copy is end-user facing (PT) - never developer instructions.
// AGENT: replace this with the first real screen of the product - write pages
// under frontend/src/pages/ and register them in PAGES below. It uses no mock
// data - real pages read/write through ./lib/jsonStore and ./lib/protocol-client.
function HomePage() {
  return (
    <section className="page">
      <div className="empty-state" data-demo-target="home-empty">
        <span className="empty-state-dots" aria-hidden="true"><span /><span /><span /></span>
        <h2 className="empty-state-title">A construir algo fantástico...</h2>
        <p className="empty-state-subtitle">
          A sua aplicação está a ganhar forma. Este ecrã dá lugar ao produto assim que a
          construção terminar.
        </p>
      </div>
    </section>
  );
}

// Register one entry per page: { id, label, component, icon? }. The shell
// renders the active page inside the content region. Keep ids stable and
// unique; the first entry is the default page. `icon` is OPTIONAL - when set
// it must be an inline <svg> element (viewBox 0 0 24 24, fill "none",
// stroke="currentColor", stroke-width 1.5-1.75) and the nav renders it before
// the label. Never use emoji or unicode glyphs as icons.
const PAGES = [
  { id: 'home', label: 'Início', component: HomePage },
];

// Extracts a plain URL from a CSS token whose computed value looks like
// url("/brand-assets/mark.png"). Returns '' when the token is unset/none.
function cssUrlValue(raw) {
  const value = (raw || '').trim();
  if (!value || value === 'none') return '';
  const match = value.match(/url\(\s*(["']?)(.*?)\1\s*\)/);
  return match ? match[2] : '';
}

export default function App() {
  const [activeId, setActiveId] = useState(PAGES[0].id);
  const [user, setUser] = useState(null);
  const [brandMark, setBrandMark] = useState('');
  const navRef = useRef(null);
  const navScrollArmed = useRef(false);

  useEffect(() => {
    let alive = true;
    getCurrentUser()
      .then((u) => { if (alive) setUser(u); })
      .catch(() => { /* best-effort personalisation only */ });
    return () => { alive = false; };
  }, []);

  // Brand mark slot: /api/design-tokens.css publishes --logo-icon-url (compact
  // mark) and --logo-url when the organisation has a logo. Read them at mount
  // and re-check on window load in case the stylesheet lands after first
  // paint. When both are empty, render no image - the app name is the brand.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const read = () => {
      const styles = window.getComputedStyle(document.documentElement);
      const url = cssUrlValue(styles.getPropertyValue('--logo-icon-url'))
        || cssUrlValue(styles.getPropertyValue('--logo-url'));
      if (url) setBrandMark(url);
    };
    read();
    if (document.readyState !== 'complete') {
      window.addEventListener('load', read, { once: true });
      return () => window.removeEventListener('load', read);
    }
    return undefined;
  }, []);

  // Expose the shell's navigation to the operator assistant runtime (operator-run
  // C3): a navigate action resolves window.__ekoaApp.navigate(routeOrId) first. A
  // route matches a PAGES id, or "/id", or an id === label match; unknown routes
  // are ignored (the runtime falls back to hash/history, harmless here).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__ekoaApp = window.__ekoaApp || {};
    window.__ekoaApp.navigate = (route) => {
      const key = String(route || '').replace(/^\//, '');
      const page = PAGES.find((p) => p.id === key || p.label === route);
      if (page) setActiveId(page.id);
    };
    return () => { if (window.__ekoaApp) delete window.__ekoaApp.navigate; };
  }, []);

  // Keep the active nav item in view - matters for the horizontal scrolling
  // nav on small screens. Skips the initial render and honours
  // prefers-reduced-motion (instant jump instead of a smooth scroll).
  useEffect(() => {
    if (!navScrollArmed.current) { navScrollArmed.current = true; return; }
    const nav = navRef.current;
    if (!nav) return;
    const item = nav.querySelector('.app-nav-item.is-active');
    if (!item || typeof item.scrollIntoView !== 'function') return;
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    item.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeId]);

  const appName = (typeof document !== 'undefined' && document.title) || 'App';
  const active = PAGES.find((p) => p.id === activeId) ?? PAGES[0];
  const ActivePage = active.component;

  return (
    <div className="app-shell" data-demo-target="app-shell">
      <header className="app-topbar" data-demo-target="app-topbar">
        <span className="app-topbar-brand">
          {brandMark ? (
            <img
              className="app-topbar-mark"
              src={brandMark}
              alt=""
              onError={() => setBrandMark('')}
            />
          ) : null}
          <span className="app-topbar-name">{appName}</span>
        </span>
        <span className="app-topbar-user">{user ? (user.name || user.email) : ''}</span>
      </header>

      <div className="app-body">
        <nav className="app-nav" data-demo-target="app-nav" aria-label="Navegação principal" ref={navRef}>
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === activeId ? 'app-nav-item is-active' : 'app-nav-item'}
              aria-current={p.id === activeId ? 'page' : undefined}
              onClick={() => setActiveId(p.id)}
            >
              {p.icon ? <span className="app-nav-icon" aria-hidden="true">{p.icon}</span> : null}
              <span className="app-nav-label">{p.label}</span>
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
