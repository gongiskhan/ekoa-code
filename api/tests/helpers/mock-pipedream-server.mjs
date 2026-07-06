/**
 * Mock Pipedream Connect REST server for tests (unit + e2e).
 *
 * Implements the exact endpoint shapes the pipedream service (cortex/src/
 * services/pipedream.ts) calls, and ASSERTS the security-relevant parts of each
 * request:
 *   - every /v1/connect/* call must carry `Authorization: Bearer <token>`
 *   - the client-credentials token exchange must carry client_id + client_secret
 *   - tokens / accounts / actions-run must carry an `external_user_id`
 *
 * Canned, deterministic responses. Counters (`stats`) let tests prove the token
 * is cached (2 runs → 1 token call) and that a refused run makes NO HTTP call.
 *
 * Error injection: an action `id` beginning with `error-<status>` (e.g.
 * `error-429`) makes /actions/run reply with that HTTP status, so the service's
 * error-mapping can be exercised. A `client_id` of `fail-token` makes the token
 * exchange reply 401.
 *
 * Usage:
 *   import { startMockPipedream } from './helpers/mock-pipedream-server.mjs';
 *   const mock = await startMockPipedream();
 *   // mock.url, mock.stats, mock.reset(), mock.setAccounts([...]), await mock.close()
 */
import { createServer } from 'node:http';

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export async function startMockPipedream() {
  const state = {
    stats: { tokenCalls: 0, runCalls: 0, tokenIssued: 0, deletedAccounts: [] },
    accounts: [{ id: 'apn_mock1', app: 'slack', name: 'Slack Workspace' }],
    lastRun: null,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const auth = req.headers['authorization'] || '';
    const hasBearer = /^Bearer\s+.+/.test(auth);

    // ---- client-credentials token exchange ----
    if (req.method === 'POST' && path === '/v1/oauth/token') {
      const body = await readJson(req);
      if (body.grant_type !== 'client_credentials' || !body.client_id || !body.client_secret) {
        return send(res, 400, { error: 'invalid_request' });
      }
      if (body.client_id === 'fail-token') {
        return send(res, 401, { error: 'invalid_client' });
      }
      state.stats.tokenCalls += 1;
      state.stats.tokenIssued += 1;
      return send(res, 200, {
        access_token: `mock-access-${state.stats.tokenIssued}`,
        token_type: 'bearer',
        expires_in: 3600,
      });
    }

    // Everything below is a Connect endpoint → require a bearer.
    const connectMatch = path.match(/^\/v1\/connect\/([^/]+)\/(tokens|accounts)(?:\/([^/]+))?$/);
    if (connectMatch) {
      if (!hasBearer) return send(res, 401, { error: 'missing_bearer' });
      const resource = connectMatch[2];
      const accountId = connectMatch[3];

      // POST /tokens — mint a Connect Link token
      if (resource === 'tokens' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body.external_user_id) return send(res, 400, { error: 'missing_external_user_id' });
        const token = `ctok_${Date.now().toString(36)}`;
        return send(res, 200, {
          token,
          connect_link_url: `https://pipedream.com/_static/connect.html?token=${token}&app=`,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
      }

      // GET /accounts?external_user_id=...
      if (resource === 'accounts' && !accountId && req.method === 'GET') {
        if (!url.searchParams.get('external_user_id')) {
          return send(res, 400, { error: 'missing_external_user_id' });
        }
        return send(res, 200, { data: state.accounts });
      }

      // DELETE /accounts/:id
      if (resource === 'accounts' && accountId && req.method === 'DELETE') {
        state.stats.deletedAccounts.push(accountId);
        return send(res, 200, {});
      }
    }

    // ---- POST /v1/connect/:project/actions/run ----
    const runMatch = path.match(/^\/v1\/connect\/([^/]+)\/actions\/run$/);
    if (runMatch && req.method === 'POST') {
      if (!hasBearer) return send(res, 401, { error: 'missing_bearer' });
      const body = await readJson(req);
      if (!body.external_user_id || !body.id || body.configured_props === undefined) {
        return send(res, 400, { error: 'invalid_run_request' });
      }
      state.stats.runCalls += 1;
      state.lastRun = { id: body.id, external_user_id: body.external_user_id, configured_props: body.configured_props };
      const errMatch = /^error-(\d{3})$/.exec(String(body.id));
      if (errMatch) {
        return send(res, Number(errMatch[1]), { error: { message: 'simulated provider error' } });
      }
      return send(res, 200, {
        exports: {},
        os: [],
        ret: { ok: true, ranAction: body.id },
      });
    }

    return send(res, 404, { error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    stats: state.stats,
    get lastRun() {
      return state.lastRun;
    },
    setAccounts(list) {
      state.accounts = list;
    },
    reset() {
      state.stats.tokenCalls = 0;
      state.stats.runCalls = 0;
      state.stats.tokenIssued = 0;
      state.stats.deletedAccounts = [];
      state.accounts = [{ id: 'apn_mock1', app: 'slack', name: 'Slack Workspace' }];
      state.lastRun = null;
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
