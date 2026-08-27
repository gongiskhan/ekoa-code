/**
 * Running build summary (token-economics port; ekoa-dev `docs/token-economics.md`).
 *
 * Follow-up app builds USED to resume the Claude Agent SDK session (`resume` ← the artifact's
 * `sdkSessionId`), which regrew an unbounded transcript: mostly stale tool results (old file reads,
 * esbuild output) that never compacted under the 1M window and floored every follow-up to Opus —
 * five prompts could burn a whole usage window on ONE artifact. The transcript is the wrong
 * continuity carrier for a coding agent: the project files on disk are the real state, and the
 * transcript is mostly stale copies of them. Follow-ups now run a FRESH session; continuity comes
 * from cheap carriers — the files on disk, a short verbatim conversation tail, an agent-maintained
 * NOTES.md, and THIS running summary.
 *
 * The summary is a fire-and-forget FAST-tier (Haiku) pass after each SUCCESSFUL build — the exact
 * shape as the post-run memory extractor (§5.8): one `llm.runOneShot`, attributed `user_work`
 * `build-summary`, billed to the build's user and stamped with the artifact id. It NEVER blocks the
 * completion flow and NEVER fails a build: an empty/failed pass keeps the previous summary. The
 * write goes through the build-mechanics seam (`agents/` reaches `apps/` only via the seam).
 *
 * Passes are SERIALIZED per artifact (a promise chain): the next follow-up's `awaitPendingBuildSummary`
 * blocks briefly on the previous build's in-flight summary so it reads a current one, and two writes
 * for the same artifact never race. Untrusted inputs (the user's request, the agent's reply) have the
 * section delimiters this prompt uses stripped, so they cannot forge a section boundary.
 */
import { runOneShot, decideForTier } from '../llm/index.js';
import { getBuildMechanics } from './seams.js';

/** Input caps (chars) + file cap, mirroring ekoa-dev's build-summary service. Newest-first budgets
 *  are unnecessary here (three distinct fields, not a turn list): a flat per-field cap is enough. */
const CAP_REQUEST = 8_000;
const CAP_REPLY = 4_000;
const CAP_PREVIOUS = 6_000;
const MAX_FILES = 30;
/** Hard cap on the STORED summary (~600 words). Re-paid verbatim in every follow-up prompt, so it
 *  is bounded tightly — the whole point of the carrier is that it stays cheap per prompt. */
const CAP_OUTPUT = 6_000;
/** Bound on how long a follow-up waits for the previous build's in-flight summary before proceeding
 *  with whatever summary is already stored (never hang a user's build on a background pass). */
const AWAIT_TIMEOUT_MS = 8_000;

export interface BuildSummaryInput {
  artifactId: string;
  userId: string;
  sessionId?: string;
  runId?: string;
  /** The prior running summary to EVOLVE (empty string / absent on a first build). */
  previousSummary?: string;
  /** The user's own request that drove this build (raw words — never the augmented prompt). */
  userRequest: string;
  /** The agent's final user-facing reply (white-labeled; may carry an appended build note, e.g. a
   *  failed final bundle — so the summary records that the last change did not fully land). */
  finalReply: string;
  /** Project-relative paths the build wrote/edited (Write/Edit/MultiEdit/NotebookEdit `file_path`). */
  filesChanged: string[];
}

const SUMMARY_SYSTEM = [
  'You maintain a concise running engineering summary of ONE web app across its build history.',
  'You are given the previous summary, the latest user request, the agent\'s final reply, and the files that changed.',
  'Return ONLY the UPDATED summary text — no preamble, no headings scaffolding, no code fences.',
  'PRESERVE across builds: durable decisions and their rationale, business rules and domain constraints,',
  'the data model / collection + field names, integration and contract details, and explicit user corrections',
  '("not X, do Y"). Fold the latest change into the running picture; drop transient chatter and superseded detail.',
  'If the final reply says a build step failed or did not fully land, record that as an open item.',
  'Keep it under 600 words. Write in the language of the user request. Keep identifiers, collection/field',
  'names, and proper nouns EXACT and unabbreviated.',
].join(' ');

/** Strip the XML-ish section delimiters this prompt uses out of UNTRUSTED text, so a request or
 *  reply cannot forge a `</...>` boundary and confuse the section structure. Non-destructive to
 *  ordinary code/prose (these exact tag tokens do not occur naturally). */
function stripDelimiters(text: string): string {
  return text.replace(/<\/?(?:prior_summary|user_request|final_reply|files_changed)>/gi, ' ');
}

function clip(text: string, cap: number): string {
  const stripped = stripDelimiters(text);
  return stripped.length > cap ? `${stripped.slice(0, cap)} […truncado]` : stripped;
}

/** Compose the one-shot prompt. Files are listed by project-relative path only (no contents — those
 *  are on disk and re-read fresh; listing paths is enough to say WHAT the build touched). */
function renderSummaryPrompt(input: BuildSummaryInput): string {
  const previous = clip(input.previousSummary ?? '', CAP_PREVIOUS).trim();
  const request = clip(input.userRequest, CAP_REQUEST).trim();
  const reply = clip(input.finalReply, CAP_REPLY).trim();
  // A file path is untrusted too (the agent writes files at the user's direction; a basename can
  // carry a forged tag with no '/'), so strip the same section delimiters here — otherwise the
  // <files_changed> boundary the request/reply stripping protects could be forged through a filename.
  const files = input.filesChanged.slice(0, MAX_FILES).map((f) => stripDelimiters(f).slice(0, 200));
  const more = input.filesChanged.length - files.length;
  const fileList = files.length
    ? files.join('\n') + (more > 0 ? `\n(+${more} more)` : '')
    : '(none reported)';
  return [
    `<prior_summary>\n${previous || '(none — this is the first build)'}\n</prior_summary>`,
    `<user_request>\n${request}\n</user_request>`,
    `<final_reply>\n${reply}\n</final_reply>`,
    `<files_changed>\n${fileList}\n</files_changed>`,
  ].join('\n\n');
}

/** Per-artifact serialization chain: a summary pass for an artifact starts only after the previous
 *  one settles, so writes never race and `awaitPendingBuildSummary` has a single promise to wait on. */
const chains = new Map<string, Promise<void>>();

/**
 * Schedule the running-summary pass for a completed build. Fire-and-forget: returns immediately and
 * NEVER throws. Production callers invoke this AFTER emitting the terminal completion event, so the
 * user's "done" never waits on the FAST pass.
 */
export function scheduleBuildSummary(input: BuildSummaryInput): void {
  const prev = chains.get(input.artifactId) ?? Promise.resolve();
  const next = prev.then(() => runBuildSummary(input)).catch((err) => {
    console.warn(`[build-summary] ${input.artifactId}: summary pass failed (non-fatal):`, err instanceof Error ? err.message : err);
  });
  chains.set(input.artifactId, next);
  void next.then(() => {
    if (chains.get(input.artifactId) === next) chains.delete(input.artifactId);
  });
}

/**
 * Wait (bounded) for an artifact's in-flight summary pass to settle before a follow-up reads it.
 * A previous build's summary is written fire-and-forget and may still be running when the next
 * follow-up begins; blocking briefly here means the follow-up briefs on a CURRENT summary instead of
 * a stale one. The timeout guarantees a background pass can never hang a user's build.
 */
export async function awaitPendingBuildSummary(artifactId: string, timeoutMs = AWAIT_TIMEOUT_MS): Promise<void> {
  const pending = chains.get(artifactId);
  if (!pending) return; // `pending` already swallows its own errors (see scheduleBuildSummary)
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([pending, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runBuildSummary(input: BuildSummaryInput): Promise<void> {
  if (!input.userRequest.trim() && !input.finalReply.trim()) return; // nothing to summarize
  let text: string;
  try {
    const res = await runOneShot(
      { prompt: renderSummaryPrompt(input), decision: decideForTier('FAST'), systemPrompt: SUMMARY_SYSTEM },
      {
        kind: 'user_work',
        agentType: 'build-summary',
        billeeUserId: input.userId,
        artifactId: input.artifactId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
      },
    );
    text = res.text;
  } catch {
    // Abort or provider failure: keep the previous summary, never surface (same as §5.8 extraction).
    return;
  }
  const summary = text.trim().slice(0, CAP_OUTPUT);
  if (!summary) return; // empty pass → keep the previous summary (persistBuildSummary also guards blank)
  await getBuildMechanics().persistBuildSummary(input.artifactId, summary);
}

/** Test-only: clear the per-artifact serialization chains between suites. */
export function __resetBuildSummaryChainsForTests(): void {
  chains.clear();
}
