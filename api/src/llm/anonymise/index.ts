/**
 * llm/anonymise/index.ts - the anonymisation service interface (the §17.7 edge-boundary line)
 * and the per-request pipeline (§17.3). This is the clean seam a future edge deployment
 * slots into without a call-site change; callers depend on `anonymize` / `deanonymize` and
 * never on detector internals or on where the service runs.
 *
 * Pipeline per request (§17.3): collect model-bound text -> detect on the WHOLE text every turn
 * (deterministic per-session tokens keep the tokenized prefix byte-identical for the prompt
 * cache; no delta shortcut - see `anonymize`) ->
 * deterministic FORMAT-PRESERVING per-session tokenization -> forward -> de-tokenize the
 * response INCLUDING tool_use argument blocks -> stream de-tokenization with minimal straddle
 * buffering. Fail-closed: a payload the mandatory detectors could not process is REFUSED, never
 * forwarded un-tokenized.
 */
import { randomUUID } from 'node:crypto';
import type {
  AnonymiseContext,
  AnonymiseResult,
  EntityClass,
  OrgRuleset,
  VaultHandle,
} from './types.js';
import { detect } from './detectors.js';
import {
  openVault,
  tokenFor,
  tokensOf,
  maxTokenLength,
  clearSession,
} from './vault.js';
import { recordAnonAudit, sha256, type AnonAuditRecord } from './audit.js';

export type {
  AnonymiseContext,
  AnonymiseResult,
  OrgRuleset,
  VaultHandle,
  EntityClass,
} from './types.js';
export { setNerDetector, dictionaryNer, __resetNerForTests, type NerDetector } from './detectors.js';
export { setAuditSink, __resetAuditForTests, type AuditSink, type AnonAuditRecord } from './audit.js';
export {
  clearSession,
  openVault,
  __resetVaultForTests,
  __setVaultClockForTests,
  __setVaultTtlForTests,
  __vaultCount,
} from './vault.js';

/** A fail-closed refusal: the mandatory detectors ((a) structured-ID, (b) deny-list) could not
 *  run, so the payload is refused rather than forwarded un-tokenized (§17.3). Surfaces through
 *  the ch03 error envelope at the caller. */
export class AnonymisationRefusedError extends Error {
  constructor(message = 'anonymisation mandatory detectors unavailable - request refused (ch17 §17.3)') {
    super(message);
    this.name = 'AnonymisationRefusedError';
  }
}

/** Mint the per-provider-request correlation id (§17.6). Join key for the audit record and,
 *  through delegation, the local egress ledger. */
export function newCorrelationId(): string {
  return `anon_${randomUUID()}`;
}

// --- Ruleset resolution seam (the §17.7 edge-boundary line: ruleset loads as config) -----

/** orgId -> loaded ruleset. Default is an empty ruleset (structured-ID + NER on, no deny-list);
 *  the composition root injects the real per-org loader. */
export type RulesetResolver = (orgId: string) => Promise<OrgRuleset> | OrgRuleset;
const defaultRulesetResolver: RulesetResolver = (orgId) => ({ orgId });
let rulesetResolver: RulesetResolver = defaultRulesetResolver;

export function setRulesetResolver(fn: RulesetResolver): void {
  rulesetResolver = fn;
}
export function __resetRulesetResolverForTests(): void {
  rulesetResolver = defaultRulesetResolver;
}
export async function resolveRuleset(orgId: string): Promise<OrgRuleset> {
  return rulesetResolver(orgId);
}

// --- Tokenization core -------------------------------------------------------------------

interface TokenizeOutcome {
  text: string;
  classes: Partial<Record<EntityClass, number>>;
  entityCount: number;
  nerAvailable: boolean;
  mandatoryOk: boolean;
  /** count of deny-list literals decrypted+consulted for this text (§17.4 b access-log, D3). */
  denyAccessCount: number;
}

/** Detect + replace on one piece of text. Position-based reconstruction keeps replacement exact;
 *  repeated identical values map to the same token (determinism). Detection runs on the WHOLE
 *  text (no delta shortcut) so a value that grows across the prior-turn boundary is never split
 *  into two non-hits; the tokenized prefix stays byte-identical across turns via deterministic
 *  per-session tokens, not by reusing a cached prefix (§17.3 step 2, §17.5). */
function tokenizeText(text: string, handle: VaultHandle, ruleset: OrgRuleset): TokenizeOutcome {
  let denyAccessCount = 0;
  const { spans, nerAvailable, mandatoryOk } = detect(text, ruleset, (n) => {
    denyAccessCount += n;
  });
  if (!mandatoryOk) return { text, classes: {}, entityCount: 0, nerAvailable, mandatoryOk: false, denyAccessCount };

  const byClass = new Map<EntityClass, Set<string>>();
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let idx = 0;
  for (const s of ordered) {
    out += text.slice(idx, s.start) + tokenFor(handle, s.value, s.cls);
    idx = s.end;
    let set = byClass.get(s.cls);
    if (!set) byClass.set(s.cls, (set = new Set()));
    set.add(s.value);
  }
  out += text.slice(idx);

  const classes: Partial<Record<EntityClass, number>> = {};
  let entityCount = 0;
  for (const [cls, set] of byClass) {
    classes[cls] = set.size;
    entityCount += set.size;
  }
  return { text: out, classes, entityCount, nerAvailable, mandatoryOk: true, denyAccessCount };
}

function auditFor(ctx: AnonymiseContext, correlationId: string, cleartext: string, o: TokenizeOutcome, refused = false): void {
  const rec: AnonAuditRecord = {
    correlationId,
    classes: o.classes,
    entityCount: o.entityCount,
    payloadHash: sha256(cleartext),
    nerAvailable: o.nerAvailable,
    // Metadata-only access-log for the encrypted deny-list (§17.4 b, D3): the COUNT of secret
    // literals consulted, never the literals themselves.
    ...(o.denyAccessCount > 0 ? { denyListAccessed: o.denyAccessCount } : {}),
    ...(refused ? { refused: true } : {}),
  };
  recordAnonAudit(ctx.actor ?? {}, rec);
}

/**
 * Anonymise one piece of model-bound text (§17.7 `anonymize`). Detects on the WHOLE text every
 * turn: cache-prefix stability (§17.3 step 2 / §17.5) comes from DETERMINISTIC per-session
 * tokenization - the same real value always maps to the same token within a session, so a growing
 * prompt's tokenized prefix is byte-identical across turns without a delta shortcut. The old
 * detect-on-delta reuse split a value straddling the prior-turn boundary into two non-hits and
 * leaked it in cleartext (dual-review HIGH/Critical); detecting the full text closes that. Fails
 * closed on a mandatory-detector outage.
 */
export function anonymize(text: string, ctx: AnonymiseContext): AnonymiseResult {
  const handle = openVault(ctx.sessionId);
  const correlationId = ctx.correlationId ?? newCorrelationId();

  const o = tokenizeText(text, handle, ctx.ruleset);
  if (!o.mandatoryOk) {
    auditFor(ctx, correlationId, text, o, true);
    throw new AnonymisationRefusedError();
  }
  auditFor(ctx, correlationId, text, o);
  return { text: o.text, handle, correlationId };
}

/**
 * Anonymise a Messages-shaped request body (§17.3 step 1): the §17.7 payload variant. Deep-walks
 * `system` + `messages` (text blocks, tool_result and tool_use string leaves) and tokenizes each
 * against the ONE session vault + correlation id, auditing the request once. `tools` schema text
 * is left intact (structure, not data). Returns the tokenized body carrying tokens only.
 */
export function anonymizeRequestBody(
  body: Record<string, unknown>,
  ctx: AnonymiseContext,
): { body: Record<string, unknown>; handle: VaultHandle; correlationId: string } {
  const handle = openVault(ctx.sessionId);
  const correlationId = ctx.correlationId ?? newCorrelationId();

  const classes: Partial<Record<EntityClass, number>> = {};
  let entityCount = 0;
  let nerAvailable = true;
  let mandatoryOk = true;
  let denyAccessCount = 0;
  const parts: string[] = [];

  const tokenizeLeaf = (s: string): string => {
    parts.push(s);
    const o = tokenizeText(s, handle, ctx.ruleset);
    if (!o.mandatoryOk) mandatoryOk = false;
    if (!o.nerAvailable) nerAvailable = false;
    denyAccessCount += o.denyAccessCount;
    // Accumulate per-leaf distinct counts. A value repeated across leaves maps to the same
    // token (determinism); the audit metadata counts tokenized spans, which is enough.
    for (const [cls, count] of Object.entries(o.classes) as Array<[EntityClass, number]>) {
      classes[cls] = (classes[cls] ?? 0) + count;
      entityCount += count;
    }
    return o.text;
  };

  const nextBody: Record<string, unknown> = { ...body };
  if (body.system !== undefined) nextBody.system = mapStringLeaves(body.system, tokenizeLeaf);
  if (body.messages !== undefined) nextBody.messages = mapStringLeaves(body.messages, tokenizeLeaf);
  // `tools` definitions carry content-bearing text (descriptions, input_schema enums/defaults)
  // that can embed PII (§17.3 step 1, dual-review Critical); walk their string leaves too. The
  // structural keys are strings but tokenization only rewrites values it detects as entities.
  if (body.tools !== undefined) nextBody.tools = mapStringLeaves(body.tools, tokenizeLeaf);

  const outcome: TokenizeOutcome = { text: '', classes, entityCount, nerAvailable, mandatoryOk, denyAccessCount };
  if (!mandatoryOk) {
    auditFor(ctx, correlationId, parts.join(' '), outcome, true);
    throw new AnonymisationRefusedError();
  }
  auditFor(ctx, correlationId, parts.join(' '), outcome);
  return { body: nextBody, handle, correlationId };
}

/** Deep-map every string leaf of a JSON-ish value through `fn` (clone; never mutate input). */
function mapStringLeaves(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStringLeaves(v, fn));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStringLeaves(v, fn);
    return out;
  }
  return value;
}

// --- De-tokenization ---------------------------------------------------------------------

/**
 * F26 — the RETURN path is format-tolerant. A model routinely reformats a token it echoes:
 * a digit token `200000005` comes back `200 000 005` / `200.000.005`, a two-word PARTY/PERSON
 * token gets its internal space wrapped to a newline. Exact-substring matching then misses it
 * and the user sees the synthetic token instead of their real value. This builds, per token, a
 * regex that matches the token's OWN character sequence with only insignificant separators
 * allowed BETWEEN adjacent characters — never weakening detection/tokenisation, and bounded so
 * an unrelated grouped number is never rewritten.
 *
 * Rules (return path only):
 *  - between two DIGITS: up to 2 grouping separators (space, tab, NBSP, thin space, '.', "'").
 *  - where the token char itself is a SPACE (multi-word names): 1-4 whitespace chars incl. newline.
 *  - elsewhere (letters, the literal '/'/'.' inside a PROCESSO token): up to 2 plain-space/NBSP.
 *  - digit-EDGE guards so a tolerant match never begins/ends inside a longer grouped digit run:
 *    reject when the match is flanked by a digit, OR by a `<digit><sep>` / `<sep><digit>` pair
 *    (the `1.234.567` / `9.200.000.005` false-positive fence).
 */
const DIGIT_GAP = "[ \\t\\u00A0\\u2009.'\\u2019]{0,2}"; // between two digits
const WORD_GAP = '[\\s\\u00A0]{1,4}'; // where the token has a literal space (name wrap)
const PLAIN_GAP = '[ \\u00A0]{0,2}'; // between other adjacent chars
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const reEsc = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build the tolerant matcher for one token, or null if the token is a single char (nothing to
 *  reflow between). The regex captures the token's chars in order with bounded separator gaps. */
function tolerantTokenRe(token: string): RegExp | null {
  if (token.length < 2) return null;
  const chars = [...token];
  let body = reEsc(chars[0]!);
  for (let i = 1; i < chars.length; i++) {
    const prev = chars[i - 1]!;
    const cur = chars[i]!;
    const gap = cur === ' ' || prev === ' '
      ? WORD_GAP
      : isDigit(prev) && isDigit(cur)
        ? DIGIT_GAP
        : PLAIN_GAP;
    // a literal space in the token is consumed by the gap itself, so don't also emit it
    body += (cur === ' ' ? '' : gap + reEsc(cur));
  }
  // Digit-edge guards: block a match flanked by a digit, or by a <digit><sep>/<sep><digit> run,
  // so the token digits inside a LONGER grouped number (1.234.567 / 9.200.000.005) are untouched.
  const startDigit = isDigit(chars[0]!);
  const endDigit = isDigit(chars[chars.length - 1]!);
  const lead = startDigit ? "(?<!\\d)(?<!\\d[ \\t\\u00A0\\u2009.'\\u2019])" : '';
  const trail = endDigit ? "(?!\\d)(?![ \\t\\u00A0\\u2009.'\\u2019]\\d)" : '';
  try {
    return new RegExp(lead + body + trail, 'g');
  } catch {
    return null; // a token that cannot form a valid pattern falls back to exact-only
  }
}

/** Replace every token in a string: exact pass first (byte-parity for what already works), then
 *  a tolerant pass per token (longest first) for reflowed occurrences. */
function replaceTokens(s: string, tokens: Array<[string, string]>): string {
  let out = s;
  for (const [token, value] of tokens) {
    if (out.includes(token)) out = out.split(token).join(value); // exact pass (unchanged)
  }
  for (const [token, value] of tokens) {
    if (out.includes(token)) continue; // already fully restored by the exact pass
    const re = tolerantTokenRe(token);
    if (re) out = out.replace(re, value);
  }
  return out;
}

/**
 * Restore cleartext in a completed string (§17.7 `deanonymize`). Replaces every session token
 * with its real value, longest tokens first, tolerant of model whitespace/format reflow (F26).
 * Applied to response text AND whole response bodies - a tool_use argument block is a substring
 * of the body, so whole-body replacement de-tokenizes tool_use arguments too (they are buffered
 * whole, §17.3 step 5), restoring the real value the local loop must act on.
 */
export function deanonymize(text: string, handle: VaultHandle): string {
  return replaceTokens(text, tokensOf(handle));
}

/** The streaming de-tokenizer (§17.3 step 6): de-tokenizes text deltas incrementally, holding
 *  back only the minimum suffix that could be the start of a placeholder straddling the next
 *  chunk boundary. The straddle bound is WIDENED for F26: a reflowed token can be longer than
 *  its compact form (each gap adds up to a few separator chars), so the hold window and the
 *  could-be-a-prefix test both account for the tolerant form. */
export function createDetokenizer(handle: VaultHandle): { push(chunk: string): string; end(): string } {
  const tokens = tokensOf(handle); // longest first, snapshot for this response
  const max = maxTokenLength(handle);
  const MAX_GAP = 4; // an upper bound on separator chars a reflowed token can accumulate per gap
  const widenedMax = max > 0 ? max * (1 + MAX_GAP) : 0;
  let pending = '';

  /** Could `suffix` be the start of a REFLOWED token (so we must hold it for the next chunk)?
   *  Walk the suffix consuming each token's chars in order, allowing up to MAX_GAP separators
   *  per gap; a hold is warranted if the whole suffix is consumed with token chars remaining. */
  const couldBeTolerantPrefix = (suffix: string): boolean => {
    const isSep = (c: string): boolean => {
      const code = c.charCodeAt(0);
      return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
        || code === 0xa0 || code === 0x2009
        || c === '.' || c === "'" || code === 0x2019;
    };
    for (const [token] of tokens) {
      // NB: no `token.length <= suffix.length` early-out - a REFLOWED suffix is LONGER than the
      // compact token (each gap adds separators), so a long partial (a grouped 8-of-9-digit run)
      // is still a valid in-progress reflow of a 9-char token and must be held.
      let ti = 0;
      let si = 0;
      let ok = true;
      while (si < suffix.length && ti < token.length) {
        if (suffix[si] === token[ti]) { si++; ti++; continue; }
        // token space is matched by any run of separators
        if (token[ti] === ' ' && isSep(suffix[si]!)) { si++; continue; }
        if (isSep(suffix[si]!)) { si++; continue; } // an inserted grouping separator
        ok = false; break;
      }
      if (ok && si === suffix.length && ti < token.length) return true; // consumed all, token remains
    }
    return false;
  };

  return {
    push(chunk: string): string {
      const s = replaceTokens(pending + chunk, tokens);
      let hold = 0;
      const maxHold = Math.min(Math.max(widenedMax - 1, 0), s.length);
      for (let k = maxHold; k >= 1; k--) {
        if (couldBeTolerantPrefix(s.slice(s.length - k))) { hold = k; break; }
      }
      const emit = s.slice(0, s.length - hold);
      pending = s.slice(s.length - hold);
      return emit;
    },
    end(): string {
      const out = replaceTokens(pending, tokens);
      pending = '';
      return out;
    },
  };
}

/** End a session: clear its vault (§17.5, D1). After this the token->value map does not exist. */
export function endSession(handle: VaultHandle): void {
  clearSession(handle.sessionId);
}
