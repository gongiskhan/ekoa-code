/**
 * Rebase a "self" URL - one the planner guessed at a LOCAL port for EKOA'S OWN frontend - onto the
 * running Ekoa origin (`automation config appOrigin`).
 *
 * ── WHAT THIS IS FOR, AND THE LINE IT MUST NOT CROSS ─────────────────────────────────────────
 *
 * The planner writes a navigate step from a goal about the user's own Ekoa app and has to invent an
 * origin for it; the port it invents is routinely stale (`http://localhost:3000` when the app is
 * served somewhere else). Rebasing repairs exactly that guess.
 *
 * It used to rebase EVERY loopback URL, on the hostname alone, and that is a different and much
 * larger claim: that no automation may ever drive a local service other than Ekoa. FOUND LIVE
 * (2026-08-28): an automation whose step was `navigate http://127.0.0.1:45180/painel` - a local
 * fixture the user named explicitly, in their own goal - was silently rewritten to
 * `http://localhost:3000/painel` and driven against the DASHBOARD, which answered its own 404. The
 * target was never contacted; the run then spent three fixer patches and ~150k tokens failing to
 * explain why the page was wrong, because the step list it was shown still said 45180.
 *
 * ── THE RULE NOW: REBASE ONLY WHAT COULD PLAUSIBLY BE US ────────────────────────────────────
 *
 * A loopback URL is rebased only when its port is one Ekoa itself could be on: no port at all, the
 * app origin's own port, or a port explicitly listed in `EKOA_AUTOMATION_SELF_PORTS`. Every other
 * loopback port is somebody else's service - a fixture, a local API, another dev server - and is
 * left ALONE, because "the user typed a port we do not serve" is not a planner hallucination.
 *
 * The residual is stated rather than hidden: a planner that invents a stale port we do NOT serve
 * (say 3001) is no longer repaired, and its navigate now fails honestly against a dead port instead
 * of landing on the dashboard. That is the better failure - it names the real problem - and the
 * engine's post-navigation origin check reports it as such.
 */

import { loadAutomationConfig } from './config.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * The loopback ports Ekoa ITSELF is served on, and therefore the ones a planner guess can be
 * repaired onto: the dashboard (`backend.port`'s sibling, 3000) and the API proxy (4111). These are
 * committed, not guessed - they are the ports `run-ekoa-code`'s driver binds - and they are the
 * realistic content of a stale guess ("e.g. http://localhost:3000", the original docblock's own
 * example). Keeping them named here is what lets the rule stay narrow in PRODUCTION too, where the
 * app origin carries no explicit port and a `localhost:3000` guess would otherwise match nothing.
 */
const EKOA_DEV_PORTS = new Set(['3000', '4111']);

/** Extra loopback ports that are ALSO Ekoa (a dev proxy, a second surface). Comma-separated. */
function selfPorts(): Set<string> {
  const raw = process.env.EKOA_AUTOMATION_SELF_PORTS ?? '';
  return new Set(raw.split(',').map((p) => p.trim()).filter((p) => p !== ''));
}

export interface SelfUrlRebase {
  url: string;
  /** The original, when a rewrite happened - so the caller can SAY it did (it used to vanish). */
  rebasedFrom?: string;
}

/**
 * The rebase, with its provenance. `rebasedFrom` is present only when the origin actually changed;
 * the engine puts it in the step record so a rewrite is visible to the operator and to the fixer.
 */
export function rebaseSelfUrlWithProvenance(
  url: string,
  appOrigin: string = loadAutomationConfig().appOrigin,
): SelfUrlRebase {
  if (typeof url !== 'string' || url.length === 0) return { url };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url }; // not an absolute URL (relative path, template, ...) - leave it
  }
  if (!LOCAL_HOSTS.has(u.hostname)) return { url }; // a real external host
  let base: URL;
  try {
    base = new URL(appOrigin);
  } catch {
    return { url }; // misconfigured appOrigin - do not make things worse
  }
  // THE NARROWING. Only a port Ekoa could be serving on is treated as a guess at Ekoa.
  const port = u.port;
  const isPlausiblySelf =
    port === '' || port === base.port || EKOA_DEV_PORTS.has(port) || selfPorts().has(port);
  if (!isPlausiblySelf) return { url };

  const before = u.toString();
  u.protocol = base.protocol;
  // hostname AND port SEPARATELY. `u.host = base.host` looks equivalent and is not: assigning a
  // host with no port leaves the EXISTING port in place (WHATWG URL), so a production rebase of
  // `http://localhost:3000/x` onto `https://app.ekoa.io` produced `https://app.ekoa.io:3000/x` -
  // a port nothing serves there. Pre-existing; caught by this module's own suite.
  u.hostname = base.hostname;
  u.port = base.port; // '' clears the port, which is exactly what an implicit 443/80 needs
  const after = u.toString();
  return after === before ? { url: after } : { url: after, rebasedFrom: before };
}

/** Back-compat entry: the rebased URL alone. */
export function rebaseSelfUrl(url: string, appOrigin: string = loadAutomationConfig().appOrigin): string {
  return rebaseSelfUrlWithProvenance(url, appOrigin).url;
}

/** An absolute URL's origin, or `null` when it is not one. For the engine's landed-where-we-asked
 *  check: comparing ORIGINS lets an in-site redirect pass while a different host fails. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
