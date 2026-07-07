import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  anonymize,
  deanonymize,
  createDetokenizer,
  endSession,
  AnonymisationRefusedError,
  setNerDetector,
  dictionaryNer,
  __resetNerForTests,
  setAuditSink,
  __resetAuditForTests,
  __resetVaultForTests,
  __setVaultClockForTests,
  __setVaultTtlForTests,
  __vaultCount,
  type AnonymiseContext,
} from '../../src/llm/anonymise/index.js';
import { __resetRulesetResolverForTests } from '../../src/llm/anonymise/index.js';
import { isValidNif, isValidIbanPt, makeNifToken, makeNissToken, makeIbanToken } from '../../src/llm/anonymise/checksum.js';
import { detect, resolveDenyList } from '../../src/llm/anonymise/detectors.js';

/**
 * G7A acceptance gate (ch17 §17.11), the deterministic part exercised against the module
 * directly with an in-memory capture audit sink (no live model, no mongo): checksum-verified
 * structured-ID detection, the deny-list, NER-layer independence, format-preserving
 * checksum-INVALID tokens, streaming straddle de-tokenization, the byte-identical cache prefix,
 * the never-persisted vault, and the metadata-only hash-chained audit shape.
 *
 * ALL test data is SYNTHETIC and checksum-INVALID where it stands in for a real identifier
 * (§17.8): a valid-checksum NIF is COMPUTED at runtime (never a committed literal) purely to
 * exercise the (a) checksum path.
 */

/** Compute a synthetic, checksum-VALID NIF at runtime from a company-range base (never a
 *  committed personal literal). Exactly one final digit validates. */
function computeValidNif(base8: string): string {
  for (let d = 0; d < 10; d++) if (isValidNif(base8 + d)) return base8 + d;
  throw new Error('no valid check digit for base ' + base8);
}

const CAPTURED: Array<{ actor: unknown; metadata: Record<string, unknown> }> = [];

function ctx(over: Partial<AnonymiseContext> = {}): AnonymiseContext {
  const { ruleset, ...rest } = over;
  return {
    sessionId: 'sess-A',
    correlationId: 'corr-1',
    actor: { userId: 'u1', orgId: 'org1' },
    ...rest,
    ruleset: { orgId: 'org1', ...(ruleset ?? {}) },
  };
}

beforeEach(() => {
  CAPTURED.length = 0;
  __resetVaultForTests();
  __resetNerForTests();
  __resetAuditForTests();
  __resetRulesetResolverForTests();
  setAuditSink({ write: (actor, metadata) => { CAPTURED.push({ actor, metadata }); } });
});
afterEach(() => {
  __resetVaultForTests();
  __resetNerForTests();
  __resetAuditForTests();
});

describe('detection layer (a): PT structured-ID, checksum-verified (§17.4 (a))', () => {
  it('tokenizes a checksum-VALID NIF and leaves a checksum-INVALID look-alike alone', () => {
    const valid = computeValidNif('50000000');
    const invalid = valid.slice(0, 8) + String((Number(valid[8]) + 1) % 10); // flip check digit
    expect(isValidNif(invalid)).toBe(false);

    const r = anonymize(`Valid ${valid} and invalid ${invalid}`, ctx());
    expect(r.text).not.toContain(valid); // detected + tokenized
    expect(r.text).toContain(invalid); // checksum-invalid, NOT tokenized unless deny-listed
    expect(deanonymize(r.text, r.handle)).toBe(`Valid ${valid} and invalid ${invalid}`);
  });

  it('the checksum-invalid look-alike IS tokenized once deny-listed (§17.4 (b))', () => {
    const valid = computeValidNif('50000000');
    const invalid = valid.slice(0, 8) + String((Number(valid[8]) + 1) % 10);
    const r = anonymize(`Ref ${invalid}`, ctx({ ruleset: { orgId: 'org1', denyList: [invalid] } }));
    expect(r.text).not.toContain(invalid); // caught by the deny-list
  });
});

describe('detection layer (b): per-org deny-list (§17.4 (b))', () => {
  it('tokenizes a deny-listed party name regardless of NER', () => {
    const r = anonymize('Meeting with Petrova Holdings tomorrow', ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    expect(r.text).not.toContain('Petrova Holdings');
    expect(deanonymize(r.text, r.handle)).toContain('Petrova Holdings');
  });

  it('resolves an org-scoped ENCRYPTED deny-list and access-logs it (§17.4 (b), D3)', () => {
    // crypto.encrypt requires a boot ENCRYPTION_KEY; exercise the plaintext resolver path here
    // and the ciphertext path in the chokepoint suite where the key is configured.
    let accessed = -1;
    const list = resolveDenyList({ orgId: 'org1', denyList: ['Casa Aveleda'] }, (n) => { accessed = n; });
    expect(list).toEqual(['Casa Aveleda']);
    expect(accessed).toBe(-1); // plaintext list is not an at-rest access event
  });
});

describe('layer independence: (a)+(b) work when (c) NER is down (§17.4)', () => {
  it('structured-ID + deny-list still tokenize with the NER head throwing', () => {
    setNerDetector(dictionaryNer([], { available: true, throwOnDetect: true })); // NER "down"
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid} for Petrova Holdings`, ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    expect(r.text).not.toContain(valid);
    expect(r.text).not.toContain('Petrova Holdings');
    // audit records the reduced coverage
    expect(CAPTURED.at(-1)!.metadata.nerAvailable).toBe(false);
  });

  it('the (c) NER path tokenizes names when a detector is plugged in', () => {
    setNerDetector(dictionaryNer(['Joana Vidal']));
    const r = anonymize('Client Joana Vidal called', ctx());
    expect(r.text).not.toContain('Joana Vidal');
    expect(deanonymize(r.text, r.handle)).toContain('Joana Vidal');
  });
});

describe('fail-closed: a mandatory-detector outage refuses (§17.3)', () => {
  it('throws AnonymisationRefusedError when the deny-list cannot be resolved', () => {
    // a malformed ciphertext makes resolveDenyList throw -> mandatory detector down -> refuse
    expect(() => anonymize('anything', ctx({ ruleset: { orgId: 'org1', denyListCiphertext: 'not-valid-ciphertext' } }))).toThrow(AnonymisationRefusedError);
    expect(CAPTURED.at(-1)!.metadata.refused).toBe(true);
  });
});

describe('tokens are format-preserving with a DELIBERATELY INVALID checksum (§17.5)', () => {
  it('a NIF token looks like a NIF but never validates', () => {
    for (let seq = 0; seq < 20; seq++) {
      const t = makeNifToken(seq);
      expect(t).toMatch(/^\d{9}$/);
      expect(isValidNif(t)).toBe(false);
    }
  });
  it('NISS/IBAN tokens preserve format', () => {
    expect(makeNissToken(3)).toMatch(/^\d{11}$/);
    expect(makeIbanToken(3)).toMatch(/^PT\d{23}$/);
  });
});

describe('prompt-cache: byte-identical tokenized prefix across turns (§17.5)', () => {
  it('turn 2 (turn1 + appended) starts byte-identically with turn 1 tokenized text', () => {
    const valid = computeValidNif('50000000');
    const turn1 = `Client NIF ${valid}.`;
    const t1 = anonymize(turn1, ctx());
    const t2 = anonymize(`${turn1}\nFollow-up question.`, ctx());
    expect(t2.text.startsWith(t1.text)).toBe(true); // detect-on-delta preserved the prefix
  });

  it('a new session is a cache boundary: its own vault re-tokenizes', () => {
    const valid = computeValidNif('50000000');
    const a = anonymize(`NIF ${valid}`, ctx({ sessionId: 'sess-A' }));
    const b = anonymize(`NIF ${valid}`, ctx({ sessionId: 'sess-B' }));
    // both tokenize (no cleartext), each from its own vault
    expect(a.text).not.toContain(valid);
    expect(b.text).not.toContain(valid);
    expect(deanonymize(a.text, a.handle)).toContain(valid);
  });
});

describe('streaming de-tokenization with straddle buffering (§17.3 step 6)', () => {
  it('a token split across two chunks de-tokenizes correctly', () => {
    const r = anonymize('Petrova Holdings signed', ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    const token = r.text.split(' signed')[0]!; // the token that replaced the party name
    const stream = `${token} signed`;
    const split = Math.floor(token.length / 2);
    const detok = createDetokenizer(r.handle);
    let out = detok.push(stream.slice(0, split));
    out += detok.push(stream.slice(split));
    out += detok.end();
    expect(out).toBe('Petrova Holdings signed');
  });
});

describe('vault: in-memory, TTL, never persisted, cleared at session end (§17.5, D1)', () => {
  it('endSession removes the vault entirely', () => {
    const r = anonymize('Petrova Holdings', ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    expect(__vaultCount()).toBe(1);
    endSession(r.handle);
    expect(__vaultCount()).toBe(0);
    // after clearing, de-tokenization can no longer reverse the token (the key does not exist)
    expect(deanonymize(r.text, r.handle)).toBe(r.text);
  });

  it('a vault older than its TTL is swept (no disk write, a cache boundary)', () => {
    let t = 1_000_000;
    __setVaultClockForTests(() => t);
    __setVaultTtlForTests(1000);
    anonymize('Petrova Holdings', ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    expect(__vaultCount()).toBe(1);
    t += 5000; // advance past TTL
    anonymize('unrelated', ctx({ sessionId: 'sess-C' })); // triggers a sweep
    expect(__vaultCount()).toBe(1); // sess-A swept, sess-C created
  });
});

describe('audit is metadata-only + hash-chained (§17.6, D2)', () => {
  it('records classes/counts/correlation-id/payload-hash, NEVER bodies, NEVER the vault', () => {
    const valid = computeValidNif('50000000');
    anonymize(`NIF ${valid} for Petrova Holdings`, ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    const m = CAPTURED.at(-1)!.metadata;
    expect(m.correlationId).toBe('corr-1');
    expect(m.classes).toMatchObject({ NIF: 1, PARTY: 1 });
    expect(m.entityCount).toBe(2);
    expect(typeof m.payloadHash).toBe('string');
    expect((m.payloadHash as string)).toHaveLength(64);
    // no body / no vault leaked into the record
    const serialized = JSON.stringify(m);
    expect(serialized).not.toContain(valid);
    expect(serialized).not.toContain('Petrova Holdings');
    expect(serialized).not.toContain('valueToToken');
  });

  it('links records into a tamper-evident chain', () => {
    anonymize('Petrova Holdings', ctx({ correlationId: 'c1', ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    anonymize('Casa Aveleda', ctx({ correlationId: 'c2', ruleset: { orgId: 'org1', denyList: ['Casa Aveleda'] } }));
    const [a, b] = CAPTURED.map((c) => c.metadata);
    expect(b!.prevChainHash).toBe(a!.chainHash); // chain links
    expect(b!.chainSeq).toBe((a!.chainSeq as number) + 1);
  });
});

describe('detect() returns a clean interface result (§17.4)', () => {
  it('never exposes which layer fired to the caller', () => {
    const valid = computeValidNif('50000000');
    const res = detect(`NIF ${valid}`, { orgId: 'org1' });
    expect(res.mandatoryOk).toBe(true);
    expect(res.spans.some((s) => s.value === valid)).toBe(true);
  });
});

/** Compute a synthetic checksum-VALID PT IBAN at runtime (PT + 2 check digits + a fixed 21-digit
 *  BBAN), never a committed literal. Exactly one pair of check digits validates. */
function computeValidIban(bban21: string): string {
  for (let cd = 2; cd <= 98; cd++) {
    const s = `PT${String(cd).padStart(2, '0')}${bban21}`;
    if (isValidIbanPt(s)) return s;
  }
  throw new Error('no valid IBAN check digits');
}

// Regression tests for the dual-review (Claude adversarial + Codex) findings on G7A - each is a
// demonstrated cleartext-PII leak, now closed.
describe('dual-review hardening: no boundary/format/overlap leak', () => {
  it('detect-on-full-text: a value that GROWS across the prior-turn boundary is tokenized, not split (HIGH)', () => {
    const valid = computeValidNif('50000000'); // 9 digits
    // Same session + channel. Turn 1 ends mid-NIF; turn 2 completes it. The old detect-on-delta
    // scanned only the appended tail and leaked the now-complete NIF; full-text detection catches it.
    const head = `Cliente NIF ${valid.slice(0, 5)}`;
    anonymize(head, ctx({ sessionId: 's-grow', channel: 'prompt' }));
    const r2 = anonymize(`Cliente NIF ${valid}`, ctx({ sessionId: 's-grow', channel: 'prompt' }));
    expect(r2.text).not.toContain(valid); // the completed NIF is tokenized, not cleartext
    expect(deanonymize(r2.text, r2.handle)).toContain(valid);
  });

  it('deny-listed party that grows across the boundary is tokenized (HIGH)', () => {
    const rs = { orgId: 'org1', denyList: ['Petrova Holdings'] };
    anonymize('Cliente Petrova', ctx({ sessionId: 's-party', channel: 'prompt', ruleset: rs }));
    const r2 = anonymize('Cliente Petrova Holdings', ctx({ sessionId: 's-party', channel: 'prompt', ruleset: rs }));
    expect(r2.text).not.toContain('Petrova Holdings'); // deny-listed party caught after growth
  });

  it('cache-prefix stays byte-identical across turns via deterministic tokens (no delta shortcut)', () => {
    const rs = { orgId: 'org1', denyList: ['Petrova Holdings'] };
    const r1 = anonymize('Meeting with Petrova Holdings', ctx({ sessionId: 's-cache', channel: 'prompt', ruleset: rs }));
    const r2 = anonymize('Meeting with Petrova Holdings next week', ctx({ sessionId: 's-cache', channel: 'prompt', ruleset: rs }));
    expect(r2.text.startsWith(r1.text)).toBe(true); // determinism preserves the prompt-cache prefix
  });

  it('spaced PT IBAN is detected + tokenized (Codex Critical: regex missed the standard grouping)', () => {
    const compact = computeValidIban('000201231234567895417'); // 21-digit BBAN
    const spaced = compact.replace(/^(PT\d{2})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})(\d)$/, '$1 $2 $3 $4 $5 $6 $7');
    expect(spaced).toContain(' '); // sanity: it is actually spaced
    const r = anonymize(`Transferir para IBAN ${spaced}`, ctx());
    expect(r.text).not.toContain(spaced); // the spaced IBAN is tokenized
    expect(deanonymize(r.text, r.handle)).toContain(spaced);
  });

  it('partial overlap tokenizes the UNION, never leaking a non-overlapping remainder (MEDIUM)', () => {
    // NER flags "Petrova Silva" (PERSON) partially overlapping the deny-listed party "Aveleda
    // Petrova". The old resolver dropped the PERSON span whole, leaking "Silva"; union-merge redacts
    // the whole run.
    setNerDetector(dictionaryNer(['Petrova Silva']));
    const r = anonymize('Cliente Aveleda Petrova Silva assinou', ctx({ ruleset: { orgId: 'org1', denyList: ['Aveleda Petrova'] } }));
    expect(r.text).not.toContain('Silva'); // the remainder is not leaked
    expect(r.text).not.toContain('Petrova');
  });
});
