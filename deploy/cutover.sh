#!/usr/bin/env bash
# P-26 upstream-swap cutover (ch14 §14.4 G13; ch10 §10.6/§10.8). Repoints the existing reverse
# proxy's upstreams from old-Cortex to the new ekoa-api + ekoa-web containers. In this run the
# ONLY supported mode is --dry-run: it prints the cutover plan and makes NO changes. A real
# cutover is the founder-gated procedure (staging -> parity rounds -> switch), OUTSIDE this run
# (§14.4). The old ekoa-deploy pipeline keeps deploying old Cortex until the founder switches.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=0
for a in "$@"; do case "$a" in --dry-run) DRY_RUN=1 ;; esac; done

if [ "$DRY_RUN" -ne 1 ]; then
  echo "cutover.sh: refusing to run a REAL cutover from this repo." >&2
  echo "  The cutover is the founder-gated chapter-10 procedure (staging -> parity -> switch)," >&2
  echo "  performed OUTSIDE this run (spec §14.4). Re-run with --dry-run to preview the plan." >&2
  exit 2
fi

api_port=$(jq -r '.port' deploy/api.service.json)
web_port=$(jq -r '.port' deploy/web.service.json)

cat <<PLAN
[cutover DRY-RUN] P-26 upstream-swap plan (no changes made):

  Reverse proxy (existing, Cloudflare edge -> origin proxy):
    BEFORE:  proxy upstream  ->  old-Cortex (single container)
    AFTER:   proxy upstream  ->  ekoa-api  (127.0.0.1:${api_port}, health /health)
             proxy upstream  ->  ekoa-web  (127.0.0.1:${web_port}, health /)

  Sequence (founder-gated, chapter 10 - NOT executed here):
    1. Deploy ekoa-api + ekoa-web containers alongside old-Cortex (no traffic yet).
    2. Health-gate both (/health 200, / 200) + run the parity workload (scripts/parity-workload).
    3. Swap the proxy upstreams to the new containers (atomic, reversible).
    4. Drain + retire old-Cortex once parity holds (the retirement row is chapter 10's).

  Secrets: injected at container runtime from Secret Manager (FIXED-14 C3) - never in this repo.
  Region: EU (europe-west) pinned at the infra layer (C1, owner action).

[cutover DRY-RUN] OK - plan well-formed, no changes made.
PLAN
