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
2. For each commit assign exactly ONE disposition:
   - **PORTED** - name the ekoa-code file/ref that carries the functionality. "Similar code
     exists" is not enough: verify the behaviour, not the filename.
   - **NOT-NEEDED** - state the reason (upstream housekeeping, superseded by a stronger
     ekoa-code design, dev-harness architecture difference, ...).
   - **OPEN** - functionality to bring here. An OPEN row is a live work item and must end
     PORTED or NOT-NEEDED - never silently dropped.
3. Append the rows to `docs/dev-parity.md`, update the "Last audited upstream commit" line to
   the audited origin/main SHA, re-run the audit to green.
4. Porting an OPEN row is an ordinary change: five-layer QA applies (ekoa-testing), import
   boundaries and the egress chokepoint apply (ekoa-architecture), diagrams update with
   structural changes. Old-cortex content (prompts, skills, tests) ports only with
   runtime-truth validation against THIS repo's code.

## Constraints

- `../ekoa-dev` is READ-ONLY except `git fetch`. Never copy secret values; name env keys only.
- Local-only ekoa-dev commits are invisible to prod - the audit warns on local/origin drift;
  surface unpushed commits to the operator rather than treating local state as upstream truth.
- The audit is operator-run, not a CI gate: CI has no sibling checkout.
