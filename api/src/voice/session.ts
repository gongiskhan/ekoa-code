/**
 * voice/session.ts - per-connection voice session records + per-stage latency tracking
 * (mega-run C1, BRIEF §5). One record per live WS connection, carrying the org + user
 * attribution attached to every provider call and the counters C2's metering reads
 * (voice_stt_ms via audio bytes at a known rate; voice_tts_chars). Raw audio is transient:
 * relayed, transcribed, discarded - nothing here persists (records die with the socket;
 * transcripts persist as normal chat messages elsewhere).
 *
 * Latency instrumentation (BRIEF §5 validation): per-turn stage timestamps logged as ONE
 * structured JSON line per turn - `audio_in_first` -> `first_interim` -> `utterance_end` for
 * an STT turn, `say_received` -> `tts_first_audio` for a TTS turn. The dashboard (C7) reads
 * these lines; they are logs, not wire messages.
 */
import { randomUUID } from 'node:crypto';
import type { VoiceLang } from '@ekoa/shared';

export type VoiceLog = (event: string, fields: Record<string, unknown>) => void;

export function defaultVoiceLog(event: string, fields: Record<string, unknown>): void {
  console.log(`[${event}]`, JSON.stringify(fields));
}

export interface VoiceSessionRecord {
  sessionId: string;
  kind: 'stt' | 'tts';
  /** Attribution (multi-tenant, BRIEF §5): every provider call under this session is made
   *  on behalf of THIS org + user; C2 meters against these fields. */
  orgId: string;
  userId: string;
  username: string;
  /** The provider registry key that actually served the session ('stub' in v1). For TTS the
   *  resolution is per-language, so this is the LAST resolved key. */
  provider: string;
  startedAt: string;
  /** STT: the negotiated PCM sample rate (Hz) - the known rate `sttMsOf` bills bytes at. */
  sampleRate: number;
  /** STT: total binary PCM bytes received (C2 derives voice_stt_ms at the known rate). */
  audioInBytes: number;
  /** TTS: total characters submitted for synthesis (C2's voice_tts_chars input). */
  ttsChars: number;
  /** Completed turns (utterance_end for STT; say accepted for TTS). */
  turns: number;
}

const active = new Map<string, VoiceSessionRecord>();

export function openVoiceSession(input: {
  kind: 'stt' | 'tts';
  orgId: string;
  userId: string;
  username: string;
  provider: string;
  sampleRate?: number;
}): VoiceSessionRecord {
  const record: VoiceSessionRecord = {
    sessionId: randomUUID(),
    kind: input.kind,
    orgId: input.orgId,
    userId: input.userId,
    username: input.username,
    provider: input.provider,
    startedAt: new Date().toISOString(),
    sampleRate: input.sampleRate ?? 16_000,
    audioInBytes: 0,
    ttsChars: 0,
    turns: 0,
  };
  active.set(record.sessionId, record);
  return record;
}

/** The wire format is ALWAYS 16 kHz linear16 mono (BRIEF §5: the worklet downsamples to 16 kHz
 *  before the socket, whatever the device AudioContext rate). Billing is pinned to this canonical
 *  rate, NOT the client-declared `sample_rate` query (which only configures the provider stream) -
 *  so a client cannot fabricate its metered duration by claiming a different rate. */
export const BILLING_SAMPLE_RATE = 16_000;

/** The C2 billing derivation (BRIEF §5, decided): v1 is UNGATED - capture open = billed, so
 *  billed STT milliseconds are the received linear16 mono PCM bytes at the canonical wire rate
 *  (2 bytes per sample), not a VAD-gated subset and not a client-declared rate. Pure so tests
 *  pin the arithmetic. */
export function sttMsOfBytes(audioInBytes: number): number {
  return Math.round((audioInBytes * 1000) / (BILLING_SAMPLE_RATE * 2));
}

export function closeVoiceSession(sessionId: string): void {
  active.delete(sessionId);
}

/** Live session records (C2 metering + tests read attribution here). */
export function activeVoiceSessions(): VoiceSessionRecord[] {
  return [...active.values()];
}

export function __resetVoiceSessionsForTests(): void {
  active.clear();
}

/* --------------------------------- latency tracking --------------------------------- */

/** One STT turn's stage clock. Stages arm on first occurrence per turn; `utterance_end`
 *  closes the turn, emits ONE `voice.latency` line, and re-arms for the next turn. */
export class SttTurnLatency {
  private audioInFirst: number | undefined;
  private firstInterim: number | undefined;
  private turn = 0;

  constructor(
    private readonly record: VoiceSessionRecord,
    private readonly log: VoiceLog,
  ) {}

  onAudioFrame(now: number = Date.now()): void {
    if (this.audioInFirst === undefined) this.audioInFirst = now;
  }

  onTranscript(text: string, now: number = Date.now()): void {
    if (text && this.firstInterim === undefined) this.firstInterim = now;
  }

  onUtteranceEnd(now: number = Date.now()): void {
    this.turn += 1;
    this.record.turns += 1;
    this.log('voice.latency', {
      kind: 'stt_turn',
      sessionId: this.record.sessionId,
      orgId: this.record.orgId,
      userId: this.record.userId,
      turn: this.turn,
      audio_in_first: this.audioInFirst ?? null,
      first_interim: this.firstInterim ?? null,
      utterance_end: now,
      ms_to_first_interim:
        this.audioInFirst !== undefined && this.firstInterim !== undefined
          ? this.firstInterim - this.audioInFirst
          : null,
      ms_to_utterance_end: this.audioInFirst !== undefined ? now - this.audioInFirst : null,
    });
    this.audioInFirst = undefined;
    this.firstInterim = undefined;
  }
}

/** One TTS turn's stage clock: `say_received` -> `tts_first_audio`, one line per turn. */
export class TtsTurnLatency {
  private sayReceived: number | undefined;
  private logged = false;

  constructor(
    private readonly record: VoiceSessionRecord,
    private readonly log: VoiceLog,
    private readonly turnId: string,
    private readonly lang: VoiceLang,
  ) {}

  onSay(now: number = Date.now()): void {
    this.sayReceived = now;
  }

  onFirstAudio(now: number = Date.now()): void {
    if (this.logged) return;
    this.logged = true;
    this.log('voice.latency', {
      kind: 'tts_turn',
      sessionId: this.record.sessionId,
      orgId: this.record.orgId,
      userId: this.record.userId,
      turnId: this.turnId,
      lang: this.lang,
      say_received: this.sayReceived ?? null,
      tts_first_audio: now,
      ms_to_first_audio: this.sayReceived !== undefined ? now - this.sayReceived : null,
    });
  }
}
