/**
 * Post-run memory extraction (ch05 §5.8, P-12 re-resolved by Amendment 2). Automatic extraction
 * ships ON. It runs ASYNCHRONOUSLY post-run — scheduled off the terminal event so it never adds
 * turn latency — and is BATCHED per run: exactly ONE FAST-tier `llm.runOneShot` call per run,
 * attributed `user_work` `memory-extract` and billed to the run's user (ch06 6.4.1 row A1). It
 * applies to hosted runs only (chat, build, assistant replies). Every write is
 * `visibility: 'private'` (sharedness is never inferred) plus a Registo entry through the single
 * audit path (`data/` `logActivity`). Privacy-scrub patterns are kept; consolidation is
 * deterministic code (no model call).
 *
 * Two gates decide whether the call happens at all: the platform kill switch
 * `MEMORY_AUTO_EXTRACT_ENABLED` (config) AND the per-user `memory.autoExtract` toggle (default
 * ON, rides user settings). Either off → zero extraction model calls (acceptance criterion 10).
 */
import { loadAgentsConfig } from '../config.js';
import { userSettings, memories } from '../data/stores.js';
import { logActivity } from '../data/activity.js';
import { runOneShot, decideForTier } from '../llm/index.js';
import type { MemoryDoc } from './resolver.js';

export interface ExtractionInput {
  userId: string;
  username: string;
  orgId: string;
  sessionId?: string;
  runId?: string;
  /** The run transcript to mine (hosted record only — never raw delegated local content, I2). */
  transcript: string;
  deps: { now: () => number; genId: () => string };
}

/** Deterministic privacy scrub applied to every extracted fact before persist (§5.8). */
function scrub(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]')
    .replace(/\b[A-Z]{2}\d{2}[\s]?[\d\s]{10,30}\b/g, '[iban]')
    .replace(/\b\d{9,}\b/g, '[number]');
}

/** Parse the FAST model's response into candidate facts. Lenient: accepts a JSON array of
 *  {title, content} or newline-delimited `title: content` lines. Deterministic. */
function parseFacts(text: string): Array<{ title: string; content: string }> {
  const out: Array<{ title: string; content: string }> = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (item && typeof item === 'object') {
          const title = String((item as { title?: unknown }).title ?? '').trim();
          const content = String((item as { content?: unknown }).content ?? '').trim();
          if (content) out.push({ title: title || content.slice(0, 40), content });
        }
      }
      return out;
    } catch {
      /* fall through to line parsing */
    }
  }
  for (const line of trimmed.split('\n')) {
    const m = /^[-*\d.\s]*([^:]+):\s*(.+)$/.exec(line.trim());
    if (m) out.push({ title: m[1]!.trim(), content: m[2]!.trim() });
  }
  return out;
}

// Distilled from the old-cortex memory-extraction instruction: the extract / don't-extract
// lists are what separate a useful organizational memory from noise. Output shape unchanged
// ({"title","content"} array — parseFacts depends on it).
const EXTRACTION_SYSTEM =
  'Extract durable, user-specific facts worth remembering from this conversation. ' +
  'Return a JSON array of {"title","content"} objects. Return [] when nothing is worth keeping.\n' +
  'EXTRACT: lasting preferences and conventions (naming, formats, language, tone), how the user ' +
  'works (recurring workflows, integration usage patterns), stable identities and constraints ' +
  '(role, team, business rules), and recurring problems WITH their accepted solutions.\n' +
  'DO NOT EXTRACT: code or implementation details, transient task state ("is building X now"), ' +
  'secrets/credentials/PII (emails, phone numbers, document numbers), generic world knowledge, ' +
  'or trivia mentioned once with no reuse value.';

/**
 * Run the post-run extraction. Returns a summary for tests; production callers `void` it AFTER
 * emitting the terminal event so the run's terminal never waits on extraction (§5.8). Both gates
 * are checked before any model call — off means the ledger records zero memory-extract rows.
 */
export async function runPostRunExtraction(input: ExtractionInput): Promise<{ skipped: boolean; written: number }> {
  if (!loadAgentsConfig().memoryAutoExtractEnabled) return { skipped: true, written: 0 };
  const perUser = await userSettings.get(input.userId);
  const enabled = perUser?.memory?.autoExtract ?? true;
  if (!enabled) return { skipped: true, written: 0 };
  if (!input.transcript.trim()) return { skipped: true, written: 0 };

  let text: string;
  try {
    const res = await runOneShot(
      { prompt: input.transcript, decision: decideForTier('FAST'), systemPrompt: EXTRACTION_SYSTEM },
      {
        kind: 'user_work',
        agentType: 'memory-extract',
        billeeUserId: input.userId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
      },
    );
    text = res.text;
  } catch {
    // Abort or provider failure: extraction is best-effort and never surfaces (§5.8).
    return { skipped: false, written: 0 };
  }

  const facts = parseFacts(text);
  if (facts.length === 0) return { skipped: false, written: 0 };

  // Deterministic consolidation: skip a fact whose scrubbed content already exists for this user.
  const existing = (await memories.find({ userId: input.userId })) as MemoryDoc[];
  const existingContent = new Set(existing.map((m) => (m.content ?? '').trim()));

  let written = 0;
  for (const fact of facts) {
    const content = scrub(fact.content);
    if (!content || existingContent.has(content.trim())) continue;
    existingContent.add(content.trim());
    const id = input.deps.genId();
    const now = new Date(input.deps.now()).toISOString();
    const doc: MemoryDoc = {
      _id: id,
      orgId: input.orgId,
      userId: input.userId,
      visibility: 'private', // always private — sharedness is never inferred (§5.8)
      title: scrub(fact.title),
      content,
      type: 'extracted',
      tier: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await memories.insert(doc as never);
    written++;
    // Registo entry through the single audit path (§5.8; ch12).
    await logActivity(
      { userId: input.userId, username: input.username, orgId: input.orgId },
      'memory',
      'memory_auto_extracted',
      input.deps,
      { memoryId: id, ...(input.sessionId ? { sessionId: input.sessionId } : {}) },
    );
  }
  return { skipped: false, written };
}
