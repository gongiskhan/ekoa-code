/**
 * llm/anonymise/vault.ts - the per-session, in-memory, TTL token vault (§17.5, v2 A6 D1).
 *
 * INVARIANT (I5, the trust anchor): the value-to-token map is held in memory ONLY, keyed by
 * the propagated session identity, and is NEVER written to disk or to any store. It is cleared
 * on session end. A map that could turn tokens back into client identities is exactly what a
 * production order would seek, so after session end it must not exist. There is deliberately
 * no persistence path in this file: the vault lives in a module-level Map and nowhere else.
 *
 * Tokens are deterministic per session (same cleartext -> same token across every turn), which
 * is what lets the tokenized prompt prefix stay byte-identical and the provider cache hit
 * (§17.5). A model switch or a new session is a cache boundary: a fresh vault re-tokenizes.
 */
import type { EntityClass, VaultHandle } from './types.js';
import {
  makeNifToken,
  makeNissToken,
  makeIbanToken,
  makeUtenteToken,
  makeCcToken,
  makeProcessoToken,
} from './checksum.js';

/** Fake, plainly-synthetic name pools for PARTY/PERSON tokens. Format-preserving (a fake
 *  two-word name where a name was) so the model reasons over well-formed input (§17.5). */
const FIRST = ['Alda', 'Bento', 'Carla', 'Duarte', 'Elsa', 'Fabio', 'Gina', 'Hugo', 'Ivone', 'Jaime'];
const LAST = ['Aveleda', 'Bragadas', 'Corvelo', 'Delmonte', 'Estremoz', 'Falperra', 'Gondra', 'Hervais'];
const PARTY_HEAD = ['Sociedade', 'Grupo', 'Casa', 'Companhia'];
const PARTY_TAIL = ['Aveleda', 'Bragadas', 'Corvelo', 'Delmonte', 'Estremoz', 'Falperra'];

function fakePerson(seq: number): string {
  return `${FIRST[seq % FIRST.length]} ${LAST[Math.floor(seq / FIRST.length) % LAST.length]}`;
}
function fakeParty(seq: number): string {
  return `${PARTY_HEAD[seq % PARTY_HEAD.length]} ${PARTY_TAIL[Math.floor(seq / PARTY_HEAD.length) % PARTY_TAIL.length]}`;
}

/** Generate the seq-th format-preserving token for a class (checksum-invalid where applicable). */
function mintToken(cls: EntityClass, seq: number): string {
  switch (cls) {
    case 'NIF':
    case 'NIPC':
      return makeNifToken(seq);
    case 'NISS':
      return makeNissToken(seq);
    case 'IBAN':
      return makeIbanToken(seq);
    case 'UTENTE':
      return makeUtenteToken(seq);
    case 'CC':
      return makeCcToken(seq);
    case 'PROCESSO':
      return makeProcessoToken(seq);
    case 'PARTY':
      return fakeParty(seq);
    case 'PERSON':
      return fakePerson(seq);
  }
}

interface ChannelPrefix {
  clearPrefix: string;
  tokenizedPrefix: string;
}

interface SessionVault {
  sessionId: string;
  createdAt: number;
  lastAccess: number;
  valueToToken: Map<string, string>;
  tokenToValue: Map<string, string>;
  perClass: Map<EntityClass, number>;
  /** detect-on-delta running prefixes, scoped per channel (§17.3 step 2). */
  channels: Map<string, ChannelPrefix>;
  /** cached sorted token list + a version, for de-tokenization + straddle detection. */
  tokenListVersion: number;
}

const vaults = new Map<string, SessionVault>();
const DEFAULT_TTL_MS = 30 * 60 * 1000;

let nowFn: () => number = () => Date.now();
let ttlMs = DEFAULT_TTL_MS;

/** Test seams: control the clock + TTL for the vault-lifetime checks (§17.5). */
export function __setVaultClockForTests(fn: () => number): void {
  nowFn = fn;
}
export function __setVaultTtlForTests(ms: number): void {
  ttlMs = ms;
}
export function __resetVaultForTests(): void {
  vaults.clear();
  nowFn = () => Date.now();
  ttlMs = DEFAULT_TTL_MS;
}

/** Test-only: number of live vaults (proves clear-on-session-end + no leak). */
export function __vaultCount(): number {
  return vaults.size;
}

/** Evict vaults whose TTL has elapsed (a session that outlives its vault re-tokenizes from
 *  scratch on the next turn - a cache boundary, never a disk write; §17.5). */
function sweep(now: number): void {
  for (const [id, v] of vaults) {
    if (now - v.lastAccess > ttlMs) vaults.delete(id);
  }
}

function getOrCreateVault(sessionId: string): SessionVault {
  const now = nowFn();
  sweep(now);
  let v = vaults.get(sessionId);
  if (!v) {
    v = {
      sessionId,
      createdAt: now,
      lastAccess: now,
      valueToToken: new Map(),
      tokenToValue: new Map(),
      perClass: new Map(),
      channels: new Map(),
      tokenListVersion: 0,
    };
    vaults.set(sessionId, v);
  }
  v.lastAccess = now;
  return v;
}

/** The stable token for a cleartext value in a session (mint on first sight, reuse after).
 *  Determinism per session is what preserves the cache prefix (§17.5). */
export function tokenFor(handle: VaultHandle, value: string, cls: EntityClass): string {
  const v = getOrCreateVault(handle.sessionId);
  const existing = v.valueToToken.get(value);
  if (existing) return existing;
  // Mint the next per-class token, skipping any collision with an already-issued token.
  let seq = v.perClass.get(cls) ?? 0;
  let token = mintToken(cls, seq);
  while (v.tokenToValue.has(token)) {
    seq += 1;
    token = mintToken(cls, seq);
  }
  v.perClass.set(cls, seq + 1);
  v.valueToToken.set(value, token);
  v.tokenToValue.set(token, value);
  v.tokenListVersion += 1;
  return token;
}

/** The token->value map for de-tokenization (longest tokens first, so a token that is a
 *  substring of another is replaced first). */
export function tokensOf(handle: VaultHandle): Array<[string, string]> {
  const v = vaults.get(handle.sessionId);
  if (!v) return [];
  v.lastAccess = nowFn();
  return [...v.tokenToValue.entries()].sort((a, b) => b[0].length - a[0].length);
}

/** The max token length in a session (bounds the streaming straddle buffer, §17.3 step 6). */
export function maxTokenLength(handle: VaultHandle): number {
  const v = vaults.get(handle.sessionId);
  if (!v) return 0;
  let max = 0;
  for (const t of v.tokenToValue.keys()) if (t.length > max) max = t.length;
  return max;
}

/** Read/advance the per-channel detect-on-delta prefix. Returns the recorded prefixes (or
 *  empty) so the caller can detect on the delta only and reuse the tokenized head. */
export function channelPrefix(handle: VaultHandle, channel: string): ChannelPrefix {
  const v = getOrCreateVault(handle.sessionId);
  return v.channels.get(channel) ?? { clearPrefix: '', tokenizedPrefix: '' };
}
export function setChannelPrefix(handle: VaultHandle, channel: string, next: ChannelPrefix): void {
  const v = getOrCreateVault(handle.sessionId);
  v.channels.set(channel, next);
}

/** Clear a session vault at session end (§17.5, D1). After this the map does not exist. */
export function clearSession(sessionId: string): void {
  vaults.delete(sessionId);
}

/** Open (or resume) a session vault and return its opaque handle. */
export function openVault(sessionId: string): VaultHandle {
  getOrCreateVault(sessionId);
  return { sessionId };
}
