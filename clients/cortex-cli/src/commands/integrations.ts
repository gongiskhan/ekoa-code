/**
 * `cortex integrations ...` - the connected-service surface: what is installed, what one
 * integration can actually do, and the two ways to make it act (a named action, or a goal).
 *
 * TWO ANSWERS THIS GROUP HAS TO READ PROPERLY, because a naive client reads both as success:
 *
 *  1. A FAILED ACTION IS AN HTTP 200. `execute` answers 200 with `{ success: false, code, error }`
 *     whenever the call was addressed and permitted and then did not work - the integration is not
 *     connected, the credential is locked, the remote answered 500. That is the contract's
 *     deliberate split (a remote failure is an answer ABOUT the remote system, not a failure of
 *     Cortex), and its consequence is that the HTTP status alone never tells you whether the action
 *     ran. So `success` is read here and a false one is exit 1 with the error document, which is
 *     what makes `if cortex integrations execute ...` mean what it looks like it means.
 *
 *  2. A MUTATING ACTION IS GATED, and the gate answers 403 carrying `details.code =
 *     'awaiting_consent'` plus the descriptor a human must be shown. THIS CLI CANNOT ANSWER IT:
 *     `POST /api/v1/integrations/:key/actions/:actionName/approval` is `auth: 'user'` and is
 *     deliberately absent from the key-reachable surface, precisely so an agent refused at the gate
 *     cannot approve the shape it was just handed. The descriptor is surfaced intact - it names the
 *     real destination, which is the part a person needs in order to answer - and the exit code
 *     is 1.
 */
import { noExtraPositionals, parseArgs, positional, valueOrPositional, type ParsedArgs } from '../args.js';
import { CortexApiError, type ResultData } from '../client.js';
import { RuntimeFailure, UsageError } from '../errors.js';
import type { CommandGroup, Ctx } from '../context.js';
import { pad, printJson } from '../output.js';

/** The execute body, taken from the generated contract rather than re-declared. */
type ExecuteResponse = ResultData<'integrations.executeAction'>;

/** The achieve body, likewise from the generated contract. */
type AchieveResponse = ResultData<'integrations.achieve'>;

/** The code reported when a failed action names no code of its own. */
const UNSPECIFIED_FAILURE = 'action_failed';

const USAGE = `cortex integrations <command>

  list     list the integrations the caller can see
  show     one integration: whether it is connected, and every action with its write gate
             cortex integrations show <key>
  execute  run ONE named action        cortex integrations execute <key> <actionName>
             --arg k=v                 repeatable; values are strings
             --args-json <json>        whole args object as JSON (mutually exclusive with --arg)
  achieve  state a goal and let Cortex pick the action, fill its arguments, narrow its answer,
           or write a new one
             cortex integrations achieve <key> --goal "<text>" [--arg k=v]

Every command accepts --json.

A FAILED ACTION IS AN HTTP 200. execute answers 200 carrying { "success": false, "code": ... }
whenever the call was addressed and permitted and then did not work - "not_connected" is the common
one. This command reads that field, so success:false is exit 1 with the error document, never a
success. The HTTP status alone never tells you whether the action ran.

A MUTATING ACTION NEEDS A HUMAN. It answers 403 with details.code = "awaiting_consent" and the
descriptor of what would have run, which is printed. THIS CLI CANNOT GRANT THAT APPROVAL: the
approval endpoint is a platform-session endpoint, deliberately off the key-reachable surface, so a
person must approve the action in the Ekoa UI before it can run.

achieve HAS FOUR OUTCOMES AND TWO OF THEM EXIT 0. "executed" ran an action; "composed" ran a trusted
READ and narrowed its rows against one of your own app collections. "authored" wrote a provisional
action that has NOT run, and "refused" declined - both exit 1. On "composed", items is a SUBSET and
result is the action's own answer whole: a next-page cursor lives there, so items alone can read as
a complete answer when it is one page of several.`;

async function list(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 0);
  const res = await ctx.client.call('integrations.list', {});
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'integrations list', status: res.status, data: res.data });
    return;
  }
  if (res.data.items.length === 0) {
    ctx.io.out('no integrations');
    return;
  }
  const width = Math.max(...res.data.items.map((i) => i.key.length));
  for (const i of res.data.items) {
    ctx.io.out(`${pad(i.key, width)}  ${i.authType ?? '-'}  ${i.displayName ?? ''}`.trimEnd());
  }
}

async function show(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const key = valueOrPositional(args, 'key', 0, 'key');
  const res = await ctx.client.call('integrations.getIntegration', { path: { key } });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'integrations show', status: res.status, data: res.data });
    return;
  }
  const capability = res.data;
  ctx.io.out(`${capability.integration.key}  ${capability.integration.displayName ?? ''}`.trimEnd());
  ctx.io.out(`connected: ${capability.connected ? 'yes' : 'no'}   actions: ${capability.actions.length}`);
  // Said here rather than left to be discovered: a disconnected integration still lists its actions
  // and still accepts an execute, and that execute comes back HTTP 200 with success:false.
  if (!capability.connected) {
    ctx.io.out('not connected: execute will answer HTTP 200 with success:false, code "not_connected"');
  }
  if (capability.actions.length === 0) return;
  const nameWidth = Math.max(...capability.actions.map((a) => a.actionName.length));
  const gateWidth = Math.max(...capability.actions.map((a) => gateOf(a).length));
  for (const action of capability.actions) {
    ctx.io.out(`  ${pad(action.actionName, nameWidth)}  ${pad(gateOf(action), gateWidth)}  ${action.target}`);
    if (action.description) ctx.io.out(`      ${action.description}`);
  }
}

/** Where this caller stands with the write gate, in one word. */
function gateOf(action: { requiresApproval: boolean; approved: boolean }): string {
  if (!action.requiresApproval) return 'read-only';
  return action.approved ? 'approved' : 'needs-approval';
}

async function execute(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 2);
  const key = args.values.get('key') ?? positional(args, 0, 'key');
  const actionName = args.values.get('action') ?? positional(args, args.values.has('key') ? 0 : 1, 'actionName');
  const actionArgs = collectArgs(args);

  const res = await reportingConsent(ctx, () =>
    ctx.client.call('integrations.executeAction', {
      path: { key, actionName },
      body: actionArgs === undefined ? {} : { args: actionArgs },
    }),
  );

  refuseFailedAction(`${key}/${actionName}`, res.data);

  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'integrations execute', status: res.status, data: res.data });
    return;
  }
  printActionResult(ctx, `${key}/${actionName}`, res.data);
}

async function achieve(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const key = valueOrPositional(args, 'key', 0, 'key');
  const goal = args.values.get('goal');
  if (goal === undefined || goal.trim() === '') throw new UsageError('achieve needs --goal "<text>"');
  const actionArgs = collectArgs(args);

  const res = await reportingConsent(ctx, () =>
    ctx.client.call('integrations.achieve', {
      path: { key },
      body: { goal, ...(actionArgs === undefined ? {} : { args: actionArgs }) },
    }),
  );
  const body = res.data;
  const what = `${key}/${body.actionName ?? '?'}`;

  // THE TWO OUTCOMES THAT RAN THE ACTION, and `composed` is one of them.
  //
  // This branch used to read `outcome === 'executed'` alone, so a COMPOSED answer - a trusted read
  // that ran, whose rows were then narrowed against one of the caller's own collections - fell into
  // the "nothing ran" arm below and exited 1 with the code `authored` and the words "has NOT run",
  // printing nothing at all on stdout. The platform had done the work, correctly, and the client
  // reported it as a failed goal. A rung whose answer is right at the route and wrong here is
  // wrong: this is where a script and a person actually meet it.
  //
  // Both arms carry the IDENTICAL execute body under `result`, so a failed one is a failed command
  // however it was reached - one rule for both outcomes and both subcommands, not three dialects.
  if (body.outcome === 'executed' || body.outcome === 'composed') {
    if (body.result) refuseFailedAction(what, body.result);
  } else {
    // NOTHING RAN, and it still arrived as HTTP 200. `authored` wrote a PROVISIONAL action that
    // cannot run until a person promotes it (`requiresApproval` is always true for it), and
    // `refused` declined outright. The goal did not happen either way, so exiting 0 would tell a
    // script that it did.
    throw new RuntimeFailure(
      body.outcome === 'refused' ? (body.code ?? 'refused') : 'authored',
      body.outcome === 'refused'
        ? `goal refused for ${key}: ${body.message ?? 'no reason given'}`
        : `goal not achieved: action "${body.actionName ?? '?'}" was written for ${key} as provisional and has NOT run - a person must promote it first`,
      body,
    );
  }

  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'integrations achieve', status: res.status, data: body });
    return;
  }
  if (body.outcome === 'composed') {
    printComposedResult(ctx, what, body);
    return;
  }
  printActionResult(ctx, what, body.result);
}

/**
 * THE 200 THAT IS NOT A SUCCESS.
 *
 * A body saying `success: false` means the action did not work, so the command fails with the
 * executor's OWN code (`not_connected`, ...) kept verbatim - that token is what a caller branches
 * on, and translating it would invent a second vocabulary for the same fact. The whole body rides
 * in `details` because stdout is empty on a failure and the error document is then the only place
 * the upstream status and payload can travel.
 */
function refuseFailedAction(what: string, body: ExecuteResponse): void {
  if (body.success) return;
  const upstream = body.status === undefined ? '' : ` (upstream HTTP ${body.status})`;
  throw new RuntimeFailure(
    body.code ?? UNSPECIFIED_FAILURE,
    `${what} failed${upstream}: ${body.error ?? 'the integration reported a failure with no message'}`,
    body,
  );
}

/** The one-line verdict of an action that ran, plus whatever it returned. */
function printActionResult(ctx: Ctx, what: string, body: ExecuteResponse | undefined): void {
  const upstream = body?.status === undefined ? '' : `  (upstream HTTP ${body.status})`;
  ctx.io.out(`ok  ${what}${upstream}`);
  if (body?.data !== undefined) ctx.io.out(JSON.stringify(body.data, null, 2));
}

/**
 * A COMPOSED answer, for a person: the verdict line, how the rows were narrowed, THE ACTION'S OWN
 * ANSWER WHOLE, and then the rows that survived. The narrowing is printed rather than left implicit
 * because a shorter list is indistinguishable from a complete one - which is the failure this whole
 * rung is built around - and a person who is not told their answer was joined against `clients`
 * cannot tell either.
 *
 * THE ENVELOPE IS PRINTED, AND ITS ABSENCE WAS THE THIRD VARIANT OF THIS RUNG'S SHARPEST DEFECT -
 * the dangerous one, because the caller could not see it. The composition is a POST-STAGE: the
 * module carries the arm's whole answer on `result`, the route projects it, `--json` prints it. The
 * HUMAN path threw it away and printed `items` alone, so every field standing BESIDE the list
 * inside `data` - a `nextPage` cursor above all, a `total`, a `hasMore` - never reached the one
 * reader who cannot go and look it up. The composed line tells them the rows were NARROWED; nothing
 * told them what they were narrowed FROM was itself one page. So a join over the first page of a
 * paginated read printed identically to the same join over the whole of it, and for "todos os
 * processos de clientes com menos de 40 anos" that is a lawyer reading a partial case list as the
 * complete one.
 *
 * `execute` has always printed the action's `data` whole (`printActionResult`), so this is the same
 * rendering plus the narrowing rather than a new dialect: a composed answer now shows a person
 * everything an executed one would have, and the subset on top.
 *
 * THE ENVELOPE GOES ABOVE THE ROWS, deliberately. `items` is capped at 200 rows, and a partiality
 * signal underneath 200 rows of JSON is a signal nobody reads.
 */
function printComposedResult(ctx: Ctx, what: string, body: AchieveResponse): void {
  const upstream = body.result?.status === undefined ? '' : `  (upstream HTTP ${body.result.status})`;
  ctx.io.out(`ok  ${what}${upstream}`);
  const c = body.composition;
  if (c) {
    // Both truncation flags share one clause because they are one fact for the reader: what is
    // printed below is PART of the answer. Which cap did it is in `composition`, under --json.
    const partial = c.truncated || c.collectionTruncated ? ' - PART of the answer, not all of it' : '';
    ctx.io.out(`composed  ${c.matched} of ${c.scanned} rows kept, joined against "${c.collection}"${partial}`);
  }
  // Printed whenever the action returned a body at all, and NOT reduced to "the interesting bits":
  // deciding which siblings of the list matter would mean this client guessing which key a given
  // third party paginates with, and the one it guessed wrong about is the one that would go missing.
  if (body.result?.data !== undefined) {
    ctx.io.out('the action\'s own answer, whole - the rows below are a subset of it:');
    ctx.io.out(JSON.stringify(body.result.data, null, 2));
  }
  ctx.io.out('rows kept:');
  ctx.io.out(JSON.stringify(body.items ?? [], null, 2));
}

/**
 * Run one call and, in HUMAN mode, print the write gate's descriptor before the failure line.
 * `report()` prints a code and a message, and the descriptor is the part a person actually needs:
 * it names the real destination the call would have written to.
 *
 * AND, ON `achieve`, WHAT A MODEL PUT IN THE CALL. The gate refuses before the request goes out, so
 * this is the one moment a human is in the loop on this write - and until the platform started
 * sending them, the person was shown a destination and a fingerprint and no way at all to see that
 * a model had chosen the `titulo` they were being asked to authorise. Names alone authorise
 * nothing, so the VALUES are printed. Both are absent from an `/execute` refusal, whose arguments
 * are the caller's own.
 *
 * Under `--json` nothing extra is written. All of it already travels intact in the error document's
 * `details`, and stderr must stay exactly one parseable document.
 */
async function reportingConsent<T>(ctx: Ctx, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!ctx.json && error instanceof CortexApiError) {
      const consent = consentRequestOf(error);
      if (consent) {
        ctx.io.err('awaiting_consent: this action changes data, and the account holder must approve it before it runs.');
        ctx.io.err(`  integration: ${consent.integrationKey}`);
        ctx.io.err(`  action:      ${consent.actionName}`);
        ctx.io.err(`  description: ${consent.description}`);
        ctx.io.err(`  target:      ${consent.target}`);
        ctx.io.err(`  shape:       ${consent.shape}`);
        for (const line of modelDecisionLines(error)) ctx.io.err(line);
        ctx.io.err('This CLI CANNOT grant that approval: POST /api/v1/integrations/:key/actions/:actionName/approval');
        ctx.io.err('is a platform-session endpoint and is deliberately not key-reachable, so a key refused at the');
        ctx.io.err('gate cannot approve itself. A person must approve this action in the Ekoa UI.');
      }
    }
    throw error;
  }
}

/**
 * What a model decided about this call, from the refusal's own `details`: the arguments it filled
 * with the values it chose, and the rungs that ran above the action. Every field is checked rather
 * than trusted - `details` is server-supplied JSON, and this is text a person reads before
 * authorising a write, so a half-shaped one prints nothing rather than the word `undefined`.
 */
function modelDecisionLines(error: CortexApiError): string[] {
  if (error.details === null || typeof error.details !== 'object') return [];
  const details = error.details as Record<string, unknown>;
  const lines: string[] = [];
  const values = details.filledArgValues;
  if (values !== null && typeof values === 'object' && !Array.isArray(values)) {
    const entries = Object.entries(values as Record<string, unknown>)
      .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
    if (entries.length > 0) {
      lines.push('  a model filled these arguments - you are approving these values:');
      for (const [name, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`    ${name} = ${JSON.stringify(value)}`);
      }
    }
  }
  if (Array.isArray(details.ladder)) {
    const rungs = details.ladder
      .filter((s): s is { rung: string; verdict: string } =>
        s !== null && typeof s === 'object' && typeof (s as { rung?: unknown }).rung === 'string'
        && typeof (s as { verdict?: unknown }).verdict === 'string')
      .map((s) => `${s.rung}: ${s.verdict}`);
    if (rungs.length > 0) lines.push(`  ladder:      ${rungs.join(', ')}`);
  }
  return lines;
}

interface ConsentDescriptor {
  integrationKey: string;
  actionName: string;
  description: string;
  target: string;
  shape: string;
}

/**
 * The write gate's descriptor, if this refusal IS the write gate. Every field is checked rather
 * than trusted: `details` is server-supplied JSON, and a half-shaped one must not print the word
 * `undefined` where a person is being asked to read a destination.
 */
function consentRequestOf(error: CortexApiError): ConsentDescriptor | undefined {
  if (error.details === null || typeof error.details !== 'object') return undefined;
  const details = error.details as Record<string, unknown>;
  if (details.code !== 'awaiting_consent') return undefined;
  if (details.consentRequest === null || typeof details.consentRequest !== 'object') return undefined;
  const fields = details.consentRequest as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' && value !== '' ? value : '-');
  return {
    integrationKey: text(fields.integrationKey),
    actionName: text(fields.actionName),
    description: text(fields.description),
    target: text(fields.target),
    shape: text(fields.shape),
  };
}

/**
 * `--arg k=v` (repeatable) or `--args-json '{...}'`, never both - the same split `automations run`
 * makes between `--input` and `--inputs-json`. A `--arg` VALUE is always a string, so an action
 * wanting a number, a boolean or a nested object takes the JSON escape rather than a guess made
 * here about what `k=1` was meant to be.
 */
function collectArgs(args: ParsedArgs): Record<string, unknown> | undefined {
  const pairs = args.multi.get('arg');
  const raw = args.values.get('args-json');
  if (pairs && raw !== undefined) throw new UsageError('--arg and --args-json are mutually exclusive');
  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (cause) {
      throw new UsageError(`--args-json is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UsageError('--args-json must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  }
  if (!pairs) return undefined;
  const collected: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new UsageError(`--arg must be key=value, got "${pair}"`);
    collected[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return collected;
}

export const integrationsCommand: CommandGroup = {
  name: 'integrations',
  summary: 'connected services: list, show, execute one action, achieve a goal',
  usage: USAGE,
  async run(ctx, argv) {
    const [sub, ...rest] = argv;
    switch (sub) {
      case 'list':
        return list(ctx, parseArgs(rest, {}));
      case 'show':
        return show(ctx, parseArgs(rest, { values: ['key'] }));
      case 'execute':
        return execute(ctx, parseArgs(rest, { values: ['key', 'action', 'args-json'], multi: ['arg'] }));
      case 'achieve':
        return achieve(ctx, parseArgs(rest, { values: ['key', 'goal', 'args-json'], multi: ['arg'] }));
      default:
        throw new UsageError(
          sub === undefined ? 'integrations needs a command' : `unknown command "integrations ${sub}"`,
        );
    }
  },
};
