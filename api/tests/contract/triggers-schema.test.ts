/**
 * Trigger schema contract (2A-S1): the shared `Trigger` schema gains `kind: 'webhook'|'listener'`
 * (absent ⇒ 'webhook', migration-free) + `pollConfig`. This validates that the REAL server-side
 * view builder (`events/service.ts` `triggerView`) emits a shape that parses against the extended
 * shared schema — for BOTH a listener trigger and a legacy (kind-absent) webhook trigger — and that
 * the schema rejects an out-of-enum `kind`. Pure (no Mongo): triggerView is a pure projection.
 */

import { describe, it, expect } from 'vitest';
import { Trigger, TriggerListResponse } from '@ekoa/shared';
import { triggerView, type TriggerDoc } from '../../src/events/service.js';

const BASE = 'https://api.example';

/** Build a TriggerDoc shell (only the view-relevant fields matter here). */
function doc(over: Partial<TriggerDoc>): TriggerDoc {
  return {
    _id: 'trg-1',
    ownerUserId: 'owner-1',
    orgId: 'orgA',
    integrationKey: 'microsoft-365',
    eventName: 'email.received',
    targetKind: 'artifact-backend',
    artifactId: 'art-1',
    entrypoint: 'onEmail',
    secretCiphertext: 'x',
    algorithm: 'hmac-sha256-hex',
    disabled: false,
    ...over,
  } as TriggerDoc;
}

describe('Trigger schema — listener kind + pollConfig (2A-S1)', () => {
  it('validates a listener trigger view (kind:listener + pollConfig)', () => {
    const view = triggerView(doc({ kind: 'listener', pollConfig: { actionName: 'list_emails', intervalMs: 60_000 } }), BASE);
    const parsed = Trigger.safeParse(view);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind).toBe('listener');
    expect(parsed.success && parsed.data.pollConfig).toEqual({ actionName: 'list_emails', intervalMs: 60_000 });
  });

  it('surfaces kind:webhook for a legacy (kind-absent) trigger — migration-free', () => {
    const legacy = doc({ integrationKey: 'stripe', eventName: 'payment', targetKind: 'automation', automationId: 'auto-1' });
    // A real legacy row has no `kind` field at all.
    delete (legacy as { kind?: unknown }).kind;
    const view = triggerView(legacy, BASE);
    expect(view.kind).toBe('webhook');
    expect('pollConfig' in view).toBe(false);
    const parsed = Trigger.safeParse(view);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind).toBe('webhook');
  });

  it('a NULL automationId is omitted, not emitted — zod .optional() rejects null', () => {
    // The shape a real row actually has: created against an ARTIFACT, so the automation target is
    // stored null rather than absent. `Id.optional()` accepts undefined and REJECTS null, so
    // passing it through failed TriggerListResponse on the client, tryCall reported not-ok, and the
    // webhooks store kept an empty array — the user saw "Ainda não existem webhooks" over a
    // populated database, with no error shown anywhere.
    //
    // Every fixture here previously set one target or the other, which is why a surface marked
    // COVERED in the schema-coverage gate still shipped this.
    const withNulls = doc({ integrationKey: 'whatsapp', eventName: 'message.received' }) as unknown as Record<string, unknown>;
    withNulls.automationId = null;
    const view = triggerView(withNulls as unknown as Parameters<typeof triggerView>[0], BASE);

    expect('automationId' in view).toBe(false);
    expect(Trigger.safeParse(view).success).toBe(true);
    expect(TriggerListResponse.safeParse({ items: [view] }).success).toBe(true);
  });

  it('a NULL artifactId is likewise omitted', () => {
    const withNulls = doc({ targetKind: 'automation', automationId: 'auto-1' }) as unknown as Record<string, unknown>;
    withNulls.artifactId = null;
    const view = triggerView(withNulls as unknown as Parameters<typeof triggerView>[0], BASE);
    expect('artifactId' in view).toBe(false);
    expect(Trigger.safeParse(view).success).toBe(true);
  });

  it('a mixed list of listener + webhook views validates against TriggerListResponse', () => {
    const items = [
      triggerView(doc({ kind: 'listener', pollConfig: { actionName: 'list_emails', intervalMs: 30_000 } }), BASE),
      triggerView(doc({ _id: 'trg-2', integrationKey: 'stripe', eventName: 'payment', targetKind: 'automation', automationId: 'a1' }), BASE),
    ];
    expect(TriggerListResponse.safeParse({ items }).success).toBe(true);
  });

  it('rejects an out-of-enum kind', () => {
    const bad = { ...triggerView(doc({}), BASE), kind: 'poller' };
    expect(Trigger.safeParse(bad).success).toBe(false);
  });
});
