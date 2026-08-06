---
name: ekoa-dev-parity
description: Audit ../ekoa-dev evolution and bring functionality into ekoa-code - the parity ledger process, disposition rules, porting constraints. Load BEFORE analysing ekoa-dev commits or porting anything from ../ekoa-dev. Do NOT use for reference-access permission rules alone (that is ekoa-governance) or test mechanics (that is ekoa-testing).
---

# ekoa-dev-parity

Normative source: `docs/dev-parity.md` (the ledger) + `docs/governance.md` (reference access).

## Process

1. Run `npm run parity:audit`. It fetches `../ekoa-dev`, lists upstream commits newer than the
   ledger's recorded SHA as row scaffolds, and exits non-zero while any are undispositioned.
   Offline: `--no-fetch`. Sibling checkout elsewhere: `EKOA_DEV_DIR`.

   **It also audits PEER checkouts, and you must not skip them.** GitHub is not the source of
   truth for ekoa-dev: on 2026-08-06 the audit reported "ledger current" while four commits -
   the whole served-app email plane among them - sat committed and unpushed on the operator's
   other machine. Peers are declared in the ledger's `<!-- parity-peers: name=<url> -->` marker
   (or `EKOA_DEV_PEERS`), fetched into `refs/remotes/parity-peer-<name>/main`, and reported
   separately with their own `Last audited peer commit (\`name\`)` baseline. An unreachable peer
   warns and is named as NOT audited - never treat that as a pass. `--no-fetch` cannot reach a
   peer at all, so an offline audit is an origin-only audit; say so rather than claiming parity.
2. For each commit assign exactly ONE disposition:
   - **PORTED** - name the ekoa-code file/ref that carries the functionality. "Similar code
     exists" is not enough: verify the behaviour, not the filename.
   - **NOT-NEEDED** - state the reason (upstream housekeeping, superseded by a stronger
     ekoa-code design, dev-harness architecture difference, ...).
   - **OPEN** - functionality to bring here. An OPEN row is a live work item and must end
     PORTED or NOT-NEEDED - never silently dropped.
3. Append the rows to `docs/dev-parity.md`, update the "Last audited upstream commit" line to
   the audited origin/main SHA (and each peer's `Last audited peer commit` line to that peer's
   head), re-run the audit to green.
4. Porting an OPEN row is an ordinary change: five-layer QA applies (ekoa-testing), import
   boundaries and the egress chokepoint apply (ekoa-architecture), diagrams update with
   structural changes. Old-cortex content (prompts, skills, tests) ports only with
   runtime-truth validation against THIS repo's code.

## Constraints

- `../ekoa-dev` is READ-ONLY except `git fetch`. Never copy secret values; name env keys only.
  Peer fetches land in the `parity-peer-*` ref namespace precisely so they can never move the
  sibling checkout's own refs.
- Unpushed commits - local or on a peer - are invisible to prod. Surface them to the operator
  rather than treating either as upstream truth, and say plainly which machine they live on.
- A commit MESSAGE is not the change. `c4f7f2c6` described three fixes and contained one; the
  other two were uncommitted in the peer's working tree. Read the diff, not the subject line.
- The audit is operator-run, not a CI gate: CI has no sibling checkout, and no peer access.
