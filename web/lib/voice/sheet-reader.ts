/**
 * Sheet reader (mega-run C4): the `ouvir` footer action's engine - read ONE text aloud
 * through the C5 tts path (WS /api/voice/tts-stream say -> WAV sentences -> TtsPlayback),
 * independent of any voice session. One reader per panel; speak() supersedes itself and
 * stop() is the user-facing clear. The api-side C5 pipeline sanitizes + number-normalizes
 * the text (strip markdown/code/tables), so the sheet's raw markdown goes up as-is.
 *
 * iOS rule carried from C5: speak() runs unlock() SYNCHRONOUSLY before any await - call it
 * directly inside the tap handler.
 */
import type { VoiceLang } from '@ekoa/shared';
import type { PlaybackLike, TtsSayChannel } from './speech-channel';

export type SheetReaderStatus = 'idle' | 'loading' | 'speaking';

export interface SheetReaderHooks {
  onStatus(status: SheetReaderStatus, sheetId: string | null): void;
  onError(): void;
}

export interface SheetReaderDeps {
  socket: TtsSayChannel;
  playback: PlaybackLike;
  hooks: SheetReaderHooks;
}

export class SheetReader {
  private status: SheetReaderStatus = 'idle';
  private sheetId: string | null = null;
  private generation = 0;

  constructor(private readonly deps: SheetReaderDeps) {}

  /** Wire as the tts socket's message hook. */
  handleMessage(msg: { type: string }): void {
    switch (msg.type) {
      case 'audio_end':
        this.deps.playback.endTurn();
        // If nothing became audible (all-markdown text synthesized to nothing), playback
        // never signals an end: settle back to idle from here.
        if (this.status === 'loading') this.setStatus('idle', null);
        return;
      case 'error':
        this.deps.playback.bargeIn();
        this.setStatus('idle', null);
        this.deps.hooks.onError();
        return;
      default:
        return;
    }
  }

  handleAudio(frame: Uint8Array): void {
    if (this.status !== 'idle') this.deps.playback.pushAudio(frame);
  }

  handlePlaybackStart(): void {
    if (this.status === 'loading') this.setStatus('speaking', this.sheetId);
  }

  handlePlaybackEnd(): void {
    if (this.status === 'speaking') this.setStatus('idle', null);
  }

  handleSocketDrop(): void {
    if (this.status !== 'idle') {
      this.deps.playback.bargeIn();
      this.setStatus('idle', null);
      this.deps.hooks.onError();
    }
  }

  get currentSheetId(): string | null {
    return this.sheetId;
  }

  /** MUST be called synchronously inside the tap handler (unlock before any await). */
  speak(text: string, lang: VoiceLang, sheetId: string): void {
    this.deps.playback.unlock(); // synchronous - the iOS gesture rule
    this.deps.playback.beginTurn();
    this.sheetId = sheetId;
    this.setStatus('loading', sheetId);
    const gen = ++this.generation;
    void this.deps.socket.say(text, lang, { sheetId }).catch(() => {
      if (gen !== this.generation) return;
      this.setStatus('idle', null);
      this.deps.hooks.onError();
    });
  }

  stop(): void {
    this.generation += 1;
    this.deps.socket.clear();
    this.deps.playback.bargeIn();
    this.setStatus('idle', null);
  }

  private setStatus(status: SheetReaderStatus, sheetId: string | null): void {
    this.status = status;
    this.sheetId = status === 'idle' ? null : sheetId;
    this.deps.hooks.onStatus(status, this.sheetId);
  }
}
