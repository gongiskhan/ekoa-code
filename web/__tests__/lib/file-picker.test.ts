/**
 * WS4b - `stageFiles`/`stagePastedText`, the primitives the composer's drag-drop and paste
 * handlers share with the native-dialog `pickFiles()` (all three end up calling the SAME
 * `stageFile` -> `POST /api/v1/uploads` path, so a dropped/pasted file is staged identically to
 * one picked through the dialog). `@/lib/api` is mocked; these tests pin the request shape and
 * the FileAttachment the composer receives back, not the server route itself (covered by
 * `api/tests/contract/uploads.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    uploads: { create: (...args: unknown[]) => createMock(...args) },
  },
}));

import {
  stageFiles,
  stagePastedText,
  pickFiles,
  shouldStageAsTextAttachment,
  PASTE_TEXT_LENGTH_THRESHOLD,
  PASTE_TEXT_LINE_THRESHOLD,
} from '@/lib/file-picker';

beforeEach(() => {
  createMock.mockReset();
});

describe('stageFiles', () => {
  it('stages each file and returns a FileAttachment carrying the SERVER-issued uploadId as .path', async () => {
    createMock.mockResolvedValue({ uploadId: 'upload-abc', displayName: 'invoice.pdf', size: 42 });
    const file = new File(['bytes'], 'invoice.pdf', { type: 'application/pdf' });

    const [att] = await stageFiles([file]);

    expect(createMock).toHaveBeenCalledTimes(1);
    const [, opts] = createMock.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    expect(opts.headers['X-Filename']).toBe('invoice.pdf');
    expect(att.path).toBe('upload-abc');
    expect(att.displayName).toBe('invoice.pdf');
    expect(att.type).toBe('file');
    expect(att.size).toBe(42);
    // The chip id is minted locally - never the server's uploadId (the exact bug WS4a fixed
    // downstream of this: attachmentId and .path must stay two different values).
    expect(att.attachmentId).not.toBe('upload-abc');
  });

  it('one bad file does not lose the rest of a multi-file drop/paste', async () => {
    createMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ uploadId: 'upload-2', displayName: 'ok.txt', size: 3 });
    const bad = new File(['x'], 'bad.txt', { type: 'text/plain' });
    const ok = new File(['ok'], 'ok.txt', { type: 'text/plain' });

    const results = await stageFiles([bad, ok]);

    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe('ok.txt');
  });

  it('an empty file list stages nothing and never calls the upload endpoint', async () => {
    const results = await stageFiles([]);
    expect(results).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('pickFiles (native dialog) reuses stageFiles under the hood', () => {
  it('is still exported and callable (regression: refactor must not drop the public API)', () => {
    expect(typeof pickFiles).toBe('function');
  });
});

describe('stagePastedText', () => {
  it('wraps the pasted text as a .txt file and stages it', async () => {
    createMock.mockResolvedValue({ uploadId: 'upload-text-1', displayName: 'pasted.txt', size: 11 });

    const att = await stagePastedText('hello world, this is a pasted paragraph.');

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(att).not.toBeNull();
    expect(att!.path).toBe('upload-text-1');
    expect(att!.type).toBe('file');
    // The staged filename carries the X-Filename header - always a .txt file, never raw text on
    // the wire outside the upload body.
    const [, opts] = createMock.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    expect(opts.headers['X-Filename']).toMatch(/\.txt$/);
  });

  it('truncates a long paste to a short display label rather than dumping the whole text as the chip name', async () => {
    createMock.mockResolvedValue({ uploadId: 'upload-text-2', displayName: 'x', size: 900 });
    const longText = 'word '.repeat(200); // ~1000 chars

    const att = await stagePastedText(longText);

    expect(att!.displayName.length).toBeLessThan(70);
  });

  it('returns null for blank/whitespace-only text without ever staging it', async () => {
    const att = await stagePastedText('   \n\t  ');
    expect(att).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when the upload call fails', async () => {
    createMock.mockRejectedValue(new Error('network blip'));
    const att = await stagePastedText('some real pasted content here');
    expect(att).toBeNull();
  });
});

describe('shouldStageAsTextAttachment (the composer paste-vs-insert decision)', () => {
  it('a short, ordinary sentence stays under BOTH signals and is left to normal paste', () => {
    expect(shouldStageAsTextAttachment('olá, tudo bem? isto e uma mensagem curta.')).toBe(false);
  });

  it('blank/whitespace-only text never stages', () => {
    expect(shouldStageAsTextAttachment('   \n\t  ')).toBe(false);
  });

  it('text past the LENGTH threshold stages even as a single line (no line breaks at all)', () => {
    const oneLongLine = 'a'.repeat(PASTE_TEXT_LENGTH_THRESHOLD + 1);
    expect(shouldStageAsTextAttachment(oneLongLine)).toBe(true);
  });

  it('text AT the length threshold does not trip it (strictly greater-than)', () => {
    const exactlyAtThreshold = 'a'.repeat(PASTE_TEXT_LENGTH_THRESHOLD);
    expect(shouldStageAsTextAttachment(exactlyAtThreshold)).toBe(false);
  });

  it('a short-line list past the LINE-COUNT threshold stages even though it is well under the length threshold', () => {
    const shortLines = Array.from({ length: PASTE_TEXT_LINE_THRESHOLD + 1 }, (_, i) => `item ${i}`).join('\n');
    expect(shortLines.length).toBeLessThan(PASTE_TEXT_LENGTH_THRESHOLD);
    expect(shouldStageAsTextAttachment(shortLines)).toBe(true);
  });

  it('blank lines in a short list do not count toward the line threshold', () => {
    const withBlanks = Array.from({ length: PASTE_TEXT_LINE_THRESHOLD }, (_, i) => `item ${i}`).join('\n\n');
    expect(shouldStageAsTextAttachment(withBlanks)).toBe(false);
  });

  it('a list AT the line threshold does not trip it (strictly greater-than)', () => {
    const exactly = Array.from({ length: PASTE_TEXT_LINE_THRESHOLD }, (_, i) => `item ${i}`).join('\n');
    expect(shouldStageAsTextAttachment(exactly)).toBe(false);
  });
});
