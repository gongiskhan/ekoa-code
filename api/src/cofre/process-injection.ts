/**
 * cofre/process-injection.ts — THE I9 primitive (Cofre WS-J / J-4).
 *
 * INVARIANT I9. Non-browser secret delivery goes only through a fixed Cortex primitive. Secrets
 * reach bash/script/desktop steps injected into the process ENVIRONMENT at execution time by this
 * function. Command strings, scripts and any model-authored step content may carry only the
 * reference NAME, never a value.
 *
 * WHAT THIS REPLACES, AND WHY IT IS A DELETION RATHER THAN A HARDENING. The only environment
 * channel that existed was the exact INVERSE of this primitive: `LocalCommandSpec.envWhitelist` was
 * a list of variable NAMES accepted from the planner (i.e. from a model), and `buildEnv` resolved
 * each name against the CORTEX API SERVER's own `process.env` — which holds the provider keys,
 * `ENCRYPTION_KEY`, `JWT_SECRET` and the database credentials — and shipped the values to a user's
 * machine. A model-authored `envWhitelist: ["JWT_SECRET"]` was a complete platform compromise
 * expressed as a normal step field.
 *
 * It was not reachable end-to-end at the time (`setDaemonConnectionResolver` was still on its
 * honest default at `server.ts`), so deleting it cost nothing then and would have been impossible
 * later. It is deleted, not extended, in the same change that adds this. THAT WINDOW HAS SINCE
 * CLOSED: `server.ts` wires the resolver to the live bridge registry, and each invocation is
 * grant-checked in `invokeTool` (I-3, default deny). Read the sentence above as history — not as a
 * claim that the path this primitive guards is still inert.
 *
 * THE SHAPE. A step declares `credentialRefs` plus a NAME MAPPING from env variable to reference.
 * Cortex resolves each reference through `unwrap({kind:'process'})` — so the grant, the tenancy and
 * the lock all apply exactly as they do to a browser fill — and returns the env for the child. The
 * values never touch the command string, the step record, or anything a model can read.
 */
import type { Actor } from '@ekoa/shared';
import { CREDENTIAL_REF_PATTERN } from '@ekoa/shared';
import { unwrap, recordUse, type UnwrapOptions } from './service.js';
import { SecretRegistry } from '../security/redaction.js';

/** A step's declared environment injection: `{ DB_TOKEN: 'cofre:itm_abc' }`. */
export type EnvInjectionMap = Record<string, string>;

export class EnvInjectionError extends Error {
  readonly code = 'ENV_INJECTION_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'EnvInjectionError';
  }
}

/** POSIX-ish environment variable names only. A name is attacker-influenced (it comes from a step
 *  declaration), and an exotic name is a way to smuggle shell syntax into an env assignment. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names the platform's own process relies on. Refused as INJECTION TARGETS so a step cannot
 * shadow the child's interpreter, loader or proxy configuration — the classic way to turn an
 * environment write into code execution.
 */
const REFUSED_ENV_NAMES = new Set([
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'BASH_ENV',
  'ENV',
  'IFS',
  'SHELL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
]);

export interface ResolvedEnvInjection {
  /** The environment to hand the child process. RAM-only; never persisted or logged. */
  env: Record<string, string>;
  /**
   * A registry pre-loaded with every injected value, so the caller can filter the child's stdout,
   * stderr and any step record through it. A secret-bearing process whose output is NOT filtered
   * fails I9's second half, so the primitive hands the filter back rather than trusting the caller
   * to build one.
   */
  secrets: SecretRegistry;
  /** Item ids that were injected — for the Registo row (ids only, never values). */
  itemIds: string[];
}

/**
 * Resolve a step's declared environment injection.
 *
 * Every failure is a refusal, never a partial environment: a child that starts with SOME of its
 * credentials is a confusing failure at best and a silent misauthentication at worst.
 */
export async function resolveEnvInjection(
  actor: Actor,
  mapping: EnvInjectionMap,
  opts: UnwrapOptions & { processLabel: string } = { processLabel: 'local_command' },
): Promise<ResolvedEnvInjection> {
  const env: Record<string, string> = {};
  const secrets = new SecretRegistry();
  const itemIds: string[] = [];

  for (const [name, ref] of Object.entries(mapping)) {
    if (!ENV_NAME.test(name)) {
      throw new EnvInjectionError(`invalid environment variable name: ${JSON.stringify(name)}`);
    }
    if (REFUSED_ENV_NAMES.has(name)) {
      throw new EnvInjectionError(
        `refusing to inject into ${name}: it controls how the child process loads or routes, ` +
          'so writing it turns an environment injection into code execution',
      );
    }
    if (!CREDENTIAL_REF_PATTERN.test(ref)) {
      // THE I9 LINE: a step may carry a reference NAME, never a value. A raw secret here is a
      // programming error in the caller, and it must fail rather than be forwarded.
      throw new EnvInjectionError(
        `${name} must be bound to an opaque cofre: reference, never a value`,
      );
    }
    const itemId = ref.slice('cofre:'.length);
    const { value } = await unwrap(itemId, actor, { kind: 'process', processLabel: opts.processLabel }, opts);
    env[name] = value;
    secrets.register(value);
    itemIds.push(itemId);
  }

  return { env, secrets, itemIds };
}

/** Mark every injected item used, after the child has actually been started. */
export async function recordEnvInjectionUse(
  actor: Actor,
  itemIds: readonly string[],
  usedBy: string,
  now = Date.now(),
): Promise<void> {
  for (const id of itemIds) await recordUse(actor, id, usedBy, now);
}
