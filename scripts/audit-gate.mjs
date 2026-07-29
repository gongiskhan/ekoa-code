#!/usr/bin/env node
/**
 * Dependency-vulnerability gate (security addendum D.4).
 *
 * WHY THIS EXISTS INSTEAD OF `npm audit --audit-level=high`. That command is all-or-nothing: it
 * fails on any high, and npm has no per-advisory ignore. When an advisory has NO fixed version, a
 * blunt gate leaves exactly two options — stay red forever (a gate nobody can act on stops being
 * read; ours was red for weeks) or drop the threshold and stop seeing highs at all. Both lose.
 *
 * So this gate fails on every high/critical EXCEPT an explicit, documented allowlist. Each entry
 * carries the reason it is accepted and what would close it, and anything NOT listed still fails —
 * the same discipline as the gitleaks value allowlist in `scripts/gitleaks.toml`.
 *
 * PRODUCTION BLOCKS; DEV IS REPORTED. The blocking set is `npm audit --omit=dev`: those packages
 * SHIP, so an advisory against one is runtime exposure to tenant data. The dev tree (the eslint
 * toolchain, test tooling) is scanned too and printed, but does not fail the build — a DoS in the
 * linter's glob matcher is a build-time annoyance, not a path to a customer's credentials, and
 * blocking on it is what kept this gate red and unread for weeks while the PRODUCTION advisories
 * (archiver's zip-slip chain, seven of them) sat unnoticed behind the noise. Dev findings stay
 * VISIBLE precisely so a genuinely alarming one is still seen.
 */
import { execFileSync } from 'node:child_process';

/**
 * Accepted high/critical advisories. An entry is a decision, not a mute button: it must say why the
 * vulnerability is not reachable here AND what would let us drop the entry.
 */
const ACCEPTED = [
  {
    package: 'brace-expansion',
    // The whole archiver chain is flagged by THIS ONE advisory, propagating up through
    // minimatch -> glob -> readdir-glob -> archiver-utils -> archiver -> zip-stream. npm reports
    // each of those separately; the propagation rule below accepts them from this entry.
    alsoCovers: ['minimatch', 'glob', 'readdir-glob', 'archiver-utils', 'archiver', 'zip-stream'],
    title: /DoS via unbounded expansion|exponential-time expansion/i,
    reason: [
      'NOT REACHABLE. The advisory is a denial of service in GLOB PATTERN expansion. The only',
      'production consumer is archiver, in api/src/services/app-archive.ts, and it is never given a',
      'pattern: entries are added one at a time as `archive.file(absolutePath, { name: relPath })`',
      'from a directory walk this repo performs itself. `archive.glob()` and `archive.directory()`',
      '(which globs internally) are not called anywhere — verified by grep.',
      '',
      'ARCHIVER@8 WAS TRIED AND REVERTED. It clears the chain, but v8 REMOVED the factory API',
      'entirely: it is pure ESM exporting classes (Archiver, ZipArchive, ...) with no default and',
      'nothing callable, so `archiver(\'zip\', ...)` becomes `TypeError: archiver is not a function`',
      'and the artifact download 500s. Migrating is a rewrite of a user-facing download path, not a',
      'shim, and is not worth doing to close an unreachable DoS — but it IS the right move the next',
      'time this file is opened for other reasons.',
    ].join('\n    '),
    closesWhen: 'app-archive.ts migrates to the archiver@8 class API, or brace-expansion ships a fix for the <=5.0.7 range.',
    reviewed: '2026-07-29',
  },
  {
    package: 'react-router',
    // Also covers the react-router-dom row, which npm reports separately for the same advisory.
    alsoCovers: ['react-router-dom'],
    title: /RSC Mode CSRF Bypass/i,
    reason: [
      'NOT REACHABLE. The advisory is specific to React Router RSC / framework mode — server',
      'components and server actions. react-router-dom is a dependency of the featured-artifact',
      'SCAFFOLDS only (api/assets/featured-artifacts/*/scaffold/frontend), which are client-side',
      'SPAs: they import BrowserRouter, Routes, Route, NavLink, useNavigate, useParams and',
      'useLocation, and nothing else. There is no server, no action, and no RSC entry point for the',
      'bypass to act on (verified by grep for createBrowserRouter / RouterProvider /',
      '@react-router/serve / react-router.config / unstable_ / rsc across every scaffold: no hits).',
      '',
      'NO FORWARD FIX EXISTS. The advisory range is 7.12.0 - 8.2.0 and the latest published release',
      'is 7.18.2, so every current version is affected. npm proposes react-router-dom@7.11.0, and',
      'taking it is STRICTLY WORSE: 7.11.0 sits inside seven other high advisories that ARE',
      'reachable from plain SPA routing — XSS via open redirects (<=7.11.0), SSR XSS in',
      'ScrollRestoration (<7.12.0), arbitrary constructor invocation via vendored turbo-stream',
      '(<=7.14.1), unbounded path expansion DoS (<7.15.0), reflected-input DoS (<7.14.0) and',
      'inefficient route-matching DoS (<7.18.0). This was tried, measured and reverted.',
    ].join('\n    '),
    closesWhen: 'react-router publishes a release outside 7.12.0 - 8.2.0; then drop this entry and bump.',
    reviewed: '2026-07-29',
  },
];

/**
 * Does an entry accept this package directly, by advisory title?
 *
 * npm reports a package's `via` as OBJECTS for its own advisories and as STRINGS naming another
 * package when it is only vulnerable THROUGH a dependency. `react-router-dom` is the second kind:
 * its via is `["react-router"]`, so it carries no title to match on.
 */
function directMatch(name, viaTitles) {
  return ACCEPTED.find(
    (a) =>
      (a.package === name || (a.alsoCovers ?? []).includes(name)) &&
      viaTitles.some((t) => a.title.test(t)),
  );
}

/**
 * Accept a package that is vulnerable ONLY through packages which are themselves accepted.
 *
 * `every`, not `some`, and deliberately: if react-router-dom ever gains an advisory of its own, the
 * string-via check must not launder it through the accepted react-router entry. A package with any
 * unaccounted-for via still blocks.
 */
function propagatedMatch(name, v, acceptedNames) {
  const via = v.via ?? [];
  if (via.length === 0) return undefined;
  const allVia = via.every((x) => (typeof x === 'string' ? acceptedNames.has(x) : false));
  if (!allVia) return undefined;
  const src = via.find((x) => typeof x === 'string');
  return ACCEPTED.find((a) => a.package === src || (a.alsoCovers ?? []).includes(name));
}

/** Run npm audit and parse it. `npm audit` exits non-zero WHEN IT FINDS THINGS, which is the normal
 *  path — the JSON is still on stdout. A genuine failure (no network, bad registry) yields no
 *  parseable stdout, and that is treated as FAILURE, never as clean. */
function audit(extraArgs) {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--json', ...extraArgs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    raw = err.stdout?.toString() ?? '';
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`[audit-gate] npm audit ${extraArgs.join(' ')} produced no parseable JSON — FAILING, not treating as clean.`);
    process.exit(1);
  }
}

const report = audit(['--omit=dev']); // the blocking set: packages that SHIP
const fullReport = audit([]); // everything, for the dev-tree report below

const vulns = report.vulnerabilities ?? {};
const blocking = [];
const accepted = [];
const acceptedNames = new Set();

// TWO PASSES. The first accepts packages by their own advisory titles and records their names; the
// second accepts packages that are vulnerable only THROUGH one of those. Order matters — a
// single pass would judge react-router-dom before knowing react-router was accepted.
const highs = Object.entries(vulns).filter(([, v]) => v.severity === 'high' || v.severity === 'critical');
const titlesOf = (v) => (v.via ?? []).filter((x) => typeof x === 'object' && x.title).map((x) => x.title);

for (const [name, v] of highs) {
  const match = directMatch(name, titlesOf(v));
  if (match) {
    accepted.push({ name, v, match, viaTitles: titlesOf(v) });
    acceptedNames.add(name);
  }
}
// Propagation is TRANSITIVE, so iterate to a fixpoint. The archiver chain is six levels deep
// (brace-expansion -> minimatch -> glob -> readdir-glob -> archiver-utils -> archiver, plus
// zip-stream); a single extra pass accepts only the first link and blocks the rest, which is
// exactly what a one-shot second pass did.
for (let changed = true; changed; ) {
  changed = false;
  for (const [name, v] of highs) {
    if (acceptedNames.has(name)) continue;
    const match = propagatedMatch(name, v, acceptedNames);
    if (match) {
      accepted.push({ name, v, match, viaTitles: [`(via ${(v.via ?? []).join(', ')})`] });
      acceptedNames.add(name);
      changed = true;
    }
  }
}
for (const [name, v] of highs) {
  if (!acceptedNames.has(name)) blocking.push({ name, v, viaTitles: titlesOf(v) });
}

for (const { name, match, viaTitles } of accepted) {
  console.log(`[audit-gate] ACCEPTED ${name} — ${viaTitles[0] ?? '(no title)'}`);
  console.log(`    ${match.reason}`);
  console.log(`    closes when: ${match.closesWhen}   (reviewed ${match.reviewed})`);
}

if (blocking.length > 0) {
  console.error(`\n[audit-gate] FAIL: ${blocking.length} unaccepted high/critical advisory(ies):`);
  for (const { name, v, viaTitles } of blocking) {
    const fix = v.fixAvailable;
    const fixStr = fix === true ? 'npm audit fix' : fix ? `${fix.name}@${fix.version}` : 'none published';
    console.error(`  - ${v.severity} ${name} (${v.range}) — fix: ${fixStr}`);
    for (const t of viaTitles.slice(0, 3)) console.error(`      ${t}`);
  }
  console.error('\nFix it, or add a documented entry to ACCEPTED in scripts/audit-gate.mjs.');
  process.exit(1);
}

// Dev-tree highs: reported, never blocking. Subtract the production set so the number means
// "additional, dev-only" rather than "total".
const prodNames = new Set(Object.keys(report.vulnerabilities ?? {}));
const devOnly = Object.entries(fullReport.vulnerabilities ?? {})
  .filter(([n, v]) => (v.severity === 'high' || v.severity === 'critical') && !prodNames.has(n))
  .map(([n]) => n);
if (devOnly.length > 0) {
  console.log(
    `\n[audit-gate] ${devOnly.length} high/critical in the DEV tree (not blocking — these do not ship): ` +
      `${devOnly.slice(0, 12).join(', ')}${devOnly.length > 12 ? ', …' : ''}`,
  );
}

const m = report.metadata?.vulnerabilities ?? {};
console.log(
  `[audit-gate] OK — 0 unaccepted high/critical in PRODUCTION deps (${accepted.length} accepted; ` +
    `below threshold there: ${m.moderate ?? 0} moderate, ${m.low ?? 0} low).`,
);
