/**
 * Assistant tool definitions from an app's UI action manifest (operator-run C4).
 *
 * The served-app assistant (D1) receives the artifact's declared `ui_actions`
 * (captured by C2 at activation) as a set of typed TOOL DEFINITIONS — one tool
 * per action, its JSON-schema input derived from the action's params. When the
 * assistant calls a tool, the server does NOT execute anything itself: it emits
 * a client-bound instruction the in-page action runtime (C3) dispatches through
 * the app's own state layer, and it writes ONE audit row per executed action
 * through the single audit path (data/ logActivity). No permission logic here
 * (the security block gates capability later; sequencing rule) — a destructive
 * action's `destructive` flag travels to the client, which confirms before it
 * dispatches (C3). This module is a pure mapper + the audit helper; it never
 * touches the DOM and never calls the model.
 */
import type { AppAction, AppActionManifest, AppActionParam } from '@ekoa/shared';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';

/** A provider-neutral tool definition: name + description + JSON-schema input.
 *  D1 adapts these to the SDK tool shape at mount time. */
export interface AssistantToolDef {
  name: string;
  description: string;
  destructive: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  /** The source action — D1 forwards this verbatim to the client runtime. */
  action: AppAction;
}

const JSON_TYPE: Record<AppActionParam['type'], string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  option: 'string',
};

/** Tool name for an action: the kebab id, namespaced so it never collides with
 *  the assistant's other tools (knowledge/tour/etc.). */
export function toolNameForAction(action: AppAction): string {
  return `app_action__${action.id.replace(/-/g, '_')}`;
}

function inputSchemaFor(action: AppAction): AssistantToolDef['inputSchema'] {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of action.params) {
    const prop: Record<string, unknown> = { type: JSON_TYPE[p.type] };
    if (p.type === 'option' && p.options) prop.enum = p.options;
    if (p.labelPt) prop.description = p.labelPt;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Map a validated action manifest to assistant tool definitions. Absent/empty
 *  manifest → no tools (the assistant simply has no operate surface). */
export function assistantToolsFromManifest(manifest: AppActionManifest | null | undefined): AssistantToolDef[] {
  if (!manifest) return [];
  return manifest.actions.map((action) => ({
    name: toolNameForAction(action),
    description: action.description,
    destructive: action.destructive,
    inputSchema: inputSchemaFor(action),
    action,
  }));
}

/**
 * Audit one assistant-driven action execution through the single audit path.
 * Metadata is IDS + the typed action shape only — never free prompt text (the
 * F3 metadata-only discipline auditBuild follows). Best-effort: bookkeeping
 * never fails the assistant turn.
 */
export function auditAssistantAction(
  actor: ActivityActor,
  input: {
    artifactId: string;
    actionId: string;
    kind: AppAction['kind'];
    destructive: boolean;
    confirmed: boolean;
    outcome: 'dispatched' | 'confirm-pending' | 'cancelled' | 'failed';
    runId?: string;
  },
  deps: LogActivityDeps,
): void {
  void logActivity(actor, 'app-assistant', `action.${input.outcome}`, deps, {
    artifactId: input.artifactId,
    actionId: input.actionId,
    kind: input.kind,
    destructive: input.destructive,
    confirmed: input.confirmed,
    ...(input.runId ? { runId: input.runId } : {}),
  }).catch(() => undefined);
}
