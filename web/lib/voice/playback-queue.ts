/**
 * Sentence playback queue (BRIEF §5, run 20260717-190134, slice C5). Pure ordering logic for
 * the TTS playback path, zero Web Audio: sentences are enqueued in arrival order, decode
 * completes ASYNCHRONOUSLY (and therefore possibly OUT of order), but playback must be
 * strictly in order, one sentence at a time. tts-playback.ts owns the actual AudioContext;
 * this module owns the invariants, so they are unit-testable with no mocks:
 *
 *  - play order == enqueue order, regardless of decode completion order;
 *  - at most one sentence is playing;
 *  - a failed decode is skipped (playback continues with the next sentence, never stalls);
 *  - flush() (barge-in) discards everything not yet finished, and reports what it discarded.
 */

export type SentenceState = 'decoding' | 'ready' | 'failed' | 'playing' | 'done';

interface Entry {
  seq: number;
  state: SentenceState;
}

export class SentenceQueue {
  private entries: Entry[] = [];
  private nextSeq = 0;

  /** Register an arrived sentence (decode starting). Returns its sequence number. */
  enqueue(): number {
    const seq = this.nextSeq++;
    this.entries.push({ seq, state: 'decoding' });
    return seq;
  }

  /** Decode finished for `seq`. Ignored if the sentence was flushed meanwhile. */
  markReady(seq: number): void {
    const e = this.find(seq);
    if (e && e.state === 'decoding') e.state = 'ready';
  }

  /** Decode failed for `seq`: the sentence is skipped, never played, never blocks. */
  markFailed(seq: number): void {
    const e = this.find(seq);
    if (e && (e.state === 'decoding' || e.state === 'ready')) e.state = 'failed';
  }

  /**
   * The sentence to start now, or null. Non-null only when nothing is playing AND the
   * earliest unfinished sentence is ready (failed ones are passed over). A head still
   * decoding returns null - order is never traded for latency.
   */
  nextToPlay(): number | null {
    if (this.entries.some((e) => e.state === 'playing')) return null;
    for (const e of this.entries) {
      if (e.state === 'done' || e.state === 'failed') continue;
      return e.state === 'ready' ? e.seq : null;
    }
    return null;
  }

  /** Transition `seq` to playing. Throws if it is not the sentence nextToPlay() returned -
   *  a caller bug the queue refuses to mask (the invariant IS the module). */
  markPlaying(seq: number): void {
    if (this.nextToPlay() !== seq) throw new Error(`out-of-order play: seq ${seq}`);
    const e = this.find(seq);
    if (e) e.state = 'playing';
  }

  /** Playback of `seq` finished (source onended). */
  markDone(seq: number): void {
    const e = this.find(seq);
    if (e && e.state === 'playing') e.state = 'done';
  }

  /** The currently playing sentence, or null. */
  get playing(): number | null {
    return this.entries.find((e) => e.state === 'playing')?.seq ?? null;
  }

  /** True when nothing is pending or playing (all done/failed, or empty). */
  get idle(): boolean {
    return this.entries.every((e) => e.state === 'done' || e.state === 'failed');
  }

  /** Sentences not yet finished (decoding + ready + playing). */
  get pendingCount(): number {
    return this.entries.filter((e) => e.state === 'decoding' || e.state === 'ready' || e.state === 'playing').length;
  }

  /**
   * Barge-in flush: discard every sentence that has not finished. Returns the discarded
   * seqs (the playing one first if present - the caller must stop() its source node).
   * Late markReady/markFailed calls for discarded seqs are ignored (find() misses).
   */
  flush(): number[] {
    const discarded: number[] = [];
    const playing = this.entries.find((e) => e.state === 'playing');
    if (playing) discarded.push(playing.seq);
    for (const e of this.entries) {
      if (e.state === 'decoding' || e.state === 'ready') discarded.push(e.seq);
    }
    this.entries = [];
    return discarded;
  }

  private find(seq: number): Entry | undefined {
    return this.entries.find((e) => e.seq === seq);
  }
}
