import { describe, it, expect } from 'vitest';
import { referencesContextLine } from '../../src/agents/context.js';

/** s6 (FC-400/D4) — reference tokens become ONE context line with real grantRefs. */
describe('referencesContextLine', () => {
  it('renders nothing for absent/empty references', () => {
    expect(referencesContextLine(undefined)).toBe('');
    expect(referencesContextLine([])).toBe('');
  });

  it('renders one PT line naming the tool and every ref with its label', () => {
    const line = referencesContextLine([
      { grantRef: 'g-abc', label: 'Contratos 2026' },
      { grantRef: 'g-def', label: 'kyc-ficha.pdf' },
    ]);
    expect(line).toContain('Autorizações locais ativas nesta sessão');
    expect(line).toContain('delegate_to_local');
    expect(line).toContain('g-abc ("Contratos 2026")');
    expect(line).toContain('g-def ("kyc-ficha.pdf")');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('escapes double quotes in labels (no broken quoting in the prompt line)', () => {
    const line = referencesContextLine([{ grantRef: 'g-x', label: 'pasta "sensível"' }]);
    expect(line).toContain(`g-x ("pasta 'sensível'")`);
  });
});
