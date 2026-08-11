import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, cp, readFile } from 'node:fs/promises';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { appBuilder } from '../../src/apps/builder.js';
import { injectAppContext } from '../../src/apps/injected-context.js';
import { featuredArtifactsDir, featuredArtifactDir } from '../../src/apps/featured-seeder.js';

/**
 * Regression guard for `featured-router-basename-missing` (docs/findings.md). Four featured
 * artifacts (booking-system, sales-crm, ecommerce-catalog, invoice-manager - all fixed) mounted
 * react-router's <BrowserRouter> with no `basename`. Every served artifact lives at /apps/<id>/
 * (serving.ts), so window.location.pathname there is "/apps/<id>/...", never bare "/" - a
 * scaffold declaring absolute routes ("/", "/algo") from the domain root never matches, and
 * react-router renders nothing (or falls through to a catch-all, if the scaffold has one).
 *
 * WHY THIS IS A BEHAVIORAL CHECK, NOT A SOURCE-PATTERN CHECK. A regex over the source asking
 * "does this file mention `basename` near `window.location.pathname`" would reject the equally
 * correct `window.__EKOA_APP_ID`-based derivation, accept a DYNAMIC-LOOKING but WRONG derivation
 * (e.g. `basename={window.location.pathname.slice(0, 3)}` - references the right global, computes
 * the wrong value), and need special-casing for HashRouter/MemoryRouter, which need no basename
 * at all. None of that is honest: the actual invariant we care about is OBSERVABLE BEHAVIOR - does
 * the artifact render its routed content when served at its real prefix - not what its source
 * looks like. So this check builds each scaffold with the REAL esbuild pipeline
 * (`appBuilder.build`, the same one `featured-builder.ts` uses), serves the dist under `/apps/
 * <id>/` (the real prefix `serving.ts` mounts every artifact at) with the REAL
 * `injectAppContext()`, and asks a REAL browser whether react-router ever reported one of its own
 * two "this won't render" diagnostics (see ROUTER_FAILED_TO_RENDER below for both exact strings
 * and how the second one was found: a first attempt at a "wrong but dynamic" fixture accidentally
 * passed, because it only checked for the FIRST diagnostic and had hit the second one instead).
 * Either one fires if and only if the mounted Router's effective basename does not match the
 * served path - which is exactly, and only, the defect class this guards against. A correct fix
 * in ANY shape passes; a wrong fix in ANY shape (including one that LOOKS dynamic) fails. Proven,
 * not asserted: the "guard correctness" suite below includes a deliberately-wrong-but-dynamic
 * fixture alongside the hardcoded-literal one, and both must fail.
 *
 * HashRouter / MemoryRouter DECISION: both are treated as automatically compliant, and this
 * guard does not even attempt to build every scaffold - only ones that declare a top-level
 * BrowserRouter (a coarse source scan just to pick which real catalog entries are IN SCOPE for
 * the expensive behavioral check; the pass/fail verdict itself is always behavioral, never
 * source-based). This is not a shortcut, it is correct: HashRouter resolves routes from
 * `window.location.hash`, which is entirely independent of the path prefix an app is served
 * under - there is no "wrong hash routing under a subpath" failure mode this defect class can
 * produce. MemoryRouter does not read the browser URL at all; it manages its own in-memory
 * history starting at `initialEntries` (default "/"), so it is equally immune (a MemoryRouter
 * scaffold has a DIFFERENT problem - no deep-link/reload support - which is out of scope for
 * this guard). The "guard correctness" suite below includes a HashRouter fixture with NO
 * basename to prove this empirically rather than leaving it as an assertion in a comment.
 *
 * SUITE_LEDGER.json: NOT registered there. `scripts/suite-ledger-run.mjs` strict-censuses three
 * categories only - web/e2e/*.spec.ts, api/tests/e2e/*.e2e.mjs drivers, and web/__tests__ frontend
 * unit files (see its own header comment: "this runner censuses the externally-authored estate...
 * module_tests_146 runs via plain `npm test`, not this runner"). This file is none of those three
 * - it is a new api/tests/apps/*.test.ts vitest module test, which the ledger's own design
 * deliberately does not count-census (module_tests_146/contract_tests_from_ruleset track the
 * HISTORICAL migration carryover, not an ongoing inventory of every current test file). Forcing
 * an entry into either section would misrepresent what this file is. It runs, and is gated,
 * exactly the way every other api/tests/apps/*.test.ts file is: `npm test --workspace api`,
 * already step 3 of the per-PR CI lane.
 */

const MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** Serve `distDir` under /apps/<id>/ on an OS-assigned port (parallel-safe). */
async function serveDist(id: string, distDir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const prefix = `/apps/${id}/`;
  const server: Server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0] as string;
    if (!url.startsWith(prefix)) {
      res.writeHead(404).end('not under prefix');
      return;
    }
    const rel = url.slice(prefix.length);
    const assetPath = rel ? join(distDir, rel) : join(distDir, 'index.html');
    const isAsset = /\.(js|css|map|json|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i.test(assetPath);
    if (isAsset && existsSync(assetPath)) {
      readFile(assetPath)
        .then((buf) => {
          res.writeHead(200, { 'Content-Type': MIME[extname(assetPath)] || 'application/octet-stream' });
          res.end(buf);
        })
        .catch(() => res.writeHead(500).end());
      return;
    }
    readFile(join(distDir, 'index.html'), 'utf-8')
      .then((html) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(injectAppContext(html, id));
      })
      .catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}${prefix}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface CheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * The installed react-router-dom emits TWO DIFFERENT diagnostics for this defect family,
 * discovered empirically while building this guard (a synthetic "wrong but dynamic" fixture
 * failed to trip the first pattern alone - it hit the second one instead, which was not yet
 * known to exist):
 *  1. "No routes matched location \"...\"" - the basename strips cleanly (including the
 *     default basename="/" case, which is what booking-system/sales-crm/ecommerce-catalog/
 *     invoice-manager actually hit - no basename means it defaults to "/", which trivially
 *     "matches" as a prefix), but no declared Route's path matches what's left.
 *  2. "<Router basename=\"...\"> is not able to match the URL \"...\" because it does not
 *     start with the basename, so the <Router> won't render anything." - the basename itself
 *     is not even a valid prefix of the served path (e.g. a dynamically-computed but WRONG
 *     value).
 * Both are react-router's own words for "this app will render nothing here" - exactly the
 * observable failure this guard exists to catch - so both fail the check. KNOWN FRAGILITY,
 * named rather than hidden: this couples the guard to react-router's current wording. If a
 * react-router upgrade changes either message, this regex needs a companion update - a
 * behavioral check over library internals cannot fully escape that coupling; catching BOTH
 * known variants (rather than the one this defect happened to hit first) is the mitigation.
 */
const ROUTER_FAILED_TO_RENDER = /no routes matched|is not able to match the URL.*won't render anything/i;

/**
 * THE INVARIANT CHECK. See the file header for why this is behavioral. `sourceDir` must already
 * be laid out like a scaffold root (manifest.json at its top, not nested under scaffold/).
 */
async function checkServesCorrectlyUnderPrefix(browser: Browser, id: string, sourceDir: string): Promise<CheckResult> {
  const workDir = await mkdtemp(join(tmpdir(), `router-guard-${id.replace(/[^a-z0-9-]/gi, '_')}-`));
  try {
    await cp(sourceDir, workDir, { recursive: true });
    const build = await appBuilder.build(id, workDir);
    if (!build.success) {
      return { ok: false, reason: `build failed: ${build.errors.join('; ') || 'unknown esbuild error'}` };
    }
    const distDir = join(workDir, 'dist');
    if (!existsSync(join(distDir, 'index.html'))) {
      return { ok: false, reason: 'build succeeded but produced no dist/index.html' };
    }
    const { url, close } = await serveDist(id, distDir);
    try {
      const page = await browser.newPage();
      const routingIssues: string[] = [];
      page.on('console', (msg) => {
        if (ROUTER_FAILED_TO_RENDER.test(msg.text())) routingIssues.push(msg.text());
      });
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
        await page.waitForTimeout(800); // let a client-side <Navigate> redirect + any re-render settle
      } finally {
        await page.close();
      }
      if (routingIssues.length > 0) return { ok: false, reason: routingIssues[0] };
      return { ok: true };
    } finally {
      await close();
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function teachingFailureMessage(id: string, reason: string): string {
  return `Featured artifact "${id}" does not serve correctly under its real path prefix, /apps/${id}/.

React-router (or the build) reported: ${reason}

WHY THIS HAPPENS: every served artifact lives at /apps/<id>/ (api/src/apps/serving.ts), so
window.location.pathname there is "/apps/${id}/...", never a bare "/". A scaffold that mounts
<BrowserRouter> with NO basename (or a WRONG one) declares its routes as absolute paths from the
domain root ("/", "/algo", ...), which then never match the real served path - react-router
renders nothing, or falls through to a catch-all/not-found route if the scaffold has one.

THE FIX (put this in the scaffold's router-mounting file, e.g. frontend/src/index.jsx, right
before the router renders):

  const m = (typeof window !== 'undefined' ? window.location.pathname : '/').match(/^(\\/apps\\/[^/]+)/);
  const basename = m ? m[1] : '/';

  root.render(<BrowserRouter basename={basename}><App /></BrowserRouter>);

This is the exact pattern every legal-* scaffold + cobrancas already ship. A DIFFERENT correct
derivation (e.g. from window.__EKOA_APP_ID) also passes - this check is behavioral, not textual.
HashRouter/MemoryRouter scaffolds need no basename at all and are unaffected by this class of bug.

Full incident writeup: docs/findings.md, entry "featured-router-basename-missing".`;
}

/** Coarse, SCOPING-ONLY source scan: which real catalog ids even declare a top-level
 *  BrowserRouter (the only router type this defect class can hit)? This never decides pass/fail
 *  - checkServesCorrectlyUnderPrefix does that, behaviorally, for whatever this returns. */
function declaresBrowserRouter(scaffoldDir: string): boolean {
  const srcRoot = join(scaffoldDir, 'frontend', 'src');
  if (!existsSync(srcRoot)) return false;
  const stack = [srcRoot];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
        // Sync read is fine - this only runs at test-collection scope over ~42 small dirs.
        const src = readFileSync(p, 'utf-8');
        if (/\bBrowserRouter\b/.test(src)) return true;
      }
    }
  }
  return false;
}

// ---- Synthetic fixture builder (guard-correctness suite only - never touches the real catalog) ----
async function writeSyntheticScaffold(dir: string, indexJsxBody: string): Promise<void> {
  await mkdir(join(dir, 'frontend', 'src'), { recursive: true });
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: 'fixture',
      name: 'Fixture',
      version: '1.0.0',
      type: 'jsx-app',
      entryPoint: 'frontend/src/index.jsx',
      outputDir: 'dist/',
    }),
  );
  await writeFile(join(dir, 'frontend', 'src', 'index.jsx'), indexJsxBody);
}

const FIXTURE_APP_JSX_ROUTES = `
  <Routes>
    <Route path="/" element={<div>home</div>} />
    <Route path="/algo" element={<div>algo</div>} />
  </Routes>`;

describe('featured artifact scaffolds serve correctly under /apps/<id>/ (router-basename guard)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  describe('guard correctness (synthetic fixtures - proves this catches the DEFECT, not the SPELLING)', () => {
    let fixturesRoot: string;

    beforeAll(async () => {
      fixturesRoot = await mkdtemp(join(tmpdir(), 'router-guard-fixtures-'));
    });

    afterAll(async () => {
      await rm(fixturesRoot, { recursive: true, force: true });
    });

    it('FAILS: BrowserRouter with no basename at all (the original booking-system bug)', async () => {
      const dir = join(fixturesRoot, 'no-basename');
      await writeSyntheticScaffold(
        dir,
        `import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
createRoot(document.getElementById('root')).render(
  <BrowserRouter><Routes><Route path="/" element={<div>home</div>} /></Routes></BrowserRouter>
);`,
      );
      const r = await checkServesCorrectlyUnderPrefix(browser, 'fixture-no-basename', dir);
      expect(r.ok).toBe(false);
    }, 20_000);

    it('FAILS: BrowserRouter with a HARDCODED literal basename (equivalent to no protection)', async () => {
      const dir = join(fixturesRoot, 'hardcoded-basename');
      await writeSyntheticScaffold(
        dir,
        `import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
createRoot(document.getElementById('root')).render(
  <BrowserRouter basename="/"><Routes><Route path="/" element={<div>home</div>} /></Routes></BrowserRouter>
);`,
      );
      const r = await checkServesCorrectlyUnderPrefix(browser, 'fixture-hardcoded-basename', dir);
      expect(r.ok).toBe(false);
    }, 20_000);

    it('FAILS: basename IS dynamic but computes the WRONG value (proves this is behavioral, not a text-pattern match)', async () => {
      const dir = join(fixturesRoot, 'wrong-dynamic-basename');
      await writeSyntheticScaffold(
        dir,
        `import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
// References window.location.pathname (would fool a naive "mentions basename + pathname" regex)
// but computes a basename that can never be a real prefix of the actual served path - NOT
// pathname.slice(0, 3): that was tried first and accidentally PASSED, because react-router's
// basename check is a raw string-prefix match with no "/" boundary requirement, and "/apps/..."
// happens to string-prefix-match "/ap". This value is unrelated to the real path on purpose.
const basename = '/definitely-wrong-' + window.location.pathname.length;
createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}><Routes><Route path="/" element={<div>home</div>} /></Routes></BrowserRouter>
);`,
      );
      const r = await checkServesCorrectlyUnderPrefix(browser, 'fixture-wrong-dynamic-basename', dir);
      expect(r.ok).toBe(false);
    }, 20_000);

    it('PASSES: basename derived from window.location.pathname (the pattern shipped in this repo)', async () => {
      const dir = join(fixturesRoot, 'correct-pathname-basename');
      await writeSyntheticScaffold(
        dir,
        `import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
const m = window.location.pathname.match(/^(\\/apps\\/[^/]+)/);
const basename = m ? m[1] : '/';
createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}><Routes><Route path="/" element={<div>home</div>} /></Routes></BrowserRouter>
);`,
      );
      const r = await checkServesCorrectlyUnderPrefix(browser, 'fixture-correct-pathname-basename', dir);
      expect(r.ok, r.reason).toBe(true);
    }, 20_000);

    it('PASSES: basename derived from window.__EKOA_APP_ID (a DIFFERENT but equally correct means)', async () => {
      const dir = join(fixturesRoot, 'correct-appid-basename');
      await writeSyntheticScaffold(
        dir,
        `import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
const basename = window.__EKOA_APP_ID ? '/apps/' + window.__EKOA_APP_ID : '/';
createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}><Routes><Route path="/" element={<div>home</div>} /></Routes></BrowserRouter>
);`,
      );
      const r = await checkServesCorrectlyUnderPrefix(browser, 'fixture-correct-appid-basename', dir);
      expect(r.ok, r.reason).toBe(true);
    }, 20_000);

    it('PASSES: HashRouter with NO basename at all (empirical proof of the HashRouter decision)', async () => {
      const dir = join(fixturesRoot, 'hashrouter-no-basename');
      await writeSyntheticScaffold(
        dir,
        `import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
createRoot(document.getElementById('root')).render(
  <HashRouter><Routes><Route path="/" element={<div>home</div>} /></Routes></HashRouter>
);`,
      );
      const r = await checkServesCorrectlyUnderPrefix(browser, 'fixture-hashrouter-no-basename', dir);
      expect(r.ok, r.reason).toBe(true);
    }, 20_000);
  });

  describe('census against the real catalog', () => {
    it(
      'every real featured scaffold declaring a top-level BrowserRouter serves correctly under /apps/<id>/',
      async () => {
        const root = featuredArtifactsDir();
        const allIds = readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
        const inScope = allIds.filter((id) => declaresBrowserRouter(join(featuredArtifactDir(id), 'scaffold')));
        expect(inScope.length).toBeGreaterThan(0); // the scoping scan itself must find candidates

        const failures: string[] = [];
        for (const id of inScope) {
          const r = await checkServesCorrectlyUnderPrefix(browser, id, join(featuredArtifactDir(id), 'scaffold'));
          if (!r.ok) failures.push(teachingFailureMessage(id, r.reason ?? 'unknown'));
        }
        expect(failures, `\n\n${failures.join('\n\n' + '='.repeat(80) + '\n\n')}`).toEqual([]);
      },
      240_000,
    );
  });
});
