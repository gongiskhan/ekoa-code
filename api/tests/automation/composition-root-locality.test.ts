import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Browser, BrowserContext } from 'playwright';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings, bridgeCapabilityGrants } from '../../src/data/stores.js';
import { registerPairing, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import { grantCapability } from '../../src/bridge/capability-grants.js';
import {
  loadEgressCandidates,
  getLocalBrowserContext,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { machineRetired, type EgressCandidate } from '../../src/automation/egress-policy.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';

/**
 * THE COMPOSITION ROOT'S P4 BINDINGS, under test.
 *
 * WHY THIS FILE EXISTS. P4 made two seam BODIES drivable - `localBrowserContextProviderUsing` came
 * out of an inline closure in `server.ts` precisely so a test could reach it, and
 * `egressCandidatesForOrg` was always a plain function - and then bound them in `server.ts` with
 * one line each. The untestable line moved one call up: every automation suite installs its OWN
 * seam (`setEgressCandidateResolver` / `setLocalBrowserContextProvider`) before exercising the
 * engine, which overrides whatever the composition root did, so NOTHING observed the real
 * bindings. Both survived deletion with 383 files / 4922 tests green:
 *
 *   - Delete `setEgressCandidateResolver(...)` and `loadEgressCandidates` falls back to
 *     `async () => null`. `null` means THIS PROCESS DOES NOT KNOW what the org has, so
 *     `fleetIsKnownEmpty` is never true and `machineRetired` always answers no - BOTH terminal
 *     branches this branch added become unreachable and the unbounded neutral retry is back.
 *   - Revert `setLocalBrowserContextProvider` to the pre-P4 closure and `proxyOptionFor` is never
 *     applied: every run that resolved a machine route silently leaves from the datacenter while
 *     every decision above it reports success.
 *
 * A clean deletion takes the imports with it, so lint and typecheck stay silent too. The assertions
 * below are therefore deliberately about the REAL implementations rather than about "a function is
 * installed": the resolver must actually answer from the registry (`[]` for an org with no
 * machines, which is the statement `null` cannot make), and the provider must actually render the
 * proxy onto `newContext`.
 */
let mem: MongoMemoryServer;
let seq = 0;
const ORG = 'orgA';
const TAILNET = 'http://100.64.0.7:1080';
const cfg: Config = {
  port: 0,
  jwtSecret: 's',
  encryptionKey: 'k',
  nodeEnv: 'test',
  llmChokepointBaseUrl: 'http://127.0.0.1:0/api/v1/llm',
  llm: defaultLlmConfig(),
};

/** Every `newContext` the composition root's provider asked for, with its options. */
const CONTEXTS: Array<Record<string, unknown> | undefined> = [];
const fakeContext = { __marker: 'ctx' } as unknown as BrowserContext;
const recordingBrowser = {
  newContext: async (options?: Record<string, unknown>) => {
    CONTEXTS.push(options);
    return fakeContext;
  },
} as unknown as Browser;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_composition_root_p4');
  // The seams start at their honest DEFAULTS - a null fleet and a provider that throws "not wired".
  // Everything below is what `buildApp` did to them, and nothing here re-binds either.
  __resetAutomationSeamsForTests();
  buildApp(cfg, { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}`, openBrowser: async () => recordingBrowser });
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

/** Exactly what `engine.ts` `knownPairingsNow` does with the listing this seam answers. */
const knownPairings = (listing: EgressCandidate[] | null): readonly string[] | null =>
  listing?.map((c) => c.pairingId) ?? null;

beforeEach(async () => {
  CONTEXTS.length = 0;
  await bridgePairings.deleteMany({});
  await bridgeCapabilityGrants.deleteMany({});
  __resetLiveConnectionsForTests();
});

describe('the egress-candidate resolver is bound to the real registry', () => {
  it('answers an EMPTY LISTING for an org with no machines - the statement the unbound default cannot make', async () => {
    const listing = await loadEgressCandidates(ORG);
    // `null` would be the unbound seam answering "I do not know", and the difference is the whole
    // of this branch's terminal-halt work: only a resolver that actually asked the registry may say
    // "this org has nothing".
    expect(listing).not.toBeNull();
    expect(listing).toEqual([]);
    expect(machineRetired('pair_gone', knownPairings(listing))).toBe(true);
  });

  it('answers the org\'s OWN machines, carrying the advertised-and-granted intersection', async () => {
    await registerPairing({
      pairingId: 'pair_home',
      org: ORG,
      ownerUserId: 'u1',
      capabilities: ['egress.residential', 'local.bash'],
      egressEndpoint: TAILNET,
    });
    await grantCapability({
      orgId: ORG,
      pairingId: 'pair_home',
      capability: 'egress.residential',
      egressEndpoint: TAILNET,
      grantedByUserId: 'admin1',
    });

    const listing = await loadEgressCandidates(ORG);
    expect(listing).toEqual([
      { pairingId: 'pair_home', org: ORG, capabilities: ['egress.residential'], egressEndpoint: TAILNET, live: false },
    ]);
    // A registered machine is NOT retired; the same listing answers both questions, which is why
    // binding this seam is what makes the terminal branches reachable at all.
    expect(machineRetired('pair_home', knownPairings(listing))).toBe(false);
    expect(machineRetired('pair_gone', knownPairings(listing))).toBe(true);
  });

  it('is org-scoped by construction - another tenant\'s machine is not in the listing', async () => {
    await registerPairing({ pairingId: 'theirs', org: 'orgB', ownerUserId: 'u9', capabilities: ['egress.residential'], egressEndpoint: TAILNET });
    expect(await loadEgressCandidates(ORG)).toEqual([]);
  });
});

describe('the local-browser context provider is bound to the real one', () => {
  it('renders a MACHINE resolution onto the launch options - the proxy actually reaches newContext', async () => {
    const ctx = await getLocalBrowserContext('u1', { outcome: 'machine', pairingId: 'pair_home', proxyUrl: TAILNET });
    expect(ctx).toBe(fakeContext);
    // The pre-P4 closure built `browser.newContext()` and dropped the route on the floor: the run
    // would leave from the datacenter while every decision above it reported a residential route.
    expect(CONTEXTS).toEqual([{ proxy: { server: TAILNET } }]);
  });

  it('leaves the datacenter route exactly as it was - no proxy option at all', async () => {
    await getLocalBrowserContext('u1', { outcome: 'datacenter', reason: 'no-requirement' });
    await getLocalBrowserContext('u1');
    expect(CONTEXTS).toEqual([{}, {}]);
  });

  it('is NON-PERSISTENT: the root hands back newContext, never a persistent profile', async () => {
    // `session-establishment.ts` calls `context.storageState()` right after a login and stores the
    // result as a credential-equivalent Cofre item. Against a persistent per-owner profile that is
    // a capture of the owner's WHOLE cross-site cookie jar.
    expect('launchPersistentContext' in (recordingBrowser as unknown as Record<string, unknown>)).toBe(false);
    await getLocalBrowserContext('u1');
    expect(CONTEXTS.length).toBe(1);
  });
});
