/**
 * Rebase a "self" URL — one pointing at a local host (localhost / 127.0.0.1 /
 * 0.0.0.0 / ::1), typically a stale port the planner LLM guessed (e.g.
 * http://localhost:3000) — onto the RUNNING Ekoa frontend origin
 * (`automation config appOrigin`).
 *
 * Non-local URLs (a real third-party host) pass through untouched. Path, query,
 * and hash are preserved — only the origin (protocol + host + port) is rewritten.
 * Idempotent: a URL already on the app origin is returned effectively unchanged.
 *
 * Ported (carryover-audit A8): only the config source is re-pointed — the old
 * `config.appOrigin` becomes this module's `loadAutomationConfig().appOrigin`.
 */

import { loadAutomationConfig } from './config.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function rebaseSelfUrl(url: string, appOrigin: string = loadAutomationConfig().appOrigin): string {
  if (typeof url !== 'string' || url.length === 0) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url; // not an absolute URL (relative path, template, etc.) — leave it
  }
  if (!LOCAL_HOSTS.has(u.hostname)) return url; // points at a real external host
  let base: URL;
  try {
    base = new URL(appOrigin);
  } catch {
    return url; // misconfigured appOrigin — don't make things worse
  }
  u.protocol = base.protocol;
  u.host = base.host; // hostname + port together
  return u.toString();
}
