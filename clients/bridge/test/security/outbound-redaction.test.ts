import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { OutboundRedactor } from '../../src/runtime/index.js';
import { bashInvoke, browserInvoke, deliverFrame, invokeAndWait, makeRig, type SecurityRig } from './helpers.js';

/**
 * SECURITY SUITE - `outbound-redaction` (I9, the daemon EGRESS half).
 *
 * THE THREAT IS THE ECHO, AND IT IS ORDINARY. A bash step that has just been handed a credential
 * can trivially put it back on the wire without anyone intending to: `env`, a curl that fails and
 * prints its own argv, a stack trace carrying a connection string, a page whose URL has the token
 * in a query parameter. Cortex already filters this on INGRESS (`api/src/bridge/ingress-redaction.ts`)
 * - this is the same filter one hop earlier, which is the only version that also keeps the value
 * out of a proxy log and off the network entirely.
 *
 * THE ASSERTION IS ON WHAT LEAVES `send`. The rig's spy IS the socket: `DaemonRuntime` wraps
 * `deps.send` in its outbound redactor in the constructor, so a frame the spy records is a frame
 * that would have gone out. Asserting on the executor's return value instead would prove nothing -
 * the whole question is whether the wrapping happened.
 */
const SECRET = 'db-token-REDACT-ME-5f3a91cc';

let rig: SecurityRig | undefined;

afterEach(() => {
  if (rig) rmSync(rig.home, { recursive: true, force: true });
  rig = undefined;
});

describe('a bash step that echoes a delivered value leaves scrubbed', () => {
  it('scrubs stdout in the frame that LEAVES send', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    const frame = await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', 'echo "$DB_TOKEN"']));

    const wire = JSON.stringify(frame);
    expect(wire).not.toContain(SECRET);
    expect(wire).toContain('[REDACTED:');
    // …and the child really did print it, so the assertion is about the filter and not about an
    // empty output that trivially contains no secret.
    expect((frame.output as { stdout: string }).stdout.length).toBeGreaterThan(5);
  });

  it('scrubs stderr as well as stdout', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    const frame = await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', 'echo "$DB_TOKEN" 1>&2']));
    expect(JSON.stringify(frame)).not.toContain(SECRET);
    expect((frame.output as { stderr: string }).stderr).toContain('[REDACTED:');
  });

  it('scrubs COMMON ENCODINGS, not just the raw literal', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    const b64 = Buffer.from(SECRET, 'utf8').toString('base64');
    const uri = encodeURIComponent(SECRET);
    const frame = await invokeAndWait(
      rig,
      bashInvoke('inv-1', ['sh', '-c', `printf '%s %s %s' "$DB_TOKEN" '${b64}' '${uri}'`]),
    );
    const wire = JSON.stringify(frame);
    expect(wire).not.toContain(SECRET);
    expect(wire).not.toContain(b64);
    expect(wire).not.toContain(uri);
  });
});

describe('a browser observation that carries the value leaves scrubbed too', () => {
  it('scrubs the page title, heading, a11y outline and URL query', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    rig.pageText.value = SECRET; // the page itself now echoes the credential
    const frame = await invokeAndWait(rig, browserInvoke('inv-1'));

    const wire = JSON.stringify(frame);
    expect(wire).not.toContain(SECRET);
    const data = frame.output as { title: string; heading: string; accessibilitySnapshot?: string; url: string };
    expect(data.title).toContain('[REDACTED:');
    expect(data.heading).toContain('[REDACTED:');
    expect(data.accessibilitySnapshot).toContain('[REDACTED:');
    expect(data.url).toContain('[REDACTED:');
  });

  it('leaves the SCREENSHOT alone - it is an image, not text', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    rig.pageText.value = SECRET;
    const frame = await invokeAndWait(rig, browserInvoke('inv-1'));
    expect(frame.screenshotB64).toBe(Buffer.from('PNG').toString('base64'));
  });
});

describe('the filter itself - scope and limits', () => {
  it('does NOT touch structural ids: substituting inside a join key would corrupt the join', () => {
    const r = new OutboundRedactor();
    r.register([SECRET]);
    const out = r.redactFrame({
      type: 'tool.result',
      invocationId: SECRET, // pathological on purpose
      ok: true,
      output: { stdout: SECRET },
    } as never) as { invocationId: string; output: { stdout: string } };
    expect(out.invocationId).toBe(SECRET);
    expect(out.output.stdout).toContain('[REDACTED:');
  });

  it('bounds the walk depth - an outbound body is arbitrary child output', () => {
    const r = new OutboundRedactor();
    r.register([SECRET]);
    let deep: unknown = SECRET;
    for (let i = 0; i < 40; i++) deep = { n: deep };
    // The point is that it TERMINATES rather than blowing the stack or hanging.
    expect(() => r.redactUnknown(deep)).not.toThrow();
  });

  it('surfaces an unmaskably short value instead of silently skipping it', () => {
    const r = new OutboundRedactor();
    r.register(['ab']);
    expect(r.unmaskable).toEqual(['ab']);
    expect(r.size).toBe(0);
  });

  it('is a NO-OP with nothing registered - it must not mangle ordinary output', () => {
    const r = new OutboundRedactor();
    const frame = { type: 'denial', taskId: 't1', reason: 'plain', principle: 'S2' } as never;
    expect(r.redactFrame(frame)).toBe(frame);
  });

  it('leaves session.push.storageState byte-exact - Cortex must store a WORKING session', () => {
    const r = new OutboundRedactor();
    r.register([SECRET]);
    const state = { cookies: [{ name: 'sid', value: SECRET }] };
    const out = r.redactFrame({ type: 'session.push', requestId: 'q1', origin: 'https://x.test', storageState: state } as never) as {
      storageState: typeof state;
    };
    // Mangling a captured session mints a perfectly valid, correctly-encrypted, USELESS Cofre item
    // that only fails later, somewhere else, as a login that does not work.
    expect(out.storageState).toEqual(state);
  });
});
