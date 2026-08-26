/**
 * test/integration/helpers/boot.ts — boots the REAL Cortex bridge in-process (from `api/dist`) and
 * wires OUR daemon (BridgeSocket + DaemonRuntime) as the dialing client, so the whole delegation path
 * runs against real Cortex code: task minting/signing, the WS bridge server, the anonymisation
 * chokepoint, and the audit sink. It mirrors the api suite's own
 * `api/tests/fake-daemon/correlation-join.test.ts` composition (attachBridgeServer +
 * createProviderHandler over proxyGatewayMessages, `__setTransportForTests` payload capture,
 * `setAuditSink` correlation ids), replacing the fake daemon with our real modules.
 *
 * This harness loads the api by its BUILT dist rather than its source, which is deliberate: it is
 * the artifact a deployed Cortex actually runs, and loading it through the ordinary module loader
 * keeps this package a plain consumer of the api rather than an importer of api source (the
 * clients/ import boundary in .eslintrc.cjs forbids the latter). `api/dist` is produced by
 * `npm run build` at the repo root; when it is absent the suites skip (see ekoaCodeAvailable), so
 * CI carries an explicit guard step asserting the entrypoints exist before running this lane.
 */
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** clients/bridge */
const PACKAGE_ROOT = path.resolve(HERE, '..', '..', '..');
/**
 * The monorepo root - where `api/dist`, `shared/dist` and the hoisted `node_modules` live. It used
 * to be a SIBLING checkout (this package had its own repository), which is why EKOA_CODE_DIR
 * exists; in-repo the default is simply two levels up and the env var is only an escape hatch for
 * running the canary against a different checkout.
 */
const EKOA_CODE_DIR = process.env.EKOA_CODE_DIR ? path.resolve(process.env.EKOA_CODE_DIR) : path.resolve(PACKAGE_ROOT, '..', '..');
const API_DIST = path.join(EKOA_CODE_DIR, 'api', 'dist');

export const ekoaCodeAvailable =
  existsSync(path.join(API_DIST, 'bridge', 'server.js')) &&
  existsSync(path.join(API_DIST, 'llm', 'anonymise', 'index.js')) &&
  // The attended-ceremony live-stream lane (D-CEREMONY-STREAM) loads these two dist entrypoints in
  // addition to the bridge server; require them here so a stale/partial dist skips the whole lane
  // rather than testing yesterday's Cortex (a green-but-meaningless run, harness.risks #1).
  existsSync(path.join(API_DIST, 'streaming', 'ceremony-stream.js')) &&
  existsSync(path.join(API_DIST, 'routes', 'cofre.js'));

/** Dynamic-import an ekoa-code dist module by its api/dist-relative path (untyped — cast per use). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function imp(rel: string): Promise<any> {
  return import(pathToFileURL(path.join(API_DIST, rel)).href);
}

export interface DelegationResultShape {
  status: 'ok' | 'unreachable' | 'cap_reached' | 'denied';
  answer?: string;
  citations: { path: string; range: string }[];
  ledgerRefs: string[];
  telemetry: { egressBytes: number; maskedCounts: Record<string, number> };
}

export interface Captured {
  /** Every outbound Anthropic payload the chokepoint tried to send (serialized), for masking asserts. */
  outbound: string[];
  /** correlationIds the anon-audit recorded (the hosted half of the S6 join). */
  auditIds: string[];
  /** ledger_row frames the server received from the daemon (the local half of the join). */
  ledgerRows: { taskId: string; correlationId: string; path: string }[];
}

/** The Cofre item VIEW fields the ceremony lane asserts on (a subset of the api's CofreItem). */
export interface CeremonyCofreItemView {
  id: string;
  type: string;
  label: string;
  state: string;
  boundOrigins: string[];
}

export interface Cortex {
  port: number;
  captured: Captured;
  /** CEREMONY LANE ONLY. Cortex-side ceremony-stream log lines (requestId-only; never a frame/keystroke). */
  ceremonyStreamLogs?: string[];
  registerPairing(input: { pairingId: string; org: string; ownerUserId: string }): Promise<void>;
  revokePairing(pairingId: string): Promise<void>;
  setActivation(userId: string, s: { active: boolean; billingLocked: boolean }): void;
  mintBridgeToken(sub: string, pairingId: string): string;
  /**
   * The pairing's OWN task-signing secret, straight out of the registry (Cofre R-8). This is what
   * Cortex signs a DelegatedTask with, and what a real daemon learns from `POST /bridge/token`.
   * The harness used to hand out the platform-wide `jwtSecret` instead, which is not the signing
   * key for anything any more - so its daemon verified every task against the wrong secret.
   */
  getPairingSigningSecret(pairingId: string, org: string): Promise<string | null>;
  /** A platform JWT for a user, so a test can drive the REAL owner-bound mint over HTTP. */
  platformToken(userId: string, org: string): string;
  delegateToLocal(actor: { userId: string; orgId: string; sessionId: string }, req: { task: string; grantRefs: string[]; budget: { egressBytes: number; modelSpend: { userId: string } } }): Promise<DelegationResultShape>;
  /** The deny-listed party value planted in the org ruleset (must be tokenized in outbound payloads). */
  readonly party: string;
  /** CEREMONY LANE ONLY (`opts.ceremony`). The owner's Cofre items, for the session-item assertion. */
  listCofreItems?(actor: { userId: string; orgId: string; role: string }, now: number): Promise<CeremonyCofreItemView[]>;
  /** CEREMONY LANE ONLY. Count of open server-side ceremonies (L2: no leaked second ceremony). */
  openCeremonyCount?(): number;
  /** CEREMONY LANE ONLY. Whether the pairing row advertises a capability yet — POLL this after `hello`
   *  (the hello handler awaits `registerPairing`, so the row updates asynchronously; harness.risks #3). */
  advertisesCapability?(pairingId: string, capability: string): Promise<boolean>;
  /** CEREMONY LANE ONLY. Reset the three ceremony registries (streams, consumed tokens, ceremonies)
   *  between scenarios for deterministic isolation. */
  resetCeremonyState?(): void;
  teardown(): Promise<void>;
}

/** A canned de-tokenizable completion so the chokepoint returns a fixed answer we can assert on. */
function cannedCompletionBody(text: string): string {
  return JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
}

/**
 * Boot Cortex with the real chokepoint, an org ruleset whose deny-list contains `party`, an audit
 * sink that records correlation ids, and a transport that CAPTURES every outbound payload. Returns the
 * handles the tests drive. The provider handler is bound to a fixed pairing/org so the daemon's
 * provider_request resolves without a full session/pairing DB round trip (as correlation-join does).
 */
export async function bootCortex(opts: {
  pairingId: string;
  org: string;
  ownerUserId: string;
  party: string;
  /** Mount the attended-ceremony live-stream surface (D-CEREMONY-STREAM): the cofre router at
   *  `/api/v1/cofre`, `attachCeremonyStreamServer`, and the `onCeremonyFrame`/`onCeremonyEnded`
   *  injections on `attachBridgeServer` — a line-for-line mirror of the production composition at
   *  `api/src/server.ts` boot. Off by default so the existing round-trip lane is untouched. */
  ceremony?: boolean;
}): Promise<Cortex> {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-integration';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key';
  // `streaming/ceremony-stream.js` reads EKOA_STREAMING_ALLOWED_ORIGINS at MODULE LOAD (harness.risks
  // #4): a value leaking from the shell would 403 the originless `ws` test client at upgrade. Clear it
  // before the first `imp()` so the module loads with an empty allow-list (the production default).
  delete process.env.EKOA_STREAMING_ALLOWED_ORIGINS;

  const config = await imp('config.js');
  config.__resetConfigForTests();
  config.loadConfig();

  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  const mongo = await imp('data/mongo.js');
  await mongo.connectMongo(mem.getUri(), 'ekoa_bridge_int');

  const activation = await imp('data/activation.js');
  const token = await imp('bridge/token.js');
  const jwt = await imp('auth/jwt.js');
  const bridgeRoutes = await imp('routes/bridge.js');
  const serverMod = await imp('bridge/server.js');
  const registry = await imp('bridge/registry.js');
  const delegation = await imp('bridge/delegation.js');
  const providerMod = await imp('bridge/provider.js');
  const clientMod = await imp('llm/client.js');
  const credsMod = await imp('llm/credentials.js');
  const anonMod = await imp('llm/anonymise/index.js');

  // Reset all injectable Cortex state (a clean slate per boot).
  activation.__resetActivationForTests();
  registry.__resetLiveConnectionsForTests();
  delegation.__resetPendingDelegationsForTests();
  credsMod.__resetCredentialsForTests();
  clientMod.__resetOrgResolverForTests();
  anonMod.__resetRulesetResolverForTests();
  anonMod.__resetVaultForTests();
  anonMod.__resetAuditForTests();

  // CEREMONY LANE (opts.ceremony). Load the streaming + cofre dist modules through the SAME `imp()`
  // loader as everything else, so `openCeremonyStream` (reached inside the cofre router) and
  // `pushCeremonyFrame` (injected into the bridge server below) resolve to ONE module-cache instance
  // and therefore ONE `sessions` registry (harness.risks #7). Reset the three per-process registries.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let streaming: any;
  let streamingAuthMod: any;
  let cofreMod: any;
  let attendedMod: any;
  let cofreRouterFactory: ((deps: { now: () => number; genId: () => string }) => any) | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const resetCeremonyRegistries = (): void => {
    streaming.__resetCeremonyStreamsForTest();
    streamingAuthMod.__resetConsumedStreamTokensForTests();
    attendedMod.__resetCeremoniesForTests();
  };
  if (opts.ceremony) {
    streaming = await imp('streaming/ceremony-stream.js');
    streamingAuthMod = await imp('streaming/auth.js');
    attendedMod = await imp('bridge/attended.js');
    cofreMod = await imp('cofre/index.js');
    const cofreRoutesMod = await imp('routes/cofre.js');
    cofreRouterFactory = cofreRoutesMod.cofreRouter;
    resetCeremonyRegistries();
  }

  const captured: Captured = { outbound: [], auditIds: [], ledgerRows: [] };
  /** Cortex-side ceremony-stream log lines (requestId-only by contract; never a frame or keystroke). */
  const ceremonyStreamLogs: string[] = [];

  // A provider credential (oauth) so the chokepoint has something to bill against.
  await credsMod.setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 });
  clientMod.setOrgResolver(async () => opts.org);
  anonMod.setRulesetResolver((orgId: string) => ({ orgId, denyList: [opts.party] }));
  anonMod.setAuditSink({
    write: (_actor: unknown, meta: { correlationId?: unknown }) => {
      if (typeof meta.correlationId === 'string') captured.auditIds.push(meta.correlationId);
    },
  });
  // Capture the outbound Anthropic payload; return a de-tokenizable canned completion.
  clientMod.__setTransportForTests({
    async *streamAgent() {
      yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false };
    },
    async oneShot() {
      return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    },
    async messages(p: { payload: unknown }) {
      captured.outbound.push(JSON.stringify(p.payload));
      return { status: 200, headers: {}, body: cannedCompletionBody('resumo derivado (sem dados sensíveis)') };
    },
  });

  // The REST half. The bridge WS server owns `upgrade`; Express owns ordinary requests, so the
  // daemon's pre-dial `POST /api/v1/bridge/token` hits the REAL owner-gated route (requireAuth ->
  // registry lookup -> signingSecret + org) instead of a stub the harness could get wrong. Express
  // is resolved out of ekoa-code's own node_modules - this repo does not depend on it.
  const expressMod = await import(pathToFileURL(path.join(EKOA_CODE_DIR, 'node_modules', 'express', 'index.js')).href);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const express = ((expressMod as any).default ?? expressMod) as any;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/bridge', bridgeRoutes.bridgeTokenRouter());
  if (opts.ceremony) {
    // The Cofre REST surface, mounted next to the bridge-token router exactly as the production app
    // does. `POST /sessions/establish` and `/sessions/capture` drive the ceremony rail.
    app.use('/api/v1/cofre', cofreRouterFactory!({ now: () => Date.now(), genId: () => randomUUID() }));
  }

  const httpServer: Server = createServer(app);
  const handle = serverMod.attachBridgeServer(httpServer, {
    resolveUserOrg: async () => opts.org,
    onLedgerRow: (taskId: string, row: { correlationId: string; path: string }) => captured.ledgerRows.push({ taskId, correlationId: row.correlationId, path: row.path }),
    provider: providerMod.createProviderHandler({
      resolvePairingByCredential: async () => ({ pairingId: opts.pairingId, org: opts.org, ownerUserId: opts.ownerUserId }),
      resolveSessionOrg: async () => opts.org,
      getActivation: () => ({ active: true, billingLocked: false }),
      runCompletion: (body: Record<string, unknown>, billee: string, correlationId: string) => clientMod.proxyGatewayMessages(body, billee, correlationId),
    }),
    // D-CEREMONY-STREAM: the exact injection the production composition root makes
    // (`api/src/server.ts` boot) — relay a ceremony's live frames to its dashboard viewer, and tear
    // the view down when the login completes (or is refused). `pushCeremonyFrame`/`closeCeremonyStream`
    // come from the SAME streaming module the cofre router's `openCeremonyStream` writes to.
    ...(opts.ceremony
      ? {
          onCeremonyFrame: streaming.pushCeremonyFrame,
          onCeremonyEnded: (requestId: string) => streaming.closeCeremonyStream(requestId),
        }
      : {}),
  });
  // The ceremony media channel WS server (path-scoped upgrade on the same HTTP server). Both this and
  // the bridge server register their own `upgrade` listener scoped to their own path prefix, so the
  // attach order is irrelevant.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ceremonyWss: any;
  if (opts.ceremony) {
    // The streaming module logs by requestId ONLY (never a frame or a keystroke) — capture those
    // lines so the never-logged assertion can scan Cortex's side of the channel too.
    ceremonyWss = streaming.attachCeremonyStreamServer(httpServer, {
      log: (event: string, fields: Record<string, unknown>) => ceremonyStreamLogs.push(`${event} ${JSON.stringify(fields)}`),
    });
  }
  await new Promise<void>((r) => httpServer.listen(0, () => r()));
  const port = (httpServer.address() as { port: number }).port;

  return {
    port,
    captured,
    ceremonyStreamLogs,
    party: opts.party,
    async registerPairing(input) {
      await registry.registerPairing(input);
    },
    async revokePairing(pairingId) {
      await registry.revokePairing(pairingId);
    },
    setActivation(userId, s) {
      activation.setActivation(userId, s);
    },
    mintBridgeToken(sub, pairingId) {
      return token.mintBridgeToken({ sub }, pairingId).token as string;
    },
    async getPairingSigningSecret(pairingId, org) {
      return (await registry.getPairingSigningSecret(pairingId, org)) as string | null;
    },
    platformToken(userId, org) {
      return jwt.signToken({ sub: userId, role: 'user', scope: 'user', orgId: org, username: userId }).token as string;
    },
    async delegateToLocal(actor, req) {
      return (await delegation.delegateToLocal(actor, req)) as DelegationResultShape;
    },
    ...(opts.ceremony
      ? {
          async listCofreItems(actor: { userId: string; orgId: string; role: string }, now: number): Promise<CeremonyCofreItemView[]> {
            return (await cofreMod.listCofreItems(actor, now)) as CeremonyCofreItemView[];
          },
          openCeremonyCount(): number {
            return attendedMod.__openCeremonyCount() as number;
          },
          async advertisesCapability(pairingId: string, capability: string): Promise<boolean> {
            return (await registry.advertisesCapability(pairingId, capability)) as boolean;
          },
          resetCeremonyState(): void {
            resetCeremonyRegistries();
          },
        }
      : {}),
    async teardown() {
      if (opts.ceremony) {
        // Close any lingering viewer sockets and the WS server BEFORE the http server, so a forked
        // worker does not linger on an open socket (harness.risks #9).
        streaming.__resetCeremonyStreamsForTest();
        ceremonyWss?.close();
      }
      await handle.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
      clientMod.__resetTransportForTests();
      await mongo.closeMongo();
      await mem.stop();
    },
  };
}
