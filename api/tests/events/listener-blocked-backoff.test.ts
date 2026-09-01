import { describe, it, expect } from 'vitest';
import { nextPollDelayMs } from '../../src/events/listener-supervisor.js';
import {
  ListenerPollError,
  isBlockedPollError,
} from '../../src/integrations/event-sources/user-defined-poll.js';

/**
 * A listener that cannot succeed must WAIT, not hammer.
 *
 * ── THE DEFECT (found live 2026-08-31, reported by the owner) ──────────────────────────────────
 *
 * Every poll failure was thrown as a plain Error carrying only prose, so the supervisor could not
 * tell a flaky network from a portal nobody can enter until a human acts. It applied
 * `RESTART_BACKOFF_MS` to both, which starts at ONE SECOND. An automation-backed poll is not a cheap
 * probe: each attempt runs the automation, and with `desktop.automation` granted that OPENS A REAL
 * BROWSER WINDOW. A Citius listener with no captured session opened a window at 1s, 2s, 4s, 8s,
 * 16s, 32s, 60s and then every minute, against a live court portal, until the daemon was killed by
 * hand. The owner watched a browser open and close on a loop.
 *
 * What is pinned here:
 *   - the CODE survives the throw, so a backoff can be chosen from it rather than from prose;
 *   - the live case classifies: "no machine is paired" arrives as the GENERIC `automation_failed`
 *     with the real state on `data.status`, so a code-only test would have missed it;
 *   - a blocked poll waits at least 15 minutes and escalates to an hour, never 1 second;
 *   - a blocked poll never advances the failure ramp, and a failure never advances the blocked one;
 *   - an ordinary failure is UNCHANGED - still the fast ramp, because a flaky poll really can clear
 *     in a second and slowing it down would be the opposite mistake.
 */

describe('ListenerPollError: the reason survives the throw', () => {
  it('classifies the codes that only a human act can clear', () => {
    for (const code of [
      'awaiting_consent', 'needs_credentials', 'not_connected',
      'disabled', 'origin_refused', 'unknown_automation',
      'automation_required', 'unsupported_transport',
    ]) {
      expect(new ListenerPollError('x', code).blocked, code).toBe(true);
    }
  });

  it('classifies THE LIVE CASE, which carries the generic code and the real state on the status', () => {
    // `runAutomationForAction` returns a locality refusal as code `automation_failed` with
    // `data: { runId, status: 'awaiting_daemon' }`. Reading the code alone misses exactly the halt
    // that caused the storm, which is why the status is read too.
    const err = new ListenerPollError(
      'poll action "consultar_notificacoes" on citius failed (automation_failed): '
      + 'no machine is paired to your account, and this step runs only on one - '
      + 'pair a machine, then establish this session from it',
      'automation_failed',
      'awaiting_daemon',
    );
    expect(err.code).toBe('automation_failed'); // the code alone says nothing
    expect(err.blocked).toBe(true);             // the status is what tells the truth
    expect(isBlockedPollError(err)).toBe(true);
  });

  it('does NOT classify an ordinary failure as blocked', () => {
    expect(new ListenerPollError('boom', 'automation_failed').blocked).toBe(false);
    expect(new ListenerPollError('boom').blocked).toBe(false);
    expect(new ListenerPollError('boom', undefined, 'failed').blocked).toBe(false);
    // A plain Error from anywhere else is not blocked either - it must keep the fast ramp.
    expect(isBlockedPollError(new Error('ECONNRESET'))).toBe(false);
  });
});

describe('nextPollDelayMs: blocked waits, failed ramps', () => {
  const interval = 60_000;

  it('a blocked poll never retries in seconds - it waits a quarter of an hour', () => {
    const first = nextPollDelayMs({ blocked: true, failures: 0, blocks: 1, intervalMs: interval });
    expect(first).toBe(900_000);
    // The whole defect in one assertion: this used to be 1_000.
    expect(first).toBeGreaterThan(RESTART_FIRST_STEP_MS);
  });

  it('escalates 15min -> 30min -> 60min and caps there', () => {
    const at = (blocks: number) => nextPollDelayMs({ blocked: true, failures: 0, blocks, intervalMs: interval });
    expect(at(1)).toBe(900_000);
    expect(at(2)).toBe(1_800_000);
    expect(at(3)).toBe(3_600_000);
    expect(at(9)).toBe(3_600_000); // capped: an unattended block costs 24 attempts a day, not 1440
  });

  it('never polls FASTER while blocked than the listener does while healthy', () => {
    // A package declaring a two-hour cadence has said something about the cost of asking; being
    // blocked does not make asking cheaper.
    expect(nextPollDelayMs({ blocked: true, failures: 0, blocks: 1, intervalMs: 7_200_000 })).toBe(7_200_000);
  });

  it('leaves an ordinary failure on the fast ramp, unchanged', () => {
    expect(nextPollDelayMs({ blocked: false, failures: 1, blocks: 0, intervalMs: interval })).toBe(1_000);
    expect(nextPollDelayMs({ blocked: false, failures: 3, blocks: 0, intervalMs: interval })).toBe(4_000);
    expect(nextPollDelayMs({ blocked: false, failures: 99, blocks: 0, intervalMs: interval })).toBe(300_000);
  });

  it('keeps the two streaks apart', () => {
    // A long failure history must not push a fresh block out to an hour...
    expect(nextPollDelayMs({ blocked: true, failures: 50, blocks: 1, intervalMs: interval })).toBe(900_000);
    // ...and a long block history must not push a fresh failure past its first rung.
    expect(nextPollDelayMs({ blocked: false, failures: 1, blocks: 50, intervalMs: interval })).toBe(1_000);
  });
});

/** The first rung of the ordinary ramp - the value the blocked path must never use. */
const RESTART_FIRST_STEP_MS = 1_000;
