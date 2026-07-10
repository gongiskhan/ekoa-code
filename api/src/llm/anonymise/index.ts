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
 *    reject when the match is flanked by a digit that sits up to 3 separators away (a
 *    variable-length lookbehind/ahead) - the `1.234.567` / `9.200.000.005` / `9..200.000.005`
 *    false-positive fence. The separator budget in the guard (0-3) covers the gap budget (0-2)
 *    plus slack, so a digit reachable through the grouping separators always rejects the match.
 */
// The grouping-separator class (regex-source). MUST stay in sync with the streaming `isSep`
// predicate below — a mismatch makes streaming hold a run the regex cannot match. Includes
// newlines so a digit token wrapped across lines (200\n000\n005) restores like any other reflow.
const SEP = " \\t\\n\\r\\u00A0\\u2009.'\\u2019";
const DIGIT_GAP = `[${SEP}]{0,2}`; // between two digits
const WORD_GAP = '[\\s\\u00A0]{1,4}'; // where the token has a literal space (name wrap)
const PLAIN_GAP = '[ \\u00A0]{0,2}'; // between other adjacent chars
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const reEsc = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The tolerant match BODY (no edge guards) for one token, or null for a single-char token. The
 *  body matches the token's chars in order with bounded separator gaps. */
function tolerantBody(token: string): string | null {
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
  return body;
}

/** Build the GUARDED tolerant matcher (the one that actually replaces), or null. Digit-edge guards
 *  (variable-length lookaround, V8) reject a match whose flank reaches a digit through 0-3
 *  separators, so the token digits inside a LONGER grouped number (1.234.567 / 9.200.000.005 /
 *  9..200.000.005) are left byte-exact. The 0-3 budget covers the guard-blind case where the model
 *  doubled a separator, which a fixed 1-separator guard missed. */
function tolerantTokenRe(token: string): RegExp | null {
  const body = tolerantBody(token);
  if (body === null) return null;
  const chars = [...token];
  const lead = isDigit(chars[0]!) ? `(?<![0-9][${SEP}]{0,3})` : '';
  const trail = isDigit(chars[chars.length - 1]!) ? `(?![${SEP}]{0,3}[0-9])` : '';
  try {
    return new RegExp(lead + body + trail, 'g');
  } catch {
    return null; // a token that cannot form a valid pattern falls back to exact-only
  }
}

/** The BARE (guard-less) tolerant matcher — where a token's body sits regardless of the edge
 *  guards. Streaming uses it to decide the hold: a cut must never land inside/abutting a token's
 *  body, because whether the guard accepts the match depends on chars that may still be arriving. */
function bareTokenRe(token: string): RegExp | null {
  const body = tolerantBody(token);
  if (body === null) return null;
  try {
    return new RegExp(body, 'g');
  } catch {
    return null;
  }
}

/** Replace every token in a string: exact pass first (byte-parity for what already works), then
 *  a tolerant pass per token (longest first) for reflowed occurrences. The tolerant replacement
 *  uses a FUNCTION replacer so a `$` in a restored value is never interpreted as a `$&`/`$1`
 *  back-reference (the split/join exact pass is already literal). */
function replaceTokens(s: string, tokens: Array<[string, string]>): string {
  let out = s;
  for (const [token, value] of tokens) {
    if (out.includes(token)) out = out.split(token).join(value); // exact pass (unchanged, literal)
  }
  for (const [token, value] of tokens) {
    if (out.includes(token)) continue; // already fully restored by the exact pass
    const re = tolerantTokenRe(token);
    if (re) out = out.replace(re, () => value); // function replacer: '$' in `value` stays literal
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

/**
 * The streaming de-tokenizer (§17.3 step 6). De-tokenizes text deltas incrementally, but replaces
 * ONLY the stable prefix of the retained RAW buffer — everything except a trailing "unsafe" run
 * that future input could still change how it replaces. The buffer stays RAW (unreplaced) so the
 * edge guards see full LEFT context: without this, a preceding `9.` emitted in an earlier chunk
 * was invisible to the guard and a real number got spliced into an unrelated grouped run.
 *
 * A suffix is unsafe (held) when it is either (a) a partial reflowed token, or (b) a run starting
 * at a DIGIT of digits+separators — the left-context a following token's edge guard needs, and
 * the tail a following digit could extend a completed token into. The hold is bounded by
 * `widenedMax` (a reflowed token's max length), so memory never grows unboundedly.
 */
export function createDetokenizer(handle: VaultHandle): { push(chunk: string): string; end(): string } {
  const tokens = tokensOf(handle); // longest first, snapshot for this response
  const max = maxTokenLength(handle);
  const MAX_GAP = 4; // an upper bound on separator chars a reflowed token can accumulate per gap
  const widenedMax = max > 0 ? max * (1 + MAX_GAP) : 0;
  let carry = ''; // retained RAW (unreplaced) tail — includes the left-context for the next match

  const isSep = (c: string): boolean => {
    const code = c.charCodeAt(0);
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
      || code === 0xa0 || code === 0x2009
      || c === '.' || c === "'" || code === 0x2019;
  };

  /** Could `suffix` be an in-progress OR just-completed REFLOWED token that future input could
   *  still change (extend or disambiguate)? Walk the suffix consuming each token's chars in order;
   *  a token space matches a RUN of >=1 separators then advances past the space. Held when the whole
   *  suffix is consumed with token chars still remaining (partial) OR the token was fully consumed
   *  exactly at the suffix end (complete-at-edge — a following digit could reject it, or a cut here
   *  would dismember a letter-head token like an IBAN). No compact-length early-out: a reflowed
   *  suffix is longer than the compact token. */
  const couldBeTolerantPrefix = (suffix: string): boolean => {
    for (const [token] of tokens) {
      let ti = 0;
      let si = 0;
      let ok = true;
      while (si < suffix.length && ti < token.length) {
        if (suffix[si] === token[ti]) { si++; ti++; continue; }
        if (token[ti] === ' ') {
          if (isSep(suffix[si]!)) { while (si < suffix.length && isSep(suffix[si]!)) si++; ti++; continue; }
          ok = false; break;
        }
        if (isSep(suffix[si]!)) { si++; continue; } // an inserted grouping separator between non-space chars
        ok = false; break;
      }
      // partial (ti < len) OR complete-exactly-at-edge (ti === len, si === len): both must be held.
      if (ok && si === suffix.length && ti > 0) return true;
    }
    return false;
  };

  const digitRelevant = (c: string | undefined): boolean => c !== undefined && (isDigit(c) || isSep(c));
  const GUARD_MARGIN = 4; // the edge-guard lookaround width: a digit reachable through <=3 separators

  /** The start offset of a token BODY (guard-less) that either STRADDLES `cut` (start < cut < end)
   *  or ENDS exactly at `cut` with a digit-relevant char immediately after — in both cases the cut
   *  would expose a match whose guard verdict depends on chars that may still be arriving, so it
   *  must be pulled back before the body. Uses the BARE matcher precisely because the guarded one
   *  would hide the body when a following digit rejects it. -1 if none. */
  const matchAcross = (buf: string, cut: number): number => {
    let best = -1;
    for (const [token] of tokens) {
      const re = bareTokenRe(token);
      if (!re) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(buf)) !== null) {
        const s = m.index;
        const e = s + m[0].length;
        const straddles = s < cut && cut < e;
        const endsAtWithDigitTail = e === cut && digitRelevant(buf[cut]);
        if ((straddles || endsAtWithDigitTail) && (best < 0 || s < best)) best = s;
        if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
      }
    }
    return best;
  };

  /** Length of the longest UNSAFE trailing suffix of `buf` (held for the next chunk). Two layers:
   *  (1) a partial/complete-at-edge reflowed token, plus a short trailing digit-relevant run for
   *  the NEXT token's edge-guard left-context; then (2) pull the cut back before ANY complete
   *  tolerant match it would land inside or abut with a digit tail — so a token is never
   *  dismembered (IBAN/CC letter-head tokens) and a real value is never spliced into a longer run. */
  const unsafeSuffixLen = (buf: string): number => {
    const cap = Math.min(widenedMax, buf.length);
    let hold = 0;
    for (let k = cap; k >= 1; k--) {
      if (couldBeTolerantPrefix(buf.slice(buf.length - k))) { hold = k; break; }
    }
    // The maximal trailing digit-relevant run (capped at widenedMax for the no-token / pure-digit
    // case, so memory stays bounded): a digit token echoed at the tail must stay whole and see the
    // following digits that decide its guard, rather than being emitted before they arrive.
    let dr = 0;
    for (let k = 1; k <= cap; k++) {
      if (digitRelevant(buf[buf.length - k])) dr = k; else break;
    }
    hold = Math.max(hold, dr);
    void GUARD_MARGIN;
    // (2) never cut inside/abutting a bare token body — bounded iteration; a straddled/abutted
    // match extends the hold to its start, so a reflowed digit token is never emitted before the
    // char that decides its guard, and a letter-head token (IBAN/CC) is never dismembered.
    let cut = buf.length - hold;
    for (let guard = 0; guard <= tokens.length + 4; guard++) {
      const start = matchAcross(buf, cut);
      if (start < 0 || start >= cut) break;
      cut = start;
    }
    return buf.length - cut;
  };

  // Last few chars of already-EMITTED (restored) output, prepended as edge-guard LEFT context when
  // replacing the next stable region. Already-emitted output is restored VALUES, so it is
  // token-free — its replaced form equals itself and it strips back off cleanly. Without it, a
  // token adjacent to a just-emitted value would not see that value's trailing digit and its lead
  // guard would wrongly accept, diverging from batch. MARGIN covers the guard lookbehind width.
  const CTX_MARGIN = 8;
  let leftCtx = '';
  const emitStable = (stable: string): string => {
    const replaced = replaceTokens(leftCtx + stable, tokens);
    const out = replaced.slice(leftCtx.length); // leftCtx is token-free -> unchanged by replaceTokens
    leftCtx = (leftCtx + out).slice(-CTX_MARGIN);
    return out;
  };

  return {
    push(chunk: string): string {
      const buf = carry + chunk;
      const hold = unsafeSuffixLen(buf);
      const stable = buf.slice(0, buf.length - hold); // no match straddles the cut
      carry = buf.slice(buf.length - hold); // kept RAW for the next chunk's guards
      return emitStable(stable);
    },
    end(): string {
      const out = emitStable(carry);
      carry = '';
      leftCtx = '';
      return out;
    },
  };
}

/** End a session: clear its vault (§17.5, D1). After this the token->value map does not exist. */
export function endSession(handle: VaultHandle): void {
  clearSession(handle.sessionId);
}
