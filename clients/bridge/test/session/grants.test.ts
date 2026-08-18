import { describe, it, expect } from 'vitest';
import { GrantTable } from '../../src/session/index.js';

/**
 * Session-scoped grant resolution (S2, §18.5.1 step 6). A grantRef resolves ONLY for the session
 * that owns it; an unknown ref and a foreign-session ref both resolve to undefined (the verifier
 * denies both as "unknown or foreign-session grant"). Harness parity: daemon.ts `grantFor`.
 */
describe('GrantTable — session-scoped grant resolution (S2)', () => {
  it('resolves a grant only for the session that owns it', () => {
    const t = new GrantTable([{ grantRef: 'g1', root: '/r', session: 's1' }]);
    expect(t.grantFor('g1', 's1')).toMatchObject({ grantRef: 'g1', session: 's1' });
    expect(t.grantFor('g1', 's2')).toBeUndefined(); // foreign session
    expect(t.grantFor('nope', 's1')).toBeUndefined(); // unknown ref
  });

  it('add appends and list reflects insertion order', () => {
    const t = new GrantTable();
    expect(t.list()).toHaveLength(0);
    t.add({ grantRef: 'g1', root: '/r1', session: 's1' });
    t.add({ grantRef: 'g2', root: '/r2', session: 's2' });
    expect(t.list()).toHaveLength(2);
    expect(t.grantFor('g2', 's2')).toMatchObject({ root: '/r2' });
  });

  it('does not cross sessions even for identical grantRefs', () => {
    const t = new GrantTable([
      { grantRef: 'shared', root: '/a', session: 's1' },
      { grantRef: 'shared', root: '/b', session: 's2' },
    ]);
    expect(t.grantFor('shared', 's1')?.root).toBe('/a');
    expect(t.grantFor('shared', 's2')?.root).toBe('/b');
  });

  it('copies its initial array so external mutation cannot change the table', () => {
    const initial = [{ grantRef: 'g1', root: '/r', session: 's1' }];
    const t = new GrantTable(initial);
    initial.push({ grantRef: 'g2', root: '/x', session: 's1' });
    expect(t.list()).toHaveLength(1);
    expect(t.grantFor('g2', 's1')).toBeUndefined();
  });
});
