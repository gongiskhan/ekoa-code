/**
 * voice/ - the voice relay module (mega-run C1, BRIEF §5 Part C). Tier 3, the documented
 * SIBLING of the streaming/ FIXED-2 WS carve-out: two WebSocket upgrade surfaces on the one
 * HTTP server, wired by the composition root (server.ts) exactly like attachCanvasServer.
 *
 *  - WS /api/voice/stream: browser sends 16 kHz linear16 PCM binary frames + JSON control
 *    messages; the relay opens ONE provider STT stream per session, forwards frames, and
 *    returns interim/final transcript JSON + utterance_end events (utterance_end_ms
 *    client-configurable via the upgrade query, clamped 1000..20000).
 *  - WS /api/voice/tts-stream: client sends {say, lang} control messages; the relay streams
 *    synthesized audio frames back; {clear} aborts the current synthesis - the barge-in path.
 *    The C5 text pipeline (text/pipeline.ts) runs on every `say` BEFORE the provider:
 *    sanitize (strip markdown/code/tables/images) -> normalize numbers (PT-PT/EN words) ->
 *    sentence-chunk; the relay synthesizes per-sentence, so each sentence arrives as its own
 *    complete audio container and playback starts at the first sentence, not the whole reply.
 *
 * Auth mirrors the WS/SSE token-query idiom (CONV-1, the streaming/ carve-out shape): the
 * platform session JWT rides `?token=` and is verified at upgrade time through the ONE verify
 * chokepoint (`verifySseToken`: signature + revocation + activation, fail closed), with the
 * same structured auth-failure logging + raw-HTTP socket rejection as streaming/.
 *
 * Per connection: an attributed session record (org + user on every provider call record),
 * a 10-minute inactivity timeout (config knob), and per-stage latency JSON logging
 * (audio_in_first / first_interim / utterance_end / tts_first_audio per turn - session.ts).
 *
 * Metering + audit (mega-run C2, BRIEF §5): at session close each connection records its
 * usage through billing/tracker.ts `recordUsageCounters` - THE single metering writer; this
 * module NEVER writes a ledger collection itself. Counters are `voice_stt_ms` (ungated:
 * capture open = billed, bytes at the known rate) and `voice_tts_chars` (characters submitted
 * for synthesis), SEPARATE from token counters, no token conversion, attributed to the
 * session's org + user from the VERIFIED upgrade token. Voice turns audit through the single
 * `logActivity` path per the A5 vocabulary (`voice.turn` + `voice.tts`, `source:'voice'`,
 * refs only - never transcript or audio bodies). Both are best-effort: a metering/audit
 * failure logs and never drops the socket.
 *
 * voice/ is NOT model egress: transcripts enter the normal chat pipeline elsewhere; nothing
 * here imports llm/. Imports: config.ts, auth/ (verify), billing/ (the tracker seam), data/
 * (logActivity), shared/ (wire schemas), ws, node builtins - strictly downward (tier table,
 * docs/architecture.md).
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  VOICE_STT_WS_PATH,
  VOICE_TTS_WS_PATH,
  VoiceLang,
  VoiceSttClientMessage,
  VoiceTtsClientMessage,
  type VoiceSttServerMessage,
  type VoiceTtsServerMessage,
} from '@ekoa/shared';
import { loadVoiceConfig } from '../config.js';
import { verifySseToken } from '../auth/middleware.js';
import type { JwtClaims } from '../auth/jwt.js';
import { recordUsageCounters } from '../billing/index.js';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';
import { resolveSttProvider, resolveTtsProvider } from './providers.js';
import { speakableChunks } from './text/pipeline.js';
import {
  openVoiceSession,
  closeVoiceSession,
  sttMsOfBytes,
  SttTurnLatency,
  TtsTurnLatency,
  defaultVoiceLog,
  type VoiceLog,
  type VoiceSessionRecord,
} from './session.js';

export { VOICE_STT_WS_PATH, VOICE_TTS_WS_PATH };

// Bounds every inbound frame (streaming/ idiom, Codex G8 class): PCM frames at 16 kHz mono
// 16-bit are ~32 KiB/s, control JSON is small, and a long `say` text stays well under this.
const MAX_PAYLOAD_BYTES = 64 * 1024;

interface AttachVoiceOptions {
  /** Optional structured logger; defaults to the console JSON logger. */
  log?: VoiceLog;
  /** Injectable clock/id for the audit rows; defaults to wall clock (tests pin time). */
  deps?: LogActivityDeps;
}

export function attachVoiceServer(
  httpServer: HttpServer,
  opts: AttachVoiceOptions = {},
): { sttWss: WebSocketServer; ttsWss: WebSocketServer } {
  const log = opts.log ?? defaultVoiceLog;
  const deps = opts.deps ?? { now: () => Date.now() };
  const sttWss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const ttsWss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = pathname(req.url);
    if (path !== VOICE_STT_WS_PATH && path !== VOICE_TTS_WS_PATH) {
      // Not our path; another handler (streaming/, bridge/) may take it. Never destroy here.
      return;
    }
    const claims = authenticateUpgrade(req, socket as Socket, path, log);
    if (!claims) return; // rejected + logged inside
    const wss = path === VOICE_STT_WS_PATH ? sttWss : ttsWss;
    wss.handleUpgrade(req, socket as Socket, head, (ws: WebSocket) => {
      if (path === VOICE_STT_WS_PATH) handleSttConnection(ws, req, claims, log, deps);
      else handleTtsConnection(ws, claims, log, deps);
    });
  });

  return { sttWss, ttsWss };
}

/** Upgrade-time auth (the streaming/ idiom): origin allowlist (opt-in) then the session-JWT
 *  `?token=` through the one verify chokepoint. Returns claims, or null after rejecting. */
function authenticateUpgrade(
  req: IncomingMessage,
  socket: Socket,
  path: string,
  log: VoiceLog,
): JwtClaims | null {
  const allowed = loadVoiceConfig().allowedOrigins;
  if (allowed.length > 0) {
    const origin = req.headers.origin;
    if (!origin || !allowed.includes(origin)) {
      log('voice.auth_failure', { reason: 'origin-rejected', path });
      rejectSocket(socket, 403, 'origin-rejected');
      return null;
    }
  }
  const verified = verifySseToken(queryParam(req.url, 'token'));
  if (!verified.ok) {
    log('voice.auth_failure', { reason: verified.code, path });
    rejectSocket(socket, verified.status, verified.code);
    return null;
  }
  return verified.claims;
}

/* --------------------------------- STT: /api/voice/stream --------------------------------- */

function handleSttConnection(
  ws: WebSocket,
  req: IncomingMessage,
  claims: JwtClaims,
  log: VoiceLog,
  deps: LogActivityDeps,
): void {
  const cfg = loadVoiceConfig();
  const sampleRate = clampInt(queryParam(req.url, 'sample_rate'), 8_000, 48_000, 16_000);
  const utteranceEndMs = clampInt(
    queryParam(req.url, 'utterance_end_ms'),
    1_000,
    20_000,
    cfg.utteranceEndMsDefault,
  );
  const langParsed = VoiceLang.safeParse(queryParam(req.url, 'lang'));
  const lang = langParsed.success ? langParsed.data : undefined;

  const resolved = resolveSttProvider();
  if (resolved.fellBackFrom) {
    log('voice.provider_fallback', { kind: 'stt', configured: resolved.fellBackFrom, resolved: resolved.key });
  }
  const record = openVoiceSession({
    kind: 'stt',
    orgId: claims.orgId,
    userId: claims.sub,
    username: claims.username,
    provider: resolved.key,
    sampleRate,
  });
  log('voice.session.opened', sessionFields(record));

  // One finished-but-unaudited turn at most (A5 vocabulary): `utterance_end` arms it, a client
  // `turn_committed` writes the `voice.turn` row WITH the transcript ref, and the next
  // `utterance_end` (or close) flushes it WITHOUT the ref - the transcript never became a
  // message (e.g. discarded in manual mode). Billing does not depend on this: the session
  // total meters at close regardless.
  let pendingTurn: { turn: number; sttMs: number } | null = null;
  let turnStartBytes = 0;
  const auditTurn = (extra?: { transcriptMessageId: string; mode?: 'manual' | 'talking' }): void => {
    if (!pendingTurn) return;
    const { turn, sttMs } = pendingTurn;
    pendingTurn = null;
    void logActivity(
      actorOf(record),
      'voice',
      'turn',
      deps,
      {
        source: 'voice',
        sessionId: record.sessionId,
        turn,
        ...(lang ? { lang } : {}),
        ...(extra ? { transcriptMessageId: extra.transcriptMessageId } : {}),
        ...(extra?.mode ? { mode: extra.mode } : {}),
      },
      { voice_stt_ms: sttMs },
    ).catch((err) => log('voice.audit_error', { sessionId: record.sessionId, errorClass: errorClass(err) }));
  };

  const send = jsonSender<VoiceSttServerMessage>(ws);
  const latency = new SttTurnLatency(record, log);
  const idle = armInactivityTimer(ws, record, cfg.inactivityTimeoutMs, log);

  const stream = resolved.provider.openStream({
    sampleRate,
    utteranceEndMs,
    lang,
    attribution: { orgId: record.orgId, userId: record.userId, sessionId: record.sessionId },
  });

  // Pump provider events onto the wire. The iterable ends when the provider stream closes
  // (after close_stream or socket close) - then the relay closes the socket cleanly.
  void (async () => {
    try {
      for await (const ev of stream.events) {
        if (ev.kind === 'speech_started') {
          send({ type: 'speech_started' });
        } else if (ev.kind === 'transcript') {
          latency.onTranscript(ev.text);
          send({ type: 'transcript', text: ev.text, isFinal: ev.isFinal, speechFinal: ev.speechFinal });
        } else if (ev.kind === 'utterance_end') {
          latency.onUtteranceEnd();
          auditTurn(); // an uncommitted previous turn flushes without its ref
          const turnBytes = record.audioInBytes - turnStartBytes;
          turnStartBytes = record.audioInBytes;
          pendingTurn = { turn: record.turns, sttMs: sttMsOfBytes(turnBytes) };
          send({ type: 'utterance_end', transcript: ev.transcript });
        } else {
          log('voice.provider_error', { sessionId: record.sessionId, errorClass: 'ProviderStreamError' });
          send({ type: 'error', code: 'VOICE_PROVIDER_ERROR', message: 'Erro no serviço de voz. Tente novamente.' });
        }
      }
    } catch (err) {
      log('voice.provider_error', { sessionId: record.sessionId, errorClass: errorClass(err) });
      send({ type: 'error', code: 'VOICE_PROVIDER_ERROR', message: 'Erro no serviço de voz. Tente novamente.' });
    }
    try { ws.close(1000, 'closed'); } catch { /* already closed */ }
  })();

  send({
    type: 'ready',
    sessionId: record.sessionId,
    sampleRate,
    utteranceEndMs,
    sttProvider: resolved.key,
  });

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    idle.reset();
    if (isBinary) {
      record.audioInBytes += data.byteLength;
      latency.onAudioFrame();
      stream.sendAudio(data);
      return;
    }
    const parsed = parseJson(data, VoiceSttClientMessage);
    if (!parsed) {
      send({ type: 'error', code: 'VOICE_BAD_MESSAGE', message: 'Mensagem de controlo inválida.' });
      return;
    }
    if (parsed.type === 'close_stream') stream.close(); // flush; pump loop closes the socket
    else if (parsed.type === 'turn_committed') {
      // Annotates the last finished turn with its chat-message ref (a ref, never text).
      // Idempotent: with no pending turn there is nothing to audit.
      auditTurn({ transcriptMessageId: parsed.transcriptMessageId, mode: parsed.mode });
    }
  });

  ws.on('close', () => {
    idle.clear();
    stream.close();
    auditTurn(); // a still-pending turn flushes without its ref
    closeVoiceSession(record.sessionId);
    log('voice.session.closed', {
      ...sessionFields(record),
      durationMs: Date.now() - Date.parse(record.startedAt),
      audioInBytes: record.audioInBytes,
      turns: record.turns,
    });
    // BRIEF §5 (decided): ungated v1 - capture open = billed. The whole session's received
    // audio meters at the known rate, through the tracker only (single metering writer).
    meterSessionClose(record, { voice_stt_ms: sttMsOfBytes(record.audioInBytes) }, log);
  });
  ws.on('error', () => { try { ws.close(); } catch { /* already closed */ } });
}

/* ------------------------------- TTS: /api/voice/tts-stream ------------------------------- */

function handleTtsConnection(ws: WebSocket, claims: JwtClaims, log: VoiceLog, deps: LogActivityDeps): void {
  const cfg = loadVoiceConfig();
  const record = openVoiceSession({
    kind: 'tts',
    orgId: claims.orgId,
    userId: claims.sub,
    username: claims.username,
    provider: 'unresolved', // per-language resolution happens at the first `say`
  });
  log('voice.session.opened', sessionFields(record));

  const send = jsonSender<VoiceTtsServerMessage>(ws);
  const idle = armInactivityTimer(ws, record, cfg.inactivityTimeoutMs, log);

  let current: { turnId: string; controller: AbortController } | null = null;

  /** Abort the in-flight turn (barge-in `clear` or a superseding `say`); confirm on the wire. */
  const stopCurrent = (reason: 'clear' | 'superseded'): void => {
    if (!current) return;
    current.controller.abort();
    send({ type: 'cleared', turnId: current.turnId });
    log(reason === 'clear' ? 'voice.tts.cleared' : 'voice.tts.superseded', {
      sessionId: record.sessionId,
      turnId: current.turnId,
    });
    current = null;
  };

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    idle.reset();
    if (isBinary) {
      send({ type: 'error', code: 'VOICE_BAD_MESSAGE', message: 'Mensagem de controlo inválida.' });
      return;
    }
    const parsed = parseJson(data, VoiceTtsClientMessage);
    if (!parsed) {
      send({ type: 'error', code: 'VOICE_BAD_MESSAGE', message: 'Mensagem de controlo inválida.' });
      return;
    }
    if (parsed.type === 'clear') {
      // Idempotent: a clear with nothing playing still confirms (the client state machine
      // may fire it on speculative barge-in).
      if (current) stopCurrent('clear');
      else send({ type: 'cleared' });
      return;
    }

    // say: supersede any in-flight turn, then stream the new synthesis.
    stopCurrent('superseded');
    const turnId = parsed.turnId ?? randomUUID();
    const controller = new AbortController();
    current = { turnId, controller };

    const resolved = resolveTtsProvider(parsed.lang);
    if (resolved.fellBackFrom) {
      log('voice.provider_fallback', { kind: 'tts', configured: resolved.fellBackFrom, resolved: resolved.key, lang: parsed.lang });
    }
    record.provider = resolved.key;
    record.ttsChars += parsed.text.length;
    record.turns += 1;

    // One spoken reply = one `voice.tts` audit row (A5 vocabulary): refs + labels only, never
    // the text; chars submitted = billed, matching the session counter above.
    void logActivity(
      actorOf(record),
      'voice',
      'tts',
      deps,
      {
        source: 'voice',
        sessionId: record.sessionId,
        provider: resolved.key,
        lang: parsed.lang,
        ...(parsed.sheetId ? { sheetId: parsed.sheetId } : {}),
      },
      { voice_tts_chars: parsed.text.length },
    ).catch((err) => log('voice.audit_error', { sessionId: record.sessionId, errorClass: errorClass(err) }));

    const latency = new TtsTurnLatency(record, log, turnId, parsed.lang);
    latency.onSay();
    send({ type: 'speaking', turnId, lang: parsed.lang, ttsProvider: resolved.key });

    // C5 text pipeline: sanitize -> normalize -> sentence-chunk BEFORE synthesis. Billing
    // stays on characters SUBMITTED by the client (above, the C2 counter semantics); the
    // provider receives the speakable units. An empty result (say text was only markdown/
    // code) completes the turn without synthesizing - nothing speakable is not an error.
    const sentences = speakableChunks(parsed.text, parsed.lang);

    void (async () => {
      try {
        for (const sentence of sentences) {
          if (controller.signal.aborted) return;
          const chunks = resolved.provider.synthesizeStream(sentence, parsed.lang, controller.signal, {
            orgId: record.orgId,
            userId: record.userId,
            sessionId: record.sessionId,
          });
          for await (const chunk of chunks) {
            if (controller.signal.aborted) return;
            latency.onFirstAudio();
            const sent = await sendAudioWithBackpressure(ws, chunk, controller.signal);
            if (!sent) return; // aborted or socket closed while sending/waiting
          }
        }
        if (!controller.signal.aborted) {
          send({ type: 'audio_end', turnId });
          if (current?.turnId === turnId) current = null;
        }
      } catch (err) {
        // An aborted turn that surfaces as a throw (a provider rejecting on the signal) is NOT
        // an error the client should see - it was a barge-in/supersede, already confirmed.
        if (controller.signal.aborted) return;
        log('voice.provider_error', { sessionId: record.sessionId, turnId, errorClass: errorClass(err) });
        send({ type: 'error', code: 'VOICE_PROVIDER_ERROR', message: 'Erro no serviço de voz. Tente novamente.' });
        if (current?.turnId === turnId) current = null;
      }
    })();
  });

  send({ type: 'ready', sessionId: record.sessionId });

  ws.on('close', () => {
    idle.clear();
    current?.controller.abort();
    current = null;
    closeVoiceSession(record.sessionId);
    log('voice.session.closed', {
      ...sessionFields(record),
      durationMs: Date.now() - Date.parse(record.startedAt),
      ttsChars: record.ttsChars,
      turns: record.turns,
    });
    // Characters submitted for synthesis over the whole session, through the tracker only.
    meterSessionClose(record, { voice_tts_chars: record.ttsChars }, log);
  });
  ws.on('error', () => { try { ws.close(); } catch { /* already closed */ } });
}

/* ------------------------------------- shared helpers ------------------------------------- */

/** The audit actor is ALWAYS the session record's verified-token identity (never a message). */
function actorOf(record: VoiceSessionRecord): ActivityActor {
  return { userId: record.userId, username: record.username, orgId: record.orgId };
}

/** Session-close metering through the ONE tracker seam (`billing/tracker.ts`, the single
 *  metering writer - this module never writes a ledger collection). Attributed to the
 *  session's org + user from the verified token; keyed org+session (idempotent upsert);
 *  best-effort - a metering failure logs and never affects the socket teardown. */
function meterSessionClose(
  record: VoiceSessionRecord,
  counters: Record<string, number>,
  log: VoiceLog,
): void {
  void recordUsageCounters({
    orgId: record.orgId,
    billeeUserId: record.userId,
    sessionId: record.sessionId,
    source: 'voice',
    counters,
  }).catch((err) =>
    log('voice.metering_error', { sessionId: record.sessionId, errorClass: errorClass(err) }),
  );
}

/** Provider error text is untrusted and may echo request/transcript content, so logs record
 *  only a bounded class token, never the message (and never a vendor-controlled `.name`
 *  verbatim - an Error subclass could set `name` to arbitrary text). Known built-in error
 *  names pass through; anything else collapses to 'ProviderError'. */
const KNOWN_ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'AbortError', 'TimeoutError', 'EvalError', 'URIError',
]);
function errorClass(err: unknown): string {
  if (err instanceof Error) return KNOWN_ERROR_NAMES.has(err.name) ? err.name : 'ProviderError';
  return typeof err;
}

/** Backpressure-aware binary send: if the socket's kernel/app buffer is already deep, wait for
 *  it to drain (or the turn to abort) before queueing more audio, so a slow client cannot make
 *  a fast provider buffer unbounded audio on one socket. Resolves false if the turn aborted or
 *  the socket closed while waiting. */
const WS_BUFFER_HIGH_WATER = 1 << 20; // 1 MiB queued audio ceiling per socket
function sendAudioWithBackpressure(ws: WebSocket, chunk: Uint8Array, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted || ws.readyState !== ws.OPEN) return resolve(false);
    if (ws.bufferedAmount < WS_BUFFER_HIGH_WATER) {
      ws.send(chunk);
      return resolve(true);
    }
    const start = Date.now();
    const tick = setInterval(() => {
      if (signal.aborted || ws.readyState !== ws.OPEN) {
        clearInterval(tick);
        return resolve(false);
      }
      // Drained enough: queue this chunk and continue.
      if (ws.bufferedAmount < WS_BUFFER_HIGH_WATER) {
        clearInterval(tick);
        if (signal.aborted || ws.readyState !== ws.OPEN) return resolve(false);
        ws.send(chunk);
        return resolve(true);
      }
      // Fail safe: a client that has not drained for 30s is treated as gone - stop the turn
      // (return false) rather than enqueue MORE audio onto an already-saturated socket.
      if (Date.now() - start > 30_000) {
        clearInterval(tick);
        return resolve(false);
      }
    }, 20);
  });
}

function sessionFields(record: VoiceSessionRecord): Record<string, unknown> {
  return {
    sessionId: record.sessionId,
    kind: record.kind,
    orgId: record.orgId,
    userId: record.userId,
    username: record.username,
    provider: record.provider,
  };
}

/** The 10-minute inactivity timeout (BRIEF §5; `voice.inactivityTimeoutMs` knob). Any client
 *  message resets it; firing tells the client why (PT-PT) and closes 1000. */
function armInactivityTimer(
  ws: WebSocket,
  record: VoiceSessionRecord,
  timeoutMs: number,
  log: VoiceLog,
): { reset: () => void; clear: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const fire = (): void => {
    log('voice.session.timeout', { sessionId: record.sessionId, orgId: record.orgId, userId: record.userId, timeoutMs });
    try {
      ws.send(JSON.stringify({ type: 'error', code: 'VOICE_TIMEOUT', message: 'Sessão de voz terminada por inatividade.' }));
    } catch { /* socket already gone */ }
    try { ws.close(1000, 'inactivity-timeout'); } catch { /* already closed */ }
  };
  const reset = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, timeoutMs);
  };
  reset();
  return {
    reset,
    clear: () => { if (timer) clearTimeout(timer); },
  };
}

function jsonSender<T>(ws: WebSocket): (msg: T) => void {
  return (msg: T): void => {
    if (ws.readyState !== ws.OPEN) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* socket already gone */ }
  };
}

function parseJson<T>(data: Buffer, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): T | null {
  let raw: unknown;
  try { raw = JSON.parse(data.toString('utf8')); } catch { return null; }
  const parsed = schema.safeParse(raw);
  return parsed.success ? (parsed.data as T) : null;
}

function pathname(reqUrl: string | undefined): string {
  if (!reqUrl) return '';
  const qIdx = reqUrl.indexOf('?');
  return qIdx >= 0 ? reqUrl.slice(0, qIdx) : reqUrl;
}

function queryParam(reqUrl: string | undefined, name: string): string | undefined {
  if (!reqUrl) return undefined;
  const qIdx = reqUrl.indexOf('?');
  if (qIdx < 0) return undefined;
  return new URLSearchParams(reqUrl.slice(qIdx + 1)).get(name) ?? undefined;
}

function clampInt(raw: string | undefined, min: number, max: number, dflt: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function rejectSocket(socket: Socket, status: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch { /* socket may already be closed */ }
  try { socket.destroy(); } catch { /* already destroyed */ }
}
