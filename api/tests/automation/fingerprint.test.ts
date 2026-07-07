import { describe, it, expect } from 'vitest';
import { fingerprintFromParts, fingerprintKey } from '../../src/automation/fingerprint.js';

/**
 * Page fingerprint (carryover-audit A8) — ported verbatim from the old Cortex suite; only the
 * import path changes. The fingerprint is the automation cache key: stable across identical page
 * states, discriminating across same-shape SPA pages, never leaking text/attribute values.
 */
describe('page fingerprint', () => {
  const baseParts = {
    url: 'https://docs.google.com/document/d/abc/edit',
    title: 'My Important Doc',
    headingText: 'Project plan',
    shapeSketch: 'tags:body=1,div=20|roles:button=3|landmarks:2',
    viewport: { w: 1280, h: 800 },
  };

  it('produces the same fingerprint for identical inputs', () => {
    const a = fingerprintFromParts(baseParts);
    const b = fingerprintFromParts(baseParts);
    expect(a).toEqual(b);
  });

  it('discriminates same-shape pages with different titles (SPA cross-entity)', () => {
    const docA = fingerprintFromParts(baseParts);
    const docB = fingerprintFromParts({ ...baseParts, title: 'Another Doc' });

    expect(docA.titleHash).not.toBe(docB.titleHash);
    expect(fingerprintKey(docA)).not.toBe(fingerprintKey(docB));
  });

  it('discriminates same-shape pages with different headings', () => {
    const a = fingerprintFromParts(baseParts);
    const b = fingerprintFromParts({ ...baseParts, headingText: 'Different topic' });

    expect(a.headingHash).not.toBe(b.headingHash);
  });

  it('extracts the last non-empty path segment as pathSuffix', () => {
    const a = fingerprintFromParts({ ...baseParts, url: 'https://example.com/foo/bar/baz' });
    expect(a.pathSuffix).toBe('baz');

    const b = fingerprintFromParts({ ...baseParts, url: 'https://example.com/' });
    expect(b.pathSuffix).toBe('');

    const c = fingerprintFromParts({ ...baseParts, url: 'https://example.com/foo/' });
    expect(c.pathSuffix).toBe('foo');
  });

  it('preserves the URL origin separately from pathname', () => {
    const a = fingerprintFromParts(baseParts);
    expect(a.origin).toBe('https://docs.google.com');
    expect(a.pathname).toBe('/document/d/abc/edit');
  });

  it('treats title hashing as case-insensitive and trim-tolerant', () => {
    const a = fingerprintFromParts({ ...baseParts, title: '  My Doc  ' });
    const b = fingerprintFromParts({ ...baseParts, title: 'my doc' });
    expect(a.titleHash).toBe(b.titleHash);
  });

  it('domShapeHash changes when structural shape changes', () => {
    const a = fingerprintFromParts(baseParts);
    const b = fingerprintFromParts({ ...baseParts, shapeSketch: 'tags:body=1,div=99|roles:button=3|landmarks:2' });
    expect(a.domShapeHash).not.toBe(b.domShapeHash);
  });

  it('does not let textual content leak into domShapeHash directly (only via titleHash/headingHash)', () => {
    // Same shape sketch -> same domShapeHash even if title changes
    const a = fingerprintFromParts(baseParts);
    const b = fingerprintFromParts({ ...baseParts, title: 'Completely different title' });
    expect(a.domShapeHash).toBe(b.domShapeHash);
  });

  it('handles invalid URLs gracefully (does not throw)', () => {
    const a = fingerprintFromParts({ ...baseParts, url: 'not-a-url' });
    expect(a.origin).toBe('null'); // about:blank URL has 'null' origin in Node URL impl
    expect(a.pathname).toBe('blank');
  });

  it('fingerprintKey is deterministic and includes all components', () => {
    const a = fingerprintFromParts(baseParts);
    const key = fingerprintKey(a);
    expect(key).toContain(a.origin);
    expect(key).toContain(a.pathname);
    expect(key).toContain(a.titleHash);
    expect(key).toContain(a.headingHash);
    expect(key).toContain(a.domShapeHash);
    expect(key).toContain('1280x800');
  });

  it('different viewports produce different keys (responsive layouts cache separately)', () => {
    const desktop = fingerprintFromParts(baseParts);
    const mobile = fingerprintFromParts({ ...baseParts, viewport: { w: 375, h: 667 } });
    expect(fingerprintKey(desktop)).not.toBe(fingerprintKey(mobile));
  });

  it('identical content under different paths produces different keys', () => {
    const a = fingerprintFromParts({ ...baseParts, url: 'https://example.com/a/foo' });
    const b = fingerprintFromParts({ ...baseParts, url: 'https://example.com/b/foo' });
    expect(fingerprintKey(a)).not.toBe(fingerprintKey(b));
  });
});
