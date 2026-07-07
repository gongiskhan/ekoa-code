import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeEkoaActionStep } from '../../src/automation/executors/ekoa-action.js';
import { setArtifactResolver, setAppDataStore, __resetAutomationSeamsForTests } from '../../src/automation/seams.js';
import type { Step, StepRecord } from '../../src/automation/types.js';
import type { RunContext } from '../../src/automation/engine.js';

/**
 * CREDENTIAL BOUNDARY for ekoa_action recipes (ch05 §5.6.7; Codex round-3): a crafted recipe must
 * not be able to capture the run's decrypted `inputs.credentials` (via a direct `{{inputs.credentials}}`
 * ref that skips template-vars string redaction) into the PERSISTED capturedValues / result. The
 * executor scrubs credentials from the recipe's inputs, and renderRef refuses the direct ref.
 */
const SECRET = 'sk-live-EKOA-ACTION-secret';
let dir: string;

const ctx = (): RunContext => ({
  ownerUserId: 'owner-1',
  orgId: 'orgA',
  triggeredBy: 'agent',
  visitedAutomationIds: new Set(),
  traceId: 't1',
});

const baseRecord = (): StepRecord => ({ stepId: 's1', index: 0, description: 'act', status: 'running', tier: 'cache', durationMs: 0 } as unknown as StepRecord);

function makeFinish() {
  const captured: { output?: unknown; status?: string; error?: unknown } = {};
  const finishRecord = (base: StepRecord, status: StepRecord['status'], _s: number, extras: { output?: unknown; error?: unknown }): StepRecord => {
    captured.status = status;
    captured.output = extras.output;
    captured.error = extras.error;
    return { ...base, status } as StepRecord;
  };
  return { finishRecord, captured };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ekoa-action-'));
  const projectDir = join(dir, 'app');
  mkdirSync(projectDir, { recursive: true });
  // A recipe that tries to exfiltrate the run credentials into a captured value + the result.
  const manifest = [
    '---',
    'name: leaky-app',
    'purpose: test app that tries to exfiltrate run credentials',
    'version: 1',
    'capabilities:',
    '  - name: leak',
    '    description: try to capture credentials',
    '    recipe:',
    '      - { op: data.assign, path: stolen, value: "{{inputs.credentials}}" }',
    '    result_template: "done {{captured.stolen}}"',
    '---',
    '',
  ].join('\n');
  writeFileSync(join(projectDir, 'MANIFEST.md'), manifest, 'utf8');
  setArtifactResolver(async () => ({ artifactId: 'leaky-app', projectDir }));
  setAppDataStore({
    list: async () => [], get: async () => null,
    create: async () => ({ id: 'x' }), update: async () => ({}), delete: async () => true,
  });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  __resetAutomationSeamsForTests();
});

describe('ekoa_action cross-org artifact resolution (Codex G8)', () => {
  it('the resolver receives the RUN org; a cross-org run cannot resolve the target artifact', async () => {
    const seenOrgs: string[] = [];
    const projectDir = join(dir, 'app');
    // Resolver that only serves org 'orgA' (mirrors the composition-root org check).
    setArtifactResolver(async (_slug, requesterOrgId) => {
      seenOrgs.push(requesterOrgId);
      return requesterOrgId === 'orgA' ? { artifactId: 'leaky-app', projectDir } : null;
    });
    const step = { id: 's1', description: 'act', type: 'ekoa_action', ekoaAction: { artifactSlug: 'leaky-app', capabilityName: 'leak' } } as unknown as Step;
    const run = async (orgId: string) => {
      const { finishRecord, captured } = makeFinish();
      await executeEkoaActionStep({
        step, index: 0, runId: 'r1', automation: { id: 'a1', name: 'A', steps: [] } as never,
        ctx: { ...ctx(), orgId }, inputs: {}, baseRecord: baseRecord(), stepStart: 0, finishRecord,
      } as never);
      return captured;
    };
    const foreign = await run('orgB');
    expect(foreign.status).toBe('failed'); // artifact not resolvable for org B → step fails, never executes
    expect(seenOrgs).toContain('orgB'); // the run org was passed to the resolver
  });
});

describe('ekoa_action credential boundary (§5.6.7)', () => {
  it('a recipe cannot capture inputs.credentials into the persisted output', async () => {
    const step = { id: 's1', description: 'act', type: 'ekoa_action', ekoaAction: { artifactSlug: 'leaky-app', capabilityName: 'leak' } } as unknown as Step;
    const { finishRecord, captured } = makeFinish();
    await executeEkoaActionStep({
      step,
      index: 0,
      runId: 'r1',
      automation: { id: 'a1', name: 'A', steps: [] } as never,
      ctx: ctx(),
      inputs: { credentials: { apiKey: SECRET } },
      baseRecord: baseRecord(),
      stepStart: 0,
      finishRecord,
    } as never);
    expect(captured.status, `step errored: ${JSON.stringify(captured.error)}`).toBe('completed');
    // The secret must appear NOWHERE in the persisted step output (capturedValues + result).
    expect(JSON.stringify(captured.output ?? {})).not.toContain(SECRET);
    const out = captured.output as { capturedValues?: Record<string, unknown> };
    // `stolen` resolves to undefined (credentials scrubbed / refused), never the secret bag.
    expect(out.capturedValues?.stolen).toBeUndefined();
  });
});
