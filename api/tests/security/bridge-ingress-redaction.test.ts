import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket as WsClient } from 'ws';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { setActivation } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { mintBridgeToken } from '../../src/bridge/token.js';
import { attachBridgeServer, type BridgeServerHandle } from '../../src/bridge/server.js';
import { delegateToLocal } from '../../src/bridge/delegation.js';
import { drainBridgeAudit } from '../../src/bridge/audit.js';
import type { BridgeFrame } from '@ekoa/shared';
import {
  redactInboundFrame,
  registerDeliveredSecrets,
  releasePairingSecrets,
  registryFor,
  __resetIngressRedactionForTests,
} from '../../src/bridge/ingress-redaction.js';

/**
 * SECURITY SUITE — value-keyed redaction at bridge ingress (Cofre H-4).
 *
 * THE LEAK. When Cortex delivers a credential to a machine (J-3), a bash step on that machine can
 * trivially echo it: `env | grep`, a curl that fails and prints its own argv, a stack trace with
 * the connection string in it. That output comes back as a frame, and frames were parsed and
 * dispatched RAW — straight into the persisted run record, the SSE stream to the browser, and (for
 * `provider_request`) the model.
 *
 * WHY THE FIX IS ON THIS SIDE. The daemon cannot do it: it does not know which of the strings in
 * its own output is a secret, and asking it to guess is precisely the pattern-matching-a-value
 * problem that value-keyed redaction exists to avoid. Cortex knows, because Cortex delivered the
 * value seconds earlier. The daemon's obligation stays the simpler one — never log payloads at all.
 */
const PAIRING = 'pair-1';
const SECRET = 'db-token-H4-LEAKED-4417';

beforeEach(() => __resetIngressRedactionForTests());

const resultFrame = (answer: string): BridgeFrame =>
  ({
    type: 'delegation_result',
    taskId: 't1',
    result: { status: 'ok', answer, citations: [], ledgerRefs: [], telemetry: { egressBytes: 0, maskedCounts: {} } },
  }) as BridgeFrame;

describe('a delivered secret cannot come back through a frame', () => {
  it('THE LEAK: a bash step echoing the credential is redacted before dispatch', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const out = redactInboundFrame(PAIRING, resultFrame(`erro ao ligar: DB_TOKEN=${SECRET} inválido`));

    const answer = (out as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer!;
    expect(answer).not.toContain(SECRET);
    // The surrounding text survives — the run record still says what went wrong.
    expect(answer).toContain('erro ao ligar');
  });

  it('redacts a denial reason', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const out = redactInboundFrame(PAIRING, { type: 'denial', reason: `recusado: ${SECRET}`, principle: 'S1' } as BridgeFrame);
    expect((out as Extract<BridgeFrame, { type: 'denial' }>).reason).not.toContain(SECRET);
  });

  it('redacts a tool.result output and error', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const out = redactInboundFrame(PAIRING, {
      type: 'tool.result',
      invocationId: 'i1',
      output: `stdout: ${SECRET}`,
      error: `stderr: ${SECRET}`,
    } as BridgeFrame);
    const f = out as Extract<BridgeFrame, { type: 'tool.result' }>;
    expect(String(f.output)).not.toContain(SECRET);
    expect(String(f.error)).not.toContain(SECRET);
  });

  it('redacts DEEP inside a provider_request body — the one headed for the model', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const out = redactInboundFrame(PAIRING, {
      type: 'provider_request',
      correlationId: 'c1',
      session: 's1',
      credential: 'cred',
      body: { messages: [{ role: 'user', content: [{ type: 'text', text: `contexto ${SECRET}` }] }] },
    } as BridgeFrame);
    expect(JSON.stringify((out as Extract<BridgeFrame, { type: 'provider_request' }>).body)).not.toContain(SECRET);
  });

  it('returns a NEW frame, leaving no raw object for a later handler to pick up', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const original = resultFrame(`x ${SECRET}`);
    const out = redactInboundFrame(PAIRING, original);
    expect(out).not.toBe(original);
    // The original is untouched, which is why dispatching the COPY is what makes this safe.
    expect((original as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer).toContain(SECRET);
  });

  it('every encoded form is covered, not just the literal', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const encoded = encodeURIComponent(SECRET);
    const json = JSON.stringify(SECRET).slice(1, -1);
    const out = redactInboundFrame(PAIRING, resultFrame(`a=${encoded} b=${json}`));
    const answer = (out as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer!;
    expect(answer).not.toContain(SECRET);
    expect(answer).not.toContain(encoded);
  });
});

describe('scope and lifetime', () => {
  it('a value delivered to one machine does not filter another machine\'s frames', () => {
    // Not a leak by itself — but a filter that silently spanned machines would mask the fact that
    // a DIFFERENT machine somehow holds the value, which is the thing worth noticing.
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const out = redactInboundFrame('other-machine', resultFrame(`echo ${SECRET}`));
    expect((out as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer).toContain(SECRET);
  });

  it('releasing a pairing drops its registry', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    expect(registryFor(PAIRING)?.size).toBe(1);
    releasePairingSecrets(PAIRING);
    expect(registryFor(PAIRING)).toBeUndefined();
  });

  it('accumulates across deliveries rather than replacing', () => {
    registerDeliveredSecrets(PAIRING, ['first-secret-value']);
    registerDeliveredSecrets(PAIRING, ['second-secret-value']);
    const out = redactInboundFrame(PAIRING, resultFrame('first-secret-value and second-secret-value'));
    const answer = (out as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer!;
    expect(answer).not.toContain('first-secret-value');
    expect(answer).not.toContain('second-secret-value');
  });
});

describe('the name-pattern leg runs even when Cortex delivered nothing', () => {
  it('a conventionally-NAMED credential the executor never held is caught', () => {
    // The case a registry-only filter misses entirely: a token the user's own script fetched on the
    // machine. Cortex never saw the value, so only the name-pattern leg can reach it — and it does,
    // for the `key=value` and JSON-key shapes that leg understands.
    const out = redactInboundFrame('never-delivered-to', resultFrame('falhou com DB_TOKEN=sk-live-ZZZZ9999TTTT'));
    const answer = (out as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer!;
    expect(answer).not.toContain('sk-live-ZZZZ9999TTTT');
  });

  it('RESIDUAL, pinned rather than assumed away: a colon-separated header line is NOT caught', () => {
    // `redactBodyByName` understands JSON keys and `key=value` pairs. A bare `Authorization: Bearer
    // x` in free-text stdout matches neither, so it survives the name leg — it is only removed when
    // Cortex DELIVERED the value and the registry leg recognises it.
    //
    // Asserted in the failing direction on purpose. Widening the name leg to colon-separated pairs
    // would make it fire on ordinary prose ("Nota: Bearer ..." or any `word: value` line in a
    // document excerpt), and a filter that mangles legitimate output is one people route around.
    // Recorded in docs/findings.md as `bridge-ingress-freetext-header-residual`; if it is ever
    // closed, this expectation flips and the test says so.
    const leaked = 'Authorization: Bearer sk-live-ZZZZ9999TTTT';
    const out = redactInboundFrame('never-delivered-to', resultFrame(leaked));
    expect((out as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer).toContain(
      'sk-live-ZZZZ9999TTTT',
    );

    // And the mitigation that makes the residual narrow: once the value IS delivered, it goes.
    registerDeliveredSecrets('delivered-to', ['sk-live-ZZZZ9999TTTT']);
    const covered = redactInboundFrame('delivered-to', resultFrame(leaked));
    expect((covered as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer).not.toContain(
      'sk-live-ZZZZ9999TTTT',
    );
  });

  it('ordinary text is left alone — a filter that mangles output is a filter people turn off', () => {
    const out = redactInboundFrame('never-delivered-to', resultFrame('A cláusula 3.1 trata das indemnizações.'));
    expect((out as Extract<BridgeFrame, { type: 'delegation_result' }>).result.answer).toBe(
      'A cláusula 3.1 trata das indemnizações.',
    );
  });
});

describe('what is deliberately NOT rewritten', () => {
  it('structural ids survive intact — substituting inside a join key would corrupt it', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const out = redactInboundFrame(PAIRING, resultFrame(`x ${SECRET}`));
    expect((out as Extract<BridgeFrame, { type: 'delegation_result' }>).taskId).toBe('t1');
  });

  it('a ledger_row passes through untouched — it is never persisted hosted-side anyway', () => {
    registerDeliveredSecrets(PAIRING, [SECRET]);
    const row = {
      type: 'ledger_row',
      taskId: 't1',
      row: { ts: '', session: 's', correlationId: 'c', path: '/Users/ana/x.txt', byteRange: '0-1', bytesOut: 1, sha256: 'h', tool: 'read' },
    } as BridgeFrame;
    expect(redactInboundFrame(PAIRING, row)).toBe(row);
  });
});

describe('the filter is WIRED into the socket, not merely available', () => {
  /**
   * The isolated cases above prove `redactInboundFrame` works. They do NOT prove the server calls
   * it — and a filter nobody calls is the failure mode this whole file exists to prevent. Removing
   * the call site left every assertion above green, which is exactly why this case exists: it
   * drives a REAL frame through a REAL socket and asserts on what the awaiting delegation receives.
   */
  let mem: MongoMemoryServer;
  let server: Server;
  let handle: BridgeServerHandle;
  let port: number;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-h4';
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    __resetConfigForTests();
    loadConfig();
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_sec_h4_wire');
    server = createServer();
    handle = attachBridgeServer(server, { resolveUserOrg: async () => 'org-1' });
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as { port: number }).port;
  }, 60_000);

  afterAll(async () => {
    await handle.close();
    await new Promise<void>((r) => server.close(() => r()));
    await drainBridgeAudit();
    await closeMongo();
    await mem.stop();
  });

  it('a secret echoed back over the wire never reaches the awaiting delegation', async () => {
    const owner = 'owner-h4';
    const pairing = 'pair-h4';
    setActivation(owner, { active: true, billingLocked: false });
    const { token } = mintBridgeToken({ sub: owner }, pairing);

    const ws = new WsClient(`ws://127.0.0.1:${port}/api/v1/bridge/connect/${pairing}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    ws.on('error', () => undefined);
    await new Promise<void>((r) => ws.on('open', () => r()));

    // Cortex delivered this value to that machine moments ago.
    registerDeliveredSecrets(pairing, [SECRET]);

    // The daemon answers the delegation with output that echoes it (the `env | grep` case).
    ws.on('message', (data) => {
      const frame = JSON.parse(typeof data === 'string' ? data : (data as Buffer).toString());
      if (frame.type !== 'delegate') return;
      ws.send(
        JSON.stringify({
          type: 'delegation_result',
          taskId: frame.task.taskId,
          result: {
            status: 'ok',
            answer: `a ligação falhou: DB_TOKEN=${SECRET}`,
            citations: [],
            ledgerRefs: [],
            telemetry: { egressBytes: 0, maskedCounts: {} },
          },
        }),
      );
    });

    const result = await delegateToLocal(
      { userId: owner, orgId: 'org-1', sessionId: 's1' },
      { task: '{"v":1,"steps":[]}', grantRefs: ['g-1'], budget: { egressBytes: 1000, modelSpend: { userId: owner } } },
      { timeoutMs: 5000 },
    );

    expect(result.status).toBe('ok');
    expect(result.answer).not.toContain(SECRET);
    expect(result.answer).toContain('a ligação falhou');
    ws.close();
  });
});
