import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveVerifyUrl, buildPrompt } from '../../src/apps/verify-runner.js';
import { __resetConfigForTests } from '../../src/config.js';

/**
 * Verify-runner contract (ch07 §7.2.6). Live incident 2026-07-11: the prompt received the
 * artifact-relative `/apps/<id>/` path verbatim, so the agent spent 13+ minutes port-scanning
 * the host for the app and died at the turn ceiling, silently. These tests pin the three
 * fixes: absolute loopback URL, the no-scavenger-hunt rule, and proportionate effort.
 */
describe('resolveVerifyUrl', () => {
  // loadConfig() is a memoized singleton that also requires JWT_SECRET/ENCRYPTION_KEY -
  // pin both and reset the cache around each case.
  beforeEach(() => {
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.ENCRYPTION_KEY ??= 'test-key-0123456789abcdef0123456789abcdef';
    __resetConfigForTests();
  });
  afterEach(() => {
    delete process.env.PORT;
    __resetConfigForTests();
  });

  it('resolves an artifact-relative path against the API loopback origin', () => {
    process.env.PORT = '4211';
    expect(resolveVerifyUrl('/apps/abc-123/')).toBe('http://127.0.0.1:4211/apps/abc-123/');
  });

  it('normalizes a missing leading slash', () => {
    process.env.PORT = '4211';
    expect(resolveVerifyUrl('apps/abc/')).toBe('http://127.0.0.1:4211/apps/abc/');
  });

  it('passes an absolute URL through untouched', () => {
    expect(resolveVerifyUrl('https://example.com/apps/x/')).toBe('https://example.com/apps/x/');
  });

  it('appends a purpose-scoped preview token when the artifactId is provided (draft apps are owner-gated)', async () => {
    process.env.PORT = '4211';
    const url = resolveVerifyUrl('/apps/abc/', 'abc', 60_000);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4211\/apps\/abc\/\?token=pv1\./);
    const { verifyPreviewToken } = await import('../../src/services/preview-token.js');
    const token = decodeURIComponent(url.split('token=')[1] as string);
    expect(verifyPreviewToken(token)).toBe('abc');
    // The token is a capability for THAT artifact only, and never a JWT.
    expect(verifyPreviewToken(token.replace('.abc.', '.other.'))).toBeNull();
    expect(token.split('.').length).toBe(4);
  });
});

describe('preview token', () => {
  it('expires and rejects tampering', async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    __resetConfigForTests();
    const { mintPreviewToken, verifyPreviewToken } = await import('../../src/services/preview-token.js');
    const expired = mintPreviewToken('a1', -1);
    expect(verifyPreviewToken(expired)).toBeNull();
    const good = mintPreviewToken('a1', 60_000);
    expect(verifyPreviewToken(good)).toBe('a1');
    expect(verifyPreviewToken(good.slice(0, -2) + 'ff')).toBeNull();
    expect(verifyPreviewToken('pv1.a1.notanumber.abc')).toBeNull();
    expect(verifyPreviewToken('')).toBeNull();
  });
});

describe('buildPrompt', () => {
  const input = {
    artifactId: 'a1',
    projectDir: '/tmp/p',
    appUrl: 'http://127.0.0.1:4211/apps/a1/',
    userId: 'u1',
    depth: 'full' as const,
    request: 'um flyer institucional',
  };

  it('names the exact URL and forbids searching the host for the app', () => {
    const p = buildPrompt(input);
    expect(p).toContain('http://127.0.0.1:4211/apps/a1/');
    expect(p).toContain('do NOT search for the app elsewhere');
    expect(p).toContain('do NOT scan ports');
    expect(p).toContain('output FAIL immediately');
  });

  it('tells the verifier to scale effort to the app (simple static pages get a quick pass)', () => {
    const p = buildPrompt(input);
    expect(p).toContain('Scale effort to the app');
  });

  it('demands per-action ">> " PT narration lines for the live progress surface (operator ask 2026-07-14)', () => {
    // build.ts re-emits these lines as same-status plan_steps the client shows beside the
    // spinner; if the prefix contract drifts out of the prompt the verify stage goes silent
    // again (the 2026-07-11 "silent multi-minute void" class).
    const p = buildPrompt(input);
    expect(p).toContain('Narrate as you go');
    expect(p).toContain('">> "');
    expect(p).toContain('European Portuguese');
  });

  it('keeps the request-fulfilment contract (F28): scaffold check + acceptance check + verdict line', () => {
    const p = buildPrompt(input);
    expect(p).toContain('<request>um flyer institucional</request>');
    expect(p).toContain('SCAFFOLD CHECK');
    expect(p).toContain('ACCEPTANCE CHECK');
    expect(p).toContain('PASS - ');
    expect(p).toContain('FAIL - ');
  });

  it('selects the scoped pass wording on follow-up builds', () => {
    const p = buildPrompt({ ...input, depth: 'scoped' });
    expect(p).toContain('SCOPED pass');
  });
});
