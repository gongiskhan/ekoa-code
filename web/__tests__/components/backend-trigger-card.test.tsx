/**
 * "Ligações" — wiring an artifact backend handler to an event source.
 *
 * WHAT THIS IS FOR. The card used to assume a source was always a mailbox: it listed only connected
 * platform mailboxes and hardcoded `eventName: 'email.received'` on every trigger it created. An
 * artifact whose backend listens to anything else therefore could not be wired from the UI at all -
 * and worse, the one control it did offer would have bound the handler to an event its source never
 * emits, producing a trigger that looks connected and never fires. `legal-citius` is exactly that
 * case: `onNotificacaoCitius` is fed by the citius package's own listener over the Portal dos
 * Mandatários, not by mail.
 *
 * So the two assertions that matter are: a package listener APPEARS as a source, and the trigger
 * created for it carries THAT SOURCE'S event name rather than a constant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackendTriggerCard } from '@/components/artifacts/backend-trigger-card';
import { api, tryCall } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    platformIntegrations: { list: vi.fn() },
    integrations: { listActive: vi.fn() },
    triggers: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
  tryCall: vi.fn(),
}));

const mockedTryCall = vi.mocked(tryCall);

/** Route each call by which api method the caller invoked, so ORDER is not part of the contract. */
function wire(responses: {
  platform?: unknown[];
  active?: unknown[];
  triggers?: unknown[];
  create?: { ok: boolean; data?: unknown; error?: { message: string } };
}) {
  mockedTryCall.mockImplementation((async (fn: () => unknown) => {
    // The mocked api methods are distinguishable by identity; invoke to find out which was asked.
    let called = '';
    (api.platformIntegrations.list as ReturnType<typeof vi.fn>).mockImplementation(() => { called = 'platform'; });
    (api.integrations.listActive as ReturnType<typeof vi.fn>).mockImplementation(() => { called = 'active'; });
    (api.triggers.list as ReturnType<typeof vi.fn>).mockImplementation(() => { called = 'triggers'; });
    (api.triggers.create as ReturnType<typeof vi.fn>).mockImplementation((body: unknown) => { called = 'create'; createdWith.push(body); });
    fn();
    if (called === 'platform') return { ok: true, data: { items: responses.platform ?? [] } };
    if (called === 'active') return { ok: true, data: { items: responses.active ?? [] } };
    if (called === 'triggers') return { ok: true, data: { items: responses.triggers ?? [] } };
    if (called === 'create') return responses.create ?? { ok: true, data: {} };
    return { ok: true, data: { items: [] } };
  }) as never);
}

let createdWith: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  createdWith = [];
});

describe('BackendTriggerCard: a source is not always a mailbox', () => {
  it('offers a package LISTENER as a source, labelled in PT-PT', async () => {
    wire({
      platform: [],
      active: [{
        key: 'citius',
        displayName: 'CITIUS / eTribunal',
        listenerEvents: [{ name: 'notificacao.recebida', labelPt: 'Notificação recebida' }],
      }],
    });

    render(<BackendTriggerCard artifactId="legal-citius" handlers={['onNotificacaoCitius']} />);

    const select = await screen.findByTestId('trigger-provider-onNotificacaoCitius');
    expect(select).toHaveTextContent('CITIUS / eTribunal · Notificação recebida');
    // The old card would have shown the "no mailbox connected" dead end here.
    expect(screen.queryByTestId('trigger-no-mailbox')).toBeNull();
  });

  it("creates the trigger with the SOURCE'S event name, never email.received", async () => {
    wire({
      platform: [],
      active: [{
        key: 'citius',
        displayName: 'CITIUS / eTribunal',
        listenerEvents: [{ name: 'notificacao.recebida', labelPt: 'Notificação recebida' }],
      }],
    });

    render(<BackendTriggerCard artifactId="legal-citius" handlers={['onNotificacaoCitius']} />);
    await screen.findByTestId('trigger-connect-onNotificacaoCitius');
    await userEvent.click(screen.getByTestId('trigger-connect-onNotificacaoCitius'));

    await waitFor(() => expect(createdWith.length).toBeGreaterThan(0));
    expect(createdWith[0]).toMatchObject({
      integrationKey: 'citius',
      eventName: 'notificacao.recebida',
      target: { kind: 'artifact-backend', artifactId: 'legal-citius', entrypoint: 'onNotificacaoCitius' },
    });
  });

  it('still offers a connected mailbox, and still binds it to email.received', async () => {
    // The mailbox case is now one entry of a general list; it must not have changed behaviour.
    wire({
      platform: [{ provider: 'microsoft', connected: true }],
      active: [],
    });

    render(<BackendTriggerCard artifactId="legal-citius" handlers={['onEmail']} />);
    const select = await screen.findByTestId('trigger-provider-onEmail');
    expect(select).toHaveTextContent('Microsoft 365');

    await userEvent.click(screen.getByTestId('trigger-connect-onEmail'));
    await waitFor(() => expect(createdWith.length).toBeGreaterThan(0));
    expect(createdWith[0]).toMatchObject({ integrationKey: 'microsoft-365', eventName: 'email.received' });
  });

  it('says nothing is connected when there is genuinely no source', async () => {
    wire({ platform: [], active: [] });
    render(<BackendTriggerCard artifactId="legal-citius" handlers={['onNotificacaoCitius']} />);
    expect(await screen.findByTestId('trigger-no-mailbox')).toBeInTheDocument();
  });

  it('skips a listener event with no usable name rather than rendering an empty option', async () => {
    wire({
      platform: [],
      active: [{ key: 'x', displayName: 'X', listenerEvents: [{ labelPt: 'sem nome' }, { name: 'ok.event' }] }],
    });
    render(<BackendTriggerCard artifactId="a1" handlers={['onEmail']} />);
    const select = await screen.findByTestId('trigger-provider-onEmail');
    expect(select.querySelectorAll('option')).toHaveLength(1);
    expect(select).toHaveTextContent('X · ok.event');
  });
});
