/**
 * THE BLOCKED BADGE SAYS WHICH BLOCK (P4.1).
 *
 * `RunStatusBadge` carried a docblock claiming its text derives from the CODE the contract defines,
 * and it did not: it rendered `schedules.runStatus[status]` off the status alone. That was
 * survivable only while `blocked` had exactly ONE cause - the integration write gate's
 * `awaiting_consent` - so its single string, "Awaiting approval", happened to be true.
 *
 * P4.1 gave `blocked` two more causes: `awaiting_daemon` (a machine of yours is not connected) and
 * `needs_credentials` (a credential only you can establish). Neither is an approval. A user whose
 * laptop is shut would read "Awaiting approval" and go looking for something to approve, and there
 * is nothing - the schedules surface has no approval control at all. That is a UI that sends people
 * to hunt for a thing that does not exist, which is worse than saying nothing.
 *
 * This spec is the durable regression for it: the copy must move with the code, in both languages.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunStatusBadge } from '@/components/schedules/run-status-badge';
import { useI18nStore } from '@/stores/i18n';
import { en } from '@/locales/en';
import { pt } from '@/locales/pt';

beforeEach(() => {
  useI18nStore.setState({ language: 'en' });
});

describe('RunStatusBadge', () => {
  it('renders each blocked CAUSE in its own words, not one word for all three', () => {
    for (const [code, expected] of Object.entries(en.schedules.runBlocked)) {
      const { unmount } = render(<RunStatusBadge status="blocked" code={code} />);
      expect(screen.getByTestId('schedule-run-status-blocked')).toHaveTextContent(expected);
      unmount();
    }
    // ...and they really are three different things to say. A single shared string would satisfy
    // the loop above while re-creating the exact defect.
    expect(new Set(Object.values(en.schedules.runBlocked)).size).toBe(3);
  });

  it('never tells a user waiting on their MACHINE to go and approve something', () => {
    render(<RunStatusBadge status="blocked" code="awaiting_daemon" />);
    expect(screen.getByTestId('schedule-run-status-blocked')).not.toHaveTextContent(/approv/i);
  });

  it('an unknown code falls back to a vague-but-true label, never to a specific wrong one', () => {
    render(<RunStatusBadge status="blocked" code="something_new_the_api_grew" />);
    const badge = screen.getByTestId('schedule-run-status-blocked');
    expect(badge).toHaveTextContent(en.schedules.runStatus.blocked);
    expect(badge).not.toHaveTextContent(/approv/i);
  });

  it('a blocked run with NO code does the same', () => {
    render(<RunStatusBadge status="blocked" />);
    expect(screen.getByTestId('schedule-run-status-blocked')).toHaveTextContent(en.schedules.runStatus.blocked);
  });

  it('the non-blocked statuses are untouched - the code only ever refines `blocked`', () => {
    render(<RunStatusBadge status="ok" code="awaiting_daemon" />);
    expect(screen.getByTestId('schedule-run-status-ok')).toHaveTextContent(en.schedules.runStatus.ok);
  });

  it('the Portuguese copy moves with it, key for key and distinct', () => {
    useI18nStore.setState({ language: 'pt' });
    expect(Object.keys(pt.schedules.runBlocked).sort()).toEqual(Object.keys(en.schedules.runBlocked).sort());
    expect(new Set(Object.values(pt.schedules.runBlocked)).size).toBe(3);
    render(<RunStatusBadge status="blocked" code="awaiting_daemon" />);
    expect(screen.getByTestId('schedule-run-status-blocked'))
      .toHaveTextContent(pt.schedules.runBlocked.awaiting_daemon);
  });
});
