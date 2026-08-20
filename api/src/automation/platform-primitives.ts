/**
 * Platform primitives — the stable vocabulary that Ekoa action recipes
 * are written in. The MANIFEST.md of every Ekoa-built artifact declares
 * capabilities; each capability's `recipe` is a sequence of these
 * primitives that the EkoaActionExecutor walks.
 *
 * Everything here is fully deterministic — no LLM in the loop, no
 * vision, no browser. Recipes are content; this module is the
 * interpreter.
 */

import type { EkoaActionTraceEntry } from './types.js';
import { getAppDataStore, executeIntegrationAction, callPlatformIntegration } from './seams.js';
import { interpolate } from './template-vars.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
// Cofre R-1: file.read/file.write used to honour any absolute path on the API host. They are now
// contained to a per-owner workspace by the same resolver semantics the daemon has had since
// ADR-001 (real-path checked, symlink-escape proof, write-safe for not-yet-created leaves).
import { resolveContained, PathContainmentError } from '../security/path-containment.js';
import { loadAutomationConfig } from './config.js';
import { matchesSimpleQuery, type SimpleQuery } from '../data/simple-query.js';

export type TemplateRef = string; // "{{inputs.email}}" or "{{captured.clientId}}"

/**
 * The `store.query` predicate. Its nine comparison semantics live in `data/simple-query.ts` since
 * `achieve`'s compose rung needed the SAME vocabulary over the same `app_data` rows and could not
 * import this module (tier 3 may not import tier 5) - one implementation rather than two copies
 * free to drift. What stays HERE is the recipe-only half: resolving a `{{captured.x}}` template
 * ref into `value` before the comparison runs.
 */
export type { SimpleQuery } from '../data/simple-query.js';

export interface ConditionExpr {
  left: TemplateRef;
  op: 'eq' | 'neq' | 'truthy' | 'falsy';
  right?: unknown;
}

export type ValidateRule = 'email' | 'url' | 'uuid' | 'iso_date' | 'non_empty';

export type PlatformPrimitive =
  // JSON store operations
  | { op: 'store.list';   collection: string;                                                 returnAs?: string }
  | { op: 'store.get';    collection: string; id: TemplateRef;                                returnAs?: string }
  | { op: 'store.create'; collection: string; data: Record<string, unknown>;                  returnAs?: string }
  | { op: 'store.update'; collection: string; id: TemplateRef; patch: Record<string, unknown>;returnAs?: string }
  | { op: 'store.delete'; collection: string; id: TemplateRef;                                returnAs?: string }
  | { op: 'store.query';  collection: string; where: SimpleQuery;                             returnAs?: string }

  // Integration / cross-artifact calls
  | { op: 'integration.call'; integrationKey: string; actionName: string; args: Record<string, unknown>; returnAs?: string }
  | { op: 'artifact.invoke';  artifactSlug: string;   capabilityName: string; inputs: Record<string, unknown>; returnAs?: string }

  // Pure data operations
  | { op: 'data.validate'; rule: ValidateRule; input: TemplateRef; failMessage: string }
  | { op: 'data.generate_id'; returnAs: string }
  | { op: 'data.now'; returnAs: string }
  | { op: 'data.format'; pattern: string; inputs: Record<string, TemplateRef>; returnAs: string }
  | { op: 'data.assign'; path: string; value: TemplateRef | unknown }

  // File operations
  | { op: 'file.read';  path: TemplateRef; returnAs: string }
  | { op: 'file.write'; path: TemplateRef; content: TemplateRef }

  // Flow control
  | { op: 'flow.fail'; message: string }
  | { op: 'flow.if'; condition: ConditionExpr; then: PlatformPrimitive[]; else?: PlatformPrimitive[] };

export interface EkoaActionContext {
  userId: string;
  /** The RUN's org — used to org-scope artifact resolution (ekoa_action target + artifact.invoke). */
  orgId: string;
  artifactId: string;
  /** User-supplied inputs passed when the step ran. */
  inputs: Record<string, unknown>;
  /** Values produced by earlier primitives via `returnAs`. */
  captured: Record<string, unknown>;
  /** Trace accumulator — engine reads this after execute completes. */
  trace: EkoaActionTraceEntry[];
}

export class EkoaActionFailure extends Error {
  constructor(message: string) { super(message); this.name = 'EkoaActionFailure'; }
}

/**
 * Walk a recipe top-to-bottom under the given context. Returns updated
 * context (mutated in place — trace + captured both grow as side-effect).
 * Throws EkoaActionFailure on a primitive that explicitly fails.
 */
export async function executeRecipe(recipe: PlatformPrimitive[], ctx: EkoaActionContext): Promise<void> {
  for (const primitive of recipe) {
    await executePrimitive(primitive, ctx);
  }
}

async function executePrimitive(p: PlatformPrimitive, ctx: EkoaActionContext): Promise<void> {
  const opStart = Date.now();
  try {
    switch (p.op) {
      case 'store.list': {
        const items = await getAppDataStore().list(ctx.artifactId, p.collection);
        if (p.returnAs) ctx.captured[p.returnAs] = items;
        ctx.trace.push({ op: p.op, summary: `store.list ${p.collection} → ${items.length} items`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'store.get': {
        const id = String(renderRef(p.id, ctx) ?? '');
        const item = await getAppDataStore().get(ctx.artifactId, p.collection, id);
        if (p.returnAs) ctx.captured[p.returnAs] = item;
        ctx.trace.push({ op: p.op, summary: `store.get ${p.collection}/${id} → ${item ? 'found' : 'null'}`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'store.create': {
        const data = renderObjectRefs(p.data, ctx);
        const item = await getAppDataStore().create(ctx.artifactId, p.collection, data);
        if (p.returnAs) ctx.captured[p.returnAs] = item;
        ctx.trace.push({ op: p.op, summary: `store.create ${p.collection} → ${item.id}`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'store.update': {
        const id = String(renderRef(p.id, ctx) ?? '');
        const patch = renderObjectRefs(p.patch, ctx);
        const item = await getAppDataStore().update(ctx.artifactId, p.collection, id, patch);
        if (p.returnAs) ctx.captured[p.returnAs] = item;
        ctx.trace.push({ op: p.op, summary: `store.update ${p.collection}/${id}`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'store.delete': {
        const id = String(renderRef(p.id, ctx) ?? '');
        const ok = await getAppDataStore().delete(ctx.artifactId, p.collection, id);
        if (p.returnAs) ctx.captured[p.returnAs] = ok;
        ctx.trace.push({ op: p.op, summary: `store.delete ${p.collection}/${id} → ${ok}`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'store.query': {
        const all = await getAppDataStore().list(ctx.artifactId, p.collection);
        const filtered = all.filter((item) => evalQuery(item, p.where, ctx));
        if (p.returnAs) ctx.captured[p.returnAs] = filtered;
        ctx.trace.push({ op: p.op, summary: `store.query ${p.collection} → ${filtered.length} matched`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'integration.call': {
        const args = renderObjectRefs(p.args, ctx);
        const isPlatform = p.integrationKey === 'google-workspace' || p.integrationKey === 'microsoft-365';
        let result: { success: boolean; data?: unknown; error?: string };
        if (isPlatform) {
          result = (await callPlatformIntegration(
            { integrationKey: p.integrationKey, actionName: p.actionName, args },
            { userId: ctx.userId, userRole: 'admin', userScopes: ['agent:execute'], traceId: 'ekoa-action' },
          )) as { success: boolean; data?: unknown; error?: string };
        } else {
          result = await executeIntegrationAction({
            integrationKey: p.integrationKey,
            actionName: p.actionName,
            args,
            ownerUserId: ctx.userId,
          });
        }
        if (!result.success) {
          throw new EkoaActionFailure(`integration.call ${p.integrationKey}.${p.actionName} failed: ${result.error}`);
        }
        if (p.returnAs) ctx.captured[p.returnAs] = result.data;
        ctx.trace.push({ op: p.op, summary: `integration.call ${p.integrationKey}.${p.actionName} ok`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'artifact.invoke': {
        // Defer to ekoa-action executor itself (recursive). Implemented
        // by the executor — primitive interpreter exposes a hook for it.
        const inputs = renderObjectRefs(p.inputs, ctx);
        const result = await invokeArtifactCapability(p.artifactSlug, p.capabilityName, inputs, ctx.userId, ctx.orgId);
        if (p.returnAs) ctx.captured[p.returnAs] = result;
        ctx.trace.push({ op: p.op, summary: `artifact.invoke ${p.artifactSlug}.${p.capabilityName} ok`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'data.validate': {
        const value = renderRef(p.input, ctx);
        const ok = validateRule(p.rule, value);
        if (!ok) throw new EkoaActionFailure(p.failMessage);
        ctx.trace.push({ op: p.op, summary: `data.validate ${p.rule} ok`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'data.generate_id': {
        const id = randomUUID();
        ctx.captured[p.returnAs] = id;
        ctx.trace.push({ op: p.op, summary: `data.generate_id → ${id}`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'data.now': {
        const now = new Date().toISOString();
        ctx.captured[p.returnAs] = now;
        ctx.trace.push({ op: p.op, summary: `data.now → ${now}`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'data.format': {
        let output = p.pattern;
        for (const [name, ref] of Object.entries(p.inputs)) {
          output = output.replace(new RegExp(`\\{${name}\\}`, 'g'), String(renderRef(ref, ctx) ?? ''));
        }
        ctx.captured[p.returnAs] = output;
        ctx.trace.push({ op: p.op, summary: `data.format → "${output.slice(0, 80)}"`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'data.assign': {
        const value = typeof p.value === 'string' && p.value.includes('{{')
          ? renderRef(p.value as TemplateRef, ctx)
          : p.value;
        ctx.captured[p.path] = value;
        ctx.trace.push({ op: p.op, summary: `data.assign ${p.path}`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'file.read': {
        const path = resolveUserPath(renderRef(p.path, ctx) as string, ctx.orgId, ctx.userId);
        const content = readFileSync(path, 'utf8');
        ctx.captured[p.returnAs] = content;
        ctx.trace.push({ op: p.op, summary: `file.read ${path} → ${content.length} bytes`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'file.write': {
        const path = resolveUserPath(renderRef(p.path, ctx) as string, ctx.orgId, ctx.userId);
        const content = renderRef(p.content, ctx) as string;
        if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf8');
        ctx.trace.push({ op: p.op, summary: `file.write ${path} ← ${content.length} bytes`, durationMs: Date.now() - opStart, status: 'ok' });
        return;
      }
      case 'flow.fail': {
        const msg = interpolate(p.message, ctx.inputs, ctx.captured as Record<string, string>);
        throw new EkoaActionFailure(msg);
      }
      case 'flow.if': {
        const condResult = evalCondition(p.condition, ctx);
        const branch = condResult ? p.then : (p.else ?? []);
        ctx.trace.push({ op: p.op, summary: `flow.if → ${condResult ? 'then' : 'else'}`, durationMs: Date.now() - opStart, status: 'ok' });
        await executeRecipe(branch, ctx);
        return;
      }
      default: {
        const exhaustive: never = p;
        throw new EkoaActionFailure(`unknown primitive: ${JSON.stringify(exhaustive)}`);
      }
    }
  } catch (err) {
    if (err instanceof EkoaActionFailure) {
      ctx.trace.push({ op: p.op, summary: err.message, durationMs: Date.now() - opStart, status: 'failed', error: err.message });
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    ctx.trace.push({ op: p.op, summary: message, durationMs: Date.now() - opStart, status: 'failed', error: message });
    throw new EkoaActionFailure(`${p.op} failed: ${message}`);
  }
}

function renderRef(ref: TemplateRef, ctx: EkoaActionContext): unknown {
  // Direct path lookups in captured/inputs without going through interpolate
  // when the ref is exactly "{{captured.foo}}" or "{{inputs.foo}}". Returns
  // the raw value (preserving object/array shapes). Otherwise string-interpolate.
  const trimmed = ref.trim();
  const direct = /^\{\{\s*(captured|inputs)\.([a-zA-Z0-9_]+)\s*\}\}$/.exec(trimmed);
  if (direct) {
    const [, source, name] = direct;
    // CREDENTIAL BOUNDARY: never resolve the run's decrypted credentials through a direct ref
    // (which skips string redaction). Defense-in-depth — ekoa-action.ts already scrubs them from
    // ctx.inputs before the recipe runs.
    if (source === 'inputs' && name === 'credentials') return undefined;
    return source === 'captured' ? ctx.captured[name!] : ctx.inputs[name!];
  }
  // For interpolation we feed BOTH inputs and captured into a single namespace
  // and lean on the existing interpolate() helper which is happy to do string substitution.
  return interpolate(
    ref,
    ctx.inputs,
    Object.fromEntries(Object.entries(ctx.captured).map(([k, v]) => [k, v == null ? '' : String(v)])),
  );
}

function renderObjectRefs(obj: Record<string, unknown>, ctx: EkoaActionContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.includes('{{')) {
      out[k] = renderRef(v, ctx);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = renderObjectRefs(v as Record<string, unknown>, ctx);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** The recipe-only half: resolve a `{{captured.x}}` ref into the compared value, then apply the
 *  ONE predicate (`data/simple-query.ts`). The comparison semantics are not restated here. */
function evalQuery(item: Record<string, unknown>, q: SimpleQuery, ctx: EkoaActionContext): boolean {
  const value = typeof q.value === 'string' && q.value.includes('{{') ? renderRef(q.value, ctx) : q.value;
  return matchesSimpleQuery(item, { field: q.field, op: q.op, value });
}

function evalCondition(c: ConditionExpr, ctx: EkoaActionContext): boolean {
  const left = renderRef(c.left, ctx);
  switch (c.op) {
    case 'eq':  return left === c.right;
    case 'neq': return left !== c.right;
    case 'truthy': return Boolean(left);
    case 'falsy':  return !left;
  }
}

function validateRule(rule: ValidateRule, value: unknown): boolean {
  if (value == null) return rule === 'non_empty' ? false : false;
  const s = String(value);
  switch (rule) {
    case 'email':     return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    case 'url':       try { new URL(s); return true; } catch { return false; }
    case 'uuid':      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    case 'iso_date':  return !Number.isNaN(Date.parse(s));
    case 'non_empty': return s.length > 0;
  }
}

/**
 * The per-owner action workspace: `<dataDir>/action-workspace/<orgId>/<userId>`. Created on demand
 * so the containment resolver always has a real directory to realpath.
 *
 * This replaces a `homedir()`-rooted resolver that honoured absolute paths verbatim — i.e. gave a
 * MODEL-authored recipe unrestricted read/write over the API host (Cofre R-1, invariants I5/I1/I2/
 * I4). Recipes never legitimately needed the host's home directory; they need a scratch space.
 */
function actionWorkspaceRoot(orgId: string, userId: string): string {
  const root = join(loadAutomationConfig().dataDir, 'action-workspace', safeSegment(orgId), safeSegment(userId));
  mkdirSync(root, { recursive: true });
  return root;
}

/** An id is an opaque token from our own store, but it forms a path segment here — refuse anything
 *  that could climb out of the workspace even before containment runs. */
function safeSegment(id: string): string {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('\0') || id === '.' || id === '..') {
    throw new EkoaActionFailure(`unsafe identifier for a workspace path: ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * Resolve a recipe-supplied path inside the caller's workspace. `~` is no longer the host's home
 * directory: it means the workspace root, so an existing recipe written as `~/notes.json` keeps
 * working while `~/.ssh/id_rsa` resolves inside the workspace and is then refused by the denylist.
 */
function resolveUserPath(path: string, orgId: string, userId: string): string {
  const root = actionWorkspaceRoot(orgId, userId);
  const requested = path === '~' ? '.' : path.startsWith('~/') ? path.slice(2) : path;
  try {
    return resolveContained(root, requested).real;
  } catch (err) {
    if (err instanceof PathContainmentError) throw new EkoaActionFailure(err.reason);
    throw err;
  }
}

// Pluggable hook so the executor can wire artifact.invoke without a
// circular import.
type InvokeArtifactCapability = (slug: string, name: string, inputs: Record<string, unknown>, userId: string, orgId: string) => Promise<unknown>;
let invokeArtifactCapability: InvokeArtifactCapability = async () => {
  throw new EkoaActionFailure('artifact.invoke not wired (executor must register a hook)');
};
export function setInvokeArtifactCapability(fn: InvokeArtifactCapability): void {
  invokeArtifactCapability = fn;
}
