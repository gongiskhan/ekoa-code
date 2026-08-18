/**
 * surface/local-server.ts — the daemon's LOCALHOST-ONLY browser/CLI surface (§18.6; C1–C3 of
 * ekoa-code/docs/bridge-counterpart-changes.md). This is the "local ledger viewer served live by the
 * daemon" the spec requires — the egress ledger is rendered from the daemon's own append-only files,
 * NEVER from hosted storage (paths can be sensitive) — plus, since the 2026-07-11 owner-authorized
 * run, the surface the hosted dashboard talks to DIRECTLY from the browser: status, grants
 * (list/mint/revoke), directory browsing for the in-app picker, and the all-sessions ledger.
 *
 * SECURITY posture (decisions.md 2026-07-11):
 *  - Bound to 127.0.0.1 ONLY (loopback) — never 0.0.0.0. CORS is not exposure: the surface stays
 *    unreachable off-machine; allowlisted app origins merely let the paired user's OWN browser read.
 *  - Host-header check (DNS-rebind guard): only `127.0.0.1[:port]` / `localhost[:port]` Hosts are
 *    served; anything else is 403 before routing.
 *  - Mutations (POST) require `content-type: application/json`, which forces a CORS preflight —
 *    a non-allowlisted web origin never gets its POST executed. Non-browser local processes are
 *    same-trust as the CLI (the machine's user).
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { EgressLedger } from '../ledger/index.js';
import { browseDirectory, defaultBrowseRoots } from './browse.js';
import {
  createBrowserGrant,
  listBrowserGrants,
  revokeBrowserGrant,
  type BrowserGrantsDeps,
} from './browser-grants.js';

/** The stable default port the hosted dashboard is configured for (C1). */
export const DEFAULT_SURFACE_PORT = 8791;

/** Dev app origins allowed by default (C2); production origins come from config `surfaceOrigins`. */
export const DEFAULT_SURFACE_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/** The daemon's current state, as the surface reports it. */
export interface LocalSurfaceStatus {
  paired: boolean;
  pairingId?: string;
  org?: string;
  cortexBaseUrl?: string;
  /** The BridgeSocket connection state, or 'stopped' when the daemon is not serving. */
  connection: string;
  /** The surface's own bound port — echoed so `/status` self-describes reachability (C1). */
  port?: number;
}

export interface LocalSurfaceDeps {
  getStatus: () => LocalSurfaceStatus;
  ledger: EgressLedger;
  /** Browser origins allowed to read this surface (C2). Defaults to the dev app origins. */
  corsOrigins?: string[];
  /** Grant list/mint/revoke wiring (C3). Absent → those routes 404 (a status-only surface). */
  grants?: BrowserGrantsDeps;
  /** Roots the /browse picker may list. Defaults to the user's home directory. */
  browseRoots?: string[];
}

export interface LocalSurfaceHandle {
  port: number;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(payload);
}

/** JSON POST bodies are small control messages; anything past this is a defect, not data. */
const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const CreateGrantBody = z.object({
  path: z.string(),
  session: z.string(),
  label: z.string().max(200).optional(),
});

const RevokeGrantBody = z.object({ grantRef: z.string().min(1) });

/** Host-header guard: only loopback names, with or without a port, pass (DNS-rebind protection). */
function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '');
  return name === '127.0.0.1' || name === 'localhost';
}

/**
 * Start the local surface, bound to loopback only. `port` 0 picks a free port; the daemon default is
 * DEFAULT_SURFACE_PORT so the hosted dashboard can find it (C1). Returns the bound port + a close().
 */
export function startLocalSurface(deps: LocalSurfaceDeps, port = 0): Promise<LocalSurfaceHandle> {
  const origins = deps.corsOrigins ?? DEFAULT_SURFACE_ORIGINS;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!hostAllowed(req.headers.host)) {
      return sendJson(res, 403, { error: 'forbidden host' });
    }

    // CORS (C2): reflect an ALLOWLISTED Origin only; a foreign origin gets no ACAO header, so the
    // browser blocks the read and the preflight for any mutation fails before it executes.
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      return res.end();
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }

    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /status':
        return sendJson(res, 200, deps.getStatus());

      case 'GET /ledger': {
        // With ?session= the historical per-session read; without it, the all-sessions viewer
        // read (C3 follow-up) — rows carry their own `session`, merged and ts-ordered.
        const session = url.searchParams.get('session');
        if (session) {
          const { rows, corrupt } = deps.ledger.readAll(session);
          return sendJson(res, 200, { session, rows, corrupt });
        }
        const { rows, corrupt } = deps.ledger.readEverything();
        return sendJson(res, 200, { rows, corrupt });
      }

      case 'GET /grants': {
        if (!deps.grants) return sendJson(res, 404, { error: 'not found' });
        const grants = listBrowserGrants(deps.grants).map((g) => ({
          grantRef: g.grantRef,
          path: g.root,
          session: g.session,
          createdAt: g.createdAt,
          ...(g.label !== undefined ? { label: g.label } : {}),
        }));
        return sendJson(res, 200, { grants });
      }

      case 'POST /grants': {
        if (!deps.grants) return sendJson(res, 404, { error: 'not found' });
        const grantsDeps = deps.grants;
        void readJsonBody(req)
          .then((raw) => {
            const body = CreateGrantBody.safeParse(raw);
            if (!body.success) return sendJson(res, 400, { error: 'invalid body' });
            const outcome = createBrowserGrant(grantsDeps, body.data);
            if (!outcome.ok) return sendJson(res, outcome.status, { error: outcome.error });
            const { grant, requested } = outcome;
            return sendJson(res, 201, {
              grantRef: grant.grantRef,
              path: grant.root,
              session: grant.session,
              createdAt: grant.createdAt,
              label: grant.label,
              requested,
            });
          })
          .catch((err: Error) => sendJson(res, 400, { error: err.message }));
        return;
      }

      case 'POST /grants/revoke': {
        if (!deps.grants) return sendJson(res, 404, { error: 'not found' });
        const grantsDeps = deps.grants;
        void readJsonBody(req)
          .then((raw) => {
            const body = RevokeGrantBody.safeParse(raw);
            if (!body.success) return sendJson(res, 400, { error: 'invalid body' });
            return sendJson(res, 200, { revoked: revokeBrowserGrant(grantsDeps, body.data.grantRef) });
          })
          .catch((err: Error) => sendJson(res, 400, { error: err.message }));
        return;
      }

      case 'GET /browse': {
        const outcome = browseDirectory(
          url.searchParams.get('path') ?? undefined,
          deps.browseRoots ?? defaultBrowseRoots(),
        );
        if (!outcome.ok) return sendJson(res, outcome.status, { error: outcome.error });
        return sendJson(res, 200, outcome.result);
      }

      default: {
        const knownPaths = ['/status', '/ledger', '/grants', '/grants/revoke', '/browse'];
        return knownPaths.includes(url.pathname)
          ? sendJson(res, 405, { error: 'method not allowed' })
          : sendJson(res, 404, { error: 'not found' });
      }
    }
  });

  return new Promise<LocalSurfaceHandle>((resolve, reject) => {
    server.once('error', reject);
    // Bind to loopback ONLY — the ledger names local file paths and must never be network-reachable.
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
