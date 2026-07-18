// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  captureSupport,
  isMobileUserAgent,
  micConstraints,
} from '@/lib/voice/capture-support';

/**
 * C4 (mega-run 20260717-190134): the pure capture-support decisions. Secure-context gating
 * distinguishes the fixable reason (insecure context -> clear PT-PT message upstream) from
 * a missing capture API; the constraints selector encodes the BRIEF §5 decided layer-1
 * profile: echoCancellation + noiseSuppression always ON, autoGainControl OFF on mobile /
 * ON on desktop, mono capture.
 */

describe('captureSupport (secure-context gate)', () => {
  it('rejects an insecure context FIRST - the fixable, message-bearing reason', () => {
    expect(
      captureSupport({ isSecureContext: false, hasGetUserMedia: false, hasAudioWorklet: false }),
    ).toEqual({ ok: false, reason: 'insecure-context' });
    // Even with the APIs visible, http is a no (a LAN IP over plain http).
    expect(
      captureSupport({ isSecureContext: false, hasGetUserMedia: true, hasAudioWorklet: true }),
    ).toEqual({ ok: false, reason: 'insecure-context' });
  });

  it('rejects a secure context that lacks getUserMedia or AudioWorklet', () => {
    expect(
      captureSupport({ isSecureContext: true, hasGetUserMedia: false, hasAudioWorklet: true }),
    ).toEqual({ ok: false, reason: 'no-capture-api' });
    expect(
      captureSupport({ isSecureContext: true, hasGetUserMedia: true, hasAudioWorklet: false }),
    ).toEqual({ ok: false, reason: 'no-capture-api' });
  });

  it('accepts a secure context with the full capture chain available', () => {
    expect(
      captureSupport({ isSecureContext: true, hasGetUserMedia: true, hasAudioWorklet: true }),
    ).toEqual({ ok: true });
  });
});

describe('isMobileUserAgent (the AGC platform switch)', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
  const MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  it('classifies phones as mobile and desktops as not', () => {
    expect(isMobileUserAgent(IPHONE)).toBe(true);
    expect(isMobileUserAgent(ANDROID)).toBe(true);
    expect(isMobileUserAgent(MAC)).toBe(false);
    expect(isMobileUserAgent(WINDOWS)).toBe(false);
  });

  it('catches iPadOS masquerading as Macintosh via multi-touch', () => {
    expect(isMobileUserAgent(MAC, 5)).toBe(true); // iPad: Macintosh UA + touch points
    expect(isMobileUserAgent(MAC, 0)).toBe(false); // real Mac
  });
});

describe('micConstraints (BRIEF §5 layer 1, decided)', () => {
  it('mobile: echo + noise suppression on, AGC OFF, mono', () => {
    expect(micConstraints(true)).toEqual({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    });
  });

  it('desktop: identical but AGC ON', () => {
    expect(micConstraints(false)).toEqual({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });
});
