import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { anonymisationDenyLists } from '../../src/data/stores.js';
import { decryptForScope } from '../../src/data/crypto.js';
import {
  anonymize,
  deanonymize,
  resolveRuleset,
  setAuditSink,
  __resetAuditForTests,
  __resetVaultForTests,
  __resetRulesetResolverForTests,
  type AnonymiseContext,
} from '../../src/llm/anonymise/index.js';
import { addDenyListEntry, removeDenyListEntry, listDenyList, __resetDenyListCacheForTests } from '../../src/services/deny-list.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';

/**
 * F10 (batch-final s1) — the deny-list resolver WIRING. The anonymisation mechanism was always
 * tested by injecting a ruleset by hand; nothing asserted that the composition root loads the
 * per-org deny-list, so `setRulesetResolver` was never called and every org ran the default
 * EMPTY ruleset: a deny-listed firm party name went to the provider in cleartext (§17.4 (b)).
 *
 * These tests exercise the REAL wiring: buildApp() must install a store-backed resolver so
 * `resolveRuleset(orgId)` — the exact call the egress client makes at client.ts:167 — carries
 * the org's encrypted deny-list, and a deny-listed literal is tokenized at egress with the
 * §17.4(b)/D3 access-log count on the audit record.
 */
let mem: MongoMemoryServer; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
const actor = { userId: 'adm1', username: 'adm1', orgId: 'org1' };
const CAPTURED: Array<{ actor: unknown; metadata: Record<string, unknown> }> = [];

const ctx = (ruleset: Awaited<ReturnType<typeof resolveRuleset>>): AnonymiseContext => ({
  sessionId: 'sess-rr', correlationId: 'corr-rr', actor: { userId: 'u1', orgId: 'org1' }, ruleset,
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_ruleset_resolver');
  buildApp(cfg, deps); // the composition root under test: it must wire the store-backed resolver
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  CAPTURED.length = 0; __resetVaultForTests(); __resetAuditForTests(); __resetDenyListCacheForTests();
  await anonymisationDenyLists.deleteMany({});
  setAuditSink({ write: (a, metadata) => { CAPTURED.push({ actor: a, metadata }); } });
});
afterEach(() => { __resetVaultForTests(); __resetAuditForTests(); });

describe('F10: composition-root ruleset resolver is store-backed (was: never wired)', () => {
  it('resolveRuleset(org) carries the org deny-list ciphertext once an entry exists', async () => {
    await addDenyListEntry('org1', 'Sociedade Petrova Lda', 'PARTY', actor, deps);
    const ruleset = await resolveRuleset('org1');
    expect(ruleset.orgId).toBe('org1');
    expect(typeof ruleset.denyListCiphertext).toBe('string');
    expect(ruleset.denyListCiphertext).not.toContain('Petrova'); // encrypted, not plaintext
  });

  it('a deny-listed party name is TOKENIZED at egress and the access is audit-counted (§17.4 b, D3)', async () => {
    await addDenyListEntry('org1', 'Sociedade Petrova Lda', 'PARTY', actor, deps);
    const ruleset = await resolveRuleset('org1');
    const r = anonymize('Reunião com a Sociedade Petrova Lda amanhã', ctx(ruleset));
    expect(r.text).not.toContain('Sociedade Petrova Lda');
    expect(deanonymize(r.text, r.handle)).toContain('Sociedade Petrova Lda');
    const meta = CAPTURED.at(-1)!.metadata;
    expect(Number(meta.denyListAccessed)).toBeGreaterThanOrEqual(1);
  });

  it('an org with no entries resolves to a ruleset with NO deny-list fields (empty stays cheap)', async () => {
    const ruleset = await resolveRuleset('org-empty');
    expect(ruleset.denyListCiphertext).toBeUndefined();
    expect(ruleset.denyList).toBeUndefined();
  });

  it('a write invalidates the resolver cache: add -> visible, remove -> gone', async () => {
    const e = await addDenyListEntry('org1', 'Quinta do Vale Verde', 'PARTY', actor, deps);
    let ruleset = await resolveRuleset('org1');
    expect(ruleset.denyListCiphertext).toBeDefined();
    const r1 = anonymize('contrato da Quinta do Vale Verde', ctx(ruleset));
    expect(r1.text).not.toContain('Quinta do Vale Verde');

    await removeDenyListEntry('org1', e.id, actor, deps);
    __resetVaultForTests();
    ruleset = await resolveRuleset('org1');
    const r2 = anonymize('contrato da Quinta do Vale Verde', ctx(ruleset));
    expect(r2.text).toContain('Quinta do Vale Verde'); // no longer deny-listed
  });

  it('entries are org-scoped-encrypted AT REST (ch04 acceptance 11) and listed metadata-only', async () => {
    await addDenyListEntry('org1', 'Sociedade Petrova Lda', 'PARTY', actor, deps);
    const rows = (await anonymisationDenyLists.find({ orgId: 'org1' })) as Array<{ _id: string; value: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).not.toContain('Petrova'); // never plaintext at rest
    expect(decryptForScope(rows[0]!.value, 'org1')).toBe('Sociedade Petrova Lda');
    const listed = await listDenyList('org1');
    expect(JSON.stringify(listed)).not.toContain('Petrova'); // metadata only, never cleartext
  });
});
