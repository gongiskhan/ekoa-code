/**
 * The guided-build state machine + its classifier calls (ch05 §5.6.1, §5.6.2), authored as
 * typed TypeScript (FIXED-4: no runtime markdown interpretation). The orchestration phases carry
 * as a typed union persisted on the session record; the phase_changed broadcast does NOT carry
 * (P-11) — phase is readable on the session resource.
 *
 * The classifier calls are FAST-tier (`llm.completeFast`), each with a COMMITTED deterministic
 * fallback (reference/llm-usage-map.md §6). The abort rule is load-bearing (§5.3.2): an abort
 * propagates as `LlmAbortedError` and NEVER falls through to a fallback — the fallback defaults
 * to "modification" and would start a build after the user pressed Stop.
 */
import { completeFast, LlmAbortedError } from '../llm/index.js';

/** Guided-build orchestration phases, persisted on the session record (§5.6.1). */
export type GuidedBuildPhase = 'idle' | 'gathering' | 'resolving-integrations' | 'building' | 'built' | 'failed';

/** The in-build classifier outcomes (§5.6.2). */
export type InBuildIntent = 'modification' | 'integration-build' | 'question';

async function fastClassify(message: string, system: string, billeeUserId: string, signal?: AbortSignal): Promise<string> {
  const res = await completeFast(
    { messages: [{ role: 'user', content: message }], system, maxTokens: 16, signal },
    { kind: 'classifier', agentType: 'classify-in-build-intent', billeeUserId },
  );
  return res.text.trim().toLowerCase();
}

/**
 * In-build message classifier for follow-ups (§5.6.2). Runs before any build work under the
 * abort rules of §5.3.2. On abort it rethrows `LlmAbortedError` (the caller bails with NO side
 * effects — never a build). On any OTHER failure it falls back to `modification` (proceed with
 * the build), the committed deterministic fallback.
 */
export async function classifyInBuildIntent(message: string, billeeUserId: string, signal?: AbortSignal): Promise<InBuildIntent> {
  try {
    const out = await fastClassify(
      message,
      'Classify this follow-up message about an app being built. Answer with ONE word: "modification" (change the app), "integration" (connect an external service), or "question" (a question or meta comment).',
      billeeUserId,
      signal,
    );
    if (out.includes('integration')) return 'integration-build';
    if (out.includes('question') || out.includes('meta')) return 'question';
    return 'modification';
  } catch (err) {
    if (err instanceof LlmAbortedError) throw err; // NEVER fall through to a fallback on abort (§5.3.2)
    return 'modification'; // committed deterministic fallback (non-fatal, §5.6.2)
  }
}

/** Build-need detection (§5.6.1). Fallback: deterministic keyword heuristic. */
export async function detectBuildIntent(message: string, billeeUserId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const out = await fastClassify(
      message,
      'Does this message ask to build or create an application/dashboard/tool? Answer "yes" or "no".',
      billeeUserId,
      signal,
    );
    return out.startsWith('y');
  } catch (err) {
    if (err instanceof LlmAbortedError) throw err;
    return /\b(build|create|make|app|dashboard|tool|criar|construir|aplica)/i.test(message); // committed fallback
  }
}

/** Integration-needs detection (§5.6.1). Fallback: no integrations needed. */
export async function detectIntegrationNeeds(message: string, billeeUserId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const out = await fastClassify(
      message,
      'Does building this need an external integration (email, calendar, payments, e-sign, etc.)? Answer "yes" or "no".',
      billeeUserId,
      signal,
    );
    return out.startsWith('y');
  } catch (err) {
    if (err instanceof LlmAbortedError) throw err;
    return false; // committed deterministic fallback
  }
}

/** Base-template selection (§5.6.1). Fallback: the generic 'blank' template. */
export async function selectBaseTemplate(message: string, billeeUserId: string, signal?: AbortSignal): Promise<string> {
  try {
    const out = await fastClassify(
      message,
      'Pick the best starting template id for this app in one lowercase token (e.g. "crm", "dashboard", "form", "blank").',
      billeeUserId,
      signal,
    );
    return out.split(/\s+/)[0] || 'blank';
  } catch (err) {
    if (err instanceof LlmAbortedError) throw err;
    return 'blank'; // committed deterministic fallback
  }
}
