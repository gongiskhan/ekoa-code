/**
 * The Cofre store's half of "done - capture now" (D-CEREMONY-DONE).
 *
 * WHAT IT HAS TO GET RIGHT is not the request - it is the ANSWER. The endpoint can only report that
 * a frame reached the machine; the capture itself travels machine -> Cortex -> Cofre a few seconds
 * later, on its own rail. So the store watches for the thing that IS the outcome (a new session item
 * bound to this origin) and reports a fact rather than a promise.
 *
 * The finding this closes was, at bottom, a person told nothing true at the moment it mattered
 * (`attended-ceremony-browser-steals-focus-and-hides-its-capture-signal`). A "captured!" that never
 * looked would be the same defect wearing a nicer coat, which is why the stale-item case below is
 * here: an item captured last week must not be mistaken for the one being waited on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CofreItem } from '@ekoa/shared';

const { listMock, captureMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    cofre: {
      cofreItemsList: listMock,
      cofreSessionCapture: captureMock,
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (err) {
      return { ok: false as const, error: { message: (err as Error).message } };
    }
  },
}));

import { useCofreStore, awaitCapturedSession } from '@/stores/cofre';

const ORIGIN = 'orders.adhoc.example';

const sessionItem = (id: string, origin = ORIGIN): CofreItem =>
  ({
    id,
    ref: `cofre:${id}`,
    type: 'session',
    label: `${origin} session`,
    state: 'unlocked',
    boundOrigins: [origin],
    createdAt: '2026-08-25T00:00:00.000Z',
  }) as CofreItem;

/** No real waiting: every case here is about WHICH item ends the watch, not how long it waits. */
const immediately = { wait: async (): Promise<void> => undefined, attempts: 3, delayMs: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  useCofreStore.setState({ items: [], isLoading: false, error: null });
});

describe('awaitCapturedSession - watching the Cofre for the ceremony`s own capture', () => {
  it('resolves true when a NEW session item for the origin appears, and commits it', async () => {
    const committed: CofreItem[][] = [];
    const pages = [[], [sessionItem('fresh')]];
    let call = 0;

    const captured = await awaitCapturedSession(ORIGIN, new Set(), {
      ...immediately,
      list: async () => pages[Math.min(call++, pages.length - 1)] ?? [],
      commit: (items) => committed.push(items),
    });

    expect(captured).toBe(true);
    expect(committed).toEqual([[sessionItem('fresh')]]);
  });

  it('ignores a session for this origin that was ALREADY there', async () => {
    // A capture from last week satisfies "an item for this origin exists" and says nothing about
    // the ceremony the person just finished.
    const captured = await awaitCapturedSession(ORIGIN, new Set(['old']), {
      ...immediately,
      list: async () => [sessionItem('old')],
      commit: () => undefined,
    });

    expect(captured).toBe(false);
  });

  it('ignores an item for a different origin, and a non-session item for this one', async () => {
    const password = { ...sessionItem('pw'), type: 'password' } as CofreItem;
    const captured = await awaitCapturedSession(ORIGIN, new Set(), {
      ...immediately,
      list: async () => [sessionItem('elsewhere', 'other.example'), password],
      commit: () => undefined,
    });

    expect(captured).toBe(false);
  });

  it('keeps watching through a failed read rather than calling it an answer', async () => {
    let call = 0;
    const captured = await awaitCapturedSession(ORIGIN, new Set(), {
      ...immediately,
      list: async () => (call++ === 0 ? null : [sessionItem('fresh')]),
      commit: () => undefined,
    });

    expect(captured).toBe(true);
  });

  it('gives up as "not yet" rather than "failed" when nothing arrives', async () => {
    const captured = await awaitCapturedSession(ORIGIN, new Set(), {
      ...immediately,
      list: async () => [],
      commit: () => undefined,
    });

    expect(captured).toBe(false);
  });
});

describe('captureSession - the store action behind the Done button', () => {
  it('asks the capture endpoint for this origin and reports the capture that follows', async () => {
    captureMock.mockResolvedValue({ requested: true, message: 'A capturar a sessão na sua máquina.' });
    listMock.mockResolvedValue({ items: [sessionItem('fresh')] });

    const result = await useCofreStore.getState().captureSession(ORIGIN);

    expect(captureMock).toHaveBeenCalledWith({ origin: ORIGIN });
    expect(result).toMatchObject({ requested: true, captured: true });
    expect(useCofreStore.getState().items).toEqual([sessionItem('fresh')]);
  });

  it('returns a refusal as it came, and waits for nothing', async () => {
    captureMock.mockResolvedValue({ requested: false, message: 'Nenhuma máquina ligada.' });

    const result = await useCofreStore.getState().captureSession(ORIGIN);

    expect(result).toEqual({ requested: false, captured: false, message: 'Nenhuma máquina ligada.' });
    expect(listMock).not.toHaveBeenCalled();
  });

  it('reports a transport failure without claiming anything about the ceremony', async () => {
    captureMock.mockRejectedValue(new Error('offline'));

    const result = await useCofreStore.getState().captureSession(ORIGIN);

    expect(result).toMatchObject({ requested: false, captured: false });
    expect(useCofreStore.getState().error).toBe('offline');
  });
});
