"use client";

/**
 * Voice modality UI (mega-run C4, BRIEF §5): the composer mic affordance + the status bar.
 * No emoji anywhere (global UI rule) - lucide icons and PT-PT text labels only.
 *
 *  - MicButton lives in the composer footer next to the attach button. Tap = manual
 *    start/stop; press-and-hold (>=550 ms, released) = the hands-free talking loop. The
 *    hold arms on pointerdown and RESOLVES ON POINTERUP so the audio unlock always runs
 *    inside a real user gesture (a timer callback may fall outside the iOS activation
 *    window). Unsupported contexts render the button disabled with the PT-PT reason
 *    (secure-context gating - the message path, not a throw).
 *  - VoiceBar renders above the composer while a session is live (or suspended): status
 *    label per machine state, the level meter, the live interim transcript, the "send
 *    now" escape hatch while capturing (never make the user wait for a timer), the
 *    hands-free toggle, and the one-tap resume notice after backgrounding.
 */

import { useCallback, useRef } from "react";
import { AudioLines, Mic, MicOff, Send, Square, X } from "lucide-react";
import { useTranslation } from "@/stores/i18n";
import type { VoiceSessionApi } from "./use-voice-session";
import type { VoiceErrorCode } from "@/lib/voice/session-driver";
import type { VoiceStatus } from "@/lib/voice/voice-machine";

const HOLD_MS = 550;

export function useVoiceStrings() {
  const { voice } = useTranslation();
  return voice;
}

function statusLabel(voice: ReturnType<typeof useVoiceStrings>, status: VoiceStatus): string {
  switch (status) {
    case "listening":
      return voice.statusListening;
    case "confirming":
      return voice.statusConfirming;
    case "capturing":
      return voice.statusCapturing;
    case "sending":
      return voice.statusSending;
    case "awaiting":
      return voice.statusAwaiting;
    case "speaking":
      return voice.statusSpeaking;
    case "standby":
      return voice.statusStandby;
    default:
      return "";
  }
}

function errorLabel(voice: ReturnType<typeof useVoiceStrings>, code: VoiceErrorCode): string {
  switch (code) {
    case "MIC_DENIED":
      return voice.errorMicDenied;
    case "CAPTURE_FAILED":
      return voice.errorCapture;
    case "VAD_LOAD_FAILED":
      return voice.errorVad;
    case "VOICE_DISCONNECTED":
      return voice.errorDisconnected;
    case "VOICE_TTS_FAILED":
      return voice.errorTts;
    default:
      return voice.errorProvider;
  }
}

/** Compact 5-bar level meter driven by the worklet's RMS reading. */
export function LevelMeter({ level, label }: { level: number; label: string }) {
  const bars = [0.08, 0.22, 0.4, 0.6, 0.8];
  return (
    <div
      data-testid="voice-level-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(1, level) * 100)}
      className="flex items-end gap-[2px] h-3.5"
    >
      {bars.map((threshold, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm transition-colors duration-75 ${
            level >= threshold ? "bg-teal-500" : "bg-neutral-200"
          }`}
          style={{ height: `${5 + i * 2}px` }}
        />
      ))}
    </div>
  );
}

export function MicButton({ voice: api }: { voice: VoiceSessionApi }) {
  const voice = useVoiceStrings();
  const holdStartRef = useRef<number | null>(null);
  const active = api.status !== "idle";

  const onPointerDown = useCallback(() => {
    holdStartRef.current = Date.now();
  }, []);

  // Both branches run inside the pointerup gesture, so the audio unlock inside the
  // driver's tap path always holds user activation (the iOS rule).
  const onPointerUp = useCallback(() => {
    const started = holdStartRef.current;
    holdStartRef.current = null;
    if (started === null) return;
    if (!active && Date.now() - started >= HOLD_MS) api.startTalking();
    else api.tapMic();
  }, [api, active]);

  const onPointerCancel = useCallback(() => {
    holdStartRef.current = null;
  }, []);

  if (api.support.ok !== true) {
    const reason =
      api.support.reason === "insecure-context"
        ? voice.micUnavailableInsecure
        : voice.micUnavailableUnsupported;
    return (
      <span title={reason} data-testid="voice-mic-unavailable">
        <button
          disabled
          aria-label={reason}
          data-testid="voice-mic-button"
          className="p-1.5 text-neutral-300 rounded cursor-not-allowed"
        >
          <MicOff size={16} />
        </button>
      </span>
    );
  }

  const title = api.suspended ? voice.micResume : active ? voice.micStop : voice.micStart;
  return (
    <button
      data-testid="voice-mic-button"
      data-voice-status={api.status}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          api.tapMic();
        }
      }}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
        active
          ? "text-teal-700 bg-teal-50 hover:bg-teal-100"
          : "text-neutral-400 hover:text-neutral-700"
      }`}
    >
      <Mic size={16} className={api.status === "capturing" ? "animate-pulse" : undefined} />
    </button>
  );
}

export function VoiceBar({ voice: api }: { voice: VoiceSessionApi }) {
  const voice = useVoiceStrings();
  const active = api.status !== "idle";
  if (!active && !api.suspended && !api.error) return null;

  return (
    <div
      data-testid="voice-bar"
      className="flex flex-col gap-1 mb-2 rounded-lg border border-teal-200 bg-teal-50/60 px-2.5 py-1.5"
    >
      {api.error ? (
        <div className="flex items-center justify-between gap-2 text-xs text-red-700">
          <span data-testid="voice-error" className="min-w-0 truncate">
            {errorLabel(voice, api.error)}
          </span>
          <button
            onClick={api.dismissError}
            title={voice.dismiss}
            aria-label={voice.dismiss}
            className="p-0.5 rounded text-red-400 hover:text-red-700"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      {api.suspended && !active ? (
        <button
          data-testid="voice-resume"
          onClick={api.tapMic}
          className="flex items-center gap-1.5 text-xs text-teal-800 hover:text-teal-900 text-left"
        >
          <Mic size={12} className="shrink-0" />
          {voice.suspendedNotice}
        </button>
      ) : null}

      {active ? (
        <div className="flex items-center gap-2 min-w-0">
          <AudioLines size={13} className="shrink-0 text-teal-600" />
          <span
            data-testid="voice-status"
            data-voice-status={api.status}
            className="text-xs font-medium text-teal-800 whitespace-nowrap"
          >
            {statusLabel(voice, api.status)}
          </span>
          <LevelMeter level={api.level} label={voice.levelMeterLabel} />
          {api.mode === "talking" && (
            <span className="text-[10px] uppercase tracking-wide text-teal-600 whitespace-nowrap">
              {voice.talkingModeLabel}
            </span>
          )}
          {api.interim && (
            <span
              data-testid="voice-interim"
              className="min-w-0 flex-1 truncate text-xs text-neutral-600 italic"
            >
              {api.interim}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 shrink-0">
            {api.status === "capturing" && (
              <button
                data-testid="voice-send-now"
                onClick={api.sendNow}
                title={voice.sendNowAction}
                aria-label={voice.sendNowAction}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-600 text-white text-[11px] font-medium hover:bg-teal-700 transition-colors"
              >
                <Send size={11} />
                {voice.sendNowAction}
              </button>
            )}
            {api.mode === "manual" && api.status === "capturing" && (
              <button
                data-testid="voice-switch-talking"
                onClick={api.startTalking}
                title={voice.switchToTalking}
                aria-label={voice.switchToTalking}
                className="px-2 py-0.5 rounded-md border border-teal-300 text-teal-700 text-[11px] font-medium hover:bg-teal-100 transition-colors"
              >
                {voice.talkingModeLabel}
              </button>
            )}
            <button
              data-testid="voice-stop"
              onClick={api.tapMic}
              title={api.mode === "talking" ? voice.exitTalking : voice.micStop}
              aria-label={api.mode === "talking" ? voice.exitTalking : voice.micStop}
              className="p-1 rounded text-teal-700 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Square size={12} />
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
