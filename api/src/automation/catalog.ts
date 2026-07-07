/**
 * Builds the "available capabilities" catalog injected into the planner
 * prompt and into chat / coding-agent system prompts.
 *
 * The catalog is what makes call_automation and call_integration_action
 * tools useful: agents need to know which automations and integration
 * actions exist, what they do, and what arguments they take.
 *
 * Two sections, capped at 25 entries each (per plan). When the cap is
 * exceeded, an addendum line tells the agent to use list_automations or
 * list_integration_actions for the rest. Ranking inside each section:
 * most-recently-successful first, then alphabetical.
 */

import { automationRunStore } from './persistence.js';
import { automations as automationsStore } from '../data/stores.js';
import { getCatalogSources } from './seams.js';
import type { Automation } from './types.js';

const MAX_DESCRIBED = 25;

export interface AutomationCatalogEntry {
  id: string;
  name: string;
  description: string;
  inputs: Array<{ name: string; required: boolean; description: string }>;
  lastRunAt?: string;
  lastRunSucceeded?: boolean;
  /**
   * Surfaced when the automation has a webhook/listener trigger. Agents
   * are told not to invoke triggered automations unless the user explicitly
   * asks (they run themselves), but the metadata is exposed so the chat
   * agent can answer "is this automation running on its own?"
   */
  trigger?: {
    kind: 'webhook' | 'listener';
    integrationKey: string;
    eventName: string;
  };
}

export interface IntegrationActionCatalogEntry {
  integrationKey: string;
  actionName: string;
  description: string;
  argsSummary: string;
  mutates: boolean;
}

export interface ConnectedAccountEntry {
  integrationKey: string;
  email: string;
}

export interface EkoaActionCatalogEntry {
  artifactSlug: string;
  artifactName: string;
  capabilityName: string;
  description: string;
  argsSummary: string;
  mutates: boolean;
}

export interface Catalog {
  automations: AutomationCatalogEntry[];
  integrationActions: IntegrationActionCatalogEntry[];
  connectedAccounts: ConnectedAccountEntry[];
  ekoaActions: EkoaActionCatalogEntry[];
}

// ============================================================================
// Builders
// ============================================================================

export async function buildAutomationCatalog(userId: string, superAdmin = false): Promise<Catalog> {
  const automations = await listAutomationCatalog(userId);
  const integrationActions = listIntegrationActionCatalog(userId, superAdmin);
  const connectedAccounts = await listConnectedAccounts();
  const ekoaActions = await listEkoaActionsCatalog(userId, superAdmin);
  return { automations, integrationActions, connectedAccounts, ekoaActions };
}

/**
 * Walk the user's artifact instances, load each one's MANIFEST.md if
 * present, and flatten capabilities into a single catalog. Errors load
 * are swallowed: a malformed manifest just hides that artifact's
 * capabilities (caller already wraps catalog construction in try/catch).
 */
async function listEkoaActionsCatalog(userId: string, superAdmin: boolean): Promise<EkoaActionCatalogEntry[]> {
  return getCatalogSources().listEkoaActions(userId, superAdmin);
}

function resolveListenerEventName(integrationKey: string, ownerUserId: string): string | undefined {
  const skill = getCatalogSources().getSkill(integrationKey, ownerUserId) ?? getCatalogSources().getSkill(integrationKey);
  return skill?.listenerConfig?.events?.[0]?.name;
}

async function listConnectedAccounts(): Promise<ConnectedAccountEntry[]> {
  try {
    const accounts = await getCatalogSources().getConnectedPlatformAccounts();
    return accounts.map((a) => ({ integrationKey: a.integrationKey, email: a.email }));
  } catch {
    return [];
  }
}

async function listAutomationCatalog(userId: string): Promise<AutomationCatalogEntry[]> {
  const all = (await automationsStore.find({ ownerUserId: userId })) as unknown as Automation[];
  // Visibility: an automation is visible to its owner only (no shared/public concept yet).
  const mine = all.filter((a) => a.ownerUserId === userId);

  const entries: AutomationCatalogEntry[] = [];
  for (const automation of mine) {
    const lastRun = (await automationRunStore.listForAutomation(automation.id, 1))[0];
    entries.push(toCatalogEntry(automation, lastRun?.startedAt, lastRun?.status === 'completed'));
  }
  return entries;
}

function toCatalogEntry(
  a: Automation,
  lastRunAt: string | undefined,
  lastRunSucceeded: boolean | undefined,
): AutomationCatalogEntry {
  let trigger: AutomationCatalogEntry['trigger'];
  if (a.trigger && a.trigger.kind !== 'manual') {
    if (a.trigger.kind === 'webhook') {
      trigger = { kind: 'webhook', integrationKey: a.trigger.integrationKey, eventName: a.trigger.eventName };
    } else if (a.trigger.kind === 'listener') {
      // Resolve a user-facing event name from the skill's listenerConfig.events
      // (the same labels the trigger picker shows). Falls back to the pollAction
      // when the skill omits an `events` declaration.
      const eventName = resolveListenerEventName(a.trigger.integrationKey, a.ownerUserId)
        ?? a.trigger.pollAction;
      trigger = { kind: 'listener', integrationKey: a.trigger.integrationKey, eventName };
    }
  }
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    inputs: (a.inputSchema?.fields ?? []).map((f) => ({
      name: f.name,
      required: f.required,
      description: f.description,
    })),
    lastRunAt,
    lastRunSucceeded,
    trigger,
  };
}

function listIntegrationActionCatalog(
  userId: string,
  superAdmin: boolean,
): IntegrationActionCatalogEntry[] {
  const skills = getCatalogSources().getVisibleSkills(userId, superAdmin);
  const entries: IntegrationActionCatalogEntry[] = [];
  for (const skill of skills) {
    for (const action of skill.actions ?? []) {
      entries.push({
        integrationKey: skill.integrationKey,
        actionName: action.actionName,
        description: action.description,
        argsSummary: summariseArgsSchema(action.argsSchema),
        mutates: action.mutates ?? false,
      });
    }
  }
  return entries;
}

function summariseArgsSchema(schema: Record<string, unknown> | undefined): string {
  if (!schema || typeof schema !== 'object') return '';
  const props = (schema as { properties?: Record<string, { type?: string; description?: string }> }).properties;
  if (!props) return '';
  const required = new Set(
    Array.isArray((schema as { required?: string[] }).required) ? (schema as { required?: string[] }).required! : [],
  );
  const parts: string[] = [];
  for (const [name, def] of Object.entries(props)) {
    const opt = required.has(name) ? '' : '?';
    const type = def?.type ? `:${def.type}` : '';
    parts.push(`${name}${opt}${type}`);
  }
  return parts.join(', ');
}

// ============================================================================
// Prompt formatting
// ============================================================================

/**
 * Format the catalog as a markdown block for system-prompt injection.
 * Deterministic ordering: most-recently-successful automations first,
 * then alphabetical by name. Integration actions sorted by
 * `<integrationKey>.<actionName>`.
 *
 * Caps each section at MAX_DESCRIBED. Anything beyond gets a one-line
 * "...and N more" footer pointing the agent at list_* lookup tools.
 */
export function formatCatalogForPrompt(catalog: Catalog): string {
  const lines: string[] = [];

  if (catalog.connectedAccounts.length > 0) {
    lines.push('## Connected accounts (the user is currently signed in as)');
    lines.push('');
    for (const a of catalog.connectedAccounts) {
      lines.push(`- ${a.integrationKey}: ${a.email}`);
    }
    lines.push('');
    lines.push(
      'When the goal refers to "me", "myself", "the user", "my email", "my inbox", etc., ' +
        'use the matching connected account email LITERALLY in argsTemplate / step descriptions. ' +
        'Do NOT add a recipientEmail / userEmail input field for this case.',
    );
    lines.push('');
  }

  const automations = rankAutomations(catalog.automations);
  if (automations.length > 0) {
    const total = automations.length;
    const shown = automations.slice(0, MAX_DESCRIBED);
    const truncated = total > MAX_DESCRIBED;
    const header = truncated
      ? `## Available automations (${total} total; showing top ${MAX_DESCRIBED} by recency)`
      : `## Available automations (${total})`;
    lines.push(header, '');
    for (const a of shown) {
      const inputs = a.inputs.length > 0
        ? ` — inputs: { ${a.inputs.map((f) => `${f.name}${f.required ? '' : '?'}`).join(', ')} }`
        : '';
      lines.push(`- ${a.name} (${a.id}): ${truncate(a.description, 200)}${inputs}`);
      if (a.trigger) {
        // PT-PT register. Surfaced to chat / coding agents so they know not
        // to invoke this automation directly — it runs itself when the event
        // arrives. The user-facing language stays "gatilho", never "webhook".
        lines.push(
          `  executa-se automaticamente quando ${a.trigger.eventName} chega de ${a.trigger.integrationKey}`,
        );
      }
      if (a.lastRunAt) {
        lines.push(`  [last run: ${formatRelative(a.lastRunAt)}${a.lastRunSucceeded === false ? ' — failed' : ''}]`);
      }
    }
    if (truncated) {
      lines.push(`- … and ${total - MAX_DESCRIBED} more (call list_automations to discover them by name)`);
    }
    lines.push('');
  }

  const actions = rankIntegrationActions(catalog.integrationActions);
  if (actions.length > 0) {
    const total = actions.length;
    const shown = actions.slice(0, MAX_DESCRIBED);
    const truncated = total > MAX_DESCRIBED;
    const header = truncated
      ? `## Available integration actions (${total} total; showing top ${MAX_DESCRIBED} alphabetical)`
      : `## Available integration actions (${total})`;
    lines.push(header, '');
    for (const e of shown) {
      const argsPart = e.argsSummary ? `(${e.argsSummary})` : '()';
      lines.push(`- ${e.integrationKey}.${e.actionName}${argsPart}: ${truncate(e.description, 200)}`);
    }
    if (truncated) {
      lines.push(`- … and ${total - MAX_DESCRIBED} more (call list_integration_actions to discover them by name)`);
    }
    lines.push('');
  }

  const ekoaActions = rankEkoaActions(catalog.ekoaActions ?? []);
  if (ekoaActions.length > 0) {
    const total = ekoaActions.length;
    const shown = ekoaActions.slice(0, MAX_DESCRIBED);
    const truncated = total > MAX_DESCRIBED;
    const header = truncated
      ? `## Available Ekoa actions (your apps' capabilities; ${total} total; showing top ${MAX_DESCRIBED} alphabetical)`
      : `## Available Ekoa actions (your apps' capabilities; ${total})`;
    lines.push(header, '');
    for (const e of shown) {
      const argsPart = e.argsSummary ? `(${e.argsSummary})` : '()';
      lines.push(`- ${e.artifactSlug}.${e.capabilityName}${argsPart}: ${truncate(e.description, 200)} [app: ${e.artifactName}]`);
    }
    if (truncated) {
      lines.push(`- … and ${total - MAX_DESCRIBED} more (call list_ekoa_actions to discover them by name)`);
    }
    lines.push('');
  }

  if (lines.length > 0) {
    lines.push(
      'Use the call_automation, call_integration_action, and call_ekoa_action tools to invoke these. ' +
        'Use list_automations / list_integration_actions / list_ekoa_actions to search the full catalog by name.',
    );
    const hasTriggered = automations.some((a) => a.trigger);
    if (hasTriggered) {
      lines.push(
        'Automações com gatilho executam-se sozinhas; não invoques `call_automation` sobre uma ' +
          'automação com gatilho excepto se o utilizador o pedir explicitamente.',
      );
    }
  }

  return lines.join('\n');
}

function rankEkoaActions(entries: EkoaActionCatalogEntry[]): EkoaActionCatalogEntry[] {
  return [...entries].sort((a, b) => {
    const ka = `${a.artifactSlug}.${a.capabilityName}`;
    const kb = `${b.artifactSlug}.${b.capabilityName}`;
    return ka.localeCompare(kb);
  });
}

function rankAutomations(entries: AutomationCatalogEntry[]): AutomationCatalogEntry[] {
  return [...entries].sort((a, b) => {
    const aT = a.lastRunAt ? Date.parse(a.lastRunAt) : 0;
    const bT = b.lastRunAt ? Date.parse(b.lastRunAt) : 0;
    if (aT !== bT) return bT - aT;
    return a.name.localeCompare(b.name);
  });
}

function rankIntegrationActions(entries: IntegrationActionCatalogEntry[]): IntegrationActionCatalogEntry[] {
  return [...entries].sort((a, b) => {
    const ka = `${a.integrationKey}.${a.actionName}`;
    const kb = `${b.integrationKey}.${b.actionName}`;
    return ka.localeCompare(kb);
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
