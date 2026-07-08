# F26: de-anonymisation round-trip fails when the model reformats a token with internal spaces

**Severity / class:** high / bug (correctness of the user-visible reply; NOT a privacy leak)

**Symptom:** A NIF the user sent (`509999018`) was correctly tokenised to the synthetic invalid-checksum
token `200000005` before egress (privacy HELD), but the model returned it reformatted with thousands spaces
- `200 000 005` - and the exact-string de-tokenizer found nothing to restore, so the user sees the synthetic
TOKEN, not their real NIF. Evidence: `docs/release/evidence/J6-anonymisation/roundtrip-rootcause.json`
(`reply_contains_token_spaced_200_000_005: true`, `reply_contains_original_nif: false`),
`j6-anonymisation.json` (J6.roundTrip FAIL), `chokepoint-vitest.json` (9/9 tokens-only egress still passes).

**Root cause (verified by reading code):** de-tokenization is exact-substring only.
`api/src/llm/anonymise/index.ts` `deanonymize` :241-247 does `out.includes(token)` +
`out.split(token).join(value)`, and the streaming `createDetokenizer` :252-288 uses the same `replaceFull`
(:257-263) plus a straddle buffer bounded by `maxTokenLength`. Both match the token byte-for-byte. The token
generator `checksum.ts` `makeNifToken` :111-116 produces contiguous digits (`makeNifToken(0)` = base
`20000000`, invalid control `5` -> `200000005`), so when the model rewrites it as `200 000 005` the literal
`200000005` no longer occurs and no restoration happens. The token never left egress (32 audit rows,
classes `{NIF:1}`), so this is a return-path correctness bug, not a leak.

**Fix scope:** make de-tokenization format/whitespace tolerant on the RETURN path only, in
`api/src/llm/anonymise/index.ts` (`deanonymize` + `createDetokenizer`). Change shape: for each active token,
match the token allowing insignificant internal separators (spaces / thin-spaces / NBSP, and for grouped
numerics also `.`/`'`) BETWEEN characters, e.g. build a per-token tolerant matcher from `tokensOf(handle)`
and replace the matched run (incl. the separators the model inserted) with the real value; keep
longest-token-first ordering; recompute the straddle-hold bound to account for the widened match so a
tolerant match spanning a chunk boundary is still held correctly. NON-goals: do NOT weaken the DETECTION /
tokenisation side (`detectors.ts`, `checksum.ts`, `vault.tokenFor`) - the checksum-invalid token generators
and detection precision stay exactly as-is; do not make matching so loose it rewrites unrelated digit runs
(bound tolerance to a token's own character sequence, separators only between adjacent token chars).

**Regression test first:** `api/tests/llm/anonymise.test.ts` (or `anonymise-chokepoint.test.ts`): open a
session vault, tokenise a checksum-INVALID synthetic NIF to a known token, then run the reply
`"... é ${token_with_spaces} ..."` (and a `.`-grouped variant) back through `deanonymize` and through the
streaming `createDetokenizer` split across chunk boundaries; assert the ORIGINAL value is restored and no
bare token remains. Add a negative case: an unrelated grouped number that is NOT a token is left untouched.
Must FAIL today. Use only synthetic checksum-invalid fixtures (§13.8) - never a real NIF.

**Acceptance:** a token the model reformats with internal separators is restored to the real value in both
the whole-string and streaming detok paths; unrelated numbers are untouched; the 9/9 chokepoint tokens-only
egress spec still passes (detection unchanged); re-run J6 shows the reply carrying the real NIF `509999018`.

**Notes:** anonymisation/egress chokepoint - a significance-labelled security surface (adversarial + Codex
review). Keep the change inside `api/src/llm/anonymise/` behind the §17.7 edge-boundary interface (callers
still depend only on `deanonymize`/`createDetokenizer`); the vault stays in-memory, no persistence. If the
detok algorithm is drawn in the ch17 pipeline diagram, note the tolerant-match step (FIXED-12). Privacy
property is unchanged - this touches only the RETURN path. Ties to F27 (registo filter granularity, separate).
