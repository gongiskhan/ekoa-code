/**
 * UI action-manifest reader (operator-run C2).
 *
 * Reads the `ui_actions` section of a generated app's MANIFEST.md frontmatter
 * and validates it against the shared AppActionManifest contract. This is the
 * OPERATE half of the per-app manifest — it lives side by side with the
 * data-plane `capabilities` section that `automation/manifest-parser.ts` owns
 * (manifest-level unification, memos/registry.md). The two readers parse the
 * same file for DISJOINT sections; the shape's single source of truth for this
 * section is the shared/ zod schema, so drift is structurally impossible here.
 *
 * Agent ergonomics: `ui_actions:` may be authored either as a bare action LIST
 * (wrapped as version 1) or as the explicit `{ version: 1, actions: [...] }`
 * object. An app that declares NO ui_actions gets no operator surface (null).
 * A PRESENT-BUT-INVALID declaration is returned as a structured error — the
 * caller records it on the artifact so the failure is visible (fail-loud)
 * without failing an otherwise working build.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { AppActionManifest } from '@ekoa/shared';

export type UiActionsResult =
  | { status: 'absent' }
  | { status: 'valid'; manifest: AppActionManifest }
  | { status: 'invalid'; error: string };

/** Extract the YAML frontmatter text between the leading `---` fences.
 *  The pattern is BYTE-COMPATIBLE with automation/manifest-parser.ts
 *  extractFrontmatter (codex C2 finding: a laxer/stricter fence here would let
 *  one parser see a section the other reports absent — the drift this module's
 *  header promises cannot happen). Keep the two regexes identical. */
function frontmatterOf(text: string): string | null {
  const m = /^---\s*\n([\s\S]+?)\n---\s*(\n|$)/.exec(text);
  return m ? (m[1] ?? null) : null;
}

/** Read + validate the ui_actions section of `<projectDir>/MANIFEST.md`. */
export async function readUiActions(projectDir: string): Promise<UiActionsResult> {
  let text: string;
  try {
    text = await readFile(join(projectDir, 'MANIFEST.md'), 'utf-8');
  } catch {
    return { status: 'absent' }; // no MANIFEST.md — no operator surface
  }

  const fm = frontmatterOf(text);
  if (!fm) return { status: 'absent' };

  let parsed: unknown;
  try {
    parsed = yaml.load(fm);
  } catch (err) {
    return { status: 'invalid', error: `MANIFEST.md frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!parsed || typeof parsed !== 'object') return { status: 'absent' };

  const raw = (parsed as Record<string, unknown>).ui_actions;
  if (raw === undefined || raw === null) return { status: 'absent' };

  const candidate = Array.isArray(raw) ? { version: 1, actions: raw } : raw;
  const v = AppActionManifest.safeParse(candidate);
  if (!v.success) {
    return { status: 'invalid', error: `ui_actions failed validation: ${v.error.issues.map((i) => i.message).join('; ')}` };
  }
  return { status: 'valid', manifest: v.data };
}
