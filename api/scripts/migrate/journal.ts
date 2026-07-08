/**
 * RUN_LOG-style journaling for the migration tool (ch10 §10.3 rule 5).
 *
 * Every run - dry-run or execute - appends one self-contained, human-readable block to a
 * journal file: the start/end timestamps, the mode, per-store `source/imported/checksum`
 * lines, every slug-collision resolution, every decrypt-sample result, and any anomaly. The
 * journal is append-only (the chapter-14 RUN_LOG discipline); a partially-failed run leaves
 * its block behind for the operator, and a re-run appends a fresh one.
 *
 * The file is opened in append mode and each block is flushed as it is written, so a crash
 * mid-run still leaves the lines emitted so far.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Journal {
  private buffer: string[] = [];

  constructor(private readonly path: string) {}

  line(text: string): void {
    this.buffer.push(text);
  }

  blank(): void {
    this.buffer.push('');
  }

  /** Flush the buffered block to the journal file (append), then clear the buffer. */
  flush(): void {
    if (this.buffer.length === 0) return;
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, this.buffer.join('\n') + '\n');
    this.buffer = [];
  }
}
