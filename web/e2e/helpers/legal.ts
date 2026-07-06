import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Cortex (backend) origin for the legal-app e2e specs, derived from the
 * repo-root `backend.port` file - the single source of truth for dev ports
 * (Session Start Rule). Never hardcode a port in a spec.
 */
export function cortexBase(): string {
  try {
    const port = readFileSync(resolve(__dirname, '..', '..', '..', 'backend.port'), 'utf-8').trim();
    if (port) return `http://localhost:${port}`;
  } catch {
    /* fall through */
  }
  return 'http://localhost:4111';
}

/** URL of a served legal app: legalAppUrl('legal-citius') -> `${cortex}/apps/legal-citius/`. */
export function legalAppUrl(appId: string, path = ''): string {
  const clean = String(path || '').replace(/^\/+/, '');
  return `${cortexBase()}/apps/${appId}/${clean}`;
}
