/**
 * Mic capture chain (mega-run C4, BRIEF §5 architecture): getUserMedia -> AudioContext at
 * the device's NATIVE rate (never hardcoded - iOS locks 48 kHz and ignores a requested
 * 16 k) -> the pcm-downsample AudioWorklet (public/voice/pcm-downsample.worklet.js)
 * producing 16 kHz linear16 frames + a level reading. This is the THIN DOM/Audio layer;
 * every decision it applies is a tested pure function (capture-support.ts) and the worklet
 * math is tested directly (pcm-worklet.test.ts).
 *
 * The ScriptProcessorNode chain garrison used is deliberately NOT ported (deprecated);
 * only its resample math, native-rate rule and muted-sink routing survive, relocated into
 * the worklet (analysis/07-voice-reuse.md §4-C4).
 */
import { detectCaptureEnvironment, isMobileUserAgent, micConstraints } from './capture-support';

export const CAPTURE_TARGET_RATE = 16_000;
const WORKLET_URL = '/voice/pcm-downsample.worklet.js';

export interface MicCaptureHooks {
  /** One packed 16 kHz linear16 chunk (transferred straight from the worklet). */
  onFrame(frame: ArrayBuffer): void;
  /** RMS level of the raw input, 0..1 (UI meter; ~15 updates/s at the default chunk). */
  onLevel(level: number): void;
}

export interface MicCapture {
  /** Opens the mic + worklet graph. Throws on denial/failure (the caller surfaces state). */
  start(): Promise<void>;
  stop(): void;
  /** The live graph, for VAD reuse (one mic stream, one context - the jarvis pattern). */
  readonly context: AudioContext | null;
  readonly stream: MediaStream | null;
}

export function createMicCapture(hooks: MicCaptureHooks): MicCapture {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let sink: GainNode | null = null;
  /** Monotonic liveness generation: stop() (and a superseding start()) bump it. An
   *  in-flight start() re-checks after EVERY await; a mismatch means it lost a rapid
   *  toggle and must tear down what IT created (mic tracks, context) and return
   *  silently - a deliberate cancel is never an error. */
  let generation = 0;

  /** Tear down resources a cancelled start() acquired but never published. */
  const abandon = (acquiredStream: MediaStream, acquiredCtx?: AudioContext): void => {
    for (const track of acquiredStream.getTracks()) track.stop();
    void acquiredCtx?.close().catch(() => {
      /* already closed */
    });
  };

  return {
    async start(): Promise<void> {
      const gen = ++generation; // a fresh start supersedes any still-pending one
      const env = detectCaptureEnvironment();
      if (!env.hasGetUserMedia || !env.hasAudioWorklet) {
        throw new Error('voice capture unsupported');
      }
      const mobile = isMobileUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0);
      const acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints(mobile),
      });
      if (gen !== generation) {
        abandon(acquiredStream); // stopped/superseded during the permission prompt
        return;
      }
      // Everything after the stream is acquired can THROW (addModule reject, graph build):
      // on any throw, tear down what THIS start() created before rethrowing, so a failed
      // open never leaks mic tracks or an AudioContext (codex C4 finding: throw-mid-open).
      let acquiredCtx: AudioContext | undefined;
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        // NATIVE rate - no sampleRate option, ever (the checklist rule); the worklet reads
        // the real rate from its global and downsamples to 16 kHz itself.
        acquiredCtx = new AC();
        try {
          await acquiredCtx.resume(); // defensively; the tap handler already ran unlock
        } catch {
          /* resume re-fires on state changes */
        }
        if (gen !== generation) {
          abandon(acquiredStream, acquiredCtx);
          return;
        }
        await acquiredCtx.audioWorklet.addModule(WORKLET_URL);
        if (gen !== generation) {
          abandon(acquiredStream, acquiredCtx); // torn down while the worklet loaded
          return;
        }
        const acquiredSource = acquiredCtx.createMediaStreamSource(acquiredStream);
        const acquiredNode = new AudioWorkletNode(acquiredCtx, 'pcm-downsample', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: { targetRate: CAPTURE_TARGET_RATE },
        });
        acquiredNode.port.onmessage = (e: MessageEvent) => {
          const data = e.data as { type?: string; frames?: Int16Array; level?: number };
          if (data?.type !== 'frames' || !data.frames) return;
          hooks.onLevel(data.level ?? 0);
          hooks.onFrame(
            data.frames.buffer.slice(
              data.frames.byteOffset,
              data.frames.byteOffset + data.frames.byteLength,
            ) as ArrayBuffer,
          );
        };
        // Muted sink keeps the graph pulled without echoing the mic to the speakers
        // (the garrison routing, ported).
        const acquiredSink = acquiredCtx.createGain();
        acquiredSink.gain.value = 0;
        acquiredSource.connect(acquiredNode);
        acquiredNode.connect(acquiredSink);
        acquiredSink.connect(acquiredCtx.destination);
        // Publish only a LIVE graph: a stop() during any await above never reaches here.
        ctx = acquiredCtx;
        stream = acquiredStream;
        node = acquiredNode;
        source = acquiredSource;
        sink = acquiredSink;
      } catch (err) {
        abandon(acquiredStream, acquiredCtx); // addModule/graph-build threw: no leak
        throw err;
      }
    },
    stop(): void {
      generation += 1; // cancels any in-flight start() (it tears down its own resources)
      // NOTE: no tail-frame flush. The worklet's ≤64 ms remainder could only ever arrive
      // asynchronously, after the driver has already stopped forwarding and closed the
      // STT stream in the same synchronous teardown - it has no consumer, so the flush
      // protocol was removed rather than kept dead.
      if (node) node.port.onmessage = null;
      try {
        source?.disconnect();
        node?.disconnect();
        sink?.disconnect();
      } catch {
        /* graph already torn down */
      }
      for (const track of stream?.getTracks() ?? []) track.stop();
      void ctx?.close().catch(() => {
        /* already closed */
      });
      node = null;
      source = null;
      sink = null;
      stream = null;
      ctx = null;
    },
    get context(): AudioContext | null {
      return ctx;
    },
    get stream(): MediaStream | null {
      return stream;
    },
  };
}
