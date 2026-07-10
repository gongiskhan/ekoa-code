import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chokepoint mock: planner calls runOneShot + decideForTier from
// '../llm/index.js' (was the old callSimpleLlm seam). A small FIFO queue
// lets each test script one or more responses (the cross-validation retry
// tests need exactly two).
const hoisted = vi.hoisted(() => ({
  responses: [] as string[],
}));

vi.mock('../../src/llm/index.js', () => ({
  runOneShot: vi.fn(async (_opts: unknown, _attr: unknown) => {
    const text = hoisted.responses.shift() ?? '';
    return { text, usage: {} };
  }),
  decideForTier: vi.fn((tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
}));

import { runOneShot, decideForTier } from '../../src/llm/index.js';
import { planFromGoal } from '../../src/automation/planner.js';
import type { Catalog } from '../../src/automation/catalog.js';

const emptyCatalog: Catalog = { automations: [], integrationActions: [], connectedAccounts: [], ekoaActions: [] };

describe('planFromGoal', () => {
  beforeEach(() => {
    vi.mocked(runOneShot).mockClear();
    vi.mocked(decideForTier).mockClear();
    hoisted.responses = [];
  });

  it('parses a successful plan response', async () => {
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'Open and export doc',
        description: 'Open a Google Doc and export it as PDF',
        inputs: [{ name: 'docId', description: 'Document ID', required: true }],
        steps: [
          { id: 'open-doc', description: 'Open the Google Doc', type: 'navigate', url: 'https://docs.google.com' },
          { id: 'click-export', description: 'Click the Export button', type: 'browser' },
          { id: 'verify', description: 'Confirm download started', type: 'verify', expectedOutcome: 'PDF download begins' },
        ],
        reasoning: 'three-step plan',
      }),
    );

    const result = await planFromGoal({ goal: 'export my doc as PDF', userId: 'u1', catalog: emptyCatalog });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.name).toBe('Open and export doc');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]!.type).toBe('navigate');
    expect(result.steps[2]!.type).toBe('verify');
    expect(result.inputSchema?.fields[0]!.name).toBe('docId');
  });

  it('returns awaiting_integration when planner detects missing auth', async () => {
    hoisted.responses.push(
      JSON.stringify({
        status: 'awaiting_integration',
        service: 'slack',
        reason: 'Slack integration not connected',
      }),
    );

    const result = await planFromGoal({ goal: 'send a slack message', userId: 'u1', catalog: emptyCatalog });

    expect(result.status).toBe('awaiting_integration');
    if (result.status !== 'awaiting_integration') throw new Error('expected awaiting_integration');
    expect(result.service).toBe('slack');
  });

  it('injects the integration-action catalog into the prompt', async () => {
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'List unread emails',
        description: '',
        inputs: [],
        steps: [{
          id: 'list',
          description: 'Use the Gmail integration to list unread',
          type: 'integration',
          integrationKey: 'google-workspace',
          integrationAction: 'list_emails',
        }],
        reasoning: 'use existing integration',
      }),
    );

    await planFromGoal({
      goal: 'list my unread emails',
      userId: 'u1',
      catalog: {
        automations: [],
        integrationActions: [
          {
            integrationKey: 'google-workspace',
            actionName: 'list_emails',
            description: 'List unread emails in inbox',
            argsSummary: 'limit?:number',
            mutates: false,
          },
        ],
        connectedAccounts: [],
        ekoaActions: [],
      },
    });

    const call = vi.mocked(runOneShot).mock.calls[0]![0];
    expect(call.prompt).toContain('google-workspace.list_emails');
  });

  it('F29: an empty steps array returns a STRUCTURED failed (after a corrective retry), never throws', async () => {
    const empty = JSON.stringify({ status: 'ok', name: 'x', description: '', inputs: [], steps: [], reasoning: '' });
    hoisted.responses.push(empty, empty); // pass 1 fails -> retry -> pass 2 fails -> failed

    const result = await planFromGoal({ goal: 'do nothing', userId: 'u1', catalog: emptyCatalog });
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.violations.join(' ')).toMatch(/passos/);
    expect(runOneShot).toHaveBeenCalledTimes(2); // pass-1 failure fed the corrective retry
  });

  it('F29: an invalid step type returns a STRUCTURED failed (after a corrective retry), never throws', async () => {
    const bad = JSON.stringify({ status: 'ok', name: 'x', description: '', inputs: [], steps: [{ id: 's', description: 'do something', type: 'magic' }], reasoning: '' });
    hoisted.responses.push(bad, bad);

    const result = await planFromGoal({ goal: 'g', userId: 'u1', catalog: emptyCatalog });
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.violations.join(' ')).toMatch(/invalid type|passo/);
  });

  it('routes through the chokepoint at EXPERT tier, billed to the run owner', async () => {
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'x',
        description: '',
        inputs: [],
        steps: [{ id: 's', description: 'go', type: 'navigate', url: 'https://x.com' }],
        reasoning: '',
      }),
    );

    await planFromGoal({ goal: 'g', userId: 'u1', catalog: emptyCatalog });

    expect(runOneShot).toHaveBeenCalledTimes(1);
    const [opts, attr] = vi.mocked(runOneShot).mock.calls[0]!;
    expect((attr as { kind: string }).kind).toBe('user_work');
    expect((attr as { agentType: string }).agentType).toBe('automation-plan');
    expect((attr as { billeeUserId: string }).billeeUserId).toBe('u1');
    expect((opts as { decision: { tier: string } }).decision.tier).toBe('EXPERT');
    expect(decideForTier).toHaveBeenCalledWith('EXPERT');
  });

  it('F29: non-JSON output returns a STRUCTURED failed (after a corrective retry), never throws', async () => {
    hoisted.responses.push('I cannot help', 'still not JSON');
    const result = await planFromGoal({ goal: 'g', userId: 'u1', catalog: emptyCatalog });
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.violations.join(' ')).toMatch(/JSON/);
    expect(runOneShot).toHaveBeenCalledTimes(2);
  });

  it('cross-validation: rejects browser step whose description names a connected integration; retries with feedback', async () => {
    // Pass 1: bad plan — browser step says "use the gmail integration"
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'Email lawyer',
        description: '',
        inputs: [],
        steps: [
          { id: 'open-google', description: 'Open Google', type: 'navigate', url: 'https://google.com' },
          {
            id: 'compose',
            description: 'Use the gmail integration to prepare a message to her email',
            type: 'browser',
          },
        ],
        reasoning: '',
      }),
    );
    // Pass 2: corrected plan — uses integration step
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'Email lawyer',
        description: '',
        inputs: [{ name: 'recipientEmail', description: 'lawyer email', required: true }],
        steps: [
          { id: 'open-google', description: 'Open Google', type: 'navigate', url: 'https://google.com' },
          {
            id: 'send',
            description: 'Send the email via the integration',
            type: 'integration',
            integrationKey: 'google-workspace',
            integrationAction: 'send_email_simple',
            argsTemplate: { to: '{{input.recipientEmail}}', subject: 'hi', body: 'hi' },
          },
        ],
        reasoning: '',
      }),
    );

    const catalog: Catalog = {
      automations: [],
      integrationActions: [
        {
          integrationKey: 'google-workspace',
          actionName: 'send_email_simple',
          description: 'Send email with structured fields',
          argsSummary: 'to,subject,body',
          mutates: true,
        },
      ],
      connectedAccounts: [{ integrationKey: 'google-workspace', email: 'me@example.com' }],
      ekoaActions: [],
    };

    const result = await planFromGoal({
      goal: 'find a lawyer and send her an email',
      userId: 'u1',
      catalog,
    });

    expect(runOneShot).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(runOneShot).mock.calls[1]![0] as { prompt: string };
    expect(secondCall.prompt).toMatch(/Plan rejected/);
    expect(secondCall.prompt).toMatch(/use the gmail integration/i);
    expect(result.status).toBe('ok');
  });

  it('cross-validation: rejects email-send goal that has no integration step when an email integration is connected', async () => {
    // Pass 1: bad plan — entirely browser-driven, no integration step
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'Email someone',
        description: '',
        inputs: [],
        steps: [
          { id: 'open', description: 'Open compose', type: 'browser' },
          { id: 'fill', description: 'Fill the body', type: 'browser' },
        ],
        reasoning: '',
      }),
    );
    // Pass 2: corrected plan
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'Email someone',
        description: '',
        inputs: [{ name: 'recipientEmail', description: 'recipient', required: true }],
        steps: [
          {
            id: 'send',
            description: 'Send the message',
            type: 'integration',
            integrationKey: 'google-workspace',
            integrationAction: 'send_email_simple',
            argsTemplate: { to: '{{input.recipientEmail}}', subject: 'hello', body: 'hi' },
          },
        ],
        reasoning: '',
      }),
    );

    const catalog: Catalog = {
      automations: [],
      integrationActions: [
        {
          integrationKey: 'google-workspace',
          actionName: 'send_email_simple',
          description: 'Send email with structured fields',
          argsSummary: 'to,subject,body',
          mutates: true,
        },
      ],
      connectedAccounts: [{ integrationKey: 'google-workspace', email: 'me@example.com' }],
      ekoaActions: [],
    };

    const result = await planFromGoal({
      goal: 'send an email to my contact',
      userId: 'u1',
      catalog,
    });

    expect(runOneShot).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(runOneShot).mock.calls[1]![0] as { prompt: string };
    expect(secondCall.prompt).toMatch(/no integration step uses/);
    expect(result.status).toBe('ok');
  });

  it('cross-validation: surfaces a hard error when even pass 2 is malformed', async () => {
    const badPlan = JSON.stringify({
      status: 'ok',
      name: 'x',
      description: '',
      inputs: [],
      steps: [
        {
          id: 'compose',
          description: 'Use the gmail integration to send something',
          type: 'browser',
        },
      ],
      reasoning: '',
    });
    hoisted.responses.push(badPlan, badPlan);

    const catalog: Catalog = {
      automations: [],
      integrationActions: [
        { integrationKey: 'google-workspace', actionName: 'send_email_simple', description: 'send', argsSummary: '', mutates: true },
      ],
      connectedAccounts: [{ integrationKey: 'google-workspace', email: 'me@example.com' }],
      ekoaActions: [],
    };

    const result = await planFromGoal({ goal: 'send an email', userId: 'u1', catalog });
    expect(result.status).toBe('failed'); // F29: cross-validation failure after the retry is structured, not a throw
    expect(result.status === 'failed' && result.violations.length).toBeGreaterThan(0);
    expect(runOneShot).toHaveBeenCalledTimes(2);
  });

  it('cross-validation: integration steps with integration-name in description are FINE (only browser/navigate are flagged)', async () => {
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'x',
        description: '',
        inputs: [],
        steps: [
          {
            id: 'send',
            description: 'Use the gmail integration to send the email',
            type: 'integration',
            integrationKey: 'google-workspace',
            integrationAction: 'send_email_simple',
            argsTemplate: { to: 'a@b.com', subject: 'x', body: 'y' },
          },
        ],
        reasoning: '',
      }),
    );

    const catalog: Catalog = {
      automations: [],
      integrationActions: [
        { integrationKey: 'google-workspace', actionName: 'send_email_simple', description: 'send', argsSummary: '', mutates: true },
      ],
      connectedAccounts: [{ integrationKey: 'google-workspace', email: 'me@example.com' }],
      ekoaActions: [],
    };

    const result = await planFromGoal({
      goal: 'send email',
      userId: 'u1',
      catalog,
    });

    expect(runOneShot).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
  });

  it('preserves type-discriminated extras (integration step)', async () => {
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'x',
        description: '',
        inputs: [],
        steps: [{
          id: 'send',
          description: 'send a message',
          type: 'integration',
          integrationKey: 'slack',
          integrationAction: 'send_message',
          argsTemplate: { channel: '{{input.channel}}', text: 'hi' },
        }],
        reasoning: '',
      }),
    );

    const result = await planFromGoal({ goal: 'g', userId: 'u1', catalog: emptyCatalog });
    if (result.status !== 'ok') throw new Error('expected ok');
    const step = result.steps[0]!;
    expect(step.integrationKey).toBe('slack');
    expect(step.integrationAction).toBe('send_message');
    expect(step.argsTemplate).toEqual({ channel: '{{input.channel}}', text: 'hi' });
  });
});
