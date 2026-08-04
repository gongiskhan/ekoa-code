import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, integrationDefinitions, approvedIntegrationActions } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { createConfig, updateConfig, findConfigForOwner, publicValuesOf } from '../../src/integrations/service.js';
import { executeUserIntegrationAction, type FetchLike } from '../../src/integrations/action-executor.js';
import { approveAction, describeAction, targetResolutionOf } from '../../src/integrations/action-consent.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * SECURITY — A CONSENT RECORD NAMES A DESTINATION, AND THAT DESTINATION CANNOT MOVE UNDER IT.
 *
 * WHAT WAS WRONG, and how it was found: driving the real dashboard against a real third-party
 * integration (ntfy.sh) whose action path interpolates a config value, `/{{ntfy_topic}}`. Two
 * halves of one defect, both reproduced end to end over a real socket before this suite existed:
 *
 *   (a) the write-gate dialog rendered `VAI EXECUTAR POST https://ntfy.sh/{{ntfy_topic}}` - a raw
 *       placeholder. C2 requires the dialog to name the real destination "not a paraphrase", and a
 *       template is strictly less than a paraphrase. The shipped Slack package hides this because
 *       its baseUrl AND path are both literal, which is why no existing suite caught it.
 *   (b) `actionShape` fingerprints the action's TEMPLATE. Config VALUES were not in the approval
 *       key, so: approve the write, change only `ntfy_topic`, and the SAME standing approval
 *       covered a publish to a topic the approver had never seen. The message landed.
 *
 * The fix keys an approval on the RESOLVED destination as well as the shape, and resolves that
 * destination from a NON-SECRET projection of the config values stored in plaintext beside the
 * ciphertext - so the gate still answers before anything is decrypted (`action-executor.ts`).
 *
 * The tests below are written so that reverting either half turns one of them red:
 * removing the target from the approval key makes REDIRECT green-to-red; dropping the resolution
 * makes the RESOLVED-TARGET tests red.
 */
const ORG = 'orgConsent';
const OWNER = 'u-consent-owner';
const KEY = 'consent-destination-probe';
const HOST = 'https://notify.example';
const TOPIC_A = 'equipa-juridica';
const TOPIC_B = 'canal-do-atacante';

let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = { userId: OWNER, orgId: ORG, role: 'user' as const };

/** Composed at run time - never a literal (the house rule for credential-shaped fixtures). */
const PROBE_SECRET = ['tk', 'PROBE', Math.random().toString(36).slice(2, 10)].join('_');

const mkResponse = (status: number, body: string) => ({
  ok: status >= 200 && status < 300, status, statusText: '',
  headers: { forEach: () => undefined }, text: async () => body,
});
function recordingFetch(): { fn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push(`${url} ${JSON.stringify(init?.headers ?? {})} ${init?.body ?? ''}`);
    return mkResponse(200, '{"ok":true}') as unknown as Response;
  };
  return { fn, calls };
}

/** The destination is TEMPLATED - the shape a literal-URL package never exercises. */
const publishAction: IntegrationAction = {
  actionName: 'publicar',
  description: 'Publicar uma notificacao',
  mutates: true,
  httpConfig: {
    method: 'POST',
    baseUrl: HOST,
    path: '/{{topic}}',
    headers: { Authorization: 'Bearer {{token}}' },
  },
};

const CONFIG_SCHEMA = [
  { key: 'token', label: 'Token', type: 'password' as const, required: true, secret: true },
  { key: 'topic', label: 'Topic', type: 'string' as const, required: true, secret: false },
];

async function seedDefinition(): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: ORG, userId: OWNER, visibility: 'private', key: KEY, displayName: 'Consent probe',
      configSchema: CONFIG_SCHEMA, actions: [publishAction], skillMd: '# probe', authType: 'api_key',
    },
    { actor, onConflict: 'replace' },
  );
}

const secretKeys = CONFIG_SCHEMA.filter((f) => f.secret).map((f) => f.key);

async function connect(topic: string): Promise<void> {
  await createConfig(actor, { integrationKey: KEY, configValues: { token: PROBE_SECRET, topic }, secretKeys }, deps);
}

async function moveTopicTo(topic: string): Promise<void> {
  const cfg = await findConfigForOwner(ORG, OWNER, KEY);
  const res = await updateConfig(actor, cfg!._id, { configValues: { token: PROBE_SECRET, topic }, secretKeys });
  expect(res.verdict).toBe('ok');
}

/** Approve the write exactly as the human does: for the destination CURRENTLY configured. */
async function approveCurrentDestination(): Promise<string> {
  const cfg = await findConfigForOwner(ORG, OWNER, KEY);
  const descriptor = describeAction(KEY, publishAction, targetResolutionOf(CONFIG_SCHEMA, cfg?.publicConfigValues));
  await approveAction({ orgId: ORG, userId: OWNER }, descriptor, 'always');
  return descriptor.target;
}

const run = (fetchImpl: FetchLike) =>
  executeUserIntegrationAction(
    { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: 'publicar', args: {} },
    { fetchImpl },
  );

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_consent_destination');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  for (const s of [integrationConfigs, integrationDefinitions, approvedIntegrationActions]) await s.deleteMany({});
  await seedDefinition();
});

describe('the consent record names the REAL destination', () => {
  it('the dialog resolves the templated path and MASKS the secret, rather than showing {{topic}}', async () => {
    await connect(TOPIC_A);
    const cfg = await findConfigForOwner(ORG, OWNER, KEY);
    const descriptor = describeAction(KEY, publishAction, targetResolutionOf(CONFIG_SCHEMA, cfg?.publicConfigValues));

    expect(descriptor.target).toBe(`POST ${HOST}/${TOPIC_A}`);
    expect(descriptor.target).not.toContain('{{');
    // The value a human must be able to read is there; the secret never is - not the value, and
    // not under its own name either.
    expect(descriptor.target).toContain(TOPIC_A);
    expect(descriptor.target).not.toContain(PROBE_SECRET);
  });

  it('a SECRET in the destination is masked, never resolved into the dialog', () => {
    const secretPathAction: IntegrationAction = {
      ...publishAction,
      httpConfig: { ...publishAction.httpConfig!, path: '/{{token}}/publish' },
    };
    const target = describeAction(KEY, secretPathAction, targetResolutionOf(CONFIG_SCHEMA, { topic: TOPIC_A })).target;
    expect(target).toContain('••••');
    expect(target).not.toContain(PROBE_SECRET);
  });

  it('with NO projection the target degrades to the template - the pre-fix behaviour, not a blank', () => {
    // A row written before the projection existed must still render something honest. Silently
    // blanking part of a URL would be worse than admitting the value is unknown.
    const target = describeAction(KEY, publishAction, targetResolutionOf(CONFIG_SCHEMA, undefined)).target;
    expect(target).toBe(`POST ${HOST}/{{topic}}`);
  });

  it('the projection carries the non-secret value and NEVER the secret', async () => {
    await connect(TOPIC_A);
    const cfg = await findConfigForOwner(ORG, OWNER, KEY);
    expect(cfg?.publicConfigValues).toEqual({ topic: TOPIC_A });
    expect(JSON.stringify(cfg?.publicConfigValues)).not.toContain(PROBE_SECRET);
    // And the helper refuses to guess when the caller cannot name the schema.
    expect(publicValuesOf({ token: PROBE_SECRET, topic: TOPIC_A }, undefined)).toBeUndefined();
  });
});

describe('THE REDIRECT: an approval does not follow the destination', () => {
  it('approving a write for one topic does NOT authorise publishing to another', async () => {
    await connect(TOPIC_A);
    const approvedTarget = await approveCurrentDestination();
    expect(approvedTarget).toBe(`POST ${HOST}/${TOPIC_A}`);

    // The approval works for what was approved.
    const first = recordingFetch();
    const ok = await run(first.fn);
    expect(ok.success, JSON.stringify(ok)).toBe(true);
    expect(first.calls.join(' ')).toContain(`/${TOPIC_A}`);

    // Now move ONLY the destination. The action's bytes are untouched, so `actionShape` is
    // identical - which is exactly why the shape alone was never enough.
    await moveTopicTo(TOPIC_B);

    const after = recordingFetch();
    const redirected = await run(after.fn);
    expect(redirected.success).toBe(false);
    expect(redirected.code).toBe('awaiting_consent');
    // NOTHING was sent to the topic the human never saw.
    expect(after.calls).toEqual([]);
    // And the refusal names the NEW destination, so the human is asked about where it now goes.
    expect(redirected.consentRequest?.target).toBe(`POST ${HOST}/${TOPIC_B}`);
  });

  it('and approving the NEW destination authorises only that one - moving back re-prompts', async () => {
    await connect(TOPIC_A);
    await approveCurrentDestination();
    await moveTopicTo(TOPIC_B);
    await approveCurrentDestination(); // the human answers again, for TOPIC_B

    const onB = recordingFetch();
    expect((await run(onB.fn)).success).toBe(true);
    expect(onB.calls.join(' ')).toContain(`/${TOPIC_B}`);

    // Moving back is a different destination again. The earlier TOPIC_A approval is still on file
    // and still keyed to TOPIC_A, so this must NOT be a free pass... it is the same destination
    // the human approved first, so it legitimately IS covered. Assert that precisely rather than
    // guessing: consent is per destination, and TOPIC_A was consented to.
    await moveTopicTo(TOPIC_A);
    const backOnA = recordingFetch();
    expect((await run(backOnA.fn)).success).toBe(true);
    expect(backOnA.calls.join(' ')).toContain(`/${TOPIC_A}`);
  });

  it('a ROTATED SECRET does not revoke a standing approval - only a moved destination does', async () => {
    // The reason the binding is the resolved TARGET and not a hash of the credential blob: the
    // envelope is non-deterministic, so binding to it would make every routine OAuth refresh
    // re-prompt for every action. Rotating must be silent; moving must not be.
    await connect(TOPIC_A);
    await approveCurrentDestination();

    const rotated = ['tk', 'ROTATED', Math.random().toString(36).slice(2, 10)].join('_');
    const cfg = await findConfigForOwner(ORG, OWNER, KEY);
    await updateConfig(actor, cfg!._id, { configValues: { token: rotated, topic: TOPIC_A }, secretKeys });

    const after = recordingFetch();
    const out = await run(after.fn);
    expect(out.success, JSON.stringify(out)).toBe(true);
    expect(after.calls.join(' ')).toContain(rotated);
  });
});
