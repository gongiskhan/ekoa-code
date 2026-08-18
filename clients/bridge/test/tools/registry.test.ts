import { describe, it, expect } from 'vitest';
import { tier1Registry, TIER1_TOOL_NAMES } from '../../src/tools/index.js';

/**
 * STRUCTURAL S3/S5 parity (mirrors the fake-daemon adversarial reflection): the Tier-1 vocabulary is
 * EXACTLY the seven file tools (read/list/glob/grep/stat/write/extract_text) and exposes NO
 * execution/exfiltration verb. This is asserted by reflection over the registry object — the same way
 * the adversarial suite proves the daemon exposes no way to run a command or upload bytes from the
 * file tier.
 */
const FORBIDDEN_VERBS = [
  'exec',
  'command',
  'shell',
  'spawn',
  'run',
  'local_command',
  'bash',
  'upload',
  'fetch',
  'http',
  'network',
  'eval',
];

describe('tier1Registry — exactly the seven file tools', () => {
  const EXPECTED = ['extract_text', 'glob', 'grep', 'list', 'read', 'stat', 'write'];
  it('has precisely {read, list, glob, grep, stat, write, extract_text}', () => {
    expect(Object.keys(tier1Registry).sort()).toEqual(EXPECTED);
    expect([...TIER1_TOOL_NAMES].sort()).toEqual(EXPECTED);
  });

  it('every registered member is a callable tool', () => {
    for (const name of TIER1_TOOL_NAMES) {
      expect(typeof (tier1Registry as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

describe('tier1Registry — no execution/exfiltration verb is reachable (S3/S5 by reflection)', () => {
  it('exposes none of the forbidden verbs as own or inherited members', () => {
    const bag = tier1Registry as unknown as Record<string, unknown>;
    for (const verb of FORBIDDEN_VERBS) {
      expect(bag[verb]).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(tier1Registry, verb)).toBe(false);
    }
  });

  it('no registered tool name matches an execution/exfiltration verb', () => {
    for (const name of Object.keys(tier1Registry)) {
      expect(FORBIDDEN_VERBS).not.toContain(name);
    }
  });
});
