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
    // Same session. Turn 1 ends mid-NIF; turn 2 completes it. The old detect-on-delta
    // scanned only the appended tail and leaked the now-complete NIF; full-text detection catches it.
    const head = `Cliente NIF ${valid.slice(0, 5)}`;
    anonymize(head, ctx({ sessionId: 's-grow' }));
    const r2 = anonymize(`Cliente NIF ${valid}`, ctx({ sessionId: 's-grow' }));
    expect(r2.text).not.toContain(valid); // the completed NIF is tokenized, not cleartext
    expect(deanonymize(r2.text, r2.handle)).toContain(valid);
  });

  it('deny-listed party that grows across the boundary is tokenized (HIGH)', () => {
    const rs = { orgId: 'org1', denyList: ['Petrova Holdings'] };
    anonymize('Cliente Petrova', ctx({ sessionId: 's-party', ruleset: rs }));
    const r2 = anonymize('Cliente Petrova Holdings', ctx({ sessionId: 's-party', ruleset: rs }));
    expect(r2.text).not.toContain('Petrova Holdings'); // deny-listed party caught after growth
  });

  it('cache-prefix stays byte-identical across turns via deterministic tokens (no delta shortcut)', () => {
    const rs = { orgId: 'org1', denyList: ['Petrova Holdings'] };
    const r1 = anonymize('Meeting with Petrova Holdings', ctx({ sessionId: 's-cache', ruleset: rs }));
    const r2 = anonymize('Meeting with Petrova Holdings next week', ctx({ sessionId: 's-cache', ruleset: rs }));
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

/**
 * F26 (batch-final s2) — de-anonymisation is whitespace/format-tolerant on the RETURN path.
 * A model routinely reformats a token it echoes: a 9-digit NIF token `200000005` comes back
 * `200 000 005` (thousands spaces) or `200.000.005` (dot grouping); a two-word PARTY/PERSON
 * token gets its internal space turned into a newline on wrap. The exact-substring detok then
 * misses it and the user sees the synthetic TOKEN, not their real value. Privacy is unaffected
 * (egress is tokens-only); this is a RETURN-path correctness fix. Detection/tokenisation are
 * unchanged — only deanonymize/createDetokenizer gain format tolerance, bounded so unrelated
 * grouped numbers are never touched.
 *
 * All fixtures are SYNTHETIC. The NIF token is minted by the vault (checksum-INVALID by design).
 */
describe('F26: whitespace/format-tolerant de-tokenization (return path only)', () => {
  // Mint a real vault token for a value, then reformat the TOKEN as a model would.
  const tokenizeAndGrab = (value: string, cls: { deny?: string } = {}) => {
    const r = anonymize(value, ctx(cls.deny ? { ruleset: { orgId: 'org1', denyList: [cls.deny] } } : {}));
    // the token is the whole tokenized text minus the surrounding scaffold — anonymize replaces
    // just the entity, so recover it from the token map
    return r;
  };

  it('a NIF token reformatted with THOUSANDS SPACES restores the original', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`O NIF é ${valid}.`, ctx());
    const token = r.text.match(/\d{9}/)![0]; // the 9-digit NIF token the model would echo
    const spaced = `${token.slice(0, 3)} ${token.slice(3, 6)} ${token.slice(6)}`; // 200 000 005
    const reply = `O número de contribuinte é ${spaced}, confirmado.`;
    expect(deanonymize(reply, r.handle)).toBe(`O número de contribuinte é ${valid}, confirmado.`);
  });

  it('a NIF token reformatted with DOT GROUPING restores the original', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    const dotted = `${token.slice(0, 3)}.${token.slice(3, 6)}.${token.slice(6)}`; // 200.000.005
    expect(deanonymize(`Consta o ${dotted} no registo.`, r.handle)).toBe(`Consta o ${valid} no registo.`);
  });

  it('a NIF token reformatted with a NON-BREAKING/THIN space restores the original', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    const NBSP = String.fromCharCode(0xa0); const THIN = String.fromCharCode(0x2009);
    const nbsp = `${token.slice(0, 3)}${NBSP}${token.slice(3, 6)}${THIN}${token.slice(6)}`;
    expect(deanonymize(`É o ${nbsp}.`, r.handle)).toBe(`É o ${valid}.`);
  });

  it('a two-word PARTY token wrapped with a NEWLINE restores the original', () => {
    const r = anonymize('Contrato com a Petrova Holdings hoje', ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    const token = r.text.match(/[A-Z][a-z]+ [A-Z][a-z]+/)![0]; // the "Word Word" party token
    const wrapped = token.replace(' ', '\n'); // the model wrapped the name at the space
    expect(deanonymize(`Assinou a ${wrapped} ontem.`, r.handle)).toContain('Petrova Holdings');
  });

  it('an unrelated grouped number is NEVER touched (no false positive)', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    // 1.234.567 is a plain grouped number, not the token — it must survive verbatim
    const reply = 'O total foi 1.234.567 euros.';
    expect(deanonymize(reply, r.handle)).toBe(reply);
  });

  it('a longer digit run EMBEDDING the token digits with separators is NOT partially rewritten (guard)', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    // Prepend a digit+separator so the token digits appear inside a LONGER grouped run.
    const embedded = `9.${token.slice(0, 3)}.${token.slice(3, 6)}.${token.slice(6)}`; // 9.200.000.005
    const reply = `Ref ${embedded} no processo.`;
    expect(deanonymize(reply, r.handle)).toBe(reply); // untouched: not our token
  });

  it('streaming: a SPACE-reformatted token split across chunk boundaries de-tokenizes correctly', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    const spaced = `${token.slice(0, 3)} ${token.slice(3, 6)} ${token.slice(6)}`; // 200 000 005
    const stream = `Contribuinte ${spaced}, ok.`;
    // Split at EVERY granularity 1..6: a reflowed token is LONGER than the compact token, so a
    // long in-progress suffix ("200 000 00") must still be HELD for the next chunk. Finer splits
    // (esp. 1-2) regress if the straddle-hold prefix check keeps a stale compact-length guard
    // (batch-final s2 self-caught bug).
    for (let step = 1; step <= 6; step++) {
      const detok = createDetokenizer(r.handle);
      let out = '';
      for (let i = 0; i < stream.length; i += step) out += detok.push(stream.slice(i, i + step));
      out += detok.end();
      expect(out, `split step ${step}`).toBe(`Contribuinte ${valid}, ok.`);
    }
  });

  it('the exact-match path still works byte-for-byte (no regression)', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid} e outro`, ctx());
    expect(deanonymize(r.text, r.handle)).toBe(`NIF ${valid} e outro`);
  });

  // --- Review + Codex hardening (both reviewers, batch-final s2 round 2) ------------------
  it('a DOUBLE-separator embedded run is NOT corrupted (guard covers 0-3 flank separators)', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    const dotted = `${token.slice(0, 3)}.${token.slice(3, 6)}.${token.slice(6)}`;
    for (const embed of [`9.${dotted}`, `9..${dotted}`, `${dotted}..9`, `9  ${token.slice(0, 3)} ${token.slice(3, 6)} ${token.slice(6)}`]) {
      const reply = `Ref ${embed} fim.`;
      expect(deanonymize(reply, r.handle), embed).toBe(reply); // byte-exact; a fixed 1-sep guard missed this
    }
  });

  it('STREAMING preserves edge context: an embedded run is not spliced across chunk boundaries', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    const dotted = `${token.slice(0, 3)}.${token.slice(3, 6)}.${token.slice(6)}`;
    for (const reply of [`Ref 9.${dotted} fim.`, `Ref ${dotted}.9 fim.`]) {
      for (let step = 1; step <= 5; step++) {
        const detok = createDetokenizer(r.handle);
        let out = '';
        for (let i = 0; i < reply.length; i += step) out += detok.push(reply.slice(i, i + step));
        out += detok.end();
        expect(out, `${reply} @ step ${step}`).toBe(reply); // the real NIF is never spliced into the run
      }
    }
  });

  it('STREAMING restores a newline-wrapped PARTY token at EVERY split (incl. mid-second-word)', () => {
    const r = anonymize('Contrato com a Petrova Holdings hoje', ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings'] } }));
    const token = r.text.match(/[A-Z][a-z]+ [A-Z][a-z]+/)![0];
    const wrapped = token.replace(' ', '\n');
    const reply = `Assinou a ${wrapped} ontem.`;
    for (let step = 1; step <= 8; step++) {
      const detok = createDetokenizer(r.handle);
      let out = '';
      for (let i = 0; i < reply.length; i += step) out += detok.push(reply.slice(i, i + step));
      out += detok.end();
      expect(out, `party split step ${step}`).toBe('Assinou a Petrova Holdings ontem.');
    }
  });

  it('a "$" in the restored value is emitted literally (function replacer, not a $-backref)', () => {
    const r = anonymize('cliente Costa $& Silva Lda', ctx({ ruleset: { orgId: 'org1', denyList: ['Costa $& Silva Lda'] } }));
    const token = r.text.match(/[A-Z][a-z]+ [A-Z][a-z]+/)![0]; // the fake two-word token
    const wrapped = token.replace(' ', '\n');
    expect(deanonymize(`assinou ${wrapped} hoje`, r.handle)).toBe('assinou Costa $& Silva Lda hoje');
  });
});

/**
 * F26 round 3 (batch-final s2) — the re-review found the v2 streaming rewrite introduced two
 * defects: (A) a letter-head/digit-tail token (IBAN PT+23 digits, CC) was DISMEMBERED because the
 * digit-run hold only reached back to the last non-digit; (B) cap saturation cut a reflowed token
 * off from its trailing context and spliced a real value into a longer run. Both are fixed by a
 * match-straddle-aware hold + a token-free left-context margin + SEP/isSep consistency (newline is
 * a grouping separator on BOTH the regex and the streaming scanner).
 */
function validIbanFixture(): string {
  for (let cd = 2; cd <= 98; cd++) {
    const s = `PT${String(cd).padStart(2, '0')}000201231234567895417`;
    if (isValidIbanPt(s)) return s;
  }
  throw new Error('no valid IBAN');
}
function streamDetok(handle: import('../../src/llm/anonymise/index.js').VaultHandle, s: string, step: number): string {
  const d = createDetokenizer(handle);
  let out = '';
  for (let i = 0; i < s.length; i += step) out += d.push(s.slice(i, i + step));
  return out + d.end();
}

describe('F26 round 3: streaming correctness for letter-head tokens + no-splice + safety', () => {
  it('FINDING A: an IBAN token (letter head, digit tail) restores in STREAMING at every split, never dismembered', () => {
    const iban = validIbanFixture();
    const r = anonymize(`A conta ${iban} foi criada`, ctx());
    const token = r.text.match(/PT\d{23}/)![0];
    for (const reply of [`A conta ${token} foi criada.`, `IBAN: ${token}`, `${token} inicial`]) {
      for (let step = 1; step <= 8; step++) {
        expect(streamDetok(r.handle, reply, step), `${reply} @ ${step}`).toBe(deanonymize(reply, r.handle));
      }
    }
  });

  it('FINDING B: a reflowed token followed by a long digit run is NEVER spliced (streaming == batch)', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    const reflow = `${token.slice(0, 3)} ${token.slice(3, 6)} ${token.slice(6)}`;
    for (const tail of ['1'.repeat(45), '1'.repeat(200), '9', '']) {
      const reply = `x${reflow}${tail}`;
      const batch = deanonymize(reply, r.handle);
      for (let step = 1; step <= 6; step++) expect(streamDetok(r.handle, reply, step), `tail ${tail.length} @ ${step}`).toBe(batch);
    }
  });

  it('a digit token wrapped across LINES restores (SEP/isSep both include newline)', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const token = r.text.match(/\d{9}/)![0];
    const wrapped = `${token.slice(0, 3)}\n${token.slice(3, 6)}\n${token.slice(6)}`;
    expect(deanonymize(`o número é ${wrapped}.`, r.handle)).toBe(`o número é ${valid}.`);
  });

  it('memory bounded: a 50KB pure-digit stream (no token) is byte-exact and does not accumulate', () => {
    const valid = computeValidNif('50000000');
    const r = anonymize(`NIF ${valid}`, ctx());
    const big = '7'.repeat(50000);
    expect(streamDetok(r.handle, big, 997)).toBe(big);
  });

  it('SECURITY property: streaming never leaks worse than batch, restores a superset, never corrupts foreign text', { timeout: 60_000 }, () => {
    const valid = computeValidNif('50000000');
    const iban = validIbanFixture();
    const r = anonymize(`NIF ${valid} IBAN ${iban} cliente Petrova Holdings e Costa Verde`, ctx({ ruleset: { orgId: 'org1', denyList: ['Petrova Holdings', 'Costa Verde'] } }));
    const nifTok = r.text.match(/(?<![\d])\d{9}(?![\d])/)?.[0];
    const ibanTok = r.text.match(/PT\d{23}/)![0];
    const parties = r.text.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) ?? [];
    const toks = [nifTok, ibanTok, ...parties].filter(Boolean) as string[];
    const pairs = toks.map((t) => [t, deanonymize(t, r.handle)] as const);
    const seps = [' ', '.', String.fromCharCode(0xa0), String.fromCharCode(0x2009), '\n', '\r\n'];
    const words = ['conta', 'ref', 'ok', 'é', '1.234.567', '9', '2024', 'processo', 'o', ',', '.', ' ', '000', 'PT', '\n', '$&', 'end', 'total'];
    const foreign = ['conta', 'ref', 'total', 'processo', 'end'];
    const rng = (seed: number) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
    const problems: string[] = [];
    // ~13k cases (5 seeds x 350 replies x 8 splits) — heavy but well under the 60s timeout even
    // under CI parallel-worker load; the full 12-seed sweep is run out-of-band during development.
    for (const seed of [4242, 999, 12345, 77, 314159]) {
      const rand = rng(seed);
      for (let n = 0; n < 350; n++) {
        const parts: string[] = [];
        const len = 1 + Math.floor(rand() * 9);
        for (let i = 0; i < len; i++) {
          if (rand() < 0.5) {
            let t = toks[Math.floor(rand() * toks.length)]!;
            if (rand() < 0.65) { const sep = seps[Math.floor(rand() * seps.length)]!; t = t.includes(' ') ? t.replace(/ /g, sep) : t.replace(/(\d)(?=(\d{3})+$)/g, `$1${sep}`); }
            parts.push(t);
          } else parts.push(words[Math.floor(rand() * words.length)]!);
        }
        const reply = parts.join(rand() < 0.5 ? ' ' : '');
        const batch = deanonymize(reply, r.handle);
        for (const step of [1, 2, 3, 5, 7, 11, 17, 29]) {
          const stream = streamDetok(r.handle, reply, step);
          for (const [tok, val] of pairs) {
            if (stream.includes(tok) && !batch.includes(tok)) problems.push(`LEAK seed${seed} n${n} s${step} ${tok}`); // no worse leak
            if (val) { const bc = batch.split(val).length - 1; const sc = stream.split(val).length - 1; if (sc < bc) problems.push(`LESS seed${seed} n${n} s${step} ${val}`); } // superset
          }
          for (const w of foreign) { if ((batch.split(w).length - 1) !== (stream.split(w).length - 1)) problems.push(`FOREIGN seed${seed} n${n} s${step} ${w} ${JSON.stringify(reply)}`); } // no corruption
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});
