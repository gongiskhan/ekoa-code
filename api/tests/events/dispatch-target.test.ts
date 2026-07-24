/**
 * Dispatch-input branching + email hydration (2A-S2). Ported from ekoa-dev
 * (cortex/tests/event-sourcing/dispatch-target.test.ts) and adapted to ekoa-code's seams: the
 * automation-vs-artifact TARGET routing + retry/dead semantics live in events/delivery.ts (covered
 * by events/delivery.test.ts), so this file exercises the extracted `buildArtifactBackendInput`
 * builder and the `hydrateEmailInput` normalizers directly. Everything here is pure + LLM-free.
 *
 * We prove:
 *   - artifact-backend + email source → the backend receives a HYDRATED EmailInput (not the preview)
 *   - artifact-backend + non-email source → the backend receives the generic { event, trigger }
 *   - a hydration failure PROPAGATES out of the builder (never a silent preview fallback)
 *   - hydrateEmailInput normalizes Graph's message shape, and Gmail's, and THROWS on a read failure
 *     (so the queue retries) instead of dispatching a truncated body; degrades only when there's no id
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildArtifactBackendInput,
  type DispatchInputDeps,
  type DispatchTrigger,
} from '../../src/integrations/event-sources/dispatch-input.js';
import { hydrateEmailInput, type EmailInput } from '../../src/integrations/event-sources/email-hydrate.js';

const hydrated: EmailInput = {
  id: 'AAA',
  mailbox: 'me@firm.com',
  from: { address: 'lead@x.com', name: 'Lead' },
  subject: 'Need help',
  receivedAt: '2026-06-19T09:00:00Z',
  body: 'full body text',
  bodyContentType: 'text',
  headers: {},
};

function deps(over: Partial<DispatchInputDeps> = {}): DispatchInputDeps {
  return {
    hydrateEmail: vi.fn(async () => hydrated),
    ...over,
  };
}

describe('buildArtifactBackendInput — dispatch-input branching', () => {
  it('hydrates an email source and returns the full EmailInput (never the preview)', async () => {
    const d = deps();
    const trigger: DispatchTrigger = { id: 'trg-1', integrationKey: 'microsoft-365', eventName: 'email.received' };
    const payload = { id: 'AAA', subject: 'Need help', bodyPreview: 'prev' };

    const out = await buildArtifactBackendInput(trigger, payload, d);

    expect(d.hydrateEmail).toHaveBeenCalledOnce();
    expect(d.hydrateEmail).toHaveBeenCalledWith(trigger, payload);
    expect(out).toEqual(hydrated);
    expect((out as EmailInput).body).toBe('full body text'); // NOT the 'prev' preview
  });

  it('passes the generic { event, trigger } envelope (no hydration) for a non-email source', async () => {
    const d = deps();
    const trigger: DispatchTrigger = { id: 'trg-7', integrationKey: 'stripe', eventName: 'payment.succeeded' };
    const payload = { event: 'payment.succeeded', amount: 100 };

    const out = await buildArtifactBackendInput(trigger, payload, d);

    expect(d.hydrateEmail).not.toHaveBeenCalled();
    expect(out).toEqual({ event: payload, trigger: { id: 'trg-7', eventName: 'payment.succeeded' } });
  });

  it('propagates a hydration failure (never swallows it into a preview body)', async () => {
    const d = deps({ hydrateEmail: vi.fn(async () => { throw new Error('read_email failed for message AAA (500): down'); }) });
    const trigger: DispatchTrigger = { id: 'trg-1', integrationKey: 'google-workspace', eventName: 'email.received' };
    await expect(buildArtifactBackendInput(trigger, { id: 'AAA', bodyPreview: 'prev' }, d))
      .rejects.toThrow(/read_email failed for message AAA/);
  });
});

describe('regression: the REAL queue-stored JSON-STRING payload (2A-S2 wiring bug)', () => {
  // The durable event queue persists the enqueued item as JSON TEXT: the listener rail's
  // enqueueListenerEvent stores `input.rawBody.toString('utf8')` where platform-poll built
  // `rawBody = Buffer.from(JSON.stringify(item))`, and the webhook ingress stores rawBody.toString('utf8')
  // too. So the payload that reaches dispatch is a STRING — the exact value server.ts hands
  // buildArtifactBackendInput — NOT the pre-parsed object the other tests feed. This byte-identical
  // helper reproduces that stored value.
  const storedPayload = (item: unknown): string => JSON.stringify(item); // == enqueueListenerEvent's stored value

  const graphListItem = {
    id: 'AAA',
    subject: 'list-subject',
    from: { emailAddress: { address: 'lead@client.com', name: 'A Lead' } },
    receivedDateTime: '2026-06-19T09:00:00Z',
    bodyPreview: 'prev',
  };
  const graphFullMessage = {
    id: 'AAA',
    subject: 'Contract question',
    from: { emailAddress: { address: 'lead@client.com', name: 'A Lead' } },
    receivedDateTime: '2026-06-19T09:05:00Z',
    body: { contentType: 'HTML', content: '<p>full body</p>' },
    internetMessageId: '<abc@client.com>',
    toRecipients: [{ emailAddress: { address: 'intake@firm.com' } }],
  };

  it('parses the JSON STRING, calls read_email, and delivers a POPULATED EmailInput (not the empty degrade)', async () => {
    // Mirror server.ts EXACTLY: buildArtifactBackendInput + the REAL hydrateEmailInput + a stubbed
    // platform call. This is the full wired path the bug lived on — a pre-parsed-object stub hid it.
    const call = vi.fn(async () => ({ success: true as const, status: 200, data: graphFullMessage }));
    const trigger: DispatchTrigger = { id: 'trg-1', integrationKey: 'microsoft-365', eventName: 'email.received' };

    const out = await buildArtifactBackendInput(trigger, storedPayload(graphListItem), {
      hydrateEmail: (t, li) => hydrateEmailInput(t, li, { call }),
    });

    expect(call).toHaveBeenCalledWith({ integrationKey: 'microsoft-365', actionName: 'read_email', args: { messageId: 'AAA' } });
    const email = out as EmailInput;
    expect(email.id).toBe('AAA');
    expect(email.from).toEqual({ address: 'lead@client.com', name: 'A Lead' });
    expect(email.subject).toBe('Contract question');
    expect(email.body).toBe('<p>full body</p>');
    expect(email.mailbox).toBe('intake@firm.com');
    // The empty-degrade the bug produced would have every field blank — assert it did NOT happen.
    expect(email.id).not.toBe('');
    expect(email.body).not.toBe('');
  });

  it('a read failure on the real JSON-STRING path still THROWS (rides the retry, never an empty delivery)', async () => {
    const call = vi.fn(async () => ({ success: false as const, status: 500, error: 'down' }));
    const trigger: DispatchTrigger = { id: 'trg-1', integrationKey: 'microsoft-365', eventName: 'email.received' };
    await expect(
      buildArtifactBackendInput(trigger, storedPayload(graphListItem), {
        hydrateEmail: (t, li) => hydrateEmailInput(t, li, { call }),
      }),
    ).rejects.toThrow(/read_email failed for message AAA \(500\)/);
    expect(call).toHaveBeenCalledOnce(); // the id WAS extracted from the parsed string → read_email attempted
  });

  it('hydrateEmailInput accepts the JSON STRING directly and calls read_email (not the no-id degrade)', async () => {
    const call = vi.fn(async () => ({ success: true as const, status: 200, data: graphFullMessage }));
    const out = await hydrateEmailInput({ integrationKey: 'microsoft-365' }, storedPayload(graphListItem), { call });
    expect(call).toHaveBeenCalledOnce();
    expect(out.subject).toBe('Contract question');
    expect(out.body).toBe('<p>full body</p>');
  });

  it('a corrupt (non-JSON) email payload THROWS instead of masquerading as an empty delivery', async () => {
    const call = vi.fn();
    await expect(
      hydrateEmailInput({ integrationKey: 'microsoft-365' }, '{ not json', { call }),
    ).rejects.toThrow(/not valid JSON/);
    expect(call).not.toHaveBeenCalled(); // never attempted read_email; NOT a silent empty success
  });
});

describe('hydrateEmailInput — normalizes the Graph (Microsoft 365) message shape', () => {
  it('fetches the full body via read_email and normalizes from/subject/body/headers/mailbox', async () => {
    const call = vi.fn(async () => ({
      success: true as const,
      status: 200,
      data: {
        id: 'AAA',
        subject: 'Contract question',
        from: { emailAddress: { address: 'lead@client.com', name: 'A Lead' } },
        receivedDateTime: '2026-06-19T09:05:00Z',
        body: { contentType: 'HTML', content: '<p>full body</p>' },
        internetMessageId: '<abc@client.com>',
        toRecipients: [{ emailAddress: { address: 'intake@firm.com' } }],
      },
    }));
    const out = await hydrateEmailInput({ integrationKey: 'microsoft-365' }, { id: 'AAA', subject: 'list-subject', bodyPreview: 'prev' }, { call });

    expect(call).toHaveBeenCalledWith({ integrationKey: 'microsoft-365', actionName: 'read_email', args: { messageId: 'AAA' } });
    expect(out).toEqual({
      id: 'AAA',
      mailbox: 'intake@firm.com',
      from: { address: 'lead@client.com', name: 'A Lead' },
      subject: 'Contract question',
      receivedAt: '2026-06-19T09:05:00Z',
      body: '<p>full body</p>',
      bodyContentType: 'html',
      headers: { 'internet-message-id': '<abc@client.com>' },
    });
  });

  it('throws on read_email failure (so the queue retries) rather than dispatching a truncated body', async () => {
    const call = vi.fn(async () => ({ success: false as const, status: 500, error: 'down' }));
    await expect(
      hydrateEmailInput({ integrationKey: 'microsoft-365' }, { id: 'BBB', subject: 'Subj', bodyPreview: 'preview text' }, { call }),
    ).rejects.toThrow(/read_email failed for message BBB \(500\)/);
    expect(call).toHaveBeenCalledOnce();
  });

  it('degrades to the list item only when there is no message id (a retry would not help)', async () => {
    const call = vi.fn();
    const out = await hydrateEmailInput(
      { integrationKey: 'microsoft-365' },
      { subject: 'Subj', from: { emailAddress: { address: 'x@y.com' } }, receivedDateTime: '2026-06-19T10:00:00Z', bodyPreview: 'preview text' },
      { call, mailbox: 'me@firm.com' },
    );
    expect(call).not.toHaveBeenCalled(); // no id → no read_email attempt
    expect(out.body).toBe('preview text');
    expect(out.from.address).toBe('x@y.com');
    expect(out.mailbox).toBe('me@firm.com');
  });
});

describe('hydrateEmailInput — normalizes the Gmail (google-workspace) message shape', () => {
  const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

  it('reads payload headers, prefers text/plain (base64url), and builds a permalink webLink', async () => {
    const internalDate = '1718787900000'; // epoch ms
    const call = vi.fn(async () => ({
      success: true as const,
      status: 200,
      data: {
        id: 'g1',
        threadId: 't1',
        snippet: 'snippet fallback',
        internalDate,
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: '"A Lead" <lead@client.com>' },
            { name: 'Subject', value: 'Contract question' },
            { name: 'Message-ID', value: '<abc@client.com>' },
            { name: 'To', value: 'intake@firm.com' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('full body') } },
            { mimeType: 'text/html', body: { data: b64url('<p>full body</p>') } },
          ],
        },
      },
    }));

    const out = await hydrateEmailInput({ integrationKey: 'google-workspace' }, { id: 'g1', subject: 'list-subject' }, { call });

    expect(call).toHaveBeenCalledWith({ integrationKey: 'google-workspace', actionName: 'read_email', args: { messageId: 'g1' } });
    expect(out).toEqual({
      id: 'g1',
      mailbox: 'intake@firm.com',
      from: { address: 'lead@client.com', name: 'A Lead' },
      subject: 'Contract question',
      receivedAt: new Date(Number(internalDate)).toISOString(),
      body: 'full body', // text/plain preferred over text/html
      bodyContentType: 'text',
      headers: { 'internet-message-id': '<abc@client.com>' },
      webLink: 'https://mail.google.com/mail/u/0/#all/g1',
    });
  });

  it('falls back to the Gmail snippet when no decodable body part exists', async () => {
    const call = vi.fn(async () => ({
      success: true as const,
      status: 200,
      data: {
        id: 'g2',
        snippet: 'just the snippet',
        internalDate: '0', // unparseable/zero → empty receivedAt
        payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'solo@client.com' }] },
      },
    }));

    const out = await hydrateEmailInput({ integrationKey: 'google-workspace' }, { id: 'g2' }, { call, mailbox: 'watch@firm.com' });

    expect(out.body).toBe('just the snippet');
    expect(out.bodyContentType).toBeUndefined();
    expect(out.from).toEqual({ address: 'solo@client.com' });
    expect(out.mailbox).toBe('watch@firm.com');
    expect(out.receivedAt).toBe('');
    expect(out.webLink).toBe('https://mail.google.com/mail/u/0/#all/g2');
  });
});
