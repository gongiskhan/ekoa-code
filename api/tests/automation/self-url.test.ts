import { describe, it, expect, afterEach } from 'vitest';
import { rebaseSelfUrl, rebaseSelfUrlWithProvenance, originOf } from '../../src/automation/self-url.js';

/**
 * THE SELF-URL REBASE, NARROWED (found live, 2026-08-28).
 *
 * It exists to repair the port the PLANNER guesses for Ekoa's own frontend. It used to rebase every
 * loopback URL on the hostname alone, which is the much larger claim that no automation may drive
 * any local service: a step the user themselves wrote - `navigate http://127.0.0.1:45180/painel`,
 * a local fixture named in their goal - was silently rewritten onto the dashboard, which answered
 * its own 404. The target was never contacted, and the rewrite left no trace to explain it.
 */
const APP = 'http://localhost:3000';

afterEach(() => {
  delete process.env.EKOA_AUTOMATION_SELF_PORTS;
});

describe('rebaseSelfUrl - only what could plausibly be Ekoa', () => {
  it('REBASES a loopback URL on the app origin\'s own port (the planner\'s stale guess)', () => {
    expect(rebaseSelfUrl('http://127.0.0.1:3000/painel', APP)).toBe('http://localhost:3000/painel');
  });

  it('REBASES a loopback URL with no port at all', () => {
    expect(rebaseSelfUrl('http://localhost/apps/legal-nucleo/', APP)).toBe('http://localhost:3000/apps/legal-nucleo/');
  });

  it('LEAVES ALONE a loopback URL on somebody else\'s port - the live defect', () => {
    // The whole finding in one assertion: a local fixture the user named must be driven, not hijacked.
    expect(rebaseSelfUrl('http://127.0.0.1:45180/painel', APP)).toBe('http://127.0.0.1:45180/painel');
    expect(rebaseSelfUrl('http://localhost:8080/admin', APP)).toBe('http://localhost:8080/admin');
  });

  it('rebases Ekoa\'s OWN dev ports, in production too (the classic stale guess)', () => {
    // In production the app origin carries no explicit port, so without the named dev-port set a
    // planner guessing localhost:3000 for the Ekoa app would match nothing and never be repaired.
    expect(rebaseSelfUrl('http://localhost:3000/painel', 'https://app.ekoa.io')).toBe('https://app.ekoa.io/painel');
    expect(rebaseSelfUrl('http://localhost:4111/apps/x/', 'https://app.ekoa.io')).toBe('https://app.ekoa.io/apps/x/');
  });

  it('rebases an extra port only when the operator declares it ours', () => {
    expect(rebaseSelfUrl('http://localhost:9099/x', APP)).toBe('http://localhost:9099/x');
    process.env.EKOA_AUTOMATION_SELF_PORTS = '9099';
    expect(rebaseSelfUrl('http://localhost:9099/x', APP)).toBe('http://localhost:3000/x');
  });

  it('never touches a real external host, a relative path, or a template', () => {
    expect(rebaseSelfUrl('https://portal.example.pt/painel', APP)).toBe('https://portal.example.pt/painel');
    expect(rebaseSelfUrl('/painel', APP)).toBe('/painel');
    expect(rebaseSelfUrl('{{input.url}}', APP)).toBe('{{input.url}}');
    expect(rebaseSelfUrl('', APP)).toBe('');
  });

  it('a misconfigured appOrigin makes nothing worse', () => {
    expect(rebaseSelfUrl('http://localhost:3000/x', 'not a url')).toBe('http://localhost:3000/x');
  });

  it('preserves path, query and hash when it does rebase', () => {
    expect(rebaseSelfUrl('http://127.0.0.1:3000/a/b?q=1#f', 'https://app.ekoa.io')).toBe('https://app.ekoa.io/a/b?q=1#f');
  });

  it('REPORTS the rewrite, so it can never vanish again', () => {
    const hijacked = rebaseSelfUrlWithProvenance('http://127.0.0.1:3000/painel', APP);
    expect(hijacked.rebasedFrom).toBe('http://127.0.0.1:3000/painel');
    // …and says nothing when it changed nothing.
    expect(rebaseSelfUrlWithProvenance('http://127.0.0.1:45180/painel', APP).rebasedFrom).toBeUndefined();
    expect(rebaseSelfUrlWithProvenance('http://localhost:3000/painel', APP).rebasedFrom).toBeUndefined();
  });
});

describe('originOf', () => {
  it('answers the origin of an absolute URL and null for anything else', () => {
    expect(originOf('http://127.0.0.1:45180/painel')).toBe('http://127.0.0.1:45180');
    expect(originOf('/painel')).toBeNull();
    expect(originOf('')).toBeNull();
  });
});
