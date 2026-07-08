# Gateway-topology pre-flight (Boot B, credentialed, default config)

Date: 2026-07-08. Boot: docs/release/probes/boot-b.mjs (claudeAuth.ok=true, mode=oauth), NO env overrides
(default `llmChokepointBaseUrl` = `http://127.0.0.1:4111/api/v1/llm`, `LLM_GATEWAY_API_KEY` unset).

Probe: login admin -> create session -> POST /api/v1/chat/runs {"message":"Responde apenas com a palavra: funciona"} -> SSE.

Result: run terminates in `error` after one text_chunk. Captured frames (verbatim):

```
event: text_chunk
data: {"type":"text_chunk","text":"Failed to authenticate. API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"Invalid or"}
event: error
data: {"type":"error","code":"ADAPTER_ERROR","message":"Claude Code returned an error result: Failed to authenticate. API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"Invalid or missing API key / JWT\"}}"}
```

Reading: the Agent SDK subprocess is pointed at the local gateway (as designed, FIXED-13), but the
gateway's `authenticate` requires `LLM_GATEWAY_API_KEY` to match what the subprocess presents, and
nothing provisions that value on any boot path (dev or deploy descriptors). Net: with a VALID stored
credential, the DEFAULT topology still cannot complete a single chat turn. Working topology requires
`LLM_CHOKEPOINT_BASE_URL=https://api.anthropic.com` (bypassing the gateway plane) - which is how the
rest of Boot B was run (EKOA_LLM_DIRECT=1).

Secondary observation: the raw adapter/provider error text (including the internal "Claude Code
returned an error result" phrasing) streams to the end user as a text_chunk + error frame.
