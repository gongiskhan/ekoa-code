# Incident response runbook

One page (security addendum E.5; spec ch09 §9.8). Grows into the ISMS at certification phase (§9.9).

## Roles

Solo-operator posture: the founder is incident commander, investigator, and communicator. External help (GCP support, counsel) is engaged by the founder as needed.

## Detection

- **Registo** (append-only audit, single write path): agent actions, privileged data access, auth events, admin operations. First place to look, and the evidence record.
- **Anonymisation audit** (hash-chained, metadata-only, ch17 §17.6): tamper-evident record of every egress anonymisation event; excision or reordering is detectable.
- **Chokepoint meter**: anomalous-burn alerts, rate-limit and spend-cap trips (per-org and per-user) fire at the single LLM egress route.
- **Deny-list access log** (ch17 §17.4) and boot-gate failures (fail-closed, §9.7).

## Severity

- **S1**: confirmed cross-org data exposure, credential/key compromise, or PII egress past the anonymisation boundary. Act immediately, notify.
- **S2**: single-org or single-user exposure, auth bypass without confirmed exploitation.
- **S3**: vulnerability found without exposure (internal report, review finding). Fix through the normal gated process.

## Containment (first hour)

1. Scope it from Registo + logs: who, what, when, which org(s).
2. Cut access as narrowly as the scope allows, in this order of preference:
   - deactivate the affected account(s) (activation map is write-through; takes effect immediately),
   - bump the token epoch (revokes outstanding JWTs on deactivate/role-change, §9.6),
   - revoke bridge pairings (kill switch, ch18 §18.3.5) for daemon-side incidents,
   - rotate the affected secret in Secret Manager (never in repo env files),
   - as a last resort stop the service (single process; the reverse proxy serves a static maintenance response).
3. Preserve evidence: Registo and the anonymisation audit are append-only; export the relevant window before any remediation that touches data.

## Notification

GDPR: personal-data breach to the supervisory authority within 72 h of awareness unless no risk; affected orgs/data subjects without undue delay when high risk (S1). Record the decision either way.

## Post-incident

Write the incident up (timeline, root cause, blast radius, fix) in `docs/decisions.md` or the run journal. Every accepted root cause ships with a deterministic guard in the same fix (test, lint rule, Semgrep pattern, grep gate) so the class is machine-caught afterwards. Verify backups/restore were unaffected (C5).
