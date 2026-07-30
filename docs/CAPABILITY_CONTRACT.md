# Cortex Capability Contract

The provider-side rules for every capability Cortex exposes to an outside client. The consumer mirror lives in
the Garrison checkout at `docs/CAPABILITY_CONTRACT.md` (`~/dev/garrison`); the factual base for both is
[CONVERGENCE_AUDIT.md](./CONVERGENCE_AUDIT.md).

## The pattern

Capabilities are implemented once, in Cortex, and exposed as public, versioned, OpenAPI-documented APIs.
Consumers use them as ordinary API clients: fittings become views over the contract, hooks call the API,
in-session agents reach capabilities through a thin CLI generated from the same spec. Every call carries a
user-scoped API key, so tenancy and authorization live where they already exist, inside Cortex. Garrison is the
daily proving ground: capabilities earn their Ekoa customer UI only after surviving real use through the
Garrison views. The two sides stay decoupled; the only coupling is the contract.

## The ten hard rules (provider form)

Each rule names the gate that actually fails a build. "Not yet mechanically enforced" means exactly that: it is
a review rule today, not a CI failure. Do not upgrade the wording without upgrading the gate.

**1. One implementation, and it lives here.** A capability is written once in `api/src/`, behind a versioned
public contract. No second copy anywhere, no per-consumer variant.
*Gate:* not yet mechanically enforced. The record is the 2026-07-30 Cortex Capability Contract entry in
[decisions.md](./decisions.md) plus [CONVERGENCE_AUDIT.md](./CONVERGENCE_AUDIT.md); review rejects a duplicate.

**2. The public contract is the entire supported surface.** Everything a consumer needs is a descriptor in
`shared/` and a mounted `/api/v1` route. No private endpoint is ever handed to a consumer as a workaround.
*Gate:* `api/tests/contract/mount-coverage.test.ts` proves every declared `/api/v1` path is really mounted (no
phantom contract, and its exclusion list only carries written reasons). Whether a consumer *stays* on the public
surface is enforced consumer-side; from here it is not mechanically enforced.

**3. Cortex never special-cases a consumer.** No consumer-specific endpoints, headers, or code branches. A
client-origin header is trace only.
*Gate:* `scripts/garrison-grep.sh` (`npm run gate:garrison`, wired into `.github/workflows/ci.yml`) fails the
build on any case-insensitive `garrison` in non-test `api/src` or `shared/src`, and on any garrison dependency
in a package manifest, lockfile, or `.gitmodules`. It is name-specific, so it catches the one named consumer,
not an unnamed future one. The trace-only header holds today: `x-client` is read once in
`api/src/auth/api-key-middleware.ts` into the audit principal and consumed only by audit logging
(`api/src/memvault/service.ts`); nothing branches on it.

**4. Every call identifies a user.** Capability routes carry AuthClass `user-or-key` (`shared/src/descriptor.ts`)
and mount `requireUserOrApiKey` (`api/src/auth/api-key-middleware.ts`): a platform JWT delegates to `requireAuth`
untouched, a `ekoa_gk_` gateway key fails closed (unknown/revoked/inactive to 401 with one uniform message,
billing-locked to 402), the role is re-read live from the users store, and key principals pass a separate
per-key capability window (429). No shared or ambient identity; no unauthenticated capability endpoint.
*Gate:* `api/tests/auth/api-key-middleware.test.ts` (fail-closed verdicts, store drift, billing 402, per-key 429,
JWT path byte-identical to `requireAuth`); per-domain contract suites pin the declared class, e.g.
`api/tests/contract/memvault.test.ts`. A generic cross-domain check that every `user-or-key` descriptor route
mounts the middleware does not exist: that half is not yet mechanically enforced.

**5. Tenancy is enforced inside Cortex.** Storage is scoped per user, filesystem paths go through one jail, and
the isolation tests live beside the implementation. Consumers contain zero tenancy machinery.
*Gate:* `api/src/memvault/jail.ts` is the single path-resolution point for the notes capability, and
`api/tests/security/memvault-isolation.test.ts` attacks it through the real app (traversal payloads, planted
symlinks, a symlinked user root, cross-tenant reads under both a JWT and a real gateway key, uniform 404s with
`jail_violation` in the audit trail). A capability that stores state ships its own isolation suite of this class
or it does not ship.

**6. Open-source consumers must work without Ekoa.** Provider obligation: never require a consumer to point at
Cortex, never make a Cortex key the price of a working default, never ship a consumer-side dependency on us.
*Gate:* consumer-side only (see the mirror). Nothing in this repo enforces it.

**7. Contracts evolve additively.** Additive change lands silently; a breaking change needs a version bump and an
explicit migration of every consumer.
*Gate:* `api/tests/contract/schema-coverage.test.ts` - every descriptor endpoint must be COVERED or accounted
PENDING against a pinned `EXPECTED_PENDING_COUNT` (49 as of 2026-07-30), so a new `shared/` endpoint cannot slip
in uncovered - plus `api/tests/contract/mount-coverage.test.ts`. The OpenAPI document and its
spec-versus-descriptor drift test do not exist yet; they land with the spec slice of this run, and until then the
descriptor maps are the contract (see [api-contract.md](./api-contract.md)).

**8. The provider stays boring.** It authenticates, meters, routes, and logs. It never interprets prompt content,
injects context, or executes side effects on the caller's behalf. A direct-provider fallback always exists.
*Gate:* the egress chokepoint invariant ([architecture.md](./architecture.md)) plus `scripts/chokepoint-grep.sh`
(`npm run gate:chokepoint`, in CI): no Anthropic reference may appear outside `api/src/llm/`. Server-side there
is deliberately no bypass, so the fallback is a client-side story: the consumer re-selects a provider without the
Cortex base URL.

**9. Local execution reaches the machine only through the Cortex bridge.** The bridge is `api/src/bridge/`; no
bridge code is ever added to a consumer repo.
*Gate:* `scripts/garrison-grep.sh` keeps consumer names out of `api/src` and `shared/src`. The "no bridge code in
the consumer" half is a property of the other repo (audited absent, CONVERGENCE_AUDIT section 2.4) and is not
mechanically enforced from here.

**10. State migrations end.** Moving state runs shadow, compare, cutover-or-remove, with a dated review recorded
at the start. No permanent parallel implementation, no flag that becomes furniture.
*Gate:* not yet mechanically enforced. The dated entry in [decisions.md](./decisions.md) is the deadline, and
review is what closes it.

## How to add a capability

1. **Write the public spec.** Complete the `shared/` descriptors for the public surface and the versioned
   OpenAPI document generated from them. Public means public: nothing a consumer needs stays private.
2. **Generate the typed client and wire the drift check.** The client is generated from the spec, never
   hand-written, and CI fails when spec, implementation, and client disagree.
3. **Build or harden the Cortex implementation behind the contract.** Per-user scoping throughout; where the
   capability holds state, a single jail point and an isolation suite in the class of
   `api/tests/security/memvault-isolation.test.ts`.
4. **Write the consumer fitting against the generated client.** Public endpoints only, and a local or null
   backend as the shipped default (rule 6).
5. **Add the CLI subcommand plus skill notes** so an in-session agent reaches the capability the same way, over
   the same spec.
6. **Shadow and cut over only where state moves**, with the review date fixed up front (rule 10).
7. **Earn the customer UI later.** The Ekoa product surface follows real daily use through the consumer views,
   not the other way round.

## See also

- [CONVERGENCE_AUDIT.md](./CONVERGENCE_AUDIT.md) - the audited state of both repos behind these rules.
- [api-contract.md](./api-contract.md) - descriptor conventions, auth tiers, error envelope, contract CI gates.
- [architecture.md](./architecture.md) - module map, import boundaries, the egress chokepoint.
- [decisions.md](./decisions.md) - append-only journal; the standing decisions this document encodes.
