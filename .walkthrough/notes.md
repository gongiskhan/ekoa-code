# Walkthrough notes - ekoa-code

## Flows that matter
- The chat-run journey: /login (real UI login) -> /chat composer -> streamed answer -> persistence (session URL load + messages API panel).
- The stack MUST be booted with `node .claude/skills/run-ekoa-code/driver.mjs up` (CSP/CORS traps make plain `next dev` unable to log in; see .claude/skills/run-ekoa-code/SKILL.md).
- A model credential must be provisioned per boot (ephemeral in-memory Mongo): the operator runs provision-credential.mjs; confirm /health claudeAuth.configured=true before recording a chat run.

## Captions
- English captions over the Portuguese UI. Login button is "Entrar"; composer is the textbox named "Descreva o que precisa...". Login lands on /chat.
- No em dashes, no emoji.

## Always show
- The verified numeric result highlighted (compound-interest demo: montante 1157,63 EUR for 1000 EUR at 5%/yr over 3 years).
- Persistence: a session loaded fresh by URL and/or the messages API evidence panel.

## Storyboard gotchas (learned 2026-07-10)
- Model output formatting varies run to run (one run wrote "1157,63", the next "1.157,63" with the Portuguese thousands separator). Anchor holdUntil/asserts on format-stable substrings ("157,63"), never on a full formatted number.
- A `continue: true` segment does NOT inherit baseURL; any `goto` action in it needs the segment to re-declare `"baseURL"` or the navigation throws on a relative URL.
- The dashboard header has a live "Tokens" usage meter; a beat highlighting it proves the run was metered.

## Avoid on camera
- /usage (crashes as of 2026-07-10: pageerror "Cannot read properties of undefined (reading 'toLocaleString')" while the billing API returns 200 - OPEN finding in RUN_LOG).
- /integrations and any credentials screens.
- Login-on-camera is deliberate in this repo: admin/tmp12345 is a committed dev-only default (printed by the driver's READY line) and the login flow itself is a fixed surface walkthroughs prove (a53c455).
