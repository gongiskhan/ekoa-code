# Codex checkpoint - anonymisation/egress scope triage (G12)

5 findings; Claude (deciding authority) triage:
- **M1 (MED) - ephemeral vault not cleared on the error/abort path** → **FIXED**. endSession for the
  ephemeral/no-session handle now runs on EVERY exit (success, transport error, abort) via a catch
  (runAgent streaming) + try/finally (runOneShot, proxyGatewayMessages). The vault is a re-identification
  key (§17.5); it must not linger to TTL after a failed call. 85 llm tests green.
- **H1 (HIGH cited) - runOneShot forwards raw image payloads** → **REBUTTED (documented deferral)**. Image
  BYTES cannot be text-tokenized; §17.9 records image-byte anonymisation as an explicit deferred LOW
  (G7A). Text (prompt/system) IS anonymised. Not a new violation - the accepted deferral. (Hardening to
  fail-closed on images is a future edge-tier item, not this gate.)
- **H2 (HIGH cited) - detection per string-leaf, not full concatenated turn** → **REBUTTED (intentional
  design)**. Per-leaf tokenization is REQUIRED for the prompt-cache byte-identical prefix (a load-bearing
  G7A property, §17.3); full-text concatenation would break it. A value split across message leaves
  evading detection does not match the threat model (the user is the data owner, not adversarial toward
  their own privacy) - PII lives within a message leaf, which IS detected. Structured detectors + deny-list
  catch in-leaf values; the streaming straddle (the real delta risk) was closed at G7A.
- **M2 (MED) - tool_use de-tok can return a tokenized placeholder on failure** → **REBUTTED (not a leak)**.
  Returning the PLACEHOLDER on a de-tok miss fails SAFE (the token, never the cleartext value, reaches the
  local loop) - the opposite of a leak. It is a correctness nit (the loop would act on a placeholder), not a
  privacy violation; the value never crosses egress un-tokenized.
- **M3 (MED) - plaintext denyList accepted** → **REBUTTED (test-only seam, never egressed)**. Production
  rulesets use denyListCiphertext (org-scoped decrypt); the plaintext `ruleset.denyList` branch is the
  in-memory test seam. Either way the deny-list is DETECTION INPUT ONLY and is NEVER sent to the provider
  (invariant 6 holds); it is not an egress leak. At-rest protection is the ciphertext path production uses.
