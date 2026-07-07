/**
 * llm/anonymise/types.ts - the shared vocabulary of the anonymisation layer (ch17), the
 * egress module's SECOND concern (FIXED-8 as amended, FIXED-13). Lives INSIDE api/src/llm/
 * because I3 requires the tokenization step to sit on the single code path that owns the
 * Anthropic transport, with no bypass (ch17 §17.2).
 *
 * Nothing here is persisted: the vault is in-memory only (§17.5) and VaultHandle is an opaque
 * reference that is NEVER serialised into any payload.
 */

/** The detected-entity classes. (a) structured-ID + (c) NER classes; (b) deny-list maps to
 *  PARTY. Each class has a format-preserving token shape (§17.5). */
export type EntityClass =
  | 'NIF'
  | 'NIPC'
  | 'NISS'
  | 'IBAN'
  | 'CC'
  | 'UTENTE'
  | 'PROCESSO'
  | 'PARTY'
  | 'PERSON';

/** One detected span in a piece of model-bound text. `value` is the exact cleartext matched. */
export interface EntitySpan {
  start: number;
  end: number;
  value: string;
  cls: EntityClass;
}

/**
 * The loaded org ruleset + deny-list (§17.7, the Garrison line). The MECHANISM is core; the
 * PT-PT ruleset and the per-org deny-list are configuration loaded against it. Either a
 * plaintext `denyList` (already loaded) or an org-scoped `denyListCiphertext` (encrypted at
 * rest, decrypted + access-logged on load, §17.4 (b)) may be supplied.
 */
export interface OrgRuleset {
  orgId: string;
  /** The firm's client/matter/party names, matched literally (§17.4 (b)). */
  denyList?: string[];
  /** Encrypted-at-rest form of the deny-list (org-scoped key; §17.4 (b), v2 A6 D3). When
   *  present it is decrypted through the one crypto module and its access is audit-logged. */
  denyListCiphertext?: string;
  /** Structured-ID recognizers (a) - default ON. A mandatory detector; its outage fails the
   *  request closed (§17.3). */
  structuredIdEnabled?: boolean;
  /** PT-PT NER head (c) - default ON but BEST-EFFORT: (a)+(b) must not depend on it (§17.4). */
  nerEnabled?: boolean;
}

/**
 * An opaque handle to a session's in-memory vault (§17.5). Carries ONLY the session key; the
 * value-to-token map it points at never leaves Cortex and is never serialised into a payload
 * (I5). A future edge deployment resolves the same handle without a call-site change (§17.7,
 * location-agnostic).
 */
export interface VaultHandle {
  readonly sessionId: string;
}

/** The audit actor for the metadata-only record folded into the Registo single write path
 *  (§17.6; ch09 invariant 3). */
export interface AnonAuditActor {
  userId?: string;
  username?: string;
  orgId?: string;
}

/**
 * The per-anonymize context. `sessionId` keys the vault (the hosted conversation id, §17.5);
 * `ruleset` carries the deny-list + toggles; `correlationId` is minted per provider request
 * at the chokepoint (§17.6) and reused across the parts of one request; `channel` scopes the
 * detect-on-delta prefix so distinct fields (prompt vs system) do not corrupt each other's
 * running prefix (§17.3 step 2, cache preservation).
 */
export interface AnonymiseContext {
  sessionId: string;
  ruleset: OrgRuleset;
  correlationId?: string;
  actor?: AnonAuditActor;
}

/** The result of anonymising one piece of model-bound text. `text` carries tokens only for
 *  every detected span; `handle` de-tokenizes the response; `correlationId` joins the audit
 *  record and (through delegation) the local egress ledger (§17.6). */
export interface AnonymiseResult {
  text: string;
  handle: VaultHandle;
  correlationId: string;
}
