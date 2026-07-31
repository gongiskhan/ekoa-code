import { describe, it, expect, afterEach } from 'vitest';
import { installPipeGuard, EXIT_OK } from '../src/output.js';

/**
 * The pipe guard's two streams are NOT symmetric, and a previous version treated them as if they
 * were: it exited 0 on EPIPE for stdout AND stderr. Stdout is honest - the reader got what it
 * asked for. Stderr is written only on the FAILURE path, so exiting 0 there reports a failing
 * command as a success, and the garrison spool drain deletes a capture on exit 0. That shape
 * (`cortex memory write ... 2>&1 | head`) would have discarded a note that never landed.
 *
 * The fix shipped without this test. It is here because the asymmetry is invisible to a reader
 * who sees two handlers doing "the same thing", so the next person to tidy them into a loop
 * reintroduces silent data loss with every gate still green.
 *
 * The `exit` seam on installPipeGuard exists precisely so this can be driven in-process.
 */
describe('the pipe guard is deliberately asymmetric', () => {
  const added: Array<{ stream: NodeJS.EventEmitter; fn: (...args: never[]) => void }> = [];

  function arm(): number[] {
    const exits: number[] = [];
    const before = {
      out: process.stdout.listeners('error').slice(),
      err: process.stderr.listeners('error').slice(),
    };
    installPipeGuard(((code: number) => {
      exits.push(code);
      // Not a real exit: the seam must return so the emit call unwinds.
      return undefined as never;
    }) as (code: number) => never);
    for (const [stream, prior] of [
      [process.stdout, before.out],
      [process.stderr, before.err],
    ] as const) {
      for (const fn of stream.listeners('error')) {
        if (!prior.includes(fn)) added.push({ stream, fn: fn as (...args: never[]) => void });
      }
    }
    return exits;
  }

  afterEach(() => {
    for (const { stream, fn } of added.splice(0)) stream.removeListener('error', fn);
  });

  const epipe = (): NodeJS.ErrnoException => Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

  it('exits 0 on a stdout EPIPE: the reader already has its result', () => {
    const exits = arm();
    process.stdout.emit('error', epipe());
    expect(exits).toEqual([EXIT_OK]);
  });

  it('does NOT exit on a stderr EPIPE, so a failing command keeps its exit code', () => {
    const exits = arm();
    const before = process.exitCode;
    process.stderr.emit('error', epipe());
    // The whole finding: no exit(0), and nothing touched the code the run determined.
    expect(exits).toEqual([]);
    expect(process.exitCode).toBe(before);
  });

  it('re-throws a non-EPIPE stream error on both streams rather than hiding a real fault', () => {
    arm();
    const enospc = Object.assign(new Error('no space'), { code: 'ENOSPC' });
    expect(() => process.stdout.emit('error', enospc)).toThrow('no space');
    expect(() => process.stderr.emit('error', enospc)).toThrow('no space');
  });
});
