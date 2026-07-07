import { describe, it, expect } from 'vitest';
import { MarkerProcessor, scanProviderError, looksLikeProviderError, BUILD_MARKER, INTEGRATION_MARKER } from '../../src/agents/markers.js';

/**
 * Marker machinery (ch05 §5.7.2) + provider-error scanners (§5.3.7). No marker — partial or
 * whole, including split across chunk boundaries — may ever appear in emitted text (acceptance
 * criteria 6, 7).
 */

function drive(processor: MarkerProcessor, chunks: string[]): { emitted: string; findings: ReturnType<MarkerProcessor['end']>['findings'] } {
  let emitted = '';
  for (const c of chunks) emitted += processor.push(c);
  const tail = processor.end();
  emitted += tail.text;
  return { emitted, findings: tail.findings };
}

describe('MarkerProcessor — build handoff (§5.7.2)', () => {
  it('detects the build marker at start-of-stream and emits no prose', () => {
    const { emitted, findings } = drive(new MarkerProcessor(), [`${BUILD_MARKER} a CRM for law firms`]);
    expect(emitted).toBe('');
    expect(findings.build?.description).toBe('a CRM for law firms');
  });

  it('detects the build marker even when split across chunk boundaries', () => {
    const half = Math.floor(BUILD_MARKER.length / 2);
    const { emitted, findings } = drive(new MarkerProcessor(), [BUILD_MARKER.slice(0, half), `${BUILD_MARKER.slice(half)} build me a form`]);
    expect(emitted).toBe('');
    expect(findings.build?.description).toBe('build me a form');
  });
});

describe('MarkerProcessor — integration handoff + context blocks', () => {
  it('strips the integration marker anywhere and keeps surrounding prose, marker-free', () => {
    const { emitted, findings } = drive(new MarkerProcessor(), [`Sure. ${INTEGRATION_MARKER}(gmail) Connecting now.`]);
    expect(emitted).not.toContain('[[EKOA');
    expect(emitted).toContain('Sure.');
    expect(emitted).toContain('Connecting now.');
    expect(findings.integration?.hint).toBe('gmail');
  });

  it('never leaks a marker split across chunks (§5.7.2 tail hold-back)', () => {
    const mid = 8;
    const chunks = ['before ', INTEGRATION_MARKER.slice(0, mid), INTEGRATION_MARKER.slice(mid), ' after'];
    let emitted = '';
    const p = new MarkerProcessor();
    for (const c of chunks) {
      const out = p.push(c);
      expect(out).not.toContain('[[EKOA'); // no partial marker ever emitted mid-stream
      emitted += out;
    }
    emitted += p.end().text;
    expect(emitted).not.toContain('[[EKOA');
    expect(emitted).toContain('before');
    expect(emitted).toContain('after');
  });

  it('extracts context blocks and keeps the last valid one, never streaming them', () => {
    const { emitted, findings } = drive(new MarkerProcessor(), ['Text <ekoa-context>{"a":1}</ekoa-context> more <ekoa-context>{"b":2}</ekoa-context> end']);
    expect(emitted).not.toContain('ekoa-context');
    expect(emitted).toContain('Text');
    expect(emitted).toContain('end');
    expect(findings.contextBlocks).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('emits plain prose unchanged', () => {
    const { emitted, findings } = drive(new MarkerProcessor(), ['Just a normal answer.']);
    expect(emitted).toBe('Just a normal answer.');
    expect(findings.build).toBeUndefined();
    expect(findings.integration).toBeUndefined();
  });
});

describe('provider-error scanners (§5.3.7)', () => {
  it('classifies auth errors', () => {
    expect(scanProviderError('Error 401: invalid api key')).toBe('auth');
    expect(scanProviderError('your organization access was revoked')).toBe('auth');
  });
  it('classifies transient errors', () => {
    expect(scanProviderError('Error 429: rate limit exceeded')).toBe('transient');
    expect(scanProviderError('the service is overloaded, try again')).toBe('transient');
    expect(scanProviderError("You've reached your usage limit")).toBe('transient');
  });
  it('returns null for normal text and flags providers via looksLikeProviderError', () => {
    expect(scanProviderError('Here is your dashboard, all done.')).toBeNull();
    expect(looksLikeProviderError('Here is your dashboard.')).toBe(false);
    expect(looksLikeProviderError('rate limit hit')).toBe(true);
  });
});
