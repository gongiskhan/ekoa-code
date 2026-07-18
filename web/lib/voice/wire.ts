/**
 * Voice WS wire framing (mega-run C4). The PURE half of the two WebSocket clients: URL
 * construction for the upgrade dial (token + session parameters ride the query string -
 * a browser WS cannot set headers, the CONV-1 idiom) and JSON message parse/build, every
 * inbound message validated against the shared zod unions (the QA rule: the web client
 * validates every JSON message it sends/receives). No sockets here - stt-socket.ts /
 * tts-socket.ts own the thin transport.
 */
import {
  VOICE_STT_WS_PATH,
  VOICE_TTS_WS_PATH,
  VoiceSttClientMessage,
  VoiceSttServerMessage,
  VoiceTtsClientMessage,
  VoiceTtsServerMessage,
  type VoiceLang,
} from '@ekoa/shared';

/** http(s) API origin -> ws(s) URL for one of the two voice paths, with query params. */
export function voiceWsUrl(
  httpBaseUrl: string,
  path: typeof VOICE_STT_WS_PATH | typeof VOICE_TTS_WS_PATH,
  params: Record<string, string | number | undefined>,
): string {
  const wsBase = httpBaseUrl.replace(/^http/, 'ws');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const qs = query.toString();
  return `${wsBase}${path}${qs ? `?${qs}` : ''}`;
}

export function sttStreamUrl(
  httpBaseUrl: string,
  opts: { token: string; sampleRate: number; utteranceEndMs?: number; lang?: VoiceLang },
): string {
  return voiceWsUrl(httpBaseUrl, VOICE_STT_WS_PATH, {
    token: opts.token,
    sample_rate: opts.sampleRate,
    utterance_end_ms: opts.utteranceEndMs,
    lang: opts.lang,
  });
}

export function ttsStreamUrl(httpBaseUrl: string, opts: { token: string }): string {
  return voiceWsUrl(httpBaseUrl, VOICE_TTS_WS_PATH, { token: opts.token });
}

/* ------------------------------- inbound (validated) ------------------------------- */

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Parse + validate a server JSON message off /api/voice/stream. null = not ours/invalid. */
export function parseSttServerMessage(raw: string): VoiceSttServerMessage | null {
  const parsed = VoiceSttServerMessage.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

/** Parse + validate a server JSON message off /api/voice/tts-stream. */
export function parseTtsServerMessage(raw: string): VoiceTtsServerMessage | null {
  const parsed = VoiceTtsServerMessage.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

/* ------------------------------- outbound (validated) ------------------------------- */

/** Serialize an outbound STT control message, validating against the shared union first
 *  (a malformed build is a client bug - throw loudly rather than send garbage). */
export function serializeSttClientMessage(msg: VoiceSttClientMessage): string {
  return JSON.stringify(VoiceSttClientMessage.parse(msg));
}

export function serializeTtsClientMessage(msg: VoiceTtsClientMessage): string {
  return JSON.stringify(VoiceTtsClientMessage.parse(msg));
}

/** UI locale -> wire language (BRIEF §5, decided: locale-only pt-PT/pt-BR resolution; the
 *  dashboard carries pt/en locales, and pt maps to pt-PT - o produto é PT-PT por omissão). */
export function voiceLangForLocale(locale: string): VoiceLang {
  if (locale === 'pt' || locale === 'pt-PT') return 'pt-PT';
  if (locale === 'pt-BR') return 'pt-BR';
  return 'en';
}
