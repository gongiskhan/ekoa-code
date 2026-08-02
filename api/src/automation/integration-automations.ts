/**
 * Integration-managed automations (the provisioner the `Automation.source` field anticipates).
 *
 * An integration package may bind actions to automation TEMPLATES (repo-authored JSON under the
 * package's `automations/` dir: name, description, inputSchema, engine-native steps). This module
 * materializes those templates as REAL automations with a DETERMINISTIC id (`managedAutomationId`)
 * so re-provisioning UPDATES instead of duplicating, and projects the per-action status rows the
 * dashboard's session panel renders (shared SessionCaptureStatus.actions).
 *
 * TENANCY (C1, finding `integration-provision-id-not-org-scoped`). The deterministic id used to be
 * `<integrationKey>-<templateKey>` with NO org component, and `Store.insert`'s duplicate-`_id`
 * refusal (data/store.ts — returns false) went unchecked. The first org to provision a template
 * therefore OWNED that id, and every other org provisioning the same shipped package silently got
 * nothing: no row, no error, `created` counted anyway. The id is now hashed over
 * (orgId, integrationKey, templateKey) so each tenant materializes its own copy, and a refused
 * insert falls through to the update-in-place path instead of being swallowed.
 *
 * automation/ may not import integrations/ (sibling modules): the caller (routes) resolves the
 * definition + template payloads and passes them in.
 */
import { createHash } from 'node:crypto';
import { automations } from '../data/stores.js';
import type { Actor } from '@ekoa/shared';
import type { Automation, AutomationInputField, Step, StepType } from './types.js';

/** Engine step-type whitelist (mirror of the planner's closed vocabulary). */
const STEP_TYPES: ReadonlySet<string> = new Set([
  'browser', 'verify', 'integration', 'sub_automation', 'navigate', 'wait',
  'local_command', 'api_call', 'ekoa_action',
]);

/** A template payload as read from `<package>/automations/<templateKey>.json`. */
export interface IntegrationAutomationTemplate {
  templateKey: string;
  name: string;
  description?: string;
  inputSchema?: { fields: AutomationInputField[] };
  steps: Array<Record<string, unknown>>;
}

/** One automation-bound action, joined by the caller with its template payload. */
export interface ProvisionBinding {
  actionName: string;
  description: string;
  mutates: boolean;
  templateKey: string;
  /** null when the package declares a binding but ships no template file (counted, not fatal). */
  template: IntegrationAutomationTemplate | null;
}

/** The wire row of SessionCaptureStatus.actions (shared/src/integrations.ts SessionActionRow). */
export interface SessionActionRow {
  actionName: string;
  description: string;
  mutates: boolean;
  automationTemplate: string | null;
  automationId: string | null;
  automationName: string | null;
  provisioned: boolean;
}

/**
 * The deterministic `_id` of an org's managed automation for one package template.
 *
 * ORG-SCOPED: two tenants provisioning the same shipped template land on different ids, so each
 * gets its own row (see the module header). Hashed over the JSON-ENCODED tuple rather than joined
 * with a separator, the house discipline of `definitionIdFor` (integrations/definition-store.ts)
 * and `runDedupeId` (automation/service.ts): JSON.stringify escapes quotes and backslashes, so the
 * encoding is injective for ANY three strings — a `-`-join is only injective while no component
 * can contain a `-`, which is false for both an integrationKey and a templateKey.
 */
export function managedAutomationId(orgId: string, integrationKey: string, templateKey: string): string {
  return createHash('sha256').update(JSON.stringify([orgId, integrationKey, templateKey])).digest('hex');
}

/** A managed-automation id is held by a row this org may not write. Loud by design: the previous
 *  behaviour was to swallow the refusal and report a provision that never happened. */
export class ManagedAutomationProvisionError extends Error {
  constructor(readonly automationId: string, message: string) {
    super(message);
    this.name = 'ManagedAutomationProvisionError';
  }
}

type StoredAutomation = Automation & { orgId: string; visibility?: 'private' | 'org' };

/** The org's existing managed automations for one integration, keyed by templateKey. */
async function managedByTemplate(actor: Actor, integrationKey: string): Promise<Map<string, StoredAutomation>> {
  const rows = (await automations.find({ orgId: actor.orgId, 'source.integrationKey': integrationKey })) as unknown as StoredAutomation[];
  const map = new Map<string, StoredAutomation>();
  for (const r of rows) if (r.source?.templateKey) map.set(r.source.templateKey, r);
  return map;
}

/** Map a template's engine-native steps defensively (repo-authored, but never trust a type blindly). */
function templateSteps(t: IntegrationAutomationTemplate): Step[] {
  return (t.steps ?? []).map((s, i) => {
    const type = (typeof s.type === 'string' && STEP_TYPES.has(s.type) ? s.type : 'browser') as StepType;
    return {
      ...s,
      id: typeof s.id === 'string' && s.id ? s.id : `step-${i + 1}`,
      description: typeof s.description === 'string' ? s.description : '',
      type,
    } as unknown as Step;
  });
}

/** Project the session panel's per-action rows from the bindings + the org's managed automations. */
export async function sessionActionRows(actor: Actor, integrationKey: string, bindings: ProvisionBinding[]): Promise<SessionActionRow[]> {
  const existing = await managedByTemplate(actor, integrationKey);
  return bindings.map((b) => {
    const auto = existing.get(b.templateKey);
    return {
      actionName: b.actionName,
      description: b.description,
      mutates: b.mutates,
      automationTemplate: b.templateKey,
      automationId: auto?.id ?? null,
      automationName: auto?.name ?? b.template?.name ?? null,
      provisioned: Boolean(auto),
    };
  });
}

/**
 * Materialize (idempotently) the bound templates as org-visible automations. An existing managed
 * automation is UPDATED in place (name/description/inputSchema/steps refresh from the template —
 * the template is the source of truth for managed automations); a missing one is created under
 * its deterministic id. Bindings without a template payload are skipped (counted by the caller
 * via the returned rows: they stay `provisioned: false`).
 *
 * COMPAT with pre-C1 rows. The existing-row lookup joins on (orgId, `source.integrationKey`,
 * `source.templateKey`) — NOT on the id — so a row provisioned under the OLD
 * `<integrationKey>-<templateKey>` id is still found for its own org and refreshed IN PLACE, under
 * its original id. Nothing is renumbered: an id is a live reference (triggers, run history, the
 * dashboard backlink), so old rows keep theirs and only NEW rows are minted org-scoped. The old id
 * was globally unique per (integrationKey, templateKey), so at most one org can be holding one.
 */
export async function provisionIntegrationAutomations(
  actor: Actor,
  integrationKey: string,
  bindings: ProvisionBinding[],
): Promise<{ created: number; updated: number; rows: SessionActionRow[] }> {
  const existing = await managedByTemplate(actor, integrationKey);
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;

  for (const b of bindings) {
    const template = b.template;
    if (!template) continue;
    const id = managedAutomationId(actor.orgId, integrationKey, b.templateKey);
    /** Refresh a stored row from the template (the source of truth), re-stamping its provenance. */
    const refresh = (cur: StoredAutomation): StoredAutomation => ({
      ...cur,
      name: template.name,
      description: template.description ?? '',
      steps: templateSteps(template),
      ...(template.inputSchema ? { inputSchema: template.inputSchema } : {}),
      source: { integrationKey, templateKey: b.templateKey },
      updatedAt: now,
    });

    const current = existing.get(b.templateKey);
    if (current) {
      // Found by provenance, so this covers a legacy row under the OLD id just as well as a
      // current one — `current.id` is whatever that row was minted with.
      await automations.update(current.id, refresh as never);
      updated++;
      continue;
    }

    const doc: StoredAutomation = {
      id,
      name: template.name,
      description: template.description ?? '',
      steps: templateSteps(template),
      ...(template.inputSchema ? { inputSchema: template.inputSchema } : {}),
      ownerUserId: actor.userId,
      orgId: actor.orgId,
      visibility: 'org',
      source: { integrationKey, templateKey: b.templateKey },
      createdAt: now,
      updatedAt: now,
    };
    if (await automations.insert({ _id: id, ...doc } as never)) {
      created++;
      continue;
    }

    // The id is TAKEN while the provenance lookup saw nothing — a row whose `source` stamp was
    // lost, or a concurrent provision of the same template that won the race. NEVER a silent
    // no-op (that swallowed refusal is the bug this slice closes): fall through to update-in-place.
    const clash = (await automations.get(id)) as StoredAutomation | null;
    if (!clash) {
      // Deleted between the refused insert and this read; the id is free again.
      await automations.put({ _id: id, ...doc } as never);
      created++;
      continue;
    }
    if (clash.orgId !== actor.orgId) {
      // Unreachable by construction (the id hashes the orgId in) — so if it ever happens the id
      // derivation is broken, and writing would corrupt another tenant's automation. Fail loudly.
      throw new ManagedAutomationProvisionError(
        id,
        `managed automation id for ${integrationKey}/${b.templateKey} is held by another org — refusing to overwrite`,
      );
    }
    await automations.update(id, refresh as never);
    updated++;
  }

  return { created, updated, rows: await sessionActionRows(actor, integrationKey, bindings) };
}
