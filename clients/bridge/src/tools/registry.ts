/**
 * tools/registry.ts — THE Tier-1 file-tool vocabulary (ch18 §18.5; ADR-002 trust tiers).
 *
 * This object IS the fixed vocabulary a delegated file-tier task may invoke: EXACTLY the six tools
 * read/list/glob/grep/stat/write and nothing else. Its shape is a structural S3/S5 guarantee — the
 * adversarial suite reflects over it and asserts, by reflection, that NO execution/exfiltration verb
 * (exec/command/shell/spawn/run/local_command/bash/upload) is reachable from the file tier. Tier-2
 * automations (bash, Playwright) live in `src/tools/tier2/` behind a separate task type + grant kind
 * + per-session enablement and are NEVER registered here.
 *
 * EXTENSION SEAM: `extract_text` (the S9 slice) is a typed OPTIONAL member — the type reserves its
 * slot so that slice can register itself without widening the registry, while the value stays exactly
 * the six shipped tools today (so the "exactly six present" reflection assertion holds now).
 */
import { read } from './read.js';
import { list } from './list.js';
import { glob } from './glob.js';
import { grep } from './grep.js';
import { stat } from './stat.js';
import { writeFile } from './write.js';
import { extractText } from './extract-text.js';

/** The Tier-1 vocabulary type: the fixed file-tool set (read/list/glob/grep/stat/write/extract_text). */
export interface Tier1Registry {
  read: typeof read;
  list: typeof list;
  glob: typeof glob;
  grep: typeof grep;
  stat: typeof stat;
  write: typeof writeFile;
  extract_text: typeof extractText;
}

/** The single registered Tier-1 vocabulary. Exactly seven members — NO exec/shell/spawn/upload verb;
 *  the adversarial suite asserts by reflection that no execution/exfiltration verb is reachable here. */
export const tier1Registry: Tier1Registry = {
  read,
  list,
  glob,
  grep,
  stat,
  write: writeFile,
  extract_text: extractText,
};

/** The canonical Tier-1 tool names, for callers that enumerate the vocabulary. */
export const TIER1_TOOL_NAMES = ['read', 'list', 'glob', 'grep', 'stat', 'write', 'extract_text'] as const;
