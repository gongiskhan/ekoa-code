import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EKOA_BRIDGE } from '../src/placeholder.js';
import { DAEMON_VERSION } from '../src/version.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('scaffold', () => {
  it('toolchain runs', () => {
    expect(EKOA_BRIDGE).toBe(true);
  });

  it('DAEMON_VERSION matches package.json', () => {
    // The version travels to Cortex in the `hello` frame and is what an operator reads when asked to
    // update a machine, so a constant that drifts from the published package would make the machine
    // list lie about which build is running.
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
    expect(DAEMON_VERSION).toBe(pkg.version);
  });
});
