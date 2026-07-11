// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * FC-401/FC-405 presence hook (run s2): polls GET /api/v1/bridge/status through the typed
 * client and maps registry truth to the three Reference states. The exported shape is the
 * hosted-stub shape, so the four consumers needed no edits (the SEAM promise). One shared
 * poller: N consumers, one request stream; a fetch failure keeps the last known state.
 */
const bridgeStatus = vi.fn();
vi.mock('@/lib/api', () => ({ api: { ekoaLocal: { bridgeStatus: (...a: unknown[]) => bridgeStatus(...a) } } }));

import { useBridgePresence, __resetBridgePresenceForTests } from '@/hooks/use-bridge-presence';

beforeEach(() => {
  vi.useFakeTimers();
  bridgeStatus.mockReset();
  __resetBridgePresenceForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useBridgePresence', () => {
  it('maps the three registry states honestly', async () => {
    bridgeStatus.mockResolvedValueOnce({ paired: false, live: false });
    const { result, unmount } = renderHook(() => useBridgePresence());
    expect(result.current).toEqual({ status: 'not-installed', connected: false });
    await flush();
    expect(result.current).toEqual({ status: 'not-installed', connected: false });

    bridgeStatus.mockResolvedValueOnce({ paired: true, live: false, pairingId: 'p1' });
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    await flush();
    expect(result.current).toEqual({ status: 'offline', connected: false });

    bridgeStatus.mockResolvedValueOnce({ paired: true, live: true, pairingId: 'p1', lastSeenAt: '2026-07-11T06:00:00Z' });
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    await flush();
    expect(result.current).toEqual({ status: 'connected', connected: true });
    unmount();
  });

  it('a fetch failure keeps the last known state (never a fabricated positive)', async () => {
    bridgeStatus.mockResolvedValueOnce({ paired: true, live: true, pairingId: 'p1' });
    const { result, unmount } = renderHook(() => useBridgePresence());
    await flush();
    expect(result.current.status).toBe('connected');

    bridgeStatus.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    await flush();
    expect(result.current.status).toBe('connected');
    unmount();
  });

  it('N consumers share ONE poller; the last unmount stops it', async () => {
    bridgeStatus.mockResolvedValue({ paired: false, live: false });
    const a = renderHook(() => useBridgePresence());
    const b = renderHook(() => useBridgePresence());
    await flush();
    expect(bridgeStatus).toHaveBeenCalledTimes(1);

    a.unmount();
    b.unmount();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(bridgeStatus).toHaveBeenCalledTimes(1);
  });

  it('first load starts at the honest not-installed default before any answer', () => {
    bridgeStatus.mockReturnValue(new Promise(() => undefined));
    const { result, unmount } = renderHook(() => useBridgePresence());
    expect(result.current).toEqual({ status: 'not-installed', connected: false });
    unmount();
  });
});
