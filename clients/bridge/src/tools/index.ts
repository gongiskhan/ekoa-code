/**
 * tools/index.ts — barrel for the Tier-1 file-tool vocabulary (§18.5). The only import surface other
 * slices (the delegation engine) should use for the file tools, their shared context/error types, and
 * the vocabulary registry. Tier-2 automations live under `src/tools/tier2/` and are NOT re-exported
 * here — they are never part of the file-tier surface (ADR-002).
 */
export { ToolError, emit, denyAndThrow, resolveInGrant, nowIso } from './types.js';
export type { ToolContext, Emission, Resolved } from './types.js';

export { read } from './read.js';
export type { ByteRange, ReadResult } from './read.js';

export { list } from './list.js';
export type { DirEntry, DirEntryKind, ListResult } from './list.js';

export { glob } from './glob.js';
export type { GlobResult } from './glob.js';

export { grep } from './grep.js';
export type { GrepOptions, GrepMatch, GrepResult } from './grep.js';

export { stat } from './stat.js';
export type { StatResult } from './stat.js';

export { writeFile, resetFirstWriteState } from './write.js';
export type { WriteBody, WritePreconditions, WriteResult } from './write.js';

export { extractText } from './extract-text.js';
export type { ExtractTextResult } from './extract-text.js';

export { tier1Registry, TIER1_TOOL_NAMES } from './registry.js';
export type { Tier1Registry } from './registry.js';
