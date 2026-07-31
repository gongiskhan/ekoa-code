import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { OPERATION_IDS, OPERATIONS } from '../src/client.js';

/**
 * CLIENT DRIFT, inside the ordinary test run.
 *
 * `npm run gate:client-drift` exists as a root script, but CI's per-gate list is a fixed set of
 * steps; riding the vitest suite is how the OpenAPI drift gate solved the same problem
 * (api/tests/contract/openapi-drift.test.ts), so the committed client is checked by `npm test`
 * with no separate lane to remember.
 */
const exec = promisify(execFile);
const SPEC = fileURLToPath(new URL('../../../docs/openapi/cortex.v1.json', import.meta.url));
const CHECK = fileURLToPath(new URL('../scripts/check-client-drift.mjs', import.meta.url));

describe('generated client vs docs/openapi/cortex.v1.json', () => {
  it('regenerates byte-identically (a spec change that skipped the client fails here)', async () => {
    const { stdout } = await exec(process.execPath, [CHECK], { encoding: 'utf8' });
    expect(stdout).toContain('clean');
  });

  it('covers every operation the spec declares, with its declared method, path and statuses', () => {
    const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as {
      paths: Record<string, Record<string, { operationId: string; 'x-ekoa-success-statuses'?: number[]; responses: Record<string, unknown> }>>;
    };
    const declared = new Map<string, { method: string; path: string; statuses: number[] }>();
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const statuses =
          op['x-ekoa-success-statuses'] ??
          Object.keys(op.responses)
            .map(Number)
            .filter((s) => s >= 200 && s < 300);
        declared.set(op.operationId, { method: method.toUpperCase(), path, statuses });
      }
    }
    expect(new Set(OPERATION_IDS)).toEqual(new Set(declared.keys()));
    for (const [id, expected] of declared) {
      const row = OPERATIONS[id as keyof typeof OPERATIONS];
      expect(row.method, id).toBe(expected.method);
      expect(row.path, id).toBe(expected.path);
      expect([...row.successStatuses], id).toEqual(expected.statuses);
    }
  });
});
