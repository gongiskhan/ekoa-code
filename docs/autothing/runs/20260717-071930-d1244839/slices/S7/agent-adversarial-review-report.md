VERDICT: approve

**Approved at `94cf9ee`** - see `## Re-review 3` at the end, which supersedes everything before it.
Trail: `bdbc472` -> needs-work (F1 proven, F2 blocking); `4eacf1d` -> approve; `7f2179e` ->
needs-work (F6, new); **`94cf9ee` -> approve**. Every finding I raised is now closed and verified
against its own original repro: F1 (cross-tenant vault hijack), F2 (hosted/delegated vault split),
F6 (same-org cross-user re-identification around the user-scoped ownership check). Earlier sections
are kept verbatim as the record of what was found when; nothing below has been rewritten after the
fact, including the one position I got wrong (Re-review 1's dismissal of cross-user delegation).

Fresh-context adversarial review of S7 "Stable gateway-session vault". Mandate was commit `bdbc472`
only. **The tree moved during the review**: `d783f7d` (fix(s7-codex): namespace-isolate vault keys)
landed on top of `bdbc472` mid-session, and `api/src/llm/client.ts` was further edited (uncommitted,
a `deriveVaultSession` refactor) while I was probing. Findings are therefore labelled with the exact
commit they were proven against. The blocking finding (F2) is in the S7 fix commit, not in `bdbc472`.

## Evidence

All commands run by me, from the repo, not taken on report.

| Check | Result |
| --- | --- |
| `npm run typecheck` (root, all workspaces) | clean (shared, api, web) |
| `npx vitest run tests/llm/{gateway-session-vault,anonymise-chokepoint,gateway,gateway-keys-auth,gateway-count-tokens,gateway-stream}.test.ts` | **6 files / 45 tests passed** |
| `npm run gate:chokepoint` | clean (no `@anthropic-ai/` or `api.anthropic.com` outside `api/src/llm/`) |
| `npx vitest run tests/docs/diagram-integrity.test.ts` | 13/13 passed (diagrams 06 + 10 notes land) |

Code read in full: post-change `proxyGatewayMessages` session-key derivation + the `finally`
(`client.ts` ~1143-1240), `proxyGatewayCountTokens` (~1318-1385), `sessionKeyFor` (~155),
`anonContextFor` (~164), `vault.ts` in full (`tokenFor` / `tokensOf` / `clearSession` / `sweep` /
30-min TTL), `anonymise/index.ts` `anonymizeRequestBody` / `deanonymize` / `endSession`,
`llm/gateway.ts` principal + keyId threading, `auth/gateway-keys-service.ts` (id derivation),
`bridge/provider.ts` `withSessionIdentity`.

Two throwaway probes were written, run, and removed; a temporary `__vaultDump()` export in
`vault.ts` was reverted. **Working tree left exactly as found** (`git status` verified clean of my
artifacts; `git worktree` removed). Note: `api/src/llm/anonymise/index.ts` contains a NUL byte
around offset 9171 which makes plain `grep` treat it as binary and silently return nothing - use
`rg -a`. Pre-existing, unrelated to S7, flagged only so the next reviewer does not get a false
"no matches".

### Rubric items I checked and cleared

- **keyId is unforgeable.** `opts.keyId` reaches `proxyGatewayMessages` only from
  `llm/gateway.ts` `principal.keyId`, which comes from the injected `verifyGatewayKey` verdict
  (`gateway-keys-service.verifyGatewayKey` -> `doc._id`), never from the request body. No injection.
- **Different keys -> different vaults.** Confirmed by the committed test (`__vaultCount() === 2`)
  and independently by my own probe. No cross-key bleed on the derived path.
- **Ephemeral clearing preserved.** `ephemeralVault = !explicitSession && !keyVaultId` and the
  `finally` clears exactly that case, including on a transport throw. Codex M1 holds for case 3.
- **count_tokens ephemeral is correct.** Its response body carries no tokenized content
  (`{"input_tokens":N}`), so no detokenization depends on vault stability. Leaving it keyless is
  intentional and right.
- **Vault growth is bounded.** One vault per *active* key, swept on every access against a 30-min
  `lastAccess` TTL. Minting many keys does not multiply vaults without passing the allowance gate
  and per-key caps first. Acceptable.
- **Does per-key persistence weaken ch17?** On its own, no. The vault stays in-memory only, is
  never persisted, maps one owner's own literals, and a stock client has no "session end" signal to
  clear on, so a TTL bound is the only available one - the same posture the hosted conversation
  vault already had. `security.md` states the trade honestly rather than overclaiming.

## Findings

### F1 - HIGH - cross-tenant re-identification via a crafted `metadata.session_id` (proven in `bdbc472`; ALREADY FIXED by `d783f7d`)

`bdbc472` put the client-supplied session id and the server-derived key vault id in **one flat
namespace**, with the client-supplied value winning:

```js
const explicitSession = typeof meta.session_id === 'string';
const keyVaultId = opts?.keyId ? `gwkey_${opts.keyId}` : undefined;
const sessionId = explicitSession ? (meta.session_id as string) : (keyVaultId ?? `sess_${correlationId}`);
```

So `metadata.session_id = "gwkey_<victimKeyId>"` opens the victim key's vault. Because
`deanonymize(resp.body, anon.handle)` substitutes **every** token in that vault (`tokensOf` returns
the whole map, not just this request's mints) and `mintToken(cls, seq)` is fully deterministic and
enumerable (`fakeParty(0) === 'Sociedade Aveleda'`, `makeIbanToken(0) === 'PT00' + 21 zeros`, ...),
an attacker echoes the enumerable fakes back and the gateway hands them the owner's real literals.
This is precisely the re-identification key ch17 says "cannot be produced".

Proven in a worktree pinned at `bdbc472` (attacker = a **different owner in a different org with an
empty ruleset**, holding only their own valid key):

```
ATTACKER RESPONSE BODY >>> {"content":[{"type":"text","text":"Repeat back exactly: ZarkovHoldings77"}], ...}
VAULT COUNT >>> 1        <- attacker and victim shared ONE vault
```

Mitigating precondition: the attacker needs the victim's `keyId` (sha256 of a 256-bit secret, not
guessable), which is exposed to the owner's own UI and to `gateway_key_minted` activity rows - so
this is realistically an escalation path from a keyId disclosure, not an unauthenticated dump.

**Status: fixed by `d783f7d`** (disjoint `csid:` / `gwkey:` / `eph:` namespaces). I verified the fix
holds: the same probe against HEAD yields two distinct vaults (`gwkey:kid_victim_sha256` and
`csid:attackerOwner:gwkey_kid_victim_sha256`) and no leak. Recorded here because the reviewed commit
did contain it and it belongs in the findings ledger; **not** the reason for the verdict.

### F2 - HIGH - BLOCKING - the S7 fix (`d783f7d`) splits the hosted vault from the delegated vault, re-introducing the brief §3 failure on the bridge path

`d783f7d` scopes the client-supplied id by billee - `csid:<billee>:<session_id>` - **only on the
gateway path**. The hosted path still keys by the raw conversation id (`client.ts` ~155):

```js
function sessionKeyFor(attribution) {
  if (attribution.kind === 'user_work' && attribution.sessionId) {
    return { sessionId: attribution.sessionId, ephemeral: false };  // raw 'conv-1'
  }
  ...
}
```

`bridge/provider.ts` propagates the conversation id explicitly *so the two share a vault*:

```js
/** Set the propagated conversation id on the request metadata so the chokepoint keys the
 *  anonymisation vault by {org, session} (§18.4.3, §17.5). */
meta.session_id = session;
```

After `d783f7d` the hosted turn writes vault `conv-1` and the delegated turn reads vault
`csid:u1:conv-1`. They are different vaults, so a token minted on the hosted turn no longer
detokenizes on the delegated turn. Proven (probe: hosted `runOneShot` with
`sessionId: 'conv-1'`, then `proxyGatewayMessages` with `metadata.session_id: 'conv-1'`, same
billee `u1`):

```
HOSTED FAKE TOKEN >>> "Sociedade Aveleda"
VAULTS AFTER HOSTED TURN    >>> [["conv-1",[["Sociedade Aveleda","Petrova Holdings"]]]]
VAULTS AFTER DELEGATED TURN >>> [["conv-1",[["Sociedade Aveleda","Petrova Holdings"]]],["csid:u1:conv-1",[]]]
DELEGATED RESPONSE >>> {"content":[{"type":"text","text":"open the folder Sociedade Aveleda"}], ...}
```

The client receives the **fake**, undetokenized. That is verbatim the failure the brief names as the
acceptance criterion S7 exists to satisfy: *"A tokenized path or identifier that reaches Claude Code
and fails to detokenize hands the client a file that does not exist; the tool loop then fails in
confusing ways."* S7 fixed this for the stock-client loop and the fix for F1 re-opened it for the
bridge/daemon loop, breaking the `security.md` ch17 sentence the same slice edits ("keyed by the
hosted conversation id so tokens stay consistent across delegated local turns") and the §18.4.3
correlation-join intent.

`d783f7d`'s stated regression pin - *"same billee+session_id still shares a vault"* - only compares
two **gateway** calls. It cannot catch this, because both sides of that comparison get the same
`csid:` prefix. No committed test covers hosted-turn-then-delegated-turn vault sharing, which is why
this landed green.

**Recommended fix** (also removes the billee/owner mismatch risk): key conversation-scoped vaults by
**{orgId, sessionId}** - the scope `bridge/provider.ts` already documents - at **both** entry points
(`sessionKeyFor` and `deriveVaultSession`), keeping `gwkey:<keyId>` and `eph:<correlationId>`
disjoint. Org scope is the correct tenancy boundary here (the ruleset itself is per-org), it keeps
hosted and delegated turns on one vault, it survives two users sharing one conversation (which
billee scoping also breaks), and it still makes a crafted `gwkey:<victim>` unreachable. Whatever
scope is chosen, the two derivations must be the *same function*.

### F3 - MEDIUM - the "explicit session_id wins" test cannot fail, and that is the gap F1 walked through

`gateway-session-vault.test.ts`:

```js
it('an explicit session_id still wins and its vault persists (bridge path unchanged)', async () => {
  const withSession = { ...body(), metadata: { session_id: 'conv-42' } };
  await proxyGatewayMessages(withSession, 'owner1', undefined, { agentType: 'gateway-client', keyId: 'kid_X' });
  // The explicit conversation id is the vault key (not the gwkey), and it persists.
  expect(__vaultCount()).toBe(1);
});
```

`__vaultCount() === 1` is true whether the vault is keyed by `conv-42` **or** by `gwkey:kid_X` -
exactly one vault exists either way. The assertion cannot distinguish the two branches, so it does
not verify the claim in its own comment, and it would pass against a derivation that ignored
`session_id` entirely. The suite asserts vault *cardinality* everywhere but never vault *identity*,
which is why a namespace-collision bug (F1) and now a namespace-split bug (F2) both land green.
Add an observability seam for the vault id (or assert identity behaviourally: same `session_id` +
**different** `keyId` must share a vault, and cross-entry hosted/delegated sharing per F2).

### F4 - LOW - "cleared on EVERY exit" overclaims: the fail-closed refusal path leaks an ephemeral vault to TTL

`anonymizeRequestBody` calls `openVault()` and can `throw AnonymisationRefusedError` (fail-closed
detectors), and it is invoked **before** the `try { ... } finally { if (ephemeralVault) endSession(...) }`
block. A refused request therefore leaves its `eph:<correlationId>` vault - possibly already holding
mints from leaves tokenized before the failure - lingering to the 30-min TTL, which is the exact
thing the comment above the `finally` (and Codex checkpoint M1) says must not happen: *"the
re-identification key must not linger to TTL after a failed gateway call"*. Pre-existing, not
introduced by `bdbc472`; raised only because this commit re-states the "EVERY exit" claim in the code
it touches. Cheap fix: open the vault inside the `try`, or clear on the refusal path.

### F5 - NIT - `partyTokenIn` is a misleading no-op in the committed test

```js
function partyTokenIn(payload: string): string | null {
  return payload.includes(PARTY) ? '<CLEARTEXT-LEAKED>' : payload;
}
```

Its docstring promises "the token a given payload used for the deny-listed party" but it returns the
**whole payload**, so `expect(partyTokenIn(calls[0])).toBe(partyTokenIn(calls[1]))` is just a
duplicate of the `expect(calls[0]).toBe(calls[1])` on the next line, and the declared `| null` never
occurs. Harmless (the real assertions carry the test), but it reads as a stronger, more targeted
check than it is. Inline it or delete it.

## Verdict rationale (original review - superseded by `## Re-review`)

`bdbc472`'s own acceptance is met and its stated scope is honoured: keying by `gwkey_<keyId>` does
give cross-request token stability, explicit `session_id` still wins, the ephemeral case is still
cleared, `count_tokens` is correctly left alone, and typecheck / the 45-test llm lane / the
chokepoint gate / the diagram test are all green by my own run. The privacy posture of *persisting*
a per-key vault is defensible and honestly documented.

The verdict is **needs-work** because F2 - a proven, spec-cited regression that re-introduces the
brief §3 failure on the bridge path - survives in the slice's current HEAD, and F3 shows the test
suite cannot catch that class of defect. F1 is already remediated and is recorded, not charged.

---

## Re-review 1 (at `4eacf1d`, billee-scoping - SUPERSEDED, see Re-review 2)

Scope: re-verify F2's closure at `4eacf1d` (fix(s7-review): scope the SDK path's session key too),
confirm F1 stays closed, and hunt for a new vault-sharing regression on the SDK-only paths. HEAD at
re-review: `4eacf1d` <- `31309d9` (count_tokens sibling) <- `d783f7d` (codex namespace) <- `bdbc472`.

The fix makes `sessionKeyFor` emit the same form as the gateway path:

```js
return { sessionId: `csid:${billeeOf(attribution)}:${attribution.sessionId}`, ephemeral: false };
// session-less fallback also renamed sess_<corr> -> eph:<corr>
```

### Re-review evidence (my own runs, at `4eacf1d`)

| Check | Result |
| --- | --- |
| `npm run typecheck` (root, all workspaces) | clean |
| `npx vitest run` gateway-session-vault, anonymise-chokepoint, gateway, gateway-keys-auth, gateway-count-tokens, gateway-stream, client, fake-daemon/correlation-join, migration/parity-workload | **9 files / 69 tests passed** |
| `npm run gate:chokepoint` | clean |
| `npx vitest run tests/docs/diagram-integrity.test.ts` | 13/13 passed |

Probes written, run, and removed; the temporary `__vaultDump()` export reverted. Working tree left
as found.

### F2 - CLOSED (verified behaviourally, not just by cardinality)

My original F2 probe, re-run against `4eacf1d`, now passes - the hosted turn and the delegated turn
land in ONE vault and the fake round-trips back to the real literal:

```
HOSTED FAKE >>> "Sociedade Aveleda"
VAULTS AFTER HOSTED    >>> [["csid:u1:conv-1",[["Sociedade Aveleda","Petrova Holdings"]]]]
VAULTS AFTER DELEGATED >>> [["csid:u1:conv-1",[["Sociedade Aveleda","Petrova Holdings"]]]]
DELEGATED RESPONSE >>> {"content":[{"type":"text","text":"open the folder Petrova Holdings"}], ...}
```

`__vaultCount() === 1`. The brief §3 failure ("hands the client a file that does not exist") is gone
from the bridge path. This is the exact probe that failed before, so the closure is demonstrated
against the original repro, not a substitute.

**I withdraw the `{orgId, sessionId}` recommendation from F2.** It was based on the
`bridge/provider.ts` `withSessionIdentity` comment ("keys the anonymisation vault by {org, session}"),
which I now believe is the imprecise statement. The authoritative §18.4.3 definition, in two places,
is the **owner + conversation**:

```js
/** The delegating principal: the pairing owner + the hosted conversation id (the §18.4.3 vault key). */
// bridge/delegation.ts:30  -> DelegationActor { userId, sessionId }
/** The delegating principal: the run's owner + the hosted conversation id (ch18 §18.4.3 vault key).
 *  Both bind from the run's actor at spec-build time - NEVER from tool arguments. */
// agents/seams.ts:179      -> DelegationToolActor { userId, sessionId }
```

`csid:<billee>:<conv>` implements exactly that, and it is strictly stricter than org scope. The
chosen fix is the right one; my original suggestion would have been a widening.

I probed the one gap this leaves - `bridge/provider.ts` bills `pairing.ownerUserId` but only checks
that the conversation's org matches the pairing's org (`sessionOrg !== pairing.org` -> reject), never
that the pairing owner IS the session owner - so a same-org cross-user delegation derives
`csid:userB:conv-1` against a vault minted at `csid:userA:conv-1` and the client receives the fake.
**I am not raising this as a finding.** Under the §18.4.3 contract the delegating principal binds
from the run's actor, so owner != session owner is not a legitimate flow; and on that path the
scoping fails *safe* - userB gets a meaningless fake, never userA's cleartext. Isolation is the
correct outcome there, so this is the design working, not a defect.

### F1 - STAYS CLOSED

Re-probed with four crafted `session_id` values aimed at the reserved namespace; the
`csid:<billee>:` prefix always wins and no variant reaches `gwkey:kid_victim_sha256`:

```
CRAFT "gwkey:kid_victim_sha256"                    -> csid:attackerOwner:gwkey:kid_victim_sha256   (empty)
CRAFT "gwkey_kid_victim_sha256"                    -> csid:attackerOwner:gwkey_kid_victim_sha256   (empty)
CRAFT ":gwkey:kid_victim_sha256"                   -> csid:attackerOwner::gwkey:kid_victim_sha256  (empty)
CRAFT "csid:victimOwner:gwkey:kid_victim_sha256"   -> csid:attackerOwner:csid:victimOwner:...      (empty)
```

All four: victim cleartext absent from the attacker's response. The committed pin for this
(`expect(__vaultCount()).toBe(2)`) is a real assertion - it would read 1 under the `bdbc472`
derivation.

### No new regression on the SDK-only paths

- Two users in the same org with the **same** conversation id -> two vaults
  (`csid:userA:shared-conv`, `csid:userB:shared-conv`). No cross-user bleed introduced by keying the
  SDK path.
- A session-less run (`completeFast`, classifier attribution) -> `__vaultCount() === 0` after the
  call, response still cleartext. The `sess_ -> eph:` rename did not break ephemeral clearing.
- `clearSession` is reached only via `endSession(handle)` inside `client.ts`, always with the derived
  handle - no route or session-end hook clears by raw conversation id, so the key-format change
  silently breaks no caller. (I checked this specifically: it is the obvious way a vault-key rename
  could strand vaults.)

### Remaining, all non-blocking

- **F3 (partly addressed).** The two properties that matter are now pinned by assertions that *can*
  fail: the hijack pin (`count === 2`) and the new bridge pin (`count === 1`). The specific test I
  flagged - "an explicit session_id still wins", asserting `count === 1` with both a `session_id` and
  a `keyId` present - is still unable to distinguish `csid:owner1:conv-42` from `gwkey:kid_X` and so
  still does not verify its own comment. The suite also remains cardinality-based; the new bridge pin
  proves one vault exists, not that the token actually detokenizes (my probe proved the latter).
  Worth a behavioural assert, not worth blocking.
- **F4 (open, pre-existing).** Fail-closed refusal still leaks an `eph:` vault to TTL
  (`anonymizeRequestBody` opens the vault and can throw before the `try`/`finally`).
- **F5 (open).** `partyTokenIn` is still a misleading no-op.
- **NIT (new).** `csid:<billee>:<id>` is an ambiguous concatenation: a billee of `x` with a crafted
  `session_id` of `y:conv-1` derives the same key as a billee of `x:y` with `conv-1`. I confirmed the
  collision leaks cleartext *when a userId contains a colon* - but userIds come from
  `genId: () => randomUUID()` (fixed-length, colon-free), so no attacker can hold or forge such an
  id and this is **not reachable**. Recording it as hardening only (reject `:` in `session_id`, or
  length-prefix the billee), not as a finding.
- **NIT (new).** `bridge/provider.ts` `withSessionIdentity`'s docstring still says the chokepoint
  keys the vault "by {org, session}"; the actual and §18.4.3-documented key is {owner, conversation}.
  One-line comment fix so the stated contract matches the code.

### Verdict (re-review 1, at `4eacf1d` - superseded by `## Re-review 2`)

**approve.** The blocking F2 is closed against its original repro, F1 stays closed under four attack
variants, the SDK-path change introduces no cross-user bleed and no ephemeral-clearing regression,
and typecheck / 69 tests / chokepoint gate / diagram integrity are green by my own runs. What remains
is one weak-but-harmless test assertion, two pre-existing nits, and two hardening/doc nits - no
material, evidence-backed finding survives.

---

## Re-review 2 (at `7f2179e`, ORG-scoping) - SUPERSEDED by Re-review 3

`7f2179e` replaces billee-scoping with ORG-scoping on both derivations:
`csid:<orgId>:<sessionId>` (gateway `deriveVaultSession` + SDK `sessionKeyFor`, now async).

**Everything the fix set out to do, it does.** All four asked-for properties verified by my own
probes at `7f2179e`:

| Property | Result |
| --- | --- |
| (1) Cross-user same-org bridge delegation (A hosts conv-1, B delegates) | **ONE shared vault** `csid:orgX:conv-1`; fake -> `Petrova Holdings` |
| (2) Self-delegation (the Re-review 1 scenario) | still shares; no regression |
| (3) Cross-ORG isolation (userZ/orgY names orgX's conv-1) | **isolated** - `csid:orgY:conv-1` empty, no cleartext |
| (4) F1 - crafted `gwkey:kid_victim` / `gwkey_kid_victim` | **stays closed** - lands in `csid:orgX:gwkey:kid_victim` (empty) |
| (5) Session-less run | `__vaultCount() === 0`, response still cleartext |

Gates at `7f2179e`, my own runs: `npm run typecheck` clean; `npm run gate:chokepoint` clean;
**9 files / 69 tests passed** (gateway-session-vault, anonymise-chokepoint, gateway,
gateway-keys-auth, gateway-count-tokens, gateway-stream, client, fake-daemon/correlation-join,
migration/parity-workload). `sessionKeyFor`'s async change: all three call sites (`runAgent` 749,
`runOneShot` 885, `completeFast` 960) correctly `await`; no unawaited Promise reaching a vault key.

F2 is therefore **fully closed** - for every delegation shape, not just self-delegation. My
Re-review 1 position (that cross-user same-org delegation was not a legitimate flow and could stay
split) was **wrong**, and Codex was right to push: `bridge/provider.ts` authorises delegation at ORG
granularity, so a same-org delegator is a supported flow and must share the vault. I withdraw it.

But org-scoping introduces a new, material problem that neither the billee-scoped version nor
`bdbc472` had.

### F6 - HIGH - BLOCKING (new in `7f2179e`) - the org-scoped conversation vault is readable by a same-org user the platform forbids from reading that conversation

The conversation vault is now keyed `csid:<orgId>:<sessionId>`, where `orgId` is resolved from the
**caller's own** billee and `sessionId` is taken **verbatim from the client's request body** with no
check that the caller has any relationship to that conversation. The platform's own authorization
model for conversations is **user-scoped, not org-scoped**:

```js
/**
 * Sessions router (ch03 §3.8.6). ...
 * User-scoped: ownership mismatch → uniform not-found.
 */
export async function ownedSession(userId: string, id: string): Promise<SessionDoc | null> {
  const s = await sessions.get(id);
  return s && s.userId === userId ? s : null;   // platform-crud.ts:102
}
```

Every `/sessions/:id` route (including `GET /:id/messages`) gates on `ownedSession` and answers a
uniform 404 to a non-owner. So user B **cannot read** user A's conversation `conv-1` at all - but
after `7f2179e`, B can recover the real literals behind that conversation's tokens. Proven at
`7f2179e` (B never touched conv-1; B simply names it):

```
VAULTS AFTER HOSTED (userA) >>> [["csid:orgX:conv-1",[["Sociedade Aveleda","Petrova Holdings"]]]]
SAME-ORG CROSS-USER READ >>> {"content":[{"type":"text","text":"open the folder Petrova Holdings"}], ...}
```

Mechanism is identical to F1: `deanonymize` substitutes **every** token in the named vault, and
`mintToken(cls, seq)` is deterministic and enumerable, so B echoes the enumerable fakes
(`Sociedade Aveleda`, `PT00…`, NIF-shaped tokens) and receives A's real client names, NIFs and IBANs
- entities detected in **A's** private documents, not merely org-wide deny-list config. This is a
side channel around the user-scoped ownership check, and it is exactly the ch17 I5 posture ("a
re-identification key that does not exist cannot be produced") applied to the wrong tenancy unit.

Precondition, stated honestly: B needs A's conversation id, which is a `randomUUID()` and is not
exposed cross-user (`listSessions` is user-scoped). So this is an escalation from a conversation-id
disclosure, not an unauthenticated dump - the **same shape and same severity as F1**, which was
fixed rather than accepted on exactly that reasoning.

**Root cause is not org-scoping itself** - it is that the gateway trusts an unvalidated,
client-supplied `session_id` as a vault key. §18.4.3's `{org, session}` is sound *when the session id
arrives on the bridge path*, which validates it first (`sessionOrg !== pairing.org` -> reject); it is
unsound when a stock Anthropic client can put any string in `metadata.session_id`.
`proxyGatewayMessages` cannot currently tell the two apart.

Recommended fix (keeps F2 closed and re-closes F6):

- On the gateway path, honour a client-supplied `session_id` only if it names a conversation the
  billee is entitled to - i.e. resolve the conversation and require `sessions.get(id).userId ===
  billee` (or org membership if the product really intends org-wide conversation access, in which
  case `ownedSession`/the sessions router is the thing that is wrong and should say so). Otherwise
  ignore it and fall through to `gwkey:` / `eph:`.
- Keep `csid:<orgId>:<conv>` as the key once the session id is validated, so hosted + any authorised
  same-org delegator still share the one vault (F2 stays closed).

A cheaper interim: have the bridge mark its own (already org-validated) session propagation as
trusted - e.g. an internal `opts.trustedSessionId` set only by `bridge/provider.ts` - and ignore
`metadata.session_id` from any other caller. That closes F6 without any new DB read on the hot path.

### Also worth fixing while here (non-blocking)

- **Double org resolution.** `sessionKeyFor` now `await`s `orgResolver(billee)` and `anonContextFor`
  immediately resolves the same org again - two lookups per SDK call on the hot path. Resolve once
  and thread it.
- **`'' ` org fallback is fail-open.** `(await orgResolver(...)) ?? ''` means an org-resolution
  failure silently keys the vault `csid::<conv>`, a shared bucket, rather than failing closed to an
  ephemeral vault. Practically unreachable (conversation ids are uuids, so two org-less users would
  have to collide on one) but it is the wrong default for a key on a privacy boundary.
- **Stale comment.** `proxyGatewayCountTokens` still says "a client session_id is billee-scoped"; it
  is now org-scoped.
- **F3 / F4 / F5** from the original review stand as previously written (all non-blocking).
- The delimiter nit from Re-review 1 is now *moot in its userId form* but reappears in org form:
  `csid:<orgId>:<conv>` with an orgId containing `:` would collide. orgIds are `randomUUID()` too, so
  again unreachable; same cheap hardening applies.

### Verdict (re-review 2, at `7f2179e` - superseded by `## Re-review 3`)

**needs-work.** F2 is genuinely and fully closed, F1 stays closed, cross-org isolation holds, and
every gate is green by my own runs - but F6 is a new, proven, HIGH-severity widening introduced by
this commit: it makes a re-identification map readable across a user boundary the platform itself
enforces with a uniform 404. It is the same class and severity as F1, which this slice already chose
to fix rather than accept. Close F6 (validate the session id, or trust it only from the bridge) and
the slice is approvable - the `{org, session}` key itself is correct and should stay.

---

## Re-review 3 (at `94cf9ee`, trusted-session gating) - CURRENT, SUPERSEDES Re-review 1 and 2

`94cf9ee` gates the shared conversation vault on an unforgeable server-side trust signal, which is
the fix I recommended. `deriveVaultSession`, most specific first:

```js
if (args.keyId) return { sessionId: sid ? `gwkey:${args.keyId}:${sid}` : `gwkey:${args.keyId}`, ephemeral: false };
if (sid && args.trustedSession) return { sessionId: `csid:${args.orgId}:${sid}`, ephemeral: false };
if (sid) return { sessionId: `csid:${args.orgId}:usr:${args.billeeUserId}:${sid}`, ephemeral: false };
return { sessionId: `eph:${args.correlationId}`, ephemeral: true };
// trustedSession: correlationIdIn !== undefined
```

### The trust signal is genuinely unforgeable

I traced **every** caller that could set it - there are exactly two:

- `api/src/bridge/provider.ts:168` - `runCompletion(reqBody, pairing.ownerUserId, correlationId)`, the
  bridge, after its credential -> pairing -> socket-binding -> activation -> org checks.
- `api/src/llm/gateway.ts:222` - passes `undefined` **explicitly** as the third argument for every
  direct client (stock, JWT, or key).

`correlationIdIn` is a positional function parameter, unreachable from the request body, so no stock
client can promote itself to trusted. `count_tokens` hardcodes `trustedSession: false`.

### F6 - CLOSED (verified against its own original repro)

```
F6 VAULTS   >>> [["csid:orgX:conv-1",[["Sociedade Aveleda","Petrova Holdings"]]],
                 ["csid:orgX:usr:userB:conv-1",[]]]
F6 RESPONSE >>> {"content":[{"type":"text","text":"open the folder Sociedade Aveleda"}], ...}
```

User B naming user A's conversation now lands in an isolated, empty vault and gets back only the
meaningless fake - A's `Petrova Holdings` never appears. This is the exact probe that leaked at
`7f2179e`.

### Everything else re-verified at `94cf9ee` (my own probes)

| Property | Result |
| --- | --- |
| BRIDGE same-org cross-user delegation WITH the server correlationId | **ONE shared vault** `csid:orgX:conv-1`; fake -> `Petrova Holdings` (F2 stays closed) |
| CROSS-ORG with a correlationId (userZ/orgY names orgX's conv-1) | isolated - `csid:orgY:conv-1` empty, no leak (org resolves server-side from the billee, so "trusted" does not mean "any org") |
| F1 - key principal crafts `gwkey:kid_victim` | `gwkey:kid_attacker:gwkey:kid_victim` (empty) - no reach |
| F1b - key principal crafts a conversation id | `gwkey:kid_attacker:conv-1` (empty) - a key principal can reach no conversation vault |
| count_tokens (userB, `session_id: conv-1`) | wrote to `csid:orgX:usr:userB:conv-1`, never A's vault |
| S7's ORIGINAL acceptance - stock key client, no session_id, 2 requests | **ONE vault** `gwkey:kid_stable` - cross-request token stability intact |
| Session-less run | `__vaultCount() === 0` |

Gates at `94cf9ee`, my own runs: `npm run typecheck` clean; `npm run gate:chokepoint` clean;
`npx vitest run tests/docs/diagram-integrity.test.ts` 13/13; **15 files / 103 tests passed**
(gateway-session-vault, anonymise-chokepoint, gateway, gateway-keys-auth, gateway-count-tokens,
gateway-stream, client, fake-daemon/correlation-join, migration/parity-workload, tests/bridge).

Working tree left exactly as found (probes removed, `__vaultDump()` debug export reverted,
`git status` verified).

### The four vault namespaces are now provably disjoint

`gwkey:<keyId>[:<sid>]` / `csid:<org>:<conv>` / `csid:<org>:usr:<billee>:<sid>` / `eph:<corr>`.
Cross-reach would require a uuid/sha256 identifier to contain a `:` or to prefix another - `keyId`
is 64-hex (sha256), `orgId`/`billeeUserId`/conversation ids are all `randomUUID()` (fixed length,
colon-free). No client-supplied string can escape its own prefix.

### Residual, recorded not blocking

- **The bridge path is ORG-validated, not ownership-validated.** `bridge/provider.ts` checks
  `sessionOrg !== pairing.org -> reject` but never that `pairing.ownerUserId` owns the conversation,
  so a same-org user with a paired daemon can still name another user's conversation id and reach
  `csid:<org>:<conv>`. I am **not blocking on this**: it is pre-existing (before S7 the raw
  `session_id` key gave *every* client, cross-org included, the same or wider reach - S7 strictly
  narrowed it at every step), and it is the deliberate `{org, session}` semantics that F2 and the
  codex recheck both require. But it should be a recorded decision, because it is the same
  user-boundary tension F6 was about, and the fix's own docstring overstates it: "ownership
  pre-validated by bridge/provider" should read **org-membership pre-validated**. If org-wide
  conversation reach is not intended, the bridge needs the ownership check, not the vault.
- **F3 (open, now with hard evidence).** The "an explicit session_id still wins" test still asserts
  only `__vaultCount() === 1` while passing BOTH a `session_id` and a `keyId`. Under `94cf9ee` rule
  (1) the key now wins and the real key is `gwkey:kid_X:conv-42` - I verified this directly - so the
  test's comment ("The explicit conversation id is the vault key (not the gwkey)") is now **actively
  false**, and its assertion cannot detect that. The behaviour is correct; the test is not. This is
  the third time a cardinality-only assert has masked a real semantic change in this slice.
- **F4 / F5** stand as originally written (both non-blocking, F4 pre-existing).
- **Double org resolution** and the **`?? ''` fail-open org fallback** from Re-review 2 stand.
- **Stale comment.** `proxyGatewayCountTokens` still says "a client session_id is billee-scoped"; it
  is org+billee-scoped now.

### Verdict (current)

**approve.** Every finding I raised is closed and verified against its own original repro: F1 (four
crafted variants, none reach a key vault), F2 (hosted + any authorised same-org delegator share one
vault, fake detokenizes), F6 (the leaking probe now isolates). S7's original acceptance - one stock
Claude Code session, one vault, stable tokens across the tool loop - is intact and re-verified. The
trust signal is unforgeable from the request body, verified by tracing all call sites. Gates green by
my own runs. What remains is one wrong test comment, two doc/comment inaccuracies, a pre-existing
bridge-authz residual, and two minor robustness nits - no material, evidence-backed finding survives.
