/**
 * The per-integration LESSONS panel (slice C3).
 *
 * The panel's whole reason to exist carefully is that this textarea holds text somebody typed once
 * and may never be able to reconstruct — an operational note about a portal that broke at 3am. So
 * the assertions here are almost entirely about the two ways such a box loses work:
 *
 *   TRUNCATION  — the ceiling must be visible and must REFUSE, never trim. Pinned by driving the
 *                 draft past the limit and asserting the save is blocked AND the text is intact.
 *   LOST UPDATE — a concurrent save must not be overwritten and must not overwrite the draft. Pinned
 *                 by making the transport answer `stale` and asserting the typed draft is still in
 *                 the textarea, that the stored version is shown alongside it, and that BOTH exits
 *                 (take theirs / overwrite) are explicit clicks.
 *
 * Plus the read-only branch, which is a claim about who may see raw bytes: `editable: false` means
 * the api handed back the SCRUBBED view, so the panel must not offer a save at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IntegrationLessonsView } from '@ekoa/shared';
import { INTEGRATION_LESSONS_MAX_CHARS } from '@ekoa/shared';
import { LessonsPanel } from '@/components/integrations/lessons-panel';
import type { LessonsLoadResult, LessonsSaveResult, LessonsTransport } from '@/lib/integrations/lessons';

const KEY = 'portal-x';

const view = (over: Partial<IntegrationLessonsView> = {}): IntegrationLessonsView => ({
  key: KEY,
  lessons: '- The portal rejects requests without a Referer header.',
  editable: true,
  updatedAt: '2026-08-03T10:00:00.000Z',
  ...over,
});

function transportOf(
  load: LessonsLoadResult,
  save: LessonsSaveResult | ((lessons: string, expected?: string) => LessonsSaveResult),
): LessonsTransport & { saves: Array<{ lessons: string; expectedUpdatedAt?: string }> } {
  const saves: Array<{ lessons: string; expectedUpdatedAt?: string }> = [];
  return {
    saves,
    load: vi.fn(async () => load),
    save: vi.fn(async (_key: string, lessons: string, expectedUpdatedAt?: string) => {
      saves.push({ lessons, ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}) });
      return typeof save === 'function' ? save(lessons, expectedUpdatedAt) : save;
    }),
  };
}

const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement;

beforeEach(() => { vi.clearAllMocks(); });

describe('LessonsPanel — the editable happy path', () => {
  it('loads the stored lessons, echoes the concurrency token on save, and only enables save when dirty', async () => {
    const t = transportOf({ kind: 'ready', view: view() }, { kind: 'saved', view: view({ lessons: 'edited', updatedAt: '2026-08-03T11:00:00.000Z' }) });
    const user = userEvent.setup();
    render(<LessonsPanel integrationKey={KEY} transport={t} />);

    await waitFor(() => expect(textarea()).toHaveValue('- The portal rejects requests without a Referer header.'));
    // Nothing typed yet: saving an unchanged body is not offered.
    const saveButton = screen.getByRole('button', { name: /guardar lições|save lessons/i });
    expect(saveButton).toBeDisabled();

    await user.clear(textarea());
    await user.type(textarea(), 'edited');
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    // THE TOKEN: the save carries the `updatedAt` this editor loaded, which is what lets the
    // server refuse rather than clobber.
    await waitFor(() => expect(t.saves).toHaveLength(1));
    expect(t.saves[0]).toEqual({ lessons: 'edited', expectedUpdatedAt: '2026-08-03T10:00:00.000Z' });
    // After a successful save the panel re-bases on the server's answer.
    await waitFor(() => expect(saveButton).toBeDisabled());
  });

  it('renders NOTHING when the integration has no lessons row (a shipped package)', async () => {
    const t = transportOf({ kind: 'absent' }, { kind: 'error', message: 'unreachable' });
    const { container } = render(<LessonsPanel integrationKey={KEY} transport={t} />);
    await waitFor(() => expect(t.load).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="lessons-panel"]')).toBeNull());
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the server message on a failed load and offers no editor', async () => {
    const t = transportOf({ kind: 'error', message: 'Serviço indisponível.' }, { kind: 'error', message: 'x' });
    render(<LessonsPanel integrationKey={KEY} transport={t} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Serviço indisponível.'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('LessonsPanel — the ceiling REFUSES, it never trims', () => {
  it('blocks the save above the limit while keeping every character the author typed', async () => {
    const long = 'x'.repeat(INTEGRATION_LESSONS_MAX_CHARS + 5);
    const t = transportOf({ kind: 'ready', view: view({ lessons: long }) }, { kind: 'error', message: 'must not be called' });
    render(<LessonsPanel integrationKey={KEY} transport={t} />);

    await waitFor(() => expect(textarea()).toHaveValue(long));
    // NOT TRUNCATED: the panel shows all of it, over-limit and all — the author can see what to cut.
    expect(textarea().value).toHaveLength(INTEGRATION_LESSONS_MAX_CHARS + 5);
    // The counter is LOCALE-formatted (`lessonsCounter` uses `toLocaleString`), so the separator is
    // matched tolerantly — same shape as the ordinary-length assertion below. What is asserted is
    // the number the author typed, NOT a clamped one.
    expect(screen.getByTestId('lessons-counter').textContent).toMatch(/20[.,\s]?005/);
    expect(screen.getByRole('button', { name: /guardar lições|save lessons/i })).toBeDisabled();
    expect(t.save).not.toHaveBeenCalled();
  });

  it('the counter is present at ordinary lengths too — the limit is never discovered by losing text', async () => {
    const t = transportOf({ kind: 'ready', view: view({ lessons: 'short' }) }, { kind: 'error', message: 'x' });
    render(<LessonsPanel integrationKey={KEY} transport={t} />);
    await waitFor(() => expect(screen.getByTestId('lessons-counter')).toBeInTheDocument());
    expect(screen.getByTestId('lessons-counter').textContent).toMatch(/5/);
    expect(screen.getByTestId('lessons-counter').textContent).toMatch(/20[.,\s]?000/);
  });
});

describe('LessonsPanel — a concurrent edit is surfaced, never silently resolved', () => {
  const theirs = view({ lessons: 'THEIR VERSION', updatedAt: '2026-08-03T12:00:00.000Z' });

  it('keeps the draft, shows what is stored, and requires an explicit choice', async () => {
    const t = transportOf({ kind: 'ready', view: view({ lessons: 'original' }) }, { kind: 'stale', view: theirs });
    const user = userEvent.setup();
    render(<LessonsPanel integrationKey={KEY} transport={t} />);

    await waitFor(() => expect(textarea()).toHaveValue('original'));
    await user.clear(textarea());
    await user.type(textarea(), 'MY VERSION');
    await user.click(screen.getByRole('button', { name: /guardar lições|save lessons/i }));

    await waitFor(() => expect(screen.getByTestId('lessons-conflict')).toBeInTheDocument());
    // THE POINT: the draft is exactly as typed — the conflict did not replace it…
    expect(textarea()).toHaveValue('MY VERSION');
    // …and the other version is shown, so nothing has to be guessed.
    expect(screen.getByTestId('lessons-conflict-theirs')).toHaveTextContent('THEIR VERSION');
  });

  it('"keep the stored version" adopts their text and clears the conflict', async () => {
    const t = transportOf({ kind: 'ready', view: view({ lessons: 'original' }) }, { kind: 'stale', view: theirs });
    const user = userEvent.setup();
    render(<LessonsPanel integrationKey={KEY} transport={t} />);

    await waitFor(() => expect(textarea()).toHaveValue('original'));
    await user.clear(textarea());
    await user.type(textarea(), 'MY VERSION');
    await user.click(screen.getByRole('button', { name: /guardar lições|save lessons/i }));
    await waitFor(() => expect(screen.getByTestId('lessons-conflict')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /ficar com a versão guardada|keep the stored version/i }));
    expect(textarea()).toHaveValue('THEIR VERSION');
    expect(screen.queryByTestId('lessons-conflict')).toBeNull();
  });

  it('"write mine over it" is a SECOND deliberate click, and it drops the token on purpose', async () => {
    let staleOnce = true;
    const t = transportOf(
      { kind: 'ready', view: view({ lessons: 'original' }) },
      (lessons) => {
        if (staleOnce) { staleOnce = false; return { kind: 'stale', view: theirs }; }
        return { kind: 'saved', view: view({ lessons, updatedAt: '2026-08-03T13:00:00.000Z' }) };
      },
    );
    const user = userEvent.setup();
    render(<LessonsPanel integrationKey={KEY} transport={t} />);

    await waitFor(() => expect(textarea()).toHaveValue('original'));
    await user.clear(textarea());
    await user.type(textarea(), 'MY VERSION');
    await user.click(screen.getByRole('button', { name: /guardar lições|save lessons/i }));
    await waitFor(() => expect(screen.getByTestId('lessons-conflict')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /gravar a minha por cima|write mine over it/i }));
    await waitFor(() => expect(t.saves).toHaveLength(2));
    // The first save was GUARDED; only the explicit overwrite drops the guard.
    expect(t.saves[0]).toEqual({ lessons: 'MY VERSION', expectedUpdatedAt: '2026-08-03T10:00:00.000Z' });
    expect(t.saves[1]).toEqual({ lessons: 'MY VERSION' });
    await waitFor(() => expect(screen.queryByTestId('lessons-conflict')).toBeNull());
  });
});

describe('LessonsPanel — a reader who may not save gets no editor', () => {
  it('renders the scrubbed text read-only, says why, and offers no save button', async () => {
    const t = transportOf(
      { kind: 'ready', view: view({ lessons: 'api_key: [REDACTED]', editable: false }) },
      { kind: 'error', message: 'must not be called' },
    );
    const user = userEvent.setup();
    render(<LessonsPanel integrationKey={KEY} transport={t} />);

    await waitFor(() => expect(textarea()).toHaveValue('api_key: [REDACTED]'));
    expect(textarea()).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /guardar lições|save lessons/i })).toBeNull();
    // Typing changes nothing and reaches no transport: the read-only state is real, not cosmetic.
    await user.type(textarea(), 'hello');
    expect(textarea()).toHaveValue('api_key: [REDACTED]');
    expect(t.save).not.toHaveBeenCalled();
  });
});
