import { describe, it, expect } from 'vitest';
import { AutomationMigrationEntry } from '@ekoa/shared';
import {
  classifyAutomation,
  migrationBootSummary,
  pauseIsReachable,
  MIGRATION_SCAN_CAP,
} from '../../src/automation/migration-report.js';
import type { Automation, Step } from '../../src/automation/types.js';

/**
 * Slice S7 - the migration CLASSIFIER, driven directly.
 *
 * WHAT IS BEING PINNED, and why each half matters on its own:
 *
 *  1. THE TIER. `flatten` is a claim that one `api_call` step fits WHOLE inside
 *     `IntegrationActionHttpConfig`, and every property of that shape which the step could exceed is
 *     a separate case below. A classifier that flattened optimistically would produce a report an
 *     operator plans real work from, naming automations that cannot in fact become one request.
 *
 *  2. THE COST. `engineInternal` and `degradations` are the half a "migration plan" normally loses.
 *     The three losses are asserted as ABSENT where they do not apply and PRESENT where they do,
 *     because a field that is always populated says nothing and a field that is never populated is
 *     indistinguishable from one that is not wired.
 *
 * Every entry is additionally validated against the shared wire schema: the classifier's output IS
 * the endpoint's body, and a field the schema does not know would otherwise reach the wire untyped.
 */

type StoredAutomation = Automation & { orgId: string; visibility?: 'private' | 'org' };

let seq = 0;
function automation(steps: Step[], over: Partial<StoredAutomation> = {}): StoredAutomation {
  seq += 1;
  return {
    id: `auto_${seq}`,
    name: `Automation ${seq}`,
    description: 'goal',
    steps,
    ownerUserId: 'ownerA',
    orgId: 'orgA',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function apiCallStep(apiRequest: NonNullable<Step['apiRequest']>, over: Partial<Step> = {}): Step {
  return { id: 's1', description: 'call it', type: 'api_call', apiRequest, ...over };
}

/** Classify and assert the entry is a shape the wire schema accepts, then hand it back. */
function classify(doc: StoredAutomation, reservedKeys: ReadonlySet<string> = new Set<string>()) {
  const entry = classifyAutomation(doc, reservedKeys);
  const parsed = AutomationMigrationEntry.safeParse(entry);
  expect(parsed.success, `entry must validate against the shared schema: ${JSON.stringify(entry)}`).toBe(true);
  return entry;
}

const GOOD_GET = { method: 'GET' as const, url: 'https://api.example.test/v1/things/{{input.id}}' };

describe('S7 classifier - tier 1: the automations that flatten into one request', () => {
  it('a single api_call step with a literal origin and an input hole flattens, with no refusals', () => {
    const entry = classify(automation([apiCallStep(GOOD_GET)]));
    expect(entry.tier).toBe('flatten');
    expect(entry.flattenRefusals).toEqual([]);
    expect(entry.stepCount).toBe(1);
  });

  it('a JSON object body is substitutable and still flattens', () => {
    const entry = classify(
      automation([
        apiCallStep({
          method: 'POST',
          url: 'https://api.example.test/v1/things',
          bodyKind: 'json',
          body: JSON.stringify({ name: '{{input.name}}', tag: 'fixed' }),
        }),
      ]),
    );
    expect(entry.tier).toBe('flatten');
    expect(entry.flattenRefusals).toEqual([]);
  });

  it('a flatten carries NO degradation about pauses: a single request has no browser to pause on', () => {
    const entry = classify(automation([apiCallStep(GOOD_GET)], { visibility: 'private' }));
    expect(entry.degradations).toEqual([]);
    expect(entry.engineInternal).toEqual([]);
  });
});

describe('S7 classifier - why an automation cannot flatten, one property of the action shape at a time', () => {
  it('two steps: not one request', () => {
    const entry = classify(automation([apiCallStep(GOOD_GET), apiCallStep(GOOD_GET, { id: 's2' })]));
    expect(entry.tier).toBe('wrap');
    expect(entry.flattenRefusals).toContain('not-single-step');
  });

  it('no steps at all is still not one request, and is not a crash', () => {
    const entry = classify(automation([]));
    expect(entry.tier).toBe('wrap');
    expect(entry.flattenRefusals).toEqual(expect.arrayContaining(['not-single-step', 'step-not-api-call']));
    expect(entry.stepCount).toBe(0);
  });

  it('a browser step is not an api_call', () => {
    const entry = classify(automation([{ id: 's1', description: 'click', type: 'browser' }]));
    expect(entry.flattenRefusals).toContain('step-not-api-call');
  });

  it('HEAD has no spelling in the action http config', () => {
    const entry = classify(automation([apiCallStep({ method: 'HEAD', url: 'https://api.example.test/v1/ping' })]));
    expect(entry.flattenRefusals).toContain('method-unrepresentable');
  });

  // REVIEW ROUND F22: the OPTIONS half of the documented refusal appeared only inside the
  // collect-every-reason fixture, whose assertions were satisfied by its OTHER refusals - so adding
  // OPTIONS to the allowed set reddened nothing. A single-property case, mirroring HEAD's.
  it('OPTIONS has none either, and it is the only property this fixture varies', () => {
    const entry = classify(automation([apiCallStep({ method: 'OPTIONS', url: 'https://api.example.test/v1/ping' })]));
    expect(entry.flattenRefusals).toContain('method-unrepresentable');
  });

  it('a template hole in the HOST refuses: a baseUrl is not a place to discover a host', () => {
    const entry = classify(automation([apiCallStep({ method: 'GET', url: 'https://{{input.host}}/v1/things' })]));
    expect(entry.flattenRefusals).toContain('origin-not-literal');
  });

  it('a relative URL refuses for the same reason', () => {
    const entry = classify(automation([apiCallStep({ method: 'GET', url: '/v1/things' })]));
    expect(entry.flattenRefusals).toContain('origin-not-literal');
  });

  it('a hole in the PATH does not refuse: that is exactly what becomes an action arg', () => {
    const entry = classify(automation([apiCallStep({ method: 'GET', url: 'https://api.example.test/v1/{{input.id}}/x' })]));
    expect(entry.flattenRefusals).not.toContain('origin-not-literal');
  });

  it('a form body has no bodyTemplate spelling', () => {
    const entry = classify(
      automation([apiCallStep({ method: 'POST', url: 'https://api.example.test/v1/things', bodyKind: 'form', body: 'a=1' })]),
    );
    expect(entry.flattenRefusals).toContain('body-not-json-object');
  });

  it('a JSON body with a hole in VALUE position does not parse as the object the action would carry', () => {
    const entry = classify(
      automation([
        apiCallStep({ method: 'POST', url: 'https://api.example.test/v1/things', bodyKind: 'json', body: '{"n": {{input.n}}}' }),
      ]),
    );
    expect(entry.flattenRefusals).toContain('body-not-json-object');
  });

  it('a capture hole names a value an earlier step produced, and a one-request action has not run one', () => {
    const entry = classify(automation([apiCallStep({ method: 'GET', url: 'https://api.example.test/v1/{{capture.id}}' })]));
    expect(entry.flattenRefusals).toContain('capture-holes');
  });

  it('credentials from two integrations leave no single destination key', () => {
    const entry = classify(
      automation([
        apiCallStep({
          method: 'GET',
          url: 'https://api.example.test/v1/things',
          headers: { 'x-one': '{{integration.alpha.token}}', 'x-two': '{{integration.beta.token}}' },
        }),
      ]),
    );
    expect(entry.flattenRefusals).toContain('multiple-credential-sources');
    expect(entry.destinationIntegrationKey).toBeUndefined();
  });

  it('credentials from ONE integration flatten, and that integration IS the destination', () => {
    const entry = classify(
      automation([
        apiCallStep({
          method: 'GET',
          url: 'https://api.example.test/v1/things',
          authIntegrationKey: 'alpha',
          headers: { authorization: 'Bearer {{integration.alpha.token}}' },
        }),
      ]),
    );
    expect(entry.tier).toBe('flatten');
    expect(entry.destinationIntegrationKey).toBe('alpha');
  });

  it('an auth-shaped header with a literal value refuses, and the report never carries the value', () => {
    const planted = ['not', 'a', 'real', 'token'].join('-');
    const entry = classify(
      automation([apiCallStep({ method: 'GET', url: 'https://api.example.test/v1/things', headers: { Authorization: `Bearer ${planted}` } })]),
    );
    expect(entry.flattenRefusals).toContain('literal-auth-header');
    expect(JSON.stringify(entry)).not.toContain(planted);
  });

  it('the three auth-shaped header names are the planner\'s three, case-insensitively', () => {
    for (const name of ['Authorization', 'X-API-Key', 'x-auth-token']) {
      const entry = classify(
        automation([apiCallStep({ method: 'GET', url: 'https://api.example.test/v1/things', headers: { [name]: 'literal' } })]),
      );
      expect(entry.flattenRefusals, `${name} must be treated as auth-shaped`).toContain('literal-auth-header');
    }
  });

  // REVIEW ROUND F16. `IntegrationActionHttpConfig` has no timeout field and the action executor's
  // default is 30s, so a step declaring a different budget would silently change behaviour.
  it('a step timeout the action shape cannot carry refuses', () => {
    const entry = classify(
      automation([apiCallStep({ method: 'GET', url: 'https://api.example.test/v1/x', timeoutMs: 120_000 })]),
    );
    expect(entry.tier).toBe('wrap');
    expect(entry.flattenRefusals).toContain('timeout-unrepresentable');
  });

  it('a step declaring EXACTLY the action default agrees with it and does not refuse', () => {
    const entry = classify(
      automation([apiCallStep({ method: 'GET', url: 'https://api.example.test/v1/x', timeoutMs: 30_000 })]),
    );
    expect(entry.flattenRefusals).not.toContain('timeout-unrepresentable');
    expect(entry.tier).toBe('flatten');
  });

  it('a step declaring NO timeout is not refused: absence already agrees with the action default', () => {
    const entry = classify(automation([apiCallStep(GOOD_GET)]));
    expect(entry.flattenRefusals).not.toContain('timeout-unrepresentable');
  });

  // REVIEW ROUND F16, second half: a flatten verdict carrying engine-internal features was
  // self-contradictory - a flattened action has no wrapper to keep them in.
  it('a declaration the action shape has no vocabulary for refuses, and does not flatten while claiming engine-internals', () => {
    for (const declaration of [
      { credentialRefs: ['cofre:item-abc'] },
      { attended: true },
      { target: { kind: 'pinned' as const, pairingId: 'machine-1' } },
    ]) {
      const entry = classify(automation([apiCallStep(GOOD_GET, { declaration })]));
      expect(entry.flattenRefusals, JSON.stringify(declaration)).toContain('step-declaration-unrepresentable');
      expect(entry.tier).toBe('wrap');
      // The contradiction the refusal exists to prevent: engineInternal populated on a flatten.
      expect(entry.engineInternal.length).toBeGreaterThan(0);
    }
  });

  it('a bare step carries no declaration refusal, so the check is differential and not always-on', () => {
    const entry = classify(automation([apiCallStep(GOOD_GET)]));
    expect(entry.flattenRefusals).not.toContain('step-declaration-unrepresentable');
    expect(entry.engineInternal).toEqual([]);
  });

  // REVIEW ROUND F20: the engine's interpolator tolerates whitespace inside a hole, and so does this
  // module's own INTEGRATION_HOLE - but the literal-auth-header check used a plain substring, so one
  // header was counted as a credential SOURCE and reported as a LITERAL credential at the same time.
  it('a SPACED credential hole is a credential reference, not a literal, in both readers at once', () => {
    const entry = classify(
      automation([
        apiCallStep({
          method: 'GET',
          url: 'https://api.example.test/v1/things',
          headers: { authorization: 'Bearer {{ integration.alpha.token }}' },
        }),
      ]),
    );
    expect(entry.flattenRefusals).not.toContain('literal-auth-header');
    expect(entry.destinationIntegrationKey).toBe('alpha');
    expect(entry.tier).toBe('flatten');
  });

  it('collects EVERY reason rather than the first: an operator plans from the whole list', () => {
    const entry = classify(
      automation([
        apiCallStep({ method: 'OPTIONS', url: 'https://{{input.host}}/x', bodyKind: 'text', body: 'raw' }),
        apiCallStep(GOOD_GET, { id: 's2' }),
      ]),
    );
    expect(entry.flattenRefusals).toContain('not-single-step');
    expect(entry.flattenRefusals.length).toBeGreaterThan(1);
  });
});

describe('S7 classifier - tier 3: what the wrapper hides, named rather than dropped', () => {
  it('a sub_automation step is a graph the action surface does not model', () => {
    const entry = classify(automation([{ id: 's1', description: 'run other', type: 'sub_automation', subAutomationId: 'other' }]));
    expect(entry.engineInternal).toContain('sub-automation');
  });

  it('browser and verify steps carry the vision/rehearsal loop', () => {
    expect(classify(automation([{ id: 's1', description: 'click', type: 'browser' }])).engineInternal).toContain('rehearsal-vision');
    expect(classify(automation([{ id: 's1', description: 'check', type: 'verify' }])).engineInternal).toContain('rehearsal-vision');
  });

  it('a declaration credentialRef is a cofre reference the engine resolves at step time', () => {
    const entry = classify(
      automation([{ id: 's1', description: 'x', type: 'navigate', url: 'https://x.test', declaration: { credentialRefs: ['cofre:item-abc'] } }]),
    );
    expect(entry.engineInternal).toContain('credential-refs');
  });

  it('a local_command envRef is the same kind of reference, one field over', () => {
    const entry = classify(
      automation([
        {
          id: 's1',
          description: 'run',
          type: 'local_command',
          commandTemplate: { argv: ['echo', 'hi'], envRefs: { TOKEN: 'cofre:item-abc' } },
        },
      ]),
    );
    expect(entry.engineInternal).toContain('command-env-refs');
  });

  it('an off-cloud target and an attended step are both engine-internal', () => {
    const entry = classify(
      automation([
        {
          id: 's1',
          description: 'x',
          type: 'navigate',
          url: 'https://x.test',
          declaration: { target: { kind: 'pinned', pairingId: 'machine-1' }, attended: true },
        },
      ]),
    );
    expect(entry.engineInternal).toEqual(expect.arrayContaining(['off-cloud-target', 'attended-step']));
  });

  it('a manual trigger is not self-firing; a webhook trigger is', () => {
    const manual = classify(automation([apiCallStep(GOOD_GET)], { trigger: { kind: 'manual' } }));
    expect(manual.engineInternal).not.toContain('self-firing-trigger');
    expect(manual.degradations).not.toContain('trigger-not-carried');

    const fired = classify(
      automation([apiCallStep(GOOD_GET)], {
        trigger: { kind: 'webhook', triggerId: 't1', integrationKey: 'alpha', eventName: 'thing.created' },
      }),
    );
    expect(fired.engineInternal).toContain('self-firing-trigger');
    expect(fired.degradations).toContain('trigger-not-carried');
  });
});

describe('S7 classifier - the degradations, recorded and not hidden', () => {
  it('an org-visible automation narrows to its owner on the action rail; a private one has nothing to lose', () => {
    expect(classify(automation([apiCallStep(GOOD_GET)], { visibility: 'org' })).degradations).toContain('org-visible-narrows-to-owner');
    expect(classify(automation([apiCallStep(GOOD_GET)], { visibility: 'private' })).degradations).not.toContain(
      'org-visible-narrows-to-owner',
    );
  });

  // REVIEW ROUND F10. The narrowing is a property of the row the action LANDS ON, and the first cut
  // read only the automation's own visibility while its comment claimed otherwise. The class that
  // made it wrong is the one provisioning mass-mints: org-visible automations whose destination is a
  // SHIPPED package, which a builder save can never claim, so no fresh private row exists to narrow
  // onto. This is the case that distinguishes the two readings.
  it('an org-visible automation bound for a SHIPPED package does not narrow: a builder save cannot claim that key', () => {
    const entry = classify(
      automation([{ id: 's1', description: 'click', type: 'browser' }], {
        visibility: 'org',
        source: { integrationKey: 'citius', templateKey: 'notificacoes' },
      }),
      new Set(['citius']),
    );
    expect(entry.destinationIntegrationKey).toBe('citius');
    expect(entry.degradations).not.toContain('org-visible-narrows-to-owner');
  });

  it('the SAME automation narrows when its destination is a key a builder save could create', () => {
    const entry = classify(
      automation([{ id: 's1', description: 'click', type: 'browser' }], {
        visibility: 'org',
        source: { integrationKey: 'a-tenant-package', templateKey: 'x' },
      }),
      new Set(['citius']),
    );
    expect(entry.degradations).toContain('org-visible-narrows-to-owner');
  });

  it('an UNRESOLVED destination narrows: the honest default for an unmade decision is the cost', () => {
    const entry = classify(automation([{ id: 's1', description: 'click', type: 'browser' }], { visibility: 'org' }), new Set(['citius']));
    expect(entry.destinationIntegrationKey).toBeUndefined();
    expect(entry.degradations).toContain('org-visible-narrows-to-owner');
  });

  it('an ABSENT visibility is org-visible, exactly as the automation service reads it', () => {
    const entry = classify(automation([apiCallStep(GOOD_GET)]));
    expect(entry.visibility).toBe('org');
    expect(entry.degradations).toContain('org-visible-narrows-to-owner');
  });

  it('a wrapped automation with a browser step collapses its mid-run pause into a failure code', () => {
    const entry = classify(automation([{ id: 's1', description: 'log in', type: 'browser' }], { visibility: 'private' }));
    expect(entry.tier).toBe('wrap');
    expect(entry.degradations).toContain('mid-run-pause-collapses');
  });

  // REVIEW ROUND F15. This case used to be built from two `wait` steps - the one fixable-adjacent
  // type the engine refuses - so it passed against the buggy browser-only predicate AND against the
  // correct one. The counterexample that actually distinguishes them is a [navigate, verify]
  // automation: no browser step, and both types are ones `shouldAttemptFix` acts on.
  it('a [navigate, verify] automation pauses today, and the report says so (F15 counterexample)', () => {
    const entry = classify(
      automation(
        [
          { id: 's1', description: 'open', type: 'navigate', url: 'https://x.test' },
          { id: 's2', description: 'check', type: 'verify' },
        ],
        { visibility: 'private' },
      ),
    );
    expect(entry.tier).toBe('wrap');
    expect(entry.degradations).toContain('mid-run-pause-collapses');
  });

  it('a sub_automation step counts: the engine recurses and the child can pause the parent', () => {
    const entry = classify(
      automation(
        [
          { id: 's1', description: 'wait', type: 'wait', durationMs: 10 },
          { id: 's2', description: 'run other', type: 'sub_automation', subAutomationId: 'other' },
        ],
        { visibility: 'private' },
      ),
    );
    expect(entry.degradations).toContain('mid-run-pause-collapses');
  });

  it('an automation the fixer will never act on does not claim a pause it cannot reach', () => {
    const entry = classify(
      automation(
        [
          { id: 's1', description: 'wait', type: 'wait', durationMs: 10 },
          { id: 's2', description: 'call', type: 'integration', integrationKey: 'k', integrationAction: 'a' },
        ],
        { visibility: 'private' },
      ),
    );
    expect(entry.tier).toBe('wrap');
    expect(entry.degradations).not.toContain('mid-run-pause-collapses');
  });

  it('the reachable set IS the engine\'s fixable set, asserted directly rather than through one case', () => {
    for (const type of ['browser', 'verify', 'navigate', 'local_command', 'api_call', 'ekoa_action', 'sub_automation'] as const) {
      expect(pauseIsReachable([{ id: 's1', description: 'x', type }]), `${type} must reach the fixer`).toBe(true);
    }
    for (const type of ['wait', 'integration'] as const) {
      expect(pauseIsReachable([{ id: 's1', description: 'x', type }]), `${type} must NOT reach the fixer`).toBe(false);
    }
  });
});

describe('S7 classifier - provenance and the shape hash', () => {
  it('a provisioned automation belongs to the integration that provisioned it, whatever its steps do', () => {
    const entry = classify(
      automation([{ id: 's1', description: 'click', type: 'browser' }], { source: { integrationKey: 'citius', templateKey: 'notificacoes' } }),
    );
    expect(entry.destinationIntegrationKey).toBe('citius');
    expect(entry.source).toEqual({ integrationKey: 'citius', templateKey: 'notificacoes' });
  });

  it('the hash moves when the STEPS move and holds when only a rename does', () => {
    const base = automation([apiCallStep(GOOD_GET)], { id: 'stable', name: 'first' });
    const renamed = { ...base, name: 'second', updatedAt: '2026-08-09T00:00:00.000Z' };
    const edited = { ...base, steps: [apiCallStep({ ...GOOD_GET, url: 'https://api.example.test/v2/things' })] };

    expect(classify(renamed).shapeHash).toBe(classify(base).shapeHash);
    expect(classify(edited).shapeHash).not.toBe(classify(base).shapeHash);
  });
});

describe('S7 - the boot summary carries counts and no names', () => {
  it('names the mode and every tier, and no automation name reaches the line', () => {
    const line = migrationBootSummary({
      mode: 'report-only',
      generatedAt: '2026-08-22T00:00:00.000Z',
      scanned: 3,
      truncated: false,
      tiers: { flatten: 1, wrap: 2, engineInternalBehindWrappers: 2 },
      entries: [classifyAutomation(automation([apiCallStep(GOOD_GET)], { name: 'Faturas do mês' }))],
      errors: [],
    });
    expect(line).toContain('[automation-migration] mode report-only');
    expect(line).toContain('flatten 1');
    expect(line).toContain('wrap 2');
    expect(line).toContain('engine-internal behind wrappers 2');
    expect(line).not.toContain('Faturas');
  });

  it('says so when the scan was capped, so a count is never read as the whole estate', () => {
    const line = migrationBootSummary({
      mode: 'report-only',
      generatedAt: '2026-08-22T00:00:00.000Z',
      scanned: MIGRATION_SCAN_CAP,
      truncated: true,
      tiers: { flatten: 0, wrap: MIGRATION_SCAN_CAP, engineInternalBehindWrappers: 0 },
      entries: [],
      errors: [],
    });
    // The MECHANISM this sentence describes is driven for real in migration-report-scan.test.ts
    // (review round F24); this case only pins that the summary says so when it is true.
    expect(line).toContain('(capped)');
  });
});
