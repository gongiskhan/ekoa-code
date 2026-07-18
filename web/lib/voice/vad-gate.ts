/**
 * Silero VAD gate (mega-run C4, BRIEF §5 layered noise handling, layer 2). Wraps
 * @ricky0123/vad-web's MicVAD (Silero v5 over onnxruntime-web WASM, fully in-browser)
 * as the speech-start/-end source feeding the reducer's speechCandidate path; the ~300 ms
 * confirmation gate itself lives in the reducer (layer 3) - this module only reports.
 *
 * Assets are SELF-HOSTED under /voice/vendor/ (scripts/copy-voice-assets.mjs - the
 * jarvis-os build.mjs recipe): worklet bundle + silero onnx + ort WASM, same-origin per
 * the strict CSP. The vad reuses the capture chain's AudioContext AND MediaStream (one
 * mic, one context - the jarvis pattern: the slow WASM load happens AFTER the mic is
 * live, so it never consumes the user-activation window). Thresholds stay at Silero's
 * proven defaults 0.3/0.25 - garrison field lesson: raising them breaks END detection in
 * room noise. minSpeechFrames-equivalent (minSpeechMs) rejects short distant bursts.
 *
 * Dynamic import keeps ~1 MB of VAD code out of every page's bundle: only a talking-mode
 * session loads it.
 */

export interface VadGateHooks {
  onSpeechStart(): void;
  onSpeechEnd(): void;
  onMisfire(): void;
}

export interface VadGate {
  /** True between onSpeechStart and onSpeechEnd/onMisfire (the confirmation-timer input). */
  readonly speaking: boolean;
  destroy(): void;
}

interface MicVadLike {
  start(): void;
  destroy(): void;
}

/** Load + start the VAD on an already-open capture graph. Rejects if the WASM/model assets
 *  fail to load - the caller surfaces that as a talking-mode error (manual mode never
 *  calls this). */
export async function startVadGate(
  audioContext: AudioContext,
  stream: MediaStream,
  hooks: VadGateHooks,
): Promise<VadGate> {
  const { MicVAD } = await import('@ricky0123/vad-web');
  let speaking = false;
  const vad = (await MicVAD.new({
    model: 'v5',
    baseAssetPath: '/voice/vendor/',
    onnxWASMBasePath: '/voice/vendor/',
    audioContext,
    startOnLoad: false,
    // Single-threaded ort: no cross-origin isolation (COOP/COEP) requirement.
    ortConfig: (ort: { env: { wasm: { numThreads: number }; logLevel: string } }) => {
      try {
        ort.env.wasm.numThreads = 1;
        ort.env.logLevel = 'error';
      } catch {
        /* older ort shapes */
      }
    },
    // Silero defaults (garrison field lesson - see module doc); threshold low enough for
    // whisper, minSpeechMs rejecting short distant bursts (BRIEF layer 2).
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.25,
    minSpeechMs: 250,
    redemptionMs: 1100,
    // ONE mic stream, owned by the capture chain: pause/resume must never touch it.
    getStream: async () => stream,
    pauseStream: async () => {
      /* keep the capture chain's stream open */
    },
    resumeStream: async (s: MediaStream) => s,
    onSpeechStart: () => {
      speaking = true;
      hooks.onSpeechStart();
    },
    onSpeechEnd: () => {
      speaking = false;
      hooks.onSpeechEnd();
    },
    onVADMisfire: () => {
      speaking = false;
      hooks.onMisfire();
    },
  } as never)) as MicVadLike;
  vad.start();
  return {
    get speaking(): boolean {
      return speaking;
    },
    destroy(): void {
      try {
        vad.destroy();
      } catch {
        /* already destroyed */
      }
    },
  };
}
