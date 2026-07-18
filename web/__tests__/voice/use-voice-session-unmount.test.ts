// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * C4 fix 2 (mega-run 20260717-190134): unmount must close the speech channel's OWN
 * resources - the TTS socket and the playback AudioContext - not just dispose the driver
 * (they deliberately survive across driver instances WHILE mounted, so only the unmount
 * disposer may close them; use-ouvir already closes its own the same way).
 *
 * The transports and the capture chain are vi.mocked (recording fakes); the SpeechChannel
 * and TtsPlayback are REAL, over a fake global AudioContext that records close() calls.
 */

const recorded = vi.hoisted(() => ({
  ttsSocketCloses: 0,
  ttsSocketsCreated: 0,
}));

vi.mock('@/lib/voice/tts-socket', () => ({
  createTtsSocket: () => {
    recorded.ttsSocketsCreated += 1;
    return {
      say: async () => undefined,
      clear: () => undefined,
      close: () => {
        recorded.ttsSocketCloses += 1;
      },
    };
  },
}));

vi.mock('@/lib/voice/stt-socket', () => ({
  createSttSocket: () => ({
    open: async () => undefined,
    sendAudio: () => undefined,
    sendCloseStream: () => undefined,
    sendTurnCommitted: () => undefined,
    close: () => undefined,
    isOpen: false,
  }),
}));

vi.mock('@/lib/voice/capture', () => ({
  CAPTURE_TARGET_RATE: 16_000,
  createMicCapture: () => ({
    start: async () => undefined,
    stop: () => undefined,
    context: null,
    stream: null,
  }),
}));

import { useVoiceSession } from '@/components/voice/use-voice-session';

/** Minimal real-AudioContext stand-in: satisfies TtsPlayback's unlock path + close(). */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  sampleRate = 48_000;
  destination = {};
  closes = 0;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  get audioWorklet(): { addModule: () => Promise<void> } {
    return { addModule: async () => undefined };
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {
    this.closes += 1;
  }
  createBuffer(): { duration: number } {
    return { duration: 0 };
  }
  createBufferSource(): {
    buffer: null;
    connect: () => void;
    start: () => void;
    stop: () => void;
    onended: null;
  } {
    return { buffer: null, connect: () => undefined, start: () => undefined, stop: () => undefined, onended: null };
  }
  async decodeAudioData(): Promise<{ duration: number }> {
    return { duration: 0 };
  }
}

beforeEach(() => {
  recorded.ttsSocketCloses = 0;
  recorded.ttsSocketsCreated = 0;
  FakeAudioContext.instances = [];
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia: async () => ({ getTracks: () => [] }) },
    configurable: true,
  });
  Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
});

function mountHook() {
  return renderHook(() =>
    useVoiceSession({
      sessionId: 's1',
      isExecuting: false,
      onSendTranscript: () => undefined,
      onPendingNote: () => undefined,
      onManualTranscript: () => undefined,
    }),
  );
}

describe('useVoiceSession unmount (fix 2)', () => {
  it('closes the speech channel tts socket AND its playback AudioContext', () => {
    const { result, unmount } = mountHook();
    expect(result.current.support.ok).toBe(true);

    // First tap assembles the speech channel: one tts socket + (via the synchronous
    // unlock) one playback AudioContext.
    act(() => {
      result.current.tapMic();
    });
    expect(recorded.ttsSocketsCreated).toBe(1);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(recorded.ttsSocketCloses).toBe(0);
    expect(FakeAudioContext.instances[0].closes).toBe(0);

    unmount();
    expect(recorded.ttsSocketCloses).toBe(1); // the socket did not outlive the composer
    expect(FakeAudioContext.instances[0].closes).toBe(1); // nor did the playback context
  });

  it('a mount that never used voice unmounts cleanly (nothing to close)', () => {
    const { unmount } = mountHook();
    unmount();
    expect(recorded.ttsSocketsCreated).toBe(0);
    expect(recorded.ttsSocketCloses).toBe(0);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});
