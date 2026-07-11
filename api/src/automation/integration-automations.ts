/**
 * Integration-managed automations (the provisioner the `Automation.source` field anticipates).
 *
 * An integration package may bind actions to automation TEMPLATES (repo-authored JSON under the
 * package's `automations/` dir: name, description, inputSchema, engine-native steps). This module
 * materializes those templates as REAL automations with a DETERMINISTIC id
 * (`<integrationKey>-<templateKey>`) so re-provisioning UPDATES instead of duplicating, and
 * projects the per-action status rows the dashboard's session panel renders
 * (shared SessionCaptureStatus.actions).
 *
 * automation/ may not import integrations/ (sibling modules): the caller (routes) resolves the
 * definition + template payloads and passes them in.
 */
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

export function managedAutomationId(integrationKey: string, templateKey: string): string {
  return `${integrationKey}-${templateKey}`;
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
    if (!b.template) continue;
    const id = managedAutomationId(integrationKey, b.templateKey);
    const current = existing.get(b.templateKey);
    if (current) {
      await automations.update(current.id, (cur) => ({
        ...cur,
        name: b.template!.name,
        description: b.template!.description ?? '',
        steps: templateSteps(b.template!),
        ...(b.template!.inputSchema ? { inputSchema: b.template!.inputSchema } : {}),
        updatedAt: now,
      }) as never);
      updated++;
    } else {
      const doc: StoredAutomation = {
        id,
        name: b.template.name,
        description: b.template.description ?? '',
        steps: templateSteps(b.template),
        ...(b.template.inputSchema ? { inputSchema: b.template.inputSchema } : {}),
        ownerUserId: actor.userId,
        orgId: actor.orgId,
        visibility: 'org',
        source: { integrationKey, templateKey: b.templateKey },
        createdAt: now,
        updatedAt: now,
      };
      await automations.insert({ _id: id, ...doc } as never);
      created++;
    }
  }

  return { created, updated, rows: await sessionActionRows(actor, integrationKey, bindings) };
}
