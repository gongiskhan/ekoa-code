import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadDemoSpecs,
  getDemoSpec,
  listDemoCards,
  validateDemoSpec,
  resetDemoCache,
  demosDir,
  type DemoSpec,
} from '../../src/services/demo-registry.js';

/**
 * Demo registry (carryover): loads and validates demo tour specs from the demos
 * directory, and lookup by appId works. The specs directory is env-configurable
 * via EKOA_DEMOS_DIR.
 */

const validSpec: DemoSpec = {
  version: 1,
  appId: 'gestor-clientes',
  card: { titlePt: 'Gestor de Clientes', descriptionPt: 'Uma visita guiada', durationSec: 60 },
  steps: [
    { id: 's1', type: 'navigate', to: '/' },
    {
      id: 's2',
      type: 'await-action',
      target: '#novo',
      event: 'click',
      simulate: { actions: [{ kind: 'click', target: '#novo' }] },
    },
    { id: 's3', type: 'spotlight', target: '#lista', copy: { titlePt: 'Lista', bodyPt: 'Aqui estao os clientes' } },
  ],
};

describe('demo-registry', () => {
  const prev = process.env.EKOA_DEMOS_DIR;
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'demos-'));
    process.env.EKOA_DEMOS_DIR = dir;
    writeFileSync(join(dir, 'gestor.json'), JSON.stringify(validSpec), 'utf-8');
    // Skipped: leading-underscore schema doc.
    writeFileSync(join(dir, '_schema.json'), JSON.stringify({ note: 'doc' }), 'utf-8');
    // Excluded: invalid spec (missing steps) — logged and dropped, never crashes.
    writeFileSync(join(dir, 'broken.json'), JSON.stringify({ version: 1, appId: 'x', card: validSpec.card }), 'utf-8');
  });
  beforeEach(() => resetDemoCache());
  afterAll(() => {
    if (prev === undefined) delete process.env.EKOA_DEMOS_DIR;
    else process.env.EKOA_DEMOS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the specs directory from EKOA_DEMOS_DIR', () => {
    expect(demosDir()).toBe(dir);
  });

  it('loads only the valid spec (skips _-prefixed and invalid files)', () => {
    const specs = loadDemoSpecs(true);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.appId).toBe('gestor-clientes');
  });

  it('looks up a full spec by appId and lists cards', () => {
    expect(getDemoSpec('gestor-clientes')?.card.titlePt).toBe('Gestor de Clientes');
    expect(getDemoSpec('nope')).toBeNull();
    expect(listDemoCards()).toEqual([{ appId: 'gestor-clientes', card: validSpec.card }]);
  });

  it('validateDemoSpec accepts a valid spec and rejects malformed ones', () => {
    expect(validateDemoSpec(validSpec).valid).toBe(true);

    // await-action without a simulate is rejected (mandatory field).
    const noSimulate = {
      ...validSpec,
      steps: [{ id: 's1', type: 'await-action', target: '#x', event: 'click' }],
    };
    expect(validateDemoSpec(noSimulate).valid).toBe(false);

    // select action without value or index is rejected (enforced in superRefine).
    const badSelect = {
      ...validSpec,
      steps: [
        {
          id: 's1',
          type: 'await-action',
          target: '#sel',
          event: 'result-ready',
          simulate: { actions: [{ kind: 'select', target: '#sel' }] },
        },
      ],
    };
    const res = validateDemoSpec(badSelect);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toContain('value');
  });
});
