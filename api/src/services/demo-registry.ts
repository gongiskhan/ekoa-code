/**
 * Demo registry - loads and validates the Tutorial Bridge demo specs (carryover
 * services sweep; backs `/api/demos*` and the demo-bridge guided tours, whose
 * routes land in another slice).
 *
 * A demo spec is a plain-English, code-free tour of one served artifact app. The
 * host tour machine drives it; the injected bridge client executes the in-app
 * parts. This module is the single source of truth for the spec shape: the zod
 * schema documents and enforces it for the loader and tests.
 *
 * Reusable, side-effect-free content loading + validation shared by the demo HTTP
 * routes and the registry test - a Service, not handler logic.
 *
 * Ported as-is except the specs directory: the old `resolveEkoaDataPath` helper
 * (a repo-relative `ekoa-data/` content tree) is not carried; the directory is env
 * -configurable via `EKOA_DEMOS_DIR`, defaulting to `<dataDir>/demos`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

// ---- schema ----------------------------------------------------------------

const copySchema = z.strictObject({
  titlePt: z.string().min(1),
  bodyPt: z.string().min(1),
});

const optionalCopySchema = z.strictObject({
  titlePt: z.string().min(1),
  bodyPt: z.string().min(1),
});

const simulateActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('click'), target: z.string().min(1) }),
  z.strictObject({ kind: z.literal('fill'), target: z.string().min(1), value: z.string() }),
  // `select` drives a native <select> (which "fill" cannot). Pick by option
  // `value` when known, else by `index` (0-based). At least one must be present -
  // enforced in the top-level superRefine (zod 3 forbids a refined member inside a
  // discriminated union, so the "value or index" check moved to the parent).
  z.strictObject({
    kind: z.literal('select'),
    target: z.string().min(1),
    value: z.string().optional(),
    index: z.number().int().min(0).optional(),
  }),
]);

const simulateSchema = z.strictObject({
  actions: z.array(simulateActionSchema).min(1),
});

const navigateStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('navigate'),
  to: z.string().min(1),
  copy: optionalCopySchema.optional(),
});

const spotlightStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('spotlight'),
  target: z.string().min(1),
  copy: copySchema,
  timeoutMs: z.number().int().positive().optional(),
});

const awaitActionStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('await-action'),
  target: z.string().min(1),
  event: z.enum(['click', 'result-ready']),
  // MANDATORY: the harness performs these inside the iframe; live users perform
  // them themselves. A spec omitting `simulate` is rejected.
  simulate: simulateSchema,
  timeoutMs: z.number().int().positive().optional(),
});

const annotateResultStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('annotate-result'),
  target: z.string().min(1),
  copy: copySchema,
  timeoutMs: z.number().int().positive().optional(),
});

const injectPromptStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('inject-prompt'),
  surface: z.literal('chat'),
  prompt: z.string().min(1),
  // Invariant: the harness never sends (the LLM may be unavailable); it only
  // asserts the text landed in the composer.
  sendInHarness: z.literal(false).optional(),
  copy: optionalCopySchema.optional(),
});

const externalImageStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('external-image-step'),
  image: z.string().min(1),
  copy: copySchema,
});

const stepSchema = z.discriminatedUnion('type', [
  navigateStepSchema,
  spotlightStepSchema,
  awaitActionStepSchema,
  annotateResultStepSchema,
  injectPromptStepSchema,
  externalImageStepSchema,
]);

const cardSchema = z.strictObject({
  titlePt: z.string().min(1),
  descriptionPt: z.string().min(1),
  durationSec: z.number().int().positive(),
  thumbnail: z.string().min(1).optional(),
});

export const demoSpecSchema = z
  .strictObject({
    version: z.literal(1),
    appId: z.string().min(1),
    card: cardSchema,
    steps: z.array(stepSchema).min(1),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.steps.forEach((step, i) => {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate step id "${step.id}"`, path: ['steps', i, 'id'] });
      }
      seen.add(step.id);

      // Every `select` simulate action must pick by value or index (one is
      // required; both-absent is meaningless). Enforced here because the member
      // can't carry its own `.refine` inside the discriminated union (zod 3).
      if (step.type === 'await-action') {
        step.simulate.actions.forEach((a, j) => {
          if (a.kind === 'select' && a.value === undefined && a.index === undefined) {
            ctx.addIssue({
              code: 'custom',
              message: 'select action requires "value" or "index"',
              path: ['steps', i, 'simulate', 'actions', j],
            });
          }
        });
      }

      // Executability invariant: an await-action that waits for a CLICK can only
      // advance when its target is actually clicked, so the simulate the harness
      // (and, conceptually, the live user) performs MUST include a click on that
      // target. Without this a "click" await hangs until timeout.
      if (step.type === 'await-action' && step.event === 'click') {
        const clicksTarget = step.simulate.actions.some((a) => a.kind === 'click' && a.target === step.target);
        if (!clicksTarget) {
          ctx.addIssue({
            code: 'custom',
            message: `await-action "${step.id}" waits for a click on "${step.target}" but its simulate never clicks it`,
            path: ['steps', i, 'simulate'],
          });
        }
      }
    });
  });

// ---- types -----------------------------------------------------------------

export type DemoCopy = z.infer<typeof copySchema>;
export type DemoSimulateAction = z.infer<typeof simulateActionSchema>;
export type DemoStep = z.infer<typeof stepSchema>;
export type DemoCard = z.infer<typeof cardSchema>;
export type DemoSpec = z.infer<typeof demoSpecSchema>;

export interface DemoValidationResult {
  valid: boolean;
  errors: string[];
  spec?: DemoSpec;
}

// ---- validation ------------------------------------------------------------

/**
 * Validate an arbitrary parsed JSON value against the demo spec schema. Exported
 * for the registry test and used by the loader. Never throws.
 */
export function validateDemoSpec(raw: unknown): DemoValidationResult {
  const result = demoSpecSchema.safeParse(raw);
  if (result.success) return { valid: true, errors: [], spec: result.data };
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return { valid: false, errors };
}

// ---- loading ---------------------------------------------------------------

function dataDir(): string {
  const raw = process.env.EKOA_DATA_DIR || './data';
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/** Absolute path to the demo specs directory (`EKOA_DEMOS_DIR` or `<dataDir>/demos`). */
export function demosDir(): string {
  const raw = process.env.EKOA_DEMOS_DIR;
  if (raw) return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  return join(dataDir(), 'demos');
}

/** Absolute path to `<demosDir>/assets`. */
export function demoAssetsDir(): string {
  return join(demosDir(), 'assets');
}

let cache: DemoSpec[] | null = null;

/**
 * Load every valid demo spec from `<demosDir>/*.json`. Files whose name starts
 * with `_` (e.g. `_schema.json`) are skipped. Invalid specs are logged and
 * excluded rather than crashing startup. Cached after first read.
 */
export function loadDemoSpecs(force = false): DemoSpec[] {
  if (cache && !force) return cache;
  const dir = demosDir();
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  } catch {
    cache = [];
    return cache;
  }
  const specs: DemoSpec[] = [];
  for (const file of entries.sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      const { valid, errors, spec } = validateDemoSpec(raw);
      if (valid && spec) {
        specs.push(spec);
      } else {
        console.warn(`[demo-registry] invalid spec ${file}: ${errors.join('; ')}`);
      }
    } catch (err) {
      console.warn(`[demo-registry] failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  cache = specs;
  return cache;
}

/** Clear the in-memory cache (tests point `EKOA_DEMOS_DIR` at a fixture then reload). */
export function resetDemoCache(): void {
  cache = null;
}

/** Full spec for one app, or null. */
export function getDemoSpec(appId: string): DemoSpec | null {
  return loadDemoSpecs().find((s) => s.appId === appId) ?? null;
}

/** Card summaries for the landing/gallery panel: `{ appId, card }` per spec. */
export function listDemoCards(): Array<{ appId: string; card: DemoCard }> {
  return loadDemoSpecs().map((s) => ({ appId: s.appId, card: s.card }));
}
