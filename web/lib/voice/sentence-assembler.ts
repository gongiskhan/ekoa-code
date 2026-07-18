/**
 * Sentence assembler (mega-run C4). Pure text buffering between the reducer's `say` effect
 * stream (arbitrary reply text chunks) and the tts-stream `say` protocol: the relay treats
 * each `say` as one unit (a new say supersedes a still-playing one - shared/src/voice.ts),
 * so the host must send COMPLETE sentences, one say at a time, never raw chunk fragments.
 *
 * push() accumulates chunk text and returns every sentence completed by that chunk;
 * flush() returns the unterminated remainder when the reply stream settles. Sentence
 * boundaries: terminal punctuation (. ! ? …) followed by whitespace/end, or a blank line
 * (markdown paragraph break). Deliberately dumb - the api-side C5 pipeline re-sanitizes
 * and re-chunks whatever it receives; this split only bounds say granularity.
 */

/** Terminal punctuation (+ closing quotes/brackets), whitespace, then a NEW-SENTENCE start
 *  (uppercase letter or opening quote/paren, via lookahead). The lookahead keeps
 *  abbreviations and enumerations together ("art. 5.2" - '5' is not a sentence start) and
 *  means a terminal at the very end of the buffer WAITS for the next chunk (or flush) -
 *  streaming chunks split anywhere, so the next character is the cheapest confirmation. */
const BOUNDARY = /([.!?…]+["')\]»”’]*)(\s+)(?=[\p{Lu}"'“«(])/u;

export class SentenceAssembler {
  private buffer = '';

  /** Add a reply chunk; returns the sentences it completed (possibly none). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    for (;;) {
      // Paragraph break: everything before it is a unit even without terminal punctuation
      // (headings, list items - the api sanitizer handles their markdown).
      const paragraph = this.buffer.match(/\n\s*\n/);
      const punct = this.buffer.match(BOUNDARY);
      let cut = -1;
      if (paragraph && (!punct || paragraph.index! < punct.index!)) {
        cut = paragraph.index! + paragraph[0].length;
      } else if (punct) {
        cut = punct.index! + punct[1].length;
      }
      if (cut < 0) break;
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut).replace(/^\s+/, '');
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** The unterminated tail (reply settled mid-sentence), or null. Resets the buffer. */
  flush(): string | null {
    const tail = this.buffer.trim();
    this.buffer = '';
    return tail ? tail : null;
  }

  /** Drop everything buffered (barge-in). */
  reset(): void {
    this.buffer = '';
  }
}
