import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSession,
  getSession,
  unregisterSession,
  clearAllSessionsForTest,
  activeSessionCount,
} from '../../src/streaming/registry.js';

/**
 * Remote-display test 3/4 (spec §13.3): the session registry and its session-level takeover
 * (a second register for a traceId closes the prior session with reason 'replaced'). Ported
 * verbatim from cortex/tests/streaming/registry.test.ts.
 */
class FakeSession {
  closed = false;
  closeReason: string | null = null;
  async close(reason: string) { this.closed = true; this.closeReason = reason; }
}

describe('streaming registry', () => {
  beforeEach(() => {
    clearAllSessionsForTest();
  });

  it('registers and retrieves a session by traceId', () => {
    const s = new FakeSession() as any;
    registerSession('t1', s);
    expect(getSession('t1')).toBe(s);
    expect(activeSessionCount()).toBe(1);
  });

  it('takes over: a second register closes the first', () => {
    const a = new FakeSession() as any;
    const b = new FakeSession() as any;
    registerSession('t1', a);
    registerSession('t1', b);
    expect(a.closed).toBe(true);
    expect(a.closeReason).toBe('replaced');
    expect(b.closed).toBe(false);
    expect(getSession('t1')).toBe(b);
    expect(activeSessionCount()).toBe(1);
  });

  it('unregister removes only when the session matches', () => {
    const a = new FakeSession() as any;
    const b = new FakeSession() as any;
    registerSession('t1', a);
    unregisterSession('t1', b);
    expect(getSession('t1')).toBe(a);
    unregisterSession('t1', a);
    expect(getSession('t1')).toBeUndefined();
  });

  it('unregister with no session arg removes any current entry', () => {
    const a = new FakeSession() as any;
    registerSession('t1', a);
    unregisterSession('t1');
    expect(getSession('t1')).toBeUndefined();
  });

  it('clears all sessions for test cleanup', () => {
    registerSession('t1', new FakeSession() as any);
    registerSession('t2', new FakeSession() as any);
    expect(activeSessionCount()).toBe(2);
    clearAllSessionsForTest();
    expect(activeSessionCount()).toBe(0);
  });
});
