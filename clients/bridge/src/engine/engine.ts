/**
 * engine/engine.ts — the executor core (ADR-001). Given a VERIFIED delegated task, it parses the
 * structured TaskProgram, runs each fixed-vocabulary tool step through the containment-checked,
 * ledgered, capped tool layer, optionally performs the ONE bounded provider-compose round trip, and
 * assembles a DERIVED-OUTPUT-ONLY DelegationResult. It never contains a reasoning loop — Cortex is
 * the only brain (the compose step is a single request, not an agent turn).
 *
 * Transport-agnostic: the caller (serve / the integration harness) injects `providerComplete` (send a
 * provider_request and await the provider_response body) and reads the emitted rows off the ledger.
 * The engine returns the DelegationResult; wiring it to a `delegation_result` frame is the caller's
 * job. A ToolError from the tool layer maps to a terminal result status (cap → cap_reached, S1 → denied)
 * — derived-output-only in every case, never raw file bytes.
 */
import { createHash } from 'node:crypto';
import type { DelegatedTask, DelegationResult } from '../wire/index.js';
import type { GrantTable, EgressAccounting } from '../session/index.js';
import type { EgressLedger } from '../ledger/index.js';
import { read, list, glob, grep, stat, writeFile, extractText, ToolError, type ToolContext } from '../tools/index.js';
import { parseTaskProgram, type TaskProgram, type ToolStep } from './task-program.js';

/** Send a provider_request body to Cortex-as-provider and resolve its de-tokenized response body. The
 *  `correlationId` is the daemon-minted per-delegation id that Cortex records on the anon-audit and
 *  the daemon writes on every ledgered read — the S6 join key (§18.5 S6). */
export type ProviderComplete = (body: unknown, correlationId: string) => Promise<unknown>;

export interface EngineDeps {
  grantTable: GrantTable;
  egress: EgressAccounting;
  ledger: EgressLedger;
  /** The one bounded provider round trip; absent → a compose step yields a denied result. */
  providerComplete?: ProviderComplete;
  now?: () => number;
  /** Aborts a long program (a `cancel` frame). Checked between steps and before compose. */
  signal?: AbortSignal;
}

/** A citation collected from a read/stat step: path + range, never bytes (§18.2.2). */
interface Citation {
  path: string;
  range: string;
}

function terminal(status: DelegationResult['status'], egressBytes = 0): DelegationResult {
  return { status, citations: [], ledgerRefs: [], telemetry: { egressBytes, maskedCounts: {} } };
}

/**
 * Run a verified task. Returns a derived-output-only DelegationResult. The task's `correlationId` is
 * minted here per delegation (one per provider round trip, the S6 join key) and threaded to every
 * ledgered read so the daemon ledger row and the hosted anon-audit share it.
 */
export async function runDelegatedTask(task: DelegatedTask, deps: EngineDeps): Promise<DelegationResult> {
  const program = parseTaskProgram(task.task);
  if (!program) {
    // Not the fixed vocabulary (S3): refuse, ledgered as a denial by the caller via the returned
    // status. The engine records a denial row directly so no rejection path skips the ledger.
    deps.ledger.append({
      kind: 'denial',
      ts: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
      session: task.session,
      taskId: task.taskId,
      reason: 'task not executable: unsupported shape',
      principle: 'S3',
      tool: 'engine',
    });
    return terminal('denied');
  }

  const correlationId = `corr-${task.taskId}`;
  const ctx: ToolContext = {
    grantTable: deps.grantTable,
    egress: deps.egress,
    ledger: deps.ledger,
    session: task.session,
    taskId: task.taskId,
    correlationId,
    budgetBytes: task.budget.egressBytes,
    ...(deps.now ? { now: deps.now } : {}),
  };

  const citations: Citation[] = [];
  const excerpts = new Map<string, string>(); // `as`-named read texts — for the provider request ONLY
  const patches: { path: string; diff: string }[] = [];

  try {
    for (const step of program.steps) {
      if (deps.signal?.aborted) return { ...terminal('denied', deps.egress.used(task.session)), ledgerRefs: deps.ledger.ledgerRefs(task.session) };
      await runStep(step, ctx, program, citations, excerpts, patches);
    }

    let answer = program.answer;
    if (program.compose) {
      if (!deps.providerComplete) return terminal('denied', deps.egress.used(task.session));
      if (deps.signal?.aborted) return terminal('denied', deps.egress.used(task.session));
      answer = await compose(program.compose, excerpts, deps.providerComplete, correlationId);
    }

    const result: DelegationResult = {
      status: 'ok',
      citations,
      ledgerRefs: deps.ledger.ledgerRefs(task.session),
      telemetry: { egressBytes: deps.egress.used(task.session), maskedCounts: {} },
      ...(answer !== undefined ? { answer } : {}),
      ...(patches.length > 0 ? { patches } : {}),
    };
    // DERIVED-OUTPUT-ONLY guard: no raw excerpt text may appear in the result. The answer is a
    // provider-composed (de-tokenized) summary or a mint-time string; excerpts live only in `excerpts`
    // and cross the wire only inside the provider request. Assert the invariant structurally.
    assertNoRawExcerpts(result, excerpts);
    return result;
  } catch (err) {
    if (err instanceof ToolError) {
      // S5 cap → cap_reached; any S1 containment/grant/write refusal → denied. Both derived-only.
      return terminal(err.principle === 'S5' ? 'cap_reached' : 'denied', deps.egress.used(task.session));
    }
    throw err;
  }
}

async function runStep(
  step: ToolStep,
  ctx: ToolContext,
  program: TaskProgram,
  citations: Citation[],
  excerpts: Map<string, string>,
  patches: { path: string; diff: string }[],
): Promise<void> {
  switch (step.tool) {
    case 'read': {
      const r = read(ctx, step.grantRef, step.relPath, step.range);
      if (step.as) excerpts.set(step.as, r.text);
      if (step.cite || program.citeAll) citations.push({ path: step.relPath, range: r.byteRange });
      return;
    }
    case 'list':
      list(ctx, step.grantRef, step.relPath);
      return;
    case 'glob':
      glob(ctx, step.grantRef, step.pattern);
      return;
    case 'grep':
      await grep(ctx, step.grantRef, step.pattern, {
        ...(step.maxMatches !== undefined ? { maxMatches: step.maxMatches } : {}),
        ...(step.maxLineLength !== undefined ? { maxLineLength: step.maxLineLength } : {}),
      });
      return;
    case 'stat':
      stat(ctx, step.grantRef, step.relPath);
      if (step.cite || program.citeAll) citations.push({ path: step.relPath, range: '' });
      return;
    case 'extract_text': {
      const x = await extractText(ctx, step.grantRef, step.relPath);
      if (step.as) excerpts.set(step.as, x.text);
      if (step.cite || program.citeAll) citations.push({ path: step.relPath, range: `0-${x.bytesOut}` });
      return;
    }
    case 'write': {
      let body: Parameters<typeof writeFile>[3];
      if (step.content !== undefined) {
        body = { content: step.content };
      } else if (step.patch) {
        const p = step.patch;
        body = { patch: { find: p.find, replace: p.replace, ...(p.occurrence !== undefined ? { occurrence: p.occurrence } : {}) } };
      } else {
        throw new ToolError('write step has neither content nor patch', 'S1');
      }
      const w = writeFile(ctx, step.grantRef, step.relPath, body, {
        expectedSha256: step.expectedSha256,
        ...(step.confirmed !== undefined ? { confirmed: step.confirmed } : {}),
      });
      // A write is not an excerpt; surface it as a patch proposal record (path + a hash-summary diff).
      patches.push({ path: step.relPath, diff: `sha256 ${w.sha256Before.slice(0, 12)}→${w.sha256After.slice(0, 12)} (${w.bytesWritten}B)` });
      return;
    }
  }
}

/** The compose completion's output ceiling. The Messages wire REQUIRES max_tokens; found live —
 *  without it the real provider 400s and the answer silently degraded to '' (the harness transport
 *  is canned, so harness parity never exercised the requirement). */
const COMPOSE_MAX_TOKENS = 1024;

/**
 * Build the ONE provider request (Anthropic-messages shape) from the collected excerpts + instructions,
 * send it, and extract the answer text from the completion. The excerpts cross Boundary 1 here (in the
 * request body) — Cortex anonymises before Anthropic and de-tokenizes the response (ch17). The daemon
 * sends no `model`: Cortex's provider endpoint clamps it to its wire tier (§18.4, §6.5.4).
 */
async function compose(
  step: NonNullable<TaskProgram['compose']>,
  excerpts: Map<string, string>,
  providerComplete: ProviderComplete,
  correlationId: string,
): Promise<string> {
  const names = step.include ?? [...excerpts.keys()];
  const context = names
    .map((n) => excerpts.get(n))
    .filter((t): t is string => typeof t === 'string')
    .join('\n\n');
  const prompt = [step.instructions, context].filter(Boolean).join('\n\n');
  const body = { max_tokens: COMPOSE_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] };
  const response = await providerComplete(body, correlationId);
  const errorNote = providerErrorNote(response);
  if (errorNote !== undefined) return errorNote;
  return extractAnswerText(response);
}

/**
 * C5 (decisions.md 2026-07-11): a provider_response carrying an ERROR body must surface as an
 * honest PT note in the answer, never degrade to ''. The hosted side sends the Anthropic error
 * envelope {type:'error', error:{type, message}} for both admission refusals (CONV-2 codes, already
 * PT) and gateway failures (the ekoa-code diagnostics classes). No excerpt text is involved.
 */
function providerErrorNote(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const obj = response as Record<string, unknown>;
  if (obj.type !== 'error') return undefined;
  const err = (obj.error && typeof obj.error === 'object' ? obj.error : {}) as Record<string, unknown>;
  const type = typeof err.type === 'string' ? err.type : 'unknown_error';
  const message = typeof err.message === 'string' ? err.message : '';
  switch (type) {
    case 'ACCOUNT_DISABLED':
    case 'BILLING_LOCKED':
      // Admission refusals arrive with user-facing PT copy — pass it through.
      return message.length > 0 ? message : `A composição falhou: o serviço recusou o pedido (${type}).`;
    case 'authentication_error':
    case 'credential_error':
      return 'A composição falhou: o serviço recusou a credencial da ponte (erro de autenticação). Verifique o emparelhamento e a credencial do fornecedor no Cortex.';
    case 'rate_limit_error':
      return 'A composição falhou: o limite de utilização do serviço foi atingido. Tente novamente dentro de momentos.';
    default:
      return `A composição falhou: o serviço devolveu um erro (${type}).`;
  }
}

/** Pull the assistant text out of an Anthropic-shaped completion body (defensive over shapes). */
function extractAnswerText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    const content = obj.content;
    if (Array.isArray(content)) {
      return content
        .map((block) => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
        .join('');
    }
    if (typeof obj.text === 'string') return obj.text;
  }
  return '';
}

/**
 * Derived-output-only guard (§18.2.2, invariant I2): no raw excerpt the loop read may appear verbatim
 * in the outbound result. Throws if any non-trivial excerpt substring is found in the serialized
 * result — a structural backstop so a coding error can never leak file bytes into the hosted record.
 */
function assertNoRawExcerpts(result: DelegationResult, excerpts: Map<string, string>): void {
  const serialized = JSON.stringify(result);
  for (const text of excerpts.values()) {
    const probe = text.trim();
    if (probe.length >= 16 && serialized.includes(probe)) {
      throw new Error('derived-output-only violation: a raw file excerpt appeared in the DelegationResult');
    }
  }
}

/** sha256 hex of a string (utility for callers building write preconditions/tests). */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
