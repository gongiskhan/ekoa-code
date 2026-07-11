/**
 * Persistent job registry (ch05 §5.2.1, P-10) over the `jobs` collection (ch04 §4.3.1), plus
 * the boot orphan sweep and the in-process zombie net. Build and brand-research jobs persist at
 * creation and on every status change; the persisted `JobRecord` outlives the in-memory
 * `LiveRunEntry` and serves `GET /jobs/:id` after completion.
 *
 * There is still NO queue (FIXED-8): jobs run immediately in-process. What P-10 adds is
 * cross-restart crash accountability — a Cortex restart used to orphan on-disk `running` jobs
 * forever (reference/invisible-behaviors.md §7.2, Conflicts #14).
 */
import { jobs, artifacts, automationRuns } from '../data/stores.js';
import type { Doc } from '../data/store.js';

export type JobStatus = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobKind = 'build' | 'brand-research';

/** Automation-run pause states are non-terminal too (§5.2). */
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

export interface JobRecord extends Doc {
  kind: JobKind;
  status: JobStatus;
  userId: string;
  sessionId?: string;
  artifactId?: string;
  request: {
    description: string;
    language: string;
    templateId?: string;
    integrationKeys?: string[];
    attachments?: unknown[];
    fieldValues?: Record<string, unknown>;
    configValues?: Record<string, unknown>;
  };
  routing?: { tier: string; reason: string };
  result?: {
    text?: string;
    slug?: string;
    appUrl?: string;
    /** brand-research: the parsed structured result + whether it was merged onto org branding. */
    branding?: Record<string, unknown>;
    brandingApplied?: boolean;
    /** brand-research: whether the target site was reachable (false = honest knowledge fallback). */
    siteReachable?: boolean;
  };
  error?: { code: string; message: string };
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

/** Persist a job record at creation (P-10). */
export async function persistJob(record: JobRecord): Promise<void> {
  await jobs.put(record);
}

/** Patch a job's status/fields and re-persist (P-10: on every status change). */
export async function patchJob(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
  return (await jobs.update(id, (cur) => ({ ...cur, ...patch }) as JobRecord)) as JobRecord | null;
}

export async function getJob(id: string): Promise<JobRecord | null> {
  return (await jobs.get(id)) as JobRecord | null;
}

/**
 * Safe, fixed user-facing message per terminal error CODE. jobView NEVER returns the persisted
 * `error.message` on the wire: a VERIFY_FAILED message embeds the verifier's model-derived note,
 * which can contain app-data PII (a NIF/IBAN the verifier quoted). The client gets the honest
 * cause via the structured `code` + a generic PT message; the raw note stays server-side.
 */
const SAFE_ERROR_MESSAGE: Record<string, string> = {
  BUILD_UNFULFILLED: 'A construção não produziu a aplicação pedida.',
  VERIFY_FAILED: 'A verificação da aplicação falhou.',
  BILLING_BLOCKED: 'A faturação está bloqueada.',
  ADAPTER_ERROR: 'Ocorreu um erro ao contactar o modelo.',
  PIPELINE_STUCK: 'A construção terminou num estado inconsistente.',
  ORPHANED: 'A construção foi interrompida por um reinício do processo.',
};

/** Wire-facing projection (`shared/jobs.ts` Job) of a persisted record. */
export function jobView(j: JobRecord): {
  id: string;
  status: string;
  artifactId?: string;
  slug?: string;
  createdAt: string;
  error?: { code: string; message: string };
} {
  return {
    id: j._id,
    status: j.status,
    ...(j.artifactId ? { artifactId: j.artifactId } : {}),
    ...(j.result?.slug ? { slug: j.result.slug } : {}),
    createdAt: j.createdAt,
    // F7: surface the CAUSE (structured code + a safe generic message) so a failed job is not
    // cause-less — NEVER the raw persisted message, which can carry model-derived PII (Codex
    // checkpoint finding). The detailed message stays server-side on the JobRecord.
    ...(j.error ? { error: { code: j.error.code, message: SAFE_ERROR_MESSAGE[j.error.code] ?? 'A construção falhou.' } } : {}),
  };
}

/** True when a NON-terminal build/brand-research job already targets this artifact (§5.3.5 the
 *  persisted complement of the in-memory live query). */
export async function nonTerminalJobForArtifact(artifactId: string): Promise<JobRecord | null> {
  const rows = (await jobs.find({ artifactId })) as JobRecord[];
  return rows.find((j) => !TERMINAL.has(j.status)) ?? null;
}

/**
 * Boot orphan sweep (§5.2.1): every `jobs` and `automation_runs` document still non-terminal is
 * marked `failed { code: 'ORPHANED' }`, and the associated artifact (if any) is reset to
 * `draft`. Idempotent — a second call finds nothing left to sweep. Returns the counts. Called
 * once at boot by the composition root.
 */
export async function sweepOrphans(now: () => number): Promise<{ jobs: number; runs: number; artifacts: number }> {
  const endedAt = new Date(now()).toISOString();
  let sweptJobs = 0;
  let sweptRuns = 0;
  const resetArtifacts = new Set<string>();

  for (const raw of await jobs.find({})) {
    const j = raw as JobRecord;
    if (TERMINAL.has(j.status)) continue;
    await jobs.update(j._id, (cur) => ({
      ...cur,
      status: 'failed',
      error: { code: 'ORPHANED', message: 'Job orphaned by a process restart (ch05 §5.2.1).' },
      endedAt,
    }) as JobRecord);
    sweptJobs++;
    if (j.artifactId) resetArtifacts.add(j.artifactId);
  }

  for (const raw of await automationRuns.find({})) {
    const r = raw as Doc & { status?: string; artifactId?: string };
    if (r.status && TERMINAL.has(r.status)) continue;
    await automationRuns.update(r._id, (cur) => ({
      ...cur,
      status: 'failed',
      error: { code: 'ORPHANED', message: 'Automation run orphaned by a process restart (ch05 §5.2.1).' },
      endedAt,
    }));
    sweptRuns++;
    if (r.artifactId) resetArtifacts.add(r.artifactId);
  }

  let artifactsReset = 0;
  for (const artifactId of resetArtifacts) {
    const updated = await artifacts.update(artifactId, (cur) => ({ ...cur, status: 'draft' }));
    if (updated) artifactsReset++;
  }

  return { jobs: sweptJobs, runs: sweptRuns, artifacts: artifactsReset };
}

/** Reset an artifact to `draft` (zombie net + build error path). */
export async function resetArtifactToDraft(artifactId: string): Promise<void> {
  await artifacts.update(artifactId, (cur) => ({ ...cur, status: 'draft' }));
}

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}
