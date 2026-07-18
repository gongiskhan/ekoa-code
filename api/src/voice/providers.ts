/**
 * voice/providers.ts - the vendor-neutral STT/TTS provider interface + registry (mega-run C1,
 * BRIEF §5). `tts_provider` per language is config (`loadVoiceConfig`), so swapping vendors
 * never touches the client or the relay. v1 registers ONLY the deterministic stub providers
 * (stub-providers.ts) - everything is testable without vendor keys; the live providers
 * (Deepgram Nova-3 STT, Aura-2 en TTS, Google pt TTS, ElevenLabs fallback) land at C6, gated
 * on key presence, by registering themselves here under the config keys.
 *
 * Attribution is COMPILE-TIME-REQUIRED on every provider call (the llm/ idiom, FIXED-8): an
 * unattributed voice provider call is inexpressible. voice/ is NOT model egress - nothing here
 * imports llm/; transcripts enter the normal chat pipeline elsewhere.
 */
import type { VoiceLang } from '@ekoa/shared';
import { loadVoiceConfig } from '../config.js';
import { createStubSttStream, createStubTtsStream } from './stub-providers.js';

/** Org + user attribution attached to every provider call record (multi-tenant, BRIEF §5). */
export interface VoiceAttribution {
  orgId: string;
  userId: string;
  /** The relay's per-connection voice session id (the provider call record key). */
  sessionId: string;
}

/** Provider-side STT events, vendor-neutral. The relay maps these 1:1 onto the shared
 *  `VoiceSttServerMessage` wire union. */
export type SttProviderEvent =
  | { kind: 'speech_started' }
  | { kind: 'transcript'; text: string; isFinal: boolean; speechFinal: boolean }
  | { kind: 'utterance_end'; transcript: string }
  | { kind: 'error'; message: string };

export interface SttOpenOpts {
  /** Client capture rate (never hardcoded - iOS locks AudioContext to 48 kHz). */
  sampleRate: number;
  /** Silence window before the provider emits utterance_end (clamped 1000..20000 ms). */
  utteranceEndMs: number;
  /** Locale hint; the live Nova-3 stream uses language=multi and ignores it. */
  lang?: VoiceLang;
  attribution: VoiceAttribution;
}

/** One open provider STT stream: push PCM in, consume events out. `close()` flushes and ends
 *  the `events` iterable (the relay's drain signal). */
export interface SttStream {
  sendAudio(frame: Buffer): void;
  close(): void;
  events: AsyncIterable<SttProviderEvent>;
}

export interface SttProvider {
  readonly key: string;
  openStream(opts: SttOpenOpts): SttStream;
}

/** One synthesis call: audio chunks stream out (first chunk carries the container header);
 *  aborting `signal` stops the stream mid-flight - the barge-in path. */
export interface TtsProvider {
  readonly key: string;
  synthesizeStream(
    text: string,
    lang: VoiceLang,
    signal: AbortSignal,
    attribution: VoiceAttribution,
  ): AsyncIterable<Buffer>;
}

/* ------------------------------------- registry ------------------------------------- */

export const STUB_PROVIDER_KEY = 'stub';

const sttProviders = new Map<string, SttProvider>();
const ttsProviders = new Map<string, TtsProvider>();

/** C6 (and tests) register live providers under their config keys. Last write wins. */
export function registerSttProvider(provider: SttProvider): void {
  sttProviders.set(provider.key, provider);
}
export function registerTtsProvider(provider: TtsProvider): void {
  ttsProviders.set(provider.key, provider);
}

// The built-in deterministic stubs (v1's only providers). stub-providers.ts imports ONLY
// types from this file, so registering here creates no runtime cycle.
registerSttProvider({ key: STUB_PROVIDER_KEY, openStream: (opts) => createStubSttStream(opts) });
registerTtsProvider({
  key: STUB_PROVIDER_KEY,
  synthesizeStream: (text, lang, signal, attribution) =>
    createStubTtsStream(text, lang, signal, attribution),
});

export interface ResolvedProvider<T> {
  /** The registry key that actually resolved (the fallback key when the configured one is
   *  unregistered - the session record carries THIS, never a provider that did not run). */
  key: string;
  provider: T;
  /** Set when the configured key was not registered and the stub answered instead. */
  fellBackFrom?: string;
}

function resolve<T>(map: Map<string, T>, configuredKey: string): ResolvedProvider<T> {
  const hit = map.get(configuredKey);
  if (hit) return { key: configuredKey, provider: hit };
  // Unregistered (live provider not landed / key absent): the stub answers so the platform
  // stays fully testable without vendor keys (C1 stance; C6 replaces this path).
  const stub = map.get(STUB_PROVIDER_KEY);
  if (!stub) throw new Error(`voice provider "${configuredKey}" not registered and no stub present`);
  return { key: STUB_PROVIDER_KEY, provider: stub, fellBackFrom: configuredKey };
}

export function resolveSttProvider(): ResolvedProvider<SttProvider> {
  return resolve(sttProviders, loadVoiceConfig().sttProvider);
}

/** Config-selected per language (BRIEF §5 TTS table); the fallback provider key applies when
 *  the per-language one is unregistered AND the fallback itself is registered. */
export function resolveTtsProvider(lang: VoiceLang): ResolvedProvider<TtsProvider> {
  const cfg = loadVoiceConfig();
  const wanted =
    lang === 'en' ? cfg.ttsProviderEn : lang === 'pt-PT' ? cfg.ttsProviderPtPt : cfg.ttsProviderPtBr;
  if (ttsProviders.has(wanted)) return { key: wanted, provider: ttsProviders.get(wanted)! };
  if (ttsProviders.has(cfg.ttsProviderFallback)) {
    return { key: cfg.ttsProviderFallback, provider: ttsProviders.get(cfg.ttsProviderFallback)!, fellBackFrom: wanted };
  }
  return resolve(ttsProviders, wanted);
}

/** Test-only: drop every non-stub registration (isolates registry state between suites). */
export function __resetVoiceProvidersForTests(): void {
  for (const k of [...sttProviders.keys()]) if (k !== STUB_PROVIDER_KEY) sttProviders.delete(k);
  for (const k of [...ttsProviders.keys()]) if (k !== STUB_PROVIDER_KEY) ttsProviders.delete(k);
}
