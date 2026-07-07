/**
 * Shared setup for the mongo-backed agents suite. Boots mongodb-memory-server, configures a
 * credential (so the SDK-env builder works), injects a fake transport (no live model), and resets
 * all in-memory seams/registry/config between tests. LLM-free by construction.
 */
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, __resetAgentsConfigForTests, loadConfig } from '../../src/config.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { __setTransportForTests, __resetTransportForTests, __resetOrgResolverForTests } from '../../src/llm/client.js';
import { __resetAttributionCountersForTests } from '../../src/llm/attribution.js';
import { __resetVaultForTests, __resetRulesetResolverForTests, __resetNerForTests, __resetAuditForTests } from '../../src/llm/anonymise/index.js';
import { __resetRegistryForTests } from '../../src/agents/registry.js';
import { __resetAgentSeamsForTests } from '../../src/agents/seams.js';
import { makeFakeTransport, type FakeTransport, type FakeTransportScript } from './_fake-transport.js';

let mem: MongoMemoryServer;

export async function bootAgentTestDb(dbName: string): Promise<void> {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), dbName);
  await setCredential({ mode: 'oauth', secret: 'oauth-tok-123' });
}

export async function shutdownAgentTestDb(): Promise<void> {
  await closeMongo();
  await mem.stop();
}

/** Reset all in-memory state and install a fresh fake transport. Returns the transport. */
export function resetAgentState(script: FakeTransportScript = {}): FakeTransport {
  __resetRegistryForTests();
  __resetAgentSeamsForTests();
  __resetAgentsConfigForTests();
  __resetAttributionCountersForTests();
  __resetOrgResolverForTests();
  __resetVaultForTests();
  __resetRulesetResolverForTests();
  __resetNerForTests();
  __resetAuditForTests();
  const t = makeFakeTransport(script);
  __setTransportForTests(t);
  return t;
}

export function restoreTransport(): void {
  __resetTransportForTests();
  __resetCredentialsForTests();
}

export async function seedUser(id: string, orgId: string): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'builder', orgId, active: true });
}
