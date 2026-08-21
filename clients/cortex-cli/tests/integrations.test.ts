import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import type { Io } from '../src/output.js';

/**
 * `cortex integrations ...` at the CLI level, with HTTP stubbed.
 *
 * The two cases that carry the weight are the ones where the HTTP status and the outcome DISAGREE,
 * because both of them exit 0 in a client that reads only the status:
 *
 *   - an action that did not work answers HTTP 200 with `success: false` (T1);
 *   - a mutating action nobody approved answers HTTP 403 with the descriptor of what it would have
 *     done, which the caller has to be shown and which this CLI cannot answer (T2).
 *
 * The rest is the group's share of the package-wide contract: exactly one JSON document on stdout,
 * an empty stdout plus one error document on stderr when it fails, and exit 2 decided before any
 * byte goes out.
 */

const ENV = { CORTEX_BASE_URL: 'https://cortex.example.com', CORTEX_API_KEY: 'ekoa_gk_test' };

interface Captured {
  io: Io;
  out: string[];
  err: string[];
}
function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t) => out.push(t), err: (t) => err.push(t), outBytes: () => undefined } };
}

/** A fetch stub answering one canned JSON body, recording what it was asked. */
function stub(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

interface ErrorDoc {
  ok: boolean;
  command: string;
  error: { code: string; message: string; status?: number; details?: unknown };
}

/** The single document a `--json` failure writes to stderr, with the empty-stdout half asserted. */
function errorDoc(cap: Captured): ErrorDoc {
  expect(cap.out, 'stdout must stay empty on a failure').toEqual([]);
  return JSON.parse(cap.err.join('\n')) as ErrorDoc;
}

const CONSENT_403 = {
  error: {
    code: 'FORBIDDEN',
    message: 'Esta ação altera dados e precisa da autorização do titular antes de correr.',
    details: {
      code: 'awaiting_consent',
      consentRequest: {
        integrationKey: 'slack',
        actionName: 'post_message',
        description: 'Publica uma mensagem num canal',
        target: 'POST https://slack.com/api/chat.postMessage',
        shape: 'sha256:3f9a1c',
      },
    },
  },
};

describe('the happy path', () => {
  it('list, show, execute and achieve each print exactly ONE json document naming their command', async () => {
    const cases: Array<{ argv: string[]; body: unknown }> = [
      { argv: ['integrations', 'list', '--json'], body: { items: [{ key: 'slack', displayName: 'Slack' }] } },
      {
        argv: ['integrations', 'show', 'slack', '--json'],
        body: { integration: { key: 'slack' }, connected: true, actions: [] },
      },
      {
        argv: ['integrations', 'execute', 'slack', 'list_channels', '--json'],
        body: { success: true, status: 200, data: { channels: [] } },
      },
      {
        argv: ['integrations', 'achieve', 'slack', '--goal', 'list the channels', '--json'],
        body: { outcome: 'executed', actionName: 'list_channels', result: { success: true, status: 200, data: {} } },
      },
    ];
    for (const { argv, body } of cases) {
      const cap = capture();
      const code = await main(argv, { io: cap.io, env: ENV, fetchImpl: stub(body).fetchImpl });
      expect(code, argv.join(' ')).toBe(0);
      expect(cap.err, argv.join(' ')).toEqual([]);
      expect(cap.out, argv.join(' ')).toHaveLength(1);
      const doc = JSON.parse(cap.out[0] as string) as { ok: boolean; command: string; status: number; data: unknown };
      expect(doc).toMatchObject({ ok: true, command: argv.slice(0, 2).join(' '), status: 200 });
      expect(doc.data).toEqual(body);
    }
  });

  it('execute addresses the contract path and sends --arg pairs as a string-valued args object', async () => {
    const cap = capture();
    const { calls, fetchImpl } = stub({ success: true, data: { ok: 1 } });
    const code = await main(
      ['integrations', 'execute', 'slack', 'post_message', '--arg', 'channel=#geral', '--arg', 'limit=10', '--json'],
      { io: cap.io, env: ENV, fetchImpl },
    );
    expect(code).toBe(0);
    expect(calls[0]?.url).toBe('https://cortex.example.com/api/v1/integrations/slack/actions/post_message/execute');
    expect(calls[0]?.init.method).toBe('POST');
    // Values are STRINGS, deliberately: "10" is not coerced to 10, and the JSON escape is the way
    // to send anything that is not a string.
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ args: { channel: '#geral', limit: '10' } });
  });

  it('--args-json carries a whole typed object, and an absent one sends no args at all', async () => {
    const typed = stub({ success: true });
    await main(['integrations', 'execute', 'slack', 'post', '--args-json', '{"limit":10,"deep":{"a":true}}'], {
      io: capture().io,
      env: ENV,
      fetchImpl: typed.fetchImpl,
    });
    expect(JSON.parse(typed.calls[0]?.init.body as string)).toEqual({ args: { limit: 10, deep: { a: true } } });

    const bare = stub({ success: true });
    await main(['integrations', 'execute', 'slack', 'post'], { io: capture().io, env: ENV, fetchImpl: bare.fetchImpl });
    expect(JSON.parse(bare.calls[0]?.init.body as string)).toEqual({});
  });

  it('achieve sends the goal in the body and lands on the achieve path', async () => {
    const { calls, fetchImpl } = stub({ outcome: 'executed', actionName: 'post', result: { success: true } });
    await main(['integrations', 'achieve', 'slack', '--goal', 'diz olá no #geral', '--arg', 'urgency=low'], {
      io: capture().io,
      env: ENV,
      fetchImpl,
    });
    expect(calls[0]?.url).toBe('https://cortex.example.com/api/v1/integrations/slack/achieve');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ goal: 'diz olá no #geral', args: { urgency: 'low' } });
  });

  it('human mode says whether the integration is connected and where each action would write', async () => {
    const cap = capture();
    const body = {
      integration: { key: 'slack', displayName: 'Slack' },
      connected: false,
      actions: [
        {
          actionName: 'post_message',
          description: 'Publica uma mensagem',
          backingType: 'api-call',
          transport: 'http',
          target: 'POST https://slack.com/api/chat.postMessage',
          shape: 'sha256:3f9a1c',
          requiresApproval: true,
          approved: false,
        },
        {
          actionName: 'list_channels',
          description: 'Lista canais',
          backingType: 'api-call',
          transport: 'http',
          target: 'GET https://slack.com/api/conversations.list',
          shape: 'sha256:aa11',
          requiresApproval: false,
          approved: false,
        },
      ],
    };
    expect(await main(['integrations', 'show', 'slack'], { io: cap.io, env: ENV, fetchImpl: stub(body).fetchImpl })).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('connected: no');
    // A disconnected integration is exactly the case that answers 200/success:false, so the human
    // listing says so rather than leaving it to be discovered by running something.
    expect(text).toContain('not_connected');
    expect(text).toContain('needs-approval');
    expect(text).toContain('read-only');
    expect(text).toContain('POST https://slack.com/api/chat.postMessage');
  });
});

/**
 * T1 - THE 200 THAT IS NOT A SUCCESS.
 *
 * `/execute` answers HTTP 200 with `{ success: false, code }` whenever the call was addressed and
 * permitted and then did not work. Reading the status alone reports a message that was never sent
 * as sent, so `success` decides the exit code here.
 */
describe('a failed action at HTTP 200', () => {
  it('exits 1 with the executor code, an empty stdout, and the whole body in the error document', async () => {
    const cap = capture();
    const body = {
      success: false,
      code: 'not_connected',
      error: 'A integração não está ligada.',
      status: 428,
    };
    const code = await main(['integrations', 'execute', 'slack', 'post_message', '--json'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub(body, 200).fetchImpl,
    });
    expect(code).toBe(1);
    const doc = errorDoc(cap);
    expect(doc.ok).toBe(false);
    expect(doc.command).toBe('integrations execute');
    // The executor's own token, verbatim - that is what a caller branches on.
    expect(doc.error.code).toBe('not_connected');
    expect(doc.error.message).toContain('slack/post_message');
    expect(doc.error.message).toContain('upstream HTTP 428');
    expect(doc.error.details).toEqual(body);
  });

  it('says the same thing in human mode, on stderr, with nothing on stdout', async () => {
    const cap = capture();
    const code = await main(['integrations', 'execute', 'slack', 'post_message'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub({ success: false, code: 'not_connected', error: 'não ligada' }).fetchImpl,
    });
    expect(code).toBe(1);
    expect(cap.out).toEqual([]);
    expect(cap.err.join('\n')).toContain('error: not_connected');
  });

  it('falls back to a generic code when the failed body names none', async () => {
    const cap = capture();
    const code = await main(['integrations', 'execute', 'slack', 'post', '--json'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub({ success: false }).fetchImpl,
    });
    expect(code).toBe(1);
    expect(errorDoc(cap).error.code).toBe('action_failed');
  });

  it('applies the same rule to achieve, whose executed arm carries the identical body', async () => {
    const cap = capture();
    const code = await main(['integrations', 'achieve', 'slack', '--goal', 'diz olá', '--json'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub({
        outcome: 'executed',
        actionName: 'post_message',
        result: { success: false, code: 'credential_locked', error: 'bloqueada' },
      }).fetchImpl,
    });
    expect(code).toBe(1);
    expect(errorDoc(cap).error.code).toBe('credential_locked');
  });

  it('refuses an achieve that never ran anything, however friendly its HTTP 200 looks', async () => {
    // `refused`: addressed, admitted, declined. The goal did not happen.
    const refused = capture();
    expect(
      await main(['integrations', 'achieve', 'slack', '--goal', 'faz algo', '--json'], {
        io: refused.io,
        env: ENV,
        fetchImpl: stub({ outcome: 'refused', code: 'ambiguous_goal', message: 'Mais do que uma ação serve.', candidates: ['a', 'b'] }).fetchImpl,
      }),
    ).toBe(1);
    const refusedDoc = errorDoc(refused);
    expect(refusedDoc.error.code).toBe('ambiguous_goal');
    expect(refusedDoc.error.details).toMatchObject({ candidates: ['a', 'b'] });

    // `authored`: an action was WRITTEN, as provisional, and cannot run until a person promotes it.
    const authored = capture();
    expect(
      await main(['integrations', 'achieve', 'slack', '--goal', 'faz algo novo', '--json'], {
        io: authored.io,
        env: ENV,
        fetchImpl: stub({ outcome: 'authored', actionName: 'novo', state: 'provisional', requiresApproval: true }).fetchImpl,
      }),
    ).toBe(1);
    const authoredDoc = errorDoc(authored);
    expect(authoredDoc.error.code).toBe('authored');
    expect(authoredDoc.error.message).toContain('has NOT run');
  });
});

/**
 * THE COMPOSED ANSWER'S TWO PARTIALITY SIGNALS, as a table.
 *
 * A composed answer can be short for two unrelated reasons, and the human line says so with ONE
 * clause because they are one fact for the reader - what is printed is PART of the answer:
 *
 *   `truncated`           - more action rows matched the join than the stage will EMIT;
 *   `collectionTruncated` - the key set was built from a PREFIX of the caller's collection.
 *
 * Neither arm had a test. The clause could be deleted, inverted, or reduced to one of the two flags
 * with the whole estate green - and it is the ONLY thing on screen that says a narrowed list is not
 * the whole of somebody's answer. The e2e suite drives the `truncated` arm through the real join
 * stage over 201 real rows; `collectionTruncated` needs 5001 collection rows to produce honestly,
 * so it is exercised here against the shape the route really emits (`AchieveComposition`, both
 * flags booleans on every composed answer), which is what makes the four rows below a table of the
 * RENDERING rather than a claim about the stage.
 *
 * All four combinations, because an OR is four cases and three of them are the ones a mutant lives
 * in: `&&` survives the first row alone, and dropping either flag survives two of the four.
 */
describe('a composed answer says when it is only part of one', () => {
  const composedBody = (truncated: boolean, collectionTruncated: boolean) => ({
    outcome: 'composed',
    actionName: 'processos',
    result: { success: true, status: 200, data: { processos: [{ id: 'p1' }, { id: 'p2' }], nextPage: 'cursor-2' } },
    items: [{ id: 'p1' }],
    composition: {
      collection: 'clients',
      where: { field: 'idade', op: 'lt', value: 40 },
      join: { resultField: 'clienteId', collectionField: 'id' },
      scanned: 2,
      collectionScanned: 5,
      collectionTruncated,
      matchedCollectionRows: 3,
      matched: 1,
      truncated,
    },
  });

  const humanOut = async (truncated: boolean, collectionTruncated: boolean): Promise<string> => {
    const cap = capture();
    const code = await main(['integrations', 'achieve', 'crm', '--goal', 'processos de clientes com menos de 40 anos'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub(composedBody(truncated, collectionTruncated)).fetchImpl,
    });
    expect(code, cap.err.join('\n')).toBe(0);
    return cap.out.join('\n');
  };

  it.each([
    ['the emit cap fired', true, false],
    ['the collection scan cap fired', false, true],
    ['both fired', true, true],
  ])('%s: the caller is told the list is PART of the answer', async (_name, truncated, collectionTruncated) => {
    expect(await humanOut(truncated, collectionTruncated)).toContain('- PART of the answer, not all of it');
  });

  it('and says nothing of the sort when the answer really is whole', async () => {
    const out = await humanOut(false, false);
    expect(out).toContain('1 of 2 rows kept, joined against "clients"');
    expect(out).not.toContain('PART of the answer');
  });

  /**
   * AND THE ACTION'S OWN ENVELOPE IS PRINTED. `--json` has always carried it; the human path
   * printed `items` alone, so a `nextPage` cursor - the one thing that says a 200 was ONE PAGE -
   * reached the one reader who cannot go and look it up. The e2e suite drives this through the real
   * route; here it is the rendering, beside the flags it belongs with.
   */
  it('prints the action\'s own answer whole, above the rows it was narrowed from', async () => {
    const out = await humanOut(false, false);
    expect(out).toContain('the action\'s own answer, whole - the rows below are a subset of it:');
    expect(out).toContain('cursor-2');
    expect(out.indexOf('cursor-2')).toBeLessThan(out.indexOf('rows kept:'));
  });
});

/**
 * T2 - THE WRITE GATE.
 *
 * A `mutates` action with no live approval is refused with HTTP 403, `details.code =
 * 'awaiting_consent'` and a descriptor naming the real destination. The descriptor has to reach the
 * caller intact, and the caller has to be told this CLI is not the place to answer it: the approval
 * endpoint is `auth: 'user'` and deliberately off the key-reachable surface.
 */
describe('a mutating action awaiting consent', () => {
  it('exits 1 and carries the descriptor through --json intact', async () => {
    const cap = capture();
    const code = await main(['integrations', 'execute', 'slack', 'post_message', '--arg', 'text=olá', '--json'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub(CONSENT_403, 403).fetchImpl,
    });
    expect(code).toBe(1);
    const doc = errorDoc(cap);
    expect(doc.error.status).toBe(403);
    expect(doc.error.code).toBe('FORBIDDEN');
    expect(doc.error.details).toEqual(CONSENT_403.error.details);
    // stderr is ONE document even here: the human-readable descriptor must not contaminate it.
    expect(() => JSON.parse(cap.err.join('\n'))).not.toThrow();
  });

  it('shows a human the destination and states that this CLI cannot grant the approval', async () => {
    const cap = capture();
    const code = await main(['integrations', 'execute', 'slack', 'post_message'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub(CONSENT_403, 403).fetchImpl,
    });
    expect(code).toBe(1);
    expect(cap.out).toEqual([]);
    const text = cap.err.join('\n');
    expect(text).toContain('awaiting_consent');
    expect(text).toContain('POST https://slack.com/api/chat.postMessage'); // the real destination
    expect(text).toContain('post_message');
    expect(text).toContain('sha256:3f9a1c');
    expect(text).toContain('CANNOT grant that approval');
    expect(text).toContain('Ekoa UI');
  });

  it('reports the gate the same way when it is achieve that hits it', async () => {
    const cap = capture();
    const code = await main(['integrations', 'achieve', 'slack', '--goal', 'diz olá no #geral'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub(CONSENT_403, 403).fetchImpl,
    });
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toContain('CANNOT grant that approval');
  });

  it('does not mistake an ordinary 403 for the gate', async () => {
    const cap = capture();
    const code = await main(['integrations', 'execute', 'slack', 'post_message'], {
      io: cap.io,
      env: ENV,
      fetchImpl: stub({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } }, 403).fetchImpl,
    });
    expect(code).toBe(1);
    expect(cap.err.join('\n')).not.toContain('awaiting_consent');
  });
});

/**
 * SKILL.md IS PART OF THE PRODUCT, AND IT SHIPPED DESCRIBING A CONTRACT THAT NO LONGER EXISTED.
 *
 * The doc said "`achieve` has three outcomes and only one of them is exit 0" and listed three rows.
 * `composed` had already landed - in the schema, in the route, in the generated client and in this
 * command's own exit-code branch - and the document an AGENT reads to decide how to use the command
 * still said a composed answer was not one of them. That is not cosmetic: a stale contract in the
 * skill doc is a wrong instruction shipped to every consumer, and an agent that believes it will
 * treat a successful narrowed read as a failed goal, which is exactly the bug the client itself had.
 *
 * So the doc is tested against the two authorities it describes, rather than proof-read:
 *
 *   1. WHAT OUTCOMES EXIST comes from `docs/openapi/cortex.v1.json` - the published contract this
 *      package generates its client from. Every outcome it declares must have a row.
 *   2. WHAT EACH ONE DOES comes from RUNNING THE COMMAND. The exit code in the doc's table is
 *      compared against the exit code the binary really produces for that outcome, so the doc
 *      cannot drift from the behaviour in either direction - a client change without the doc, or a
 *      doc change without the client, reds here.
 */
describe('the shipped skill doc describes the contract this command implements', () => {
  const SKILL = readFileSync(fileURLToPath(new URL('../SKILL.md', import.meta.url)), 'utf8');
  const SPEC = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../docs/openapi/cortex.v1.json', import.meta.url)), 'utf8'),
  ) as { components: { schemas: { AchieveIntegrationGoalResponse: { properties: { outcome: { enum: string[] } } } } } };
  const OUTCOMES = SPEC.components.schemas.AchieveIntegrationGoalResponse.properties.outcome.enum;

  /** The row of the doc's achieve table for one outcome, split into cells. */
  function tableRow(outcome: string): string[] {
    const line = SKILL.split('\n').find((l) => l.startsWith(`| \`${outcome}\` |`));
    expect(line, `SKILL.md has no achieve table row for the outcome "${outcome}"`).toBeDefined();
    return (line as string).split('|').map((c) => c.trim());
  }

  /** A minimally well-formed achieve response for each outcome, as the route emits it. */
  const bodyFor: Record<string, Record<string, unknown>> = {
    executed: { outcome: 'executed', actionName: 'processos', result: { success: true, status: 200, data: { processos: [] } } },
    composed: {
      outcome: 'composed',
      actionName: 'processos',
      result: { success: true, status: 200, data: { processos: [{ id: 'p1' }] } },
      items: [{ id: 'p1' }],
      composition: {
        collection: 'clients',
        where: { field: 'idade', op: 'lt', value: 40 },
        join: { resultField: 'clienteId', collectionField: 'id' },
        scanned: 1, collectionScanned: 5, collectionTruncated: false,
        matchedCollectionRows: 3, matched: 1, truncated: false,
      },
    },
    authored: { outcome: 'authored', actionName: 'novo', state: 'provisional', requiresApproval: true },
    refused: { outcome: 'refused', code: 'ambiguous_goal', message: 'Mais do que uma ação serve.' },
  };

  it('lists EVERY outcome the published contract declares - four of them, not three', () => {
    expect(OUTCOMES).toContain('composed');
    for (const outcome of OUTCOMES) expect(tableRow(outcome)[1]).toBe(`\`${outcome}\``);
    // …and it does not still claim there are three. The count is written out in the prose above the
    // table, which is the sentence an agent actually reads before the rows.
    expect(SKILL).toContain(`\`achieve\` has FOUR outcomes`);
    expect(SKILL).not.toContain('has three outcomes');
  });

  it('states the exit code each outcome REALLY produces, taken from running the command', async () => {
    for (const outcome of OUTCOMES) {
      const cap = capture();
      const code = await main(['integrations', 'achieve', 'crm', '--goal', 'um objectivo', '--json'], {
        io: cap.io,
        env: ENV,
        fetchImpl: stub(bodyFor[outcome] as Record<string, unknown>).fetchImpl,
      });
      // The doc's exit cell reads "0, or 1 if …" or "1"; the code the binary produced has to be the
      // one it opens with.
      const stated = tableRow(outcome)[3] as string;
      expect(stated.startsWith(String(code)), `SKILL.md says "${stated}" for ${outcome}, the binary exits ${code}`).toBe(true);
    }
  });
});

describe('usage failures', () => {
  it('are decided before any request is made, and exit 2', async () => {
    const cases: string[][] = [
      ['integrations'], // no command
      ['integrations', 'frobnicate'], // unknown command
      ['integrations', 'show'], // missing <key>
      ['integrations', 'execute', 'slack'], // missing <actionName>
      ['integrations', 'execute', 'slack', 'post', 'extra'], // extra positional
      ['integrations', 'execute', 'slack', 'post', '--nope', 'x'], // unknown flag
      ['integrations', 'execute', 'slack', 'post', '--arg', 'novalue'], // not key=value
      ['integrations', 'execute', 'slack', 'post', '--arg', 'k=v', '--args-json', '{}'], // both
      ['integrations', 'execute', 'slack', 'post', '--args-json', 'not json'],
      ['integrations', 'execute', 'slack', 'post', '--args-json', '[1,2]'], // not an object
      ['integrations', 'achieve', 'slack'], // missing --goal
      ['integrations', 'achieve', 'slack', '--goal', '   '], // blank --goal
    ];
    for (const argv of cases) {
      const cap = capture();
      const { calls, fetchImpl } = stub({ success: true });
      expect(await main(argv, { io: cap.io, env: ENV, fetchImpl }), argv.join(' ')).toBe(2);
      expect(calls, `${argv.join(' ')} must not reach the server`).toHaveLength(0);
      expect(cap.err.join('\n'), argv.join(' ')).not.toBe('');
    }
  });

  it('under --json a usage failure is one document on stderr and an empty stdout', async () => {
    const cap = capture();
    const { calls, fetchImpl } = stub({ success: true });
    expect(await main(['integrations', 'achieve', 'slack', '--json'], { io: cap.io, env: ENV, fetchImpl })).toBe(2);
    expect(calls).toHaveLength(0);
    expect(errorDoc(cap)).toMatchObject({ ok: false, error: { code: 'USAGE' } });
  });
});

describe('the group is reachable and documented', () => {
  it('appears in the root help with a readable gap after its name, and has its own help', async () => {
    const root = capture();
    expect(await main(['--help'], { io: root.io, env: {} })).toBe(0);
    expect(root.out.join('\n')).toMatch(/ {2}integrations {2,}connected services/);

    const group = capture();
    expect(await main(['integrations', '--help'], { io: group.io, env: {} })).toBe(0);
    const usage = group.out.join('\n');
    expect(usage).toContain('cortex integrations <command>');
    // The two traps are in the usage text, not only in SKILL.md.
    expect(usage).toContain('A FAILED ACTION IS AN HTTP 200');
    expect(usage).toContain('CANNOT GRANT THAT APPROVAL');
  });
});
