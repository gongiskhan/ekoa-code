/**
 * Build-time tour writer (operator-run E1).
 *
 * A generated app DECLARES its guided tours the same way it declares its UI
 * actions (action-manifest.ts, C2): an overview tour plus one tour per main
 * journey, authored by the build agent (which is already an LLM) and captured
 * DETERMINISTICALLY here at activation - there is NO model call in this module.
 * The two authoring channels the agent may use:
 *
 *   1. a `tours:` list in the app's `MANIFEST.md` frontmatter (mirrors `ui_actions`);
 *   2. sibling `tours/<name>.json` files under the project dir (one tour each) -
 *      identical in shape to the shipped platform demos (api/assets/demos/*.json),
 *      which the agent can read as templates.
 *
 * Each authored tour omits `appId` (the agent cannot know the artifact id it is
 * assigned at build); the writer STAMPS `appId` = the artifact id and validates
 * the result against the demo-spec schema EXTENDED with the optional `tourId`/`kind`
 * fields (demo-registry.ts). The stored, served spec is therefore byte-identical in
 * shape to a hand-authored platform tour - one validator, no drift.
 *
 * Selectors are `data-demo-target` names - the SAME namespace as the action
 * registry's `target` field (shared/action-manifest), which is what keeps tour
 * highlights pointing at the right element across rebuilds. Targets are
 * CROSS-VALIDATED against the app's declared UI-action targets and the shell
 * landmarks; an unknown target only WARNS (the app may add its own targets the
 * registry does not know) - it never fails the capture.
 *
 * Fail-loud like the UI-action reader: an app with no tours gets none (absent);
 * a PRESENT-BUT-INVALID tour set is returned as a structured error the caller
 * records on the artifact (`artifact.data.toursError`) so the failure is visible
 * without failing an otherwise working build.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { demoSpecSchema, TOUR_ID_RE, type DemoSpec } from '../services/demo-registry.js';

/** Shell landmarks every app base ships with a stable `data-demo-target` (base
 *  scaffold App.jsx + base-conventions.md). Always known, so target
 *  cross-validation has a baseline even for an app that declares no ui_actions. */
export const SHELL_LANDMARKS = [
  'app-shell',
  'app-topbar',
  'app-nav',
  'app-content',
  'assistant-root',
  'home-empty',
] as const;

export type ToursResult =
  | { status: 'absent' }
  | { status: 'valid'; tours: DemoSpec[]; warnings: string[] }
  | { status: 'invalid'; error: string };

export interface ReadToursOptions {
  /** The artifact id assigned at build; stamped as each tour's `appId`. */
  appId: string;
  /** The app's declared UI-action targets (data-demo-target names). Merged with
   *  the shell landmarks to form the known-target set for cross-validation. */
  knownTargets?: Iterable<string>;
}

/** Extract the YAML frontmatter text between the leading `---` fences.
 *  BYTE-COMPATIBLE with automation/manifest-parser.ts and action-manifest.ts
 *  extractFrontmatter (codex C2 finding: a laxer/stricter fence here would let one
 *  reader see a section another reports absent). Keep the three regexes identical. */
function frontmatterOf(text: string): string | null {
  const m = /^---\s*\n([\s\S]+?)\n---\s*(\n|$)/.exec(text);
  return m ? (m[1] ?? null) : null;
}

/** Every `data-demo-target` name a step drives (own target + simulate targets). */
function stepTargets(step: DemoSpec['steps'][number]): string[] {
  const out: string[] = [];
  if ('target' in step && typeof step.target === 'string') out.push(step.target);
  if (step.type === 'await-action') {
    for (const a of step.simulate.actions) out.push(a.target);
  }
  return out;
}

/** Read the `tours:` list from `<projectDir>/MANIFEST.md` frontmatter. Returns
 *  null on any structural problem the frontmatter reader can distinguish from
 *  "no tours" (invalid YAML), so the caller can surface it fail-loud. */
async function toursFromManifest(projectDir: string): Promise<{ tours: unknown[]; invalidReason?: string }> {
  let text: string;
  try {
    text = await readFile(join(projectDir, 'MANIFEST.md'), 'utf-8');
  } catch {
    return { tours: [] }; // no MANIFEST.md
  }
  const fm = frontmatterOf(text);
  if (!fm) return { tours: [] };
  let parsed: unknown;
  try {
    parsed = yaml.load(fm);
  } catch (err) {
    return { tours: [], invalidReason: `MANIFEST.md frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!parsed || typeof parsed !== 'object') return { tours: [] };
  const raw = (parsed as Record<string, unknown>).tours;
  if (raw === undefined || raw === null) return { tours: [] };
  if (!Array.isArray(raw)) return { tours: [], invalidReason: 'MANIFEST.md `tours` must be a list of tour objects' };
  return { tours: raw };
}

/** Read sibling `<projectDir>/tours/*.json` files (one authored tour each). */
async function toursFromFiles(projectDir: string): Promise<{ tours: unknown[]; invalidReason?: string }> {
  const dir = join(projectDir, 'tours');
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  } catch {
    return { tours: [] }; // no tours/ dir
  }
  const tours: unknown[] = [];
  for (const file of entries) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, file), 'utf-8'));
    } catch (err) {
      return { tours: [], invalidReason: `tours/${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    tours.push(raw);
  }
  return { tours };
}

/**
 * Read + validate the guided tours declared by a generated app. See the module
 * header for the contract. Never throws.
 */
export async function readTours(projectDir: string, opts: ReadToursOptions): Promise<ToursResult> {
  const fromManifest = await toursFromManifest(projectDir);
  if (fromManifest.invalidReason) return { status: 'invalid', error: fromManifest.invalidReason };
  const fromFiles = await toursFromFiles(projectDir);
  if (fromFiles.invalidReason) return { status: 'invalid', error: fromFiles.invalidReason };

  const authored = [...fromManifest.tours, ...fromFiles.tours];
  if (authored.length === 0) return { status: 'absent' };

  const known = new Set<string>([...SHELL_LANDMARKS, ...(opts.knownTargets ?? [])]);
  const specs: DemoSpec[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenTourIds = new Set<string>();

  authored.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`tour #${i + 1} must be an object`);
      return;
    }
    const obj = entry as Record<string, unknown>;
    const tourId = obj.tourId;
    // Generated tours MUST be identifiable within their app (the platform's
    // single-tour specs may omit tourId; a per-app SET cannot). Enforced here
    // rather than on the schema so the 28 legacy specs stay valid.
    if (typeof tourId !== 'string' || !TOUR_ID_RE.test(tourId)) {
      errors.push(`tour #${i + 1} needs a kebab-case "tourId" (got ${JSON.stringify(tourId)})`);
      return;
    }
    if (seenTourIds.has(tourId)) {
      errors.push(`duplicate tourId "${tourId}"`);
      return;
    }
    seenTourIds.add(tourId);
    if (obj.kind !== 'overview' && obj.kind !== 'journey') {
      errors.push(`tour "${tourId}" needs kind "overview" or "journey" (got ${JSON.stringify(obj.kind)})`);
      return;
    }
    // Stamp appId + default version 1 (agent authors neither). A leading
    // `version: 1` is overridable by an explicit authored version so a wrong
    // version still fails the schema loud rather than being silently corrected.
    const candidate = { version: 1, ...obj, appId: opts.appId };
    const r = demoSpecSchema.safeParse(candidate);
    if (!r.success) {
      const detail = r.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
      errors.push(`tour "${tourId}" failed validation: ${detail}`);
      return;
    }
    specs.push(r.data);
  });

  if (errors.length > 0) return { status: 'invalid', error: errors.join('; ') };

  // Target cross-validation (warn-not-fail) + the overview convention.
  for (const spec of specs) {
    for (const step of spec.steps) {
      for (const t of stepTargets(step)) {
        if (!known.has(t)) {
          warnings.push(`tour "${spec.tourId}" step "${step.id}" targets "${t}", not a declared ui_action target or shell landmark`);
        }
      }
    }
  }
  const overviews = specs.filter((s) => s.kind === 'overview').length;
  if (overviews !== 1) {
    warnings.push(`expected exactly one overview tour, found ${overviews}`);
  }

  return { status: 'valid', tours: specs, warnings };
}
