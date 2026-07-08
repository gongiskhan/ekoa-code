# F20: chat `complete.result` (and the persisted assistant message) carry only a tail

**Severity / class:** medium / bug

**Symptom:** The chat run's terminal `complete` frame carries only a ~25-char TAIL of the answer;
the full reply is reconstructable only from the `text_chunk` stream. Reproduced across two runs.
Evidence: `docs/release/evidence/J2-grounding/j2-grounding.json` - `replyFromChunks` is the full 385-char
answer ("Com base na base de conhecimento ... RX-417"), but `replyFromComplete` / the `complete` frame
`result` is just `"do processo:** **RX-417**"` (the last delta). Same shape in J4 turnA
(`complete.result = "Estou pronto para ajudar!"` vs the full "Anotado! ... Estou pronto para ajudar!").
Any client reading the completion frame or the `GET /chat/runs/:id` snapshot gets a truncated answer, and
the PERSISTED assistant message is truncated too (see root cause) - so future `loadHistory` context is
corrupted, not just the wire snapshot.

**Root cause (verified by reading code):** the accumulated stream text is discarded in favour of the SDK
`result` message's `.result` field, which held only the final delta. Two clobbers on the one path:
- `api/src/llm/client.ts` `defaultTransport.streamAgent` :351 accumulates `text += t` for every assistant
  delta (correct = full answer), then :365 `if (msg.subtype === 'success') text = (msg as {result}).result;`
  OVERWRITES it with the result field, and :375 yields `{kind:'final', text, ...}` carrying the tail.
- `api/src/llm/client.ts` `runAgent` :672 accumulates `rawText += msg.text` per delta, then :694
  `case 'final': rawText = msg.text || rawText;` clobbers the accumulation with `final.text` (the tail).
That tail flows `rawText` -> :711 `text = deanonymize(rawText)` -> `AgentRunResult.text` -> `agents/chat.ts`
:163 `result.text` -> :172 `cleanText` -> :201 `finishComplete(cleanText)` (streaming.ts :62 `complete`) AND
:200 `persistAssistantMessage(cleanText)` AND registry snapshot (`settleChatRun result`). The streamed
`sink.text` deltas (:159) are fine - only the terminal snapshot + persistence are truncated.

**Fix scope:** files `api/src/llm/client.ts` only (the egress chokepoint). Prefer the accumulated streamed
text over the SDK `result` field: in `runAgent` change `rawText = msg.text || rawText` to keep the
accumulation (`rawText = rawText || msg.text`), and in `defaultTransport.streamAgent` stop overwriting the
accumulated `text` with `msg.result` (fall back to it only when nothing streamed). Apply the same
prefer-accumulated rule to `oneShot` (:389) for parity. NON-goals: do not touch the marker pipeline
(`agents/markers.ts`), the per-delta `sink.text` path (already correct), or usage/metering.

**Regression test first:** `api/tests/agents/chat-lifecycle.test.ts` (fake transport, `__setTransportForTests`)
- yield several `{kind:'text'}` deltas whose concatenation is the full answer, then a `{kind:'final', text}`
whose `text` is only the last delta; assert (a) the `complete` event `result` equals the concatenated
`text_chunk`s and (b) the persisted assistant message equals the same. Fails today (both = tail). A
`api/tests/streaming/` assertion that `complete.result === join(text_chunks)` reinforces the §13 streaming
gate.

**Acceptance:** `complete.result`, the run snapshot, and the persisted assistant message all equal the full
concatenated answer; contract + streaming-union gates green; re-run J2 shows `replyFromComplete ===
replyFromChunks`.

**Notes:** change is inside `api/src/llm/` (the egress chokepoint) - keep the Anthropic import confined
there; no boundary or diagram change (streaming-contract shape in `shared/events.ts` is unchanged, only the
value carried). Significance-labelled area (llm/) -> adversarial + Codex review.
