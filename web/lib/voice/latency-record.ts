/**
 * Per-turn latency record collector (mega-run C7, BRIEF §5 validation: "latency instrumentation
 * kept and dashboarded"). C3/C4 already emit ONE mark at a time via the reducer's
 * `emitLatencyMark` effect (audio_in -> first_interim -> utterance_end -> agent_first_token ->
 * tts_first_audio, plus barge_in) - session-driver.ts's `onLatencyMark` hook fires per mark.
 * This pure collector folds a turn's marks into ONE structured record, the client-side mirror of
 * the server's per-turn stage clocks (api/src/voice/session.ts SttTurnLatency/TtsTurnLatency):
 * the host logs ONE JSON line per turn instead of five, and the C7 dashboard memo reads these
 * lines (voice-latency.md). Pure - no DOM, no timers, no console; the host (use-voice-session.ts)
 * owns emitting the closed record.
 *
 * Turn boundaries: a turn OPENS on 'audio_in' (a fresh tap or the loop re-arming) and CLOSES on
 * whichever comes first -
 *   - 'tts_first_audio': a talking-mode turn whose reply got read aloud (the common case);
 *   - the NEXT 'audio_in': a manual-mode/no-tts turn never got a close mark of its own - closed
 *     by the next turn's start, mirroring the server's re-arm-per-turn model;
 *   - 'barge_in': the reducer's FRESH_TURN reset on an interruption during TTS carries no
 *     separate audio_in mark for the NEW capture it opens - 'barge_in' itself is that instant,
 *     so it closes whatever was open (tagging the interruption on it) and immediately opens the
 *     next turn at the same timestamp.
 * A pending-note capture (barge-in during standby/awaiting, BRIEF §5 mobile checklist) emits NO
 * marks at all (voice-machine.ts onBargeIn's standby/awaiting branches carry no
 * emitLatencyMark effect) - it never touches the collector.
 */

export type LatencyMark =
  | 'audio_in'
  | 'first_interim'
  | 'utterance_end'
  | 'agent_first_token'
  | 'tts_first_audio'
  | 'barge_in';

export interface LatencyRecord {
  turn: number;
  audio_in: number | null;
  first_interim: number | null;
  utterance_end: number | null;
  agent_first_token: number | null;
  tts_first_audio: number | null;
  barge_in: number | null;
  ms_to_first_interim: number | null;
  ms_to_utterance_end: number | null;
  ms_to_agent_first_token: number | null;
  ms_to_tts_first_audio: number | null;
  /** The turn closed via barge_in before a tts_first_audio ever arrived - a real product
   *  signal (the reply was cut short), never a malformed record. */
  interrupted: boolean;
}

type OpenMarks = Partial<Record<LatencyMark, number>>;

function delta(from: number | undefined, to: number | undefined): number | null {
  return from !== undefined && to !== undefined ? to - from : null;
}

function toRecord(turn: number, m: OpenMarks): LatencyRecord {
  return {
    turn,
    audio_in: m.audio_in ?? null,
    first_interim: m.first_interim ?? null,
    utterance_end: m.utterance_end ?? null,
    agent_first_token: m.agent_first_token ?? null,
    tts_first_audio: m.tts_first_audio ?? null,
    barge_in: m.barge_in ?? null,
    ms_to_first_interim: delta(m.audio_in, m.first_interim),
    ms_to_utterance_end: delta(m.audio_in, m.utterance_end),
    ms_to_agent_first_token: delta(m.audio_in, m.agent_first_token),
    ms_to_tts_first_audio: delta(m.audio_in, m.tts_first_audio),
    interrupted: m.barge_in !== undefined && m.tts_first_audio === undefined,
  };
}

export class LatencyRecordCollector {
  private nextTurn = 0;
  private openTurn = -1;
  private open: OpenMarks | null = null;

  /** Feed one mark. Returns the CLOSED record when this mark ends a turn, else null (still
   *  accumulating). */
  mark(m: LatencyMark, atMs: number): LatencyRecord | null {
    if (m === 'audio_in') {
      const closed = this.open ? toRecord(this.openTurn, this.open) : null;
      this.openTurn = this.nextTurn++;
      this.open = { audio_in: atMs };
      return closed;
    }
    if (m === 'barge_in') {
      // In practice the reducer only ever emits 'barge_in' from the 'speaking' status
      // (voice-machine.ts onBargeIn/confirmCandidate), which is reached ONLY after
      // tts_first_audio already closed the turn below - so `this.open` is normally already
      // null here and this branch is defensive (a future mark source, or teardown races).
      let closed: LatencyRecord | null = null;
      if (this.open) {
        this.open.barge_in = atMs;
        closed = toRecord(this.openTurn, this.open);
      }
      // The interruption is itself the NEXT capture's start instant: it opens a fresh turn
      // seeded with BOTH audio_in and barge_in at this timestamp, so the dashboard can tell
      // "opened by an interruption" apart from "opened by a fresh tap" without needing to
      // mutate an already-closed (already-logged) record.
      this.openTurn = this.nextTurn++;
      this.open = { audio_in: atMs, barge_in: atMs };
      return closed;
    }
    if (!this.open) return null; // a stray mark with no turn open: ignore, defensive
    this.open[m] = atMs;
    if (m === 'tts_first_audio') {
      const closed = toRecord(this.openTurn, this.open);
      this.open = null;
      return closed;
    }
    return null;
  }

  /** Force-close whatever is accumulated (session teardown). Idempotent: a second call with
   *  nothing open returns null. */
  close(): LatencyRecord | null {
    if (!this.open) return null;
    const closed = toRecord(this.openTurn, this.open);
    this.open = null;
    return closed;
  }
}
