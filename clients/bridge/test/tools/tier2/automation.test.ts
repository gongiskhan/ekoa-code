import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EgressLedger, type AutomationLedgerRow } from '../../../src/ledger/index.js';
import { bash, browse, AutomationEnablement, Tier2Error, type Tier2Context } from '../../../src/tools/tier2/index.js';
import { parseTaskProgram } from '../../../src/engine/index.js';

/**
 * Tier-2 automation smoke + structural gates (ADR-002, build-only). One smoke per tool proves the
 * round trip; the rest prove the tier is OFF by default, ledgered, env-scrubbed, and UNREACHABLE from
 * a file-tier program. This is the tier's whole test surface this run — deliberately not expanded.
 */
let dir: string;
let ledger: EgressLedger;
let enablement: AutomationEnablement;
const SESSION = 'sess-auto';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ekoa-tier2-'));
  ledger = new EgressLedger(dir);
  enablement = new AutomationEnablement();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function ctx(over: Partial<Tier2Context> = {}): Tier2Context {
  return { ledger, enablement, session: SESSION, taskId: 'task-1', now: () => 1_700_000_000_000, ...over };
}
const autoRows = () => ledger.readAll(SESSION).rows.filter((r): r is AutomationLedgerRow => r.kind === 'automation');

describe('Tier-2 is OFF by default and refuses (ledgered) until enabled', () => {
  it('bash on a non-enabled session → Tier2Error(disabled) + a ledgered denial with the full command', async () => {
    await expect(bash(ctx(), 'echo hello')).rejects.toBeInstanceOf(Tier2Error);
    const row = autoRows().at(-1);
    expect(row).toMatchObject({ tool: 'bash', outcome: 'denied', detail: 'echo hello' });
  });

  it('browser on a non-enabled session → Tier2Error(disabled) + ledgered denial with the target', async () => {
    await expect(browse(ctx(), 'https://example.com')).rejects.toBeInstanceOf(Tier2Error);
    expect(autoRows().at(-1)).toMatchObject({ tool: 'browser', outcome: 'denied', detail: 'https://example.com' });
  });
});

describe('Tier-2 is structurally unreachable from a file-tier program (S3)', () => {
  it('a TaskProgram naming bash / browser does not parse (the file-tier schema has no such step)', () => {
    expect(parseTaskProgram(JSON.stringify({ v: 1, steps: [{ tool: 'bash', command: 'echo x' }] }))).toBeNull();
    expect(parseTaskProgram(JSON.stringify({ v: 1, steps: [{ tool: 'browser', url: 'http://x' }] }))).toBeNull();
  });
});

describe('bash smoke — enabled session', () => {
  it('runs a command and ledgers it (the delegation round trip for the tier)', async () => {
    enablement.enable(SESSION);
    const r = await bash(ctx(), 'echo ekoa-bridge-ok');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('ekoa-bridge-ok');
    expect(autoRows().at(-1)).toMatchObject({ tool: 'bash', outcome: 'ran', exitCode: 0 });
  });

  it('scrubs the environment — a secret in the daemon env does NOT reach the child', async () => {
    enablement.enable(SESSION);
    process.env.EKOA_SECRET_TEST = 'super-secret-value';
    try {
      const r = await bash(ctx(), 'echo "[$EKOA_SECRET_TEST]"');
      expect(r.stdout).toContain('[]'); // the var is unset in the scrubbed child env
      expect(r.stdout).not.toContain('super-secret-value');
    } finally {
      delete process.env.EKOA_SECRET_TEST;
    }
  });

  it('a non-zero exit is captured (not thrown) and ledgered', async () => {
    enablement.enable(SESSION);
    const r = await bash(ctx(), 'exit 3');
    expect(r.exitCode).toBe(3);
    expect(autoRows().at(-1)).toMatchObject({ tool: 'bash', outcome: 'ran', exitCode: 3 });
  });

  it('a command that exceeds the timeout is killed and ledgered as timeout', async () => {
    enablement.enable(SESSION);
    await expect(bash(ctx(), 'sleep 5', { timeoutMs: 200 })).rejects.toMatchObject({ reason: 'timeout' });
    expect(autoRows().at(-1)).toMatchObject({ tool: 'bash', outcome: 'timeout' });
  }, 10_000);
});

describe('browser smoke — enabled session (skips if chromium is not installed)', () => {
  it('navigates to a data: URL and reads its title, ledgered with the target', async () => {
    enablement.enable(SESSION);
    const dataUrl = 'data:text/html,<title>Ekoa%20Bridge%20Smoke</title><body>hello from the browser tier</body>';
    let r;
    try {
      r = await browse(ctx(), dataUrl, { timeoutMs: 15_000 });
    } catch (err) {
      // Build-only tier: if the chromium binary is unavailable in this environment, the one smoke
      // skips honestly rather than failing the gate (the code path is still typechecked + linted).
      const msg = err instanceof Error ? err.message : String(err);
      if (/Executable doesn't exist|launch failed|install/i.test(msg)) {
        return;
      }
      throw err;
    }
    expect(r.title).toBe('Ekoa Bridge Smoke');
    expect(r.text).toContain('hello from the browser tier');
    expect(autoRows().at(-1)).toMatchObject({ tool: 'browser', outcome: 'ran' });
  }, 30_000);
});
