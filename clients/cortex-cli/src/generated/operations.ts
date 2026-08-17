/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: docs/openapi/cortex.v1.json (the public Cortex Capability API contract).
 * Regenerate: npm run generate --workspace @ekoa/cortex-cli
 * Verify:     npm run gate:client-drift (root)
 */

/** Facts about one operation that the generated TYPES cannot carry (they are values, not types). */
export interface OperationSpec {
  /** HTTP method, upper case. */
  readonly method: string;
  /** Path template with `{param}` placeholders, exactly as the spec declares it. */
  readonly path: string;
  /** `x-ekoa-domain`. */
  readonly domain: string;
  /**
   * Declared success statuses IN DECLARED ORDER (`x-ekoa-success-statuses`). The FIRST entry is the
   * primary outcome; a later one is a distinct, documented outcome carrying the SAME body schema -
   * `automations.createRun` answers 202 for a fresh run and 200 for an idempotent replay, and the
   * status is the only signal telling them apart.
   */
  readonly successStatuses: readonly number[];
  /** `x-ekoa-kind`: a `binary` response is delivered as bytes, never parsed as JSON. */
  readonly kind: 'json' | 'binary';
  /** Response media type of the primary success status. */
  readonly mediaType: string;
  /** `x-ekoa-timeout-ms` where declared, else the client default (30000 ms). */
  readonly timeoutMs: number;
}

export const OPERATIONS = {
  'automations.approvedCommands': { method: 'GET', path: '/api/v1/automations/approved-commands', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.cancelRun': { method: 'POST', path: '/api/v1/automations/runs/{id}/cancel', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.catalog': { method: 'GET', path: '/api/v1/automations/catalog', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.consent': { method: 'POST', path: '/api/v1/automations/runs/{id}/consent', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.create': { method: 'POST', path: '/api/v1/automations', domain: 'automations', successStatuses: [201], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.createRun': { method: 'POST', path: '/api/v1/automations/{id}/runs', domain: 'automations', successStatuses: [202, 200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.get': { method: 'GET', path: '/api/v1/automations/{id}', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.getRun': { method: 'GET', path: '/api/v1/automations/runs/{id}', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.getRunLogs': { method: 'GET', path: '/api/v1/automations/runs/{id}/logs', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.list': { method: 'GET', path: '/api/v1/automations', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.listRuns': { method: 'GET', path: '/api/v1/automations/runs', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.patch': { method: 'PATCH', path: '/api/v1/automations/{id}', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.plan': { method: 'POST', path: '/api/v1/automations/plan', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.remove': { method: 'DELETE', path: '/api/v1/automations/{id}', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.resumeRun': { method: 'POST', path: '/api/v1/automations/runs/{id}/resume', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.revokeApprovedCommand': { method: 'POST', path: '/api/v1/automations/approved-commands/revoke', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'automations.stepFeedback': { method: 'POST', path: '/api/v1/automations/runs/{id}/steps/{stepId}/feedback', domain: 'automations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'integrations.achieve': { method: 'POST', path: '/api/v1/integrations/{key}/achieve', domain: 'integrations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 60000 },
  'integrations.executeAction': { method: 'POST', path: '/api/v1/integrations/{key}/actions/{actionName}/execute', domain: 'integrations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 60000 },
  'integrations.getIntegration': { method: 'GET', path: '/api/v1/integrations/{key}', domain: 'integrations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'integrations.list': { method: 'GET', path: '/api/v1/integrations', domain: 'integrations', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'knowledge.listCollections': { method: 'GET', path: '/api/v1/knowledge/collections', domain: 'knowledge', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'knowledge.listDocuments': { method: 'GET', path: '/api/v1/knowledge/documents', domain: 'knowledge', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'knowledge.readKnowledgeDoc': { method: 'GET', path: '/api/v1/knowledge/documents/{collection}/{docId}', domain: 'knowledge', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'knowledge.searchKnowledge': { method: 'POST', path: '/api/v1/knowledge/search', domain: 'knowledge', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'memvault.deleteNote': { method: 'DELETE', path: '/api/v1/memvault/note', domain: 'memvault', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'memvault.exportVault': { method: 'GET', path: '/api/v1/memvault/export', domain: 'memvault', successStatuses: [200], kind: 'binary', mediaType: 'application/x-tar', timeoutMs: 30000 },
  'memvault.listNotes': { method: 'GET', path: '/api/v1/memvault/notes', domain: 'memvault', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'memvault.readNote': { method: 'GET', path: '/api/v1/memvault/note', domain: 'memvault', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'memvault.searchNotes': { method: 'POST', path: '/api/v1/memvault/search', domain: 'memvault', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'memvault.writeNote': { method: 'POST', path: '/api/v1/memvault/notes', domain: 'memvault', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.completeRun': { method: 'POST', path: '/api/v1/schedules/runs/{runId}/complete', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.create': { method: 'POST', path: '/api/v1/schedules', domain: 'schedules', successStatuses: [201], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.get': { method: 'GET', path: '/api/v1/schedules/{id}', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.list': { method: 'GET', path: '/api/v1/schedules', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.listAllRuns': { method: 'GET', path: '/api/v1/schedules/runs', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.listRuns': { method: 'GET', path: '/api/v1/schedules/{id}/runs', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.patch': { method: 'PATCH', path: '/api/v1/schedules/{id}', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.preview': { method: 'POST', path: '/api/v1/schedules/preview', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.remove': { method: 'DELETE', path: '/api/v1/schedules/{id}', domain: 'schedules', successStatuses: [200], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
  'schedules.runNow': { method: 'POST', path: '/api/v1/schedules/{id}/run-now', domain: 'schedules', successStatuses: [202], kind: 'json', mediaType: 'application/json', timeoutMs: 30000 },
} as const satisfies Record<string, OperationSpec>;

/** Every operationId in the contract: `<domain>.<endpoint>`. */
export type OperationId = keyof typeof OPERATIONS;

export const OPERATION_IDS = Object.keys(OPERATIONS) as OperationId[];
