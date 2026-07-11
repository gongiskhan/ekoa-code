/**
 * automation/ persistence adapter (ch05 §5.6.7; re-pointing rules of the G8 brief). The ported
 * engine/catalog were written against the old Cortex file-backed `automationStore` /
 * `automationRunStore`; this module re-points those exact method shapes onto the already-registered
 * `data/` stores (`automations`, `automation_runs`) so the engine port stays faithful and the
 * whole persistence surface is one mockable module in tests.
 *
 * Run ids are GLOBALLY UNIQUE (ch03 retires the old composite `(automationId, runId)` key): the
 * run store keys on `runId` alone. Run records persist at EVERY status transition (§5.6.7) — the
 * engine already calls `update` at each one. Per-step PNG screenshots (§13.4) are best-effort;
 * a write failure never fails a run (the engine's `snap` swallows it).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { automations, automationRuns } from '../data/stores.js';
import { loadAutomationConfig } from './config.js';
import type { Automation, RunRecord } from './types.js';

// --- Automations -------------------------------------------------------------

export const automationStore = {
  async findById(id: string): Promise<Automation | null> {
    const doc = await automations.get(id);
    return doc ? (doc as unknown as Automation) : null;
  },
  async update(id: string, patch: Partial<Automation>): Promise<void> {
    await automations.update(id, (cur) => ({ ...cur, ...patch }));
  },
  /** Persist a full automation (used by the plan endpoint's save side, and tests). */
  async put(automation: Automation): Promise<void> {
    await automations.put({ _id: automation.id, ...automation } as never);
  },
};

// --- Automation runs (keyed by globally-unique run id) -----------------------

export const automationRunStore = {
  async create(record: RunRecord): Promise<void> {
    await automationRuns.insert({ _id: record.id, ...record } as never);
  },
  /** Patch a run by id. `automationId` is accepted for call-site fidelity but the key is `runId`
   *  alone (ch03 globally-unique run ids). */
  async update(_automationId: string, runId: string, patch: Partial<RunRecord>): Promise<void> {
    await automationRuns.update(runId, (cur) => ({ ...cur, ...patch }));
  },
  async findById(_automationId: string, runId: string): Promise<RunRecord | null> {
    const doc = await automationRuns.get(runId);
    return doc ? (doc as unknown as RunRecord) : null;
  },
  async listForAutomation(automationId: string, limit?: number): Promise<RunRecord[]> {
    const rows = (await automationRuns.find({ automationId }, { startedAt: -1 })) as unknown as RunRecord[];
    return typeof limit === 'number' ? rows.slice(0, limit) : rows;
  },
};

// --- Per-step screenshots (§13.4) --------------------------------------------

/**
 * Persist a per-step PNG under the automation data dir and return its path relative to that dir
 * (served via /automation-screenshots, ch12). Best-effort: returns undefined and never throws on
 * a filesystem error — the caller (`snap`) already treats undefined as "no screenshot".
 */
export function writeStepScreenshot(
  automationId: string,
  runId: string,
  index: number,
  png: Buffer,
): string | undefined {
  try {
    const rel = join('automation-runs', automationId, runId, `step-${index}.png`);
    const abs = join(loadAutomationConfig().dataDir, rel);
    mkdirSync(join(loadAutomationConfig().dataDir, 'automation-runs', automationId, runId), { recursive: true });
    writeFileSync(abs, png);
    return rel;
  } catch {
    return undefined;
  }
}

/**
 * Absolute root the `/automation-screenshots` static plane serves from — `<dataDir>/automation-runs`.
 * `writeStepScreenshot` returns paths RELATIVE to `dataDir` prefixed with `automation-runs/`, so the
 * static mount roots at this directory and the URL drops the prefix (see `screenshotUrlFromPath`).
 * The single source of truth for the serving layout, so the composition root's mount and the URL
 * builder never drift.
 */
export function automationRunsRoot(): string {
  return join(loadAutomationConfig().dataDir, 'automation-runs');
}

/**
 * Map a stored step screenshot path (relative to the data dir, e.g.
 * `automation-runs/<automationId>/<runId>/step-3.png`) to the public capability URL the UI renders
 * (`/automation-screenshots/<automationId>/<runId>/step-3.png`). The unguessable automationId/runId
 * path IS the capability (ch12) — mirrors the old cortex mapping. Returns undefined for a missing
 * path so callers can spread it conditionally.
 */
export function screenshotUrlFromPath(relPath: string | undefined): string | undefined {
  if (!relPath) return undefined;
  return `/automation-screenshots/${relPath.replace(/^automation-runs\//, '')}`;
}
