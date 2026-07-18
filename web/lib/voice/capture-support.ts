/**
 * Capture-support decisions (mega-run C4, BRIEF §5). The PURE parts of the capture chain's
 * environment gating: the secure-context decision and the getUserMedia constraints selector.
 * No DOM types beyond structural surfaces - fully unit-testable with plain objects.
 */

export interface CaptureEnvironment {
  /** window.isSecureContext (localhost counts as secure; a LAN IP over http does not). */
  isSecureContext: boolean;
  /** navigator.mediaDevices?.getUserMedia is a function. */
  hasGetUserMedia: boolean;
  /** AudioWorklet is available on the page's AudioContext implementation. */
  hasAudioWorklet: boolean;
}

export type CaptureUnavailableReason = 'insecure-context' | 'no-capture-api';

export type CaptureSupport = { ok: true } | { ok: false; reason: CaptureUnavailableReason };

/**
 * Secure-context gate (ported rule: garrison legacy-voice micCaptureAllowed). getUserMedia
 * only exists in secure contexts, but the DISTINCT reason matters for the message shown:
 * an insecure context is fixable by the user (open over HTTPS/localhost); a missing capture
 * API is not. The caller maps the reason to PT-PT copy - no strings here.
 */
export function captureSupport(env: CaptureEnvironment): CaptureSupport {
  if (!env.isSecureContext) return { ok: false, reason: 'insecure-context' };
  if (!env.hasGetUserMedia || !env.hasAudioWorklet) return { ok: false, reason: 'no-capture-api' };
  return { ok: true };
}

/** Reads the live browser environment (SSR-safe: reports unsupported on the server). */
export function detectCaptureEnvironment(): CaptureEnvironment {
  if (typeof window === 'undefined') {
    return { isSecureContext: false, hasGetUserMedia: false, hasAudioWorklet: false };
  }
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return {
    isSecureContext: window.isSecureContext === true,
    hasGetUserMedia: typeof window.navigator?.mediaDevices?.getUserMedia === 'function',
    hasAudioWorklet: typeof AC === 'function' && 'audioWorklet' in AC.prototype,
  };
}

/**
 * Mobile detection for the AGC decision only (BRIEF §5 layered noise handling, layer 1):
 * autoGainControl OFF on mobile - AGC ramps gain during pauses and amplifies background -
 * and ON for desktop (decided). Deliberately coarse UA sniffing: a wrong answer degrades
 * noise handling, never functionality. iPadOS 13+ masquerades as Macintosh but exposes
 * multi-touch, hence the maxTouchPoints clause.
 */
export function isMobileUserAgent(userAgent: string, maxTouchPoints = 0): boolean {
  if (/\b(Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini)\b/i.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * getUserMedia audio constraints (BRIEF §5, decided): echoCancellation ON always - the first
 * defense against TTS output triggering the mic; noiseSuppression ON always; autoGainControl
 * per platform (see isMobileUserAgent). Mono capture - the wire is mono linear16.
 */
export function micConstraints(mobile: boolean): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: !mobile,
  };
}
