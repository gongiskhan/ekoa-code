import { describe, it, expect } from 'vitest';
import { runDeviceLogin, type FetchLike } from '../../src/auth/index.js';
import { pt } from '../../src/i18n/pt.js';

/**
 * Device-login poll loop against a FAKE fetch (no network, no real waits). The clock is a constant and
 * sleep is a no-op recorder, so the loop terminates only on approval/denial/expiry — exactly the
 * transitions under test. All tokens are synthetic strings.
 */

type PollBody =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; user?: { id: string; username: string; role: string }; expiresIn?: number };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface FakeStart {
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  interval?: number;
  expiresIn?: number;
}

function makeFetch(polls: PollBody[], start: FakeStart = {}): { fetchImpl: FetchLike; urls: string[]; pollCount: () => number } {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/api/v1/auth/device')) {
      return jsonResponse({
        deviceCode: start.deviceCode ?? 'dc-1',
        userCode: start.userCode ?? 'BCDF-2345',
        verificationUri: start.verificationUri ?? '/settings/devices',
        interval: start.interval ?? 5,
        expiresIn: start.expiresIn ?? 600,
      });
    }
    if (url.endsWith('/api/v1/auth/device/poll')) {
      const body = polls[i] ?? { status: 'pending' };
      i += 1;
      return jsonResponse(body);
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, urls, pollCount: () => i };
}

describe('runDeviceLogin — happy path', () => {
  it('polls pending then approved, returns the platform credential and prompts with the full URL', async () => {
    const NOW = 1_000_000;
    const sleeps: number[] = [];
    let prompted: { code: string; url: string } | undefined;
    const { fetchImpl } = makeFetch([
      { status: 'pending' },
      { status: 'approved', token: 'jwt-abc', user: { id: 'u1', username: 'ana', role: 'user' }, expiresIn: 3600 },
    ]);

    const cred = await runDeviceLogin({
      cortexBaseUrl: 'https://cortex.example/',
      fetchImpl,
      now: () => NOW,
      sleep: async (ms) => { sleeps.push(ms); },
      onPrompt: (code, url) => { prompted = { code, url }; },
    });

    expect(cred.access).toBe('jwt-abc');
    expect(cred.expires).toBe(NOW + 3600 * 1000);
    expect(cred.user).toEqual({ id: 'u1', username: 'ana', role: 'user' });
    // verificationUri is a relative path; it must be joined onto the Cortex base for the user.
    expect(prompted).toEqual({ code: 'BCDF-2345', url: 'https://cortex.example/settings/devices' });
    expect(sleeps).toEqual([5000, 5000]); // interval honored, unchanged while pending
  });
});

describe('runDeviceLogin — slow_down backs off by the interval', () => {
  it('adds 5s to the poll interval after a slow_down, then completes on approval', async () => {
    const sleeps: number[] = [];
    const { fetchImpl } = makeFetch([
      { status: 'slow_down' },
      { status: 'approved', token: 'jwt-xyz', expiresIn: 600 },
    ]);
    const cred = await runDeviceLogin({
      cortexBaseUrl: 'https://cortex.example',
      fetchImpl,
      now: () => 5_000_000,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(cred.access).toBe('jwt-xyz');
    expect(sleeps).toEqual([5000, 10000]); // second wait backed off by +5s
  });
});

describe('runDeviceLogin — terminal failures throw PT-PT DeviceLoginError', () => {
  it('denied → reason "denied" with the PT-PT message', async () => {
    const { fetchImpl } = makeFetch([{ status: 'denied' }]);
    await expect(
      runDeviceLogin({ cortexBaseUrl: 'https://c.example', fetchImpl, now: () => 0, sleep: async () => {} }),
    ).rejects.toMatchObject({ name: 'DeviceLoginError', reason: 'denied', message: pt.deviceDenied });
  });

  it('expired → reason "expired" with the PT-PT message', async () => {
    const { fetchImpl } = makeFetch([{ status: 'expired' }]);
    await expect(
      runDeviceLogin({ cortexBaseUrl: 'https://c.example', fetchImpl, now: () => 0, sleep: async () => {} }),
    ).rejects.toMatchObject({ name: 'DeviceLoginError', reason: 'expired', message: pt.deviceExpired });
  });

  it('a failed device-start (HTTP error) throws reason "start-failed"', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: 'boom' }, 500);
    await expect(
      runDeviceLogin({ cortexBaseUrl: 'https://c.example', fetchImpl, now: () => 0, sleep: async () => {} }),
    ).rejects.toMatchObject({ name: 'DeviceLoginError', reason: 'start-failed' });
  });

  it('a NETWORK failure on device-start (fetch throws) becomes a PT-PT DeviceLoginError, not a raw throw (review fix)', async () => {
    // Host unreachable: fetch rejects with TypeError before any HTTP status exists. The unguarded
    // version let this escape as an English stack trace; it must now be a typed start-failed error
    // with the network-specific PT-PT message.
    const fetchImpl: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(
      runDeviceLogin({ cortexBaseUrl: 'https://c.example', fetchImpl, now: () => 0, sleep: async () => {} }),
    ).rejects.toMatchObject({ name: 'DeviceLoginError', reason: 'start-failed', message: pt.deviceStartFailed(0) });
  });

  it('an abort DURING device-start becomes reason "aborted"', async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    };
    await expect(
      runDeviceLogin({ cortexBaseUrl: 'https://c.example', fetchImpl, now: () => 0, sleep: async () => {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'DeviceLoginError', reason: 'aborted' });
  });

  it('a transient poll error is tolerated (retried), then approval wins', async () => {
    let call = 0;
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/device')) {
        return jsonResponse({ deviceCode: 'dc', userCode: 'BCDF-2345', verificationUri: '/x', interval: 5, expiresIn: 600 });
      }
      call += 1;
      if (call === 1) throw new Error('network blip');
      return jsonResponse({ status: 'approved', token: 'jwt-after-blip', expiresIn: 600 });
    };
    const cred = await runDeviceLogin({ cortexBaseUrl: 'https://c.example', fetchImpl, now: () => 0, sleep: async () => {} });
    expect(cred.access).toBe('jwt-after-blip');
  });

  it('an already-aborted signal throws reason "aborted"', async () => {
    const { fetchImpl } = makeFetch([]);
    await expect(
      runDeviceLogin({
        cortexBaseUrl: 'https://c.example',
        fetchImpl,
        now: () => 0,
        sleep: async () => {},
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: 'DeviceLoginError', reason: 'aborted', message: pt.deviceAborted });
  });
});
