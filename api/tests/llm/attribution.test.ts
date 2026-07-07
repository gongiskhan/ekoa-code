import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  assertNotPlatformCall,
  meteringAnomalyCount,
  requireAttribution,
  billeeOf,
  __resetAttributionCountersForTests,
  type LlmAttribution,
} from '../../src/llm/attribution.js';

/**
 * Attribution contract (ch06 §6.3): the platform-call alarm increments the /health
 * metering-anomaly counter and logs (§6.3 rule 3, §6.10 rule 4); the runtime
 * missing-attribution guard rejects (§6.10 rule 3); billee resolution routes platform to
 * the admin (empty billee, resolved by billing/).
 */
beforeEach(() => __resetAttributionCountersForTests());
afterEach(() => vi.restoreAllMocks());

describe('platform-call alarm (§6.3 rule 3)', () => {
  it('increments the /health anomaly counter and logs on a platform-attributed call', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(meteringAnomalyCount()).toBe(0);

    const platform: LlmAttribution = { kind: 'platform', agentType: 'some-overhead', justification: 'test' };
    assertNotPlatformCall(platform);

    expect(meteringAnomalyCount()).toBe(1);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]?.[0]).toContain('metering-anomaly');
  });

  it('does NOT increment on user_work or classifier calls', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertNotPlatformCall({ kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' });
    assertNotPlatformCall({ kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'u1' });
    expect(meteringAnomalyCount()).toBe(0);
    expect(err).not.toHaveBeenCalled();
  });
});

describe('requireAttribution — missing-attribution guard (§6.10 rule 3)', () => {
  it('rejects undefined / null / non-object attribution at runtime', () => {
    expect(() => requireAttribution(undefined)).toThrow(/missing its required attribution/);
    expect(() => requireAttribution(null)).toThrow(/missing its required attribution/);
    // a shape that defeated the compile-time requirement via `any`
    expect(() => requireAttribution({} as unknown as LlmAttribution)).toThrow();
  });

  it('accepts a well-formed attribution', () => {
    expect(() => requireAttribution({ kind: 'user_work', agentType: 'build', billeeUserId: 'u1' })).not.toThrow();
  });
});

describe('billeeOf', () => {
  it('bills the user for user_work / classifier, and empty (admin-resolved) for platform', () => {
    expect(billeeOf({ kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' })).toBe('u1');
    expect(billeeOf({ kind: 'classifier', agentType: 'detect-build-intent', billeeUserId: 'u2' })).toBe('u2');
    expect(billeeOf({ kind: 'platform', agentType: 'x', justification: 'y' })).toBe('');
  });

  it('artifact-backend:<entrypoint> is a valid user_work tag family', () => {
    const attr: LlmAttribution = { kind: 'user_work', agentType: 'artifact-backend:sendEmail', billeeUserId: 'owner1', artifactId: 'art1' };
    expect(billeeOf(attr)).toBe('owner1');
  });
});
