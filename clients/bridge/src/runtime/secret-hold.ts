/**
 * runtime/secret-hold.ts - the daemon half of the I9 one-time secret lifecycle.
 *
 * THE OBLIGATION, IN FULL. Cortex delivers a credential on `secret.deliver` because a
 * `local_command` step runs on the USER'S machine and the value has to get there. What the daemon
 * owes in return is precise and testable: hold it in RAM only, never on disk, never in a log, never
 * in the ledger - not even the env-var NAMES, which are themselves a map of what this tenant holds
 * - inject it into the child at execution time, and ZEROIZE it afterwards. Cortex enforces what
 * Cortex can (a delivery nonce, redeemed exactly once); this module is the other half, and the
 * `test/security/secret-*.test.ts` suites are what turn it from a promise into a property.
 *
 * WHY BUFFERS, AND WHY IT IS NOT PEDANTRY. A JavaScript string is immutable: there is no operation
 * that overwrites its bytes, and it lives in the heap until the collector happens to reach it -
 * which may be after a core dump, a heap snapshot, or a swap to disk. `buf.fill(0)` on a Buffer
 * overwrites the actual backing memory, synchronously, at a moment we choose. So the value is
 * copied into a Buffer the instant it arrives and every later hop works from that; a `string` is
 * materialised only transiently, inside `withChildEnv`, to build the child's environment (Node's
 * spawn API takes strings and there is no way around it), and that transient is dropped
 * immediately. This does NOT claim the transient is unrecoverable - it claims the RESIDENT copy,
 * the one that lives for the whole invocation, is overwritable and is overwritten. The frame's own
 * JSON.parse also produced strings we cannot reach; that is stated here rather than papered over,
 * and it is why the hold zeroizes what it owns instead of claiming the process is clean.
 */

/** How long a delivered-but-unused hold survives before it is swept and zeroized. A delivery whose
 *  invoke never arrives is a run that died; keeping the value resident past that is pure risk. */
const HOLD_TTL_MS = 5 * 60_000;

interface Hold {
  invocationId: string;
  nonce: string;
  /** env-var name -> value bytes. Names are plain (they are not the secret, but they are still
   *  never logged - see the module docblock); VALUES are only ever Buffers. */
  env: Map<string, Buffer>;
  createdAt: number;
}

export interface SecretHoldDeps {
  now?: () => number;
  ttlMs?: number;
  /** Called with the live values whenever a hold is created, so the outbound redactor can arm
   *  BEFORE anything can echo them, and again (with nothing) when a hold is zeroized. */
  onRegister?: (values: Buffer[]) => void;
  onRelease?: (invocationId: string) => void;
}

export class SecretHold {
  private readonly holds = new Map<string, Hold>();

  constructor(private readonly deps: SecretHoldDeps = {}) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * Take custody of a delivery. The incoming `env` values are strings (JSON.parse made them so);
   * they are copied into Buffers here and the caller must not retain the object it passed.
   *
   * A second delivery for the same invocation REPLACES the first and zeroizes it: two live copies
   * of a credential for one invocation is the exact condition Cortex's single-use nonce exists to
   * prevent, so if one ever reaches here the safe reading is "the older one is stale".
   */
  deliver(invocationId: string, nonce: string, env: Record<string, string>): void {
    this.sweep();
    const existing = this.holds.get(invocationId);
    if (existing) this.zeroizeHold(existing);

    const map = new Map<string, Buffer>();
    for (const [name, value] of Object.entries(env)) {
      if (typeof name !== 'string' || typeof value !== 'string') continue;
      map.set(name, Buffer.from(value, 'utf8'));
    }
    this.holds.set(invocationId, { invocationId, nonce, env: map, createdAt: this.now() });
    this.deps.onRegister?.([...map.values()]);
  }

  /** True when an invocation has credential material waiting. Never reveals what. */
  has(invocationId: string): boolean {
    this.sweep();
    return this.holds.has(invocationId);
  }

  /** The nonce the delivery carried, so a result can be joined to it. Not credential material. */
  nonceFor(invocationId: string): string | undefined {
    return this.holds.get(invocationId)?.nonce;
  }

  /** The env-var NAMES held for an invocation - for tests and for the injection allowlist check.
   *  Callers must not log these (the docblock explains why); the security suite asserts nobody does. */
  namesFor(invocationId: string): string[] {
    const held = this.holds.get(invocationId);
    return held ? [...held.env.keys()] : [];
  }

  /**
   * Run `fn` with the held values materialised as a plain env record, then zeroize and drop the
   * hold no matter how `fn` ends.
   *
   * THE `finally` IS THE WHOLE POINT. A child that throws, times out, or is killed must not leave a
   * credential resident - and "the caller will remember to clean up" is exactly the kind of
   * obligation that survives review and then does not survive the next refactor. The transient
   * strings built here go out of scope when `fn` returns; the Buffers are overwritten before it
   * does.
   */
  async withChildEnv<T>(
    invocationId: string,
    fn: (injected: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const held = this.holds.get(invocationId);
    if (!held) return fn({});
    const injected: Record<string, string> = {};
    for (const [name, buf] of held.env) injected[name] = buf.toString('utf8');
    try {
      return await fn(injected);
    } finally {
      // Overwrite the transient record's own values too. They are strings and therefore not
      // actually erasable - assigning over the property only drops the REFERENCE - but dropping the
      // reference is the most this layer can do and doing it is still better than holding it.
      for (const key of Object.keys(injected)) delete injected[key];
      this.zeroize(invocationId);
    }
  }

  /** Overwrite and forget one hold. Idempotent: a swept hold zeroized again is a no-op. */
  zeroize(invocationId: string): void {
    const held = this.holds.get(invocationId);
    if (!held) return;
    this.zeroizeHold(held);
    this.holds.delete(invocationId);
    this.deps.onRelease?.(invocationId);
  }

  /** Drop and zeroize every hold past its TTL. Called on every deliver/has so it needs no timer
   *  (a timer would keep the process alive and would be the one thing that stops on a busy loop). */
  sweep(): void {
    const ttl = this.deps.ttlMs ?? HOLD_TTL_MS;
    const now = this.now();
    for (const [id, held] of this.holds) {
      if (now - held.createdAt > ttl) {
        this.zeroizeHold(held);
        this.holds.delete(id);
        this.deps.onRelease?.(id);
      }
    }
  }

  /** Zeroize everything (daemon shutdown). */
  zeroizeAll(): void {
    for (const [id, held] of this.holds) {
      this.zeroizeHold(held);
      this.deps.onRelease?.(id);
    }
    this.holds.clear();
  }

  /** Live hold count. Tests assert it returns to zero; nothing else should need it. */
  get size(): number {
    return this.holds.size;
  }

  /**
   * Test seam: the Buffers a hold owns, WITHOUT consuming it. Named so its only legitimate use is
   * obvious - `secret-zeroize.test.ts` keeps a reference and asserts the bytes are 0 afterwards,
   * which is not observable any other way. It reads live credential bytes, so it exists to be
   * asserted on and never to be called from `src/`.
   */
  __buffersForZeroizeTest(invocationId: string): Buffer[] {
    return [...(this.holds.get(invocationId)?.env.values() ?? [])];
  }

  private zeroizeHold(held: Hold): void {
    for (const buf of held.env.values()) buf.fill(0);
    held.env.clear();
  }
}
