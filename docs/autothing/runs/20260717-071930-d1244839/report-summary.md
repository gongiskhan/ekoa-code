# Cortex Gateway - Claude Code v1 (run 20260717-071930-d1244839) - PASSED

A stock Claude Code client now works against Cortex via ANTHROPIC_BASE_URL + a per-user gateway key, metered on the key owner - proven LIVE with a real claude CLI.

7 slices, all gated green, landed on main (4a12588..dcbb278, 32 commits):
- S1 heartbeat-and-replay SSE liveness
- S2 model family mapping (opus/sonnet/haiku -> tiers)
- S3 count_tokens forwarding + live 50MB gateway body limit
- S4a per-user gateway API keys (store, seam, caps, billing, Registo)
- S4b keys settings UI (/settings/api-keys)
- S7 stable gateway-session vault (deny-list token stability across the tool loop)
- S6 live stock-Claude-Code proof driver + ancillary inventory

Gates: typecheck/lint/build 0; api lane 190 files/1720 tests; web 172; securityWall clean; deliberate-red proven; mutation scoped 67.5%; every slice fresh-review + cross-model Codex approved (with regression pins); every slice video-verified; built-in security review + Codex checkpoint both issues-fixed (the two decorrelated final passes each caught a real pre-auth-DoS / vault issue the other missed).

TOP FOLLOW-UP (open HIGH): gateway-anon-tooluse-fidelity - deny-list literals in Claude Code tool_use paths don't reliably detokenize across the agentic loop; a mangled near-miss can egress to the provider (confidentiality). Deny-list orgs only; empty-ruleset is a proven no-op. Deeper anonymisation-plane fix is a dedicated follow-up.
Also: S5 model-field honesty shipped pass-through pending the credential-mode decision.
