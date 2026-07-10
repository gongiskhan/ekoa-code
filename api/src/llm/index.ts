/**
 * llm/ public entry (ch02 §2.6, §2.9 rule 3). The ONLY thing outside api/src/llm/ may import.
 * This is the single egress module (FIXED-3/8/13): attribution + metering (ch06) live behind
 * this surface; nothing else imports @anthropic-ai/* or references the provider host.
 */

// Routing (deterministic tier selection — pure code, no model call).
export {
  classify,
  decideForTier,
  decideForTask,
  TIERS,
  type Tier,
  type RouterDecision,
  type ClassificationContext,
} from './router.js';

// Attribution contract + the /health metering-anomaly counter.
export {
  type LlmAttribution,
  type UserWorkAgentType,
  type ClassifierAgentType,
  meteringAnomalyCount,
} from './attribution.js';

// Chokepoint entry points + abort/transport error types.
export {
  runAgent,
  runOneShot,
  completeFast,
  proxyGatewayMessages,
  setOrgResolver,
  LlmAbortedError,
  LlmTransportError,
  LlmRateCapError,
  type AgentRunOptions,
  type AgentRunHandle,
  type AgentRunResult,
  type OneShotOptions,
  type OneShotResult,
  type MessagesOptions,
  type MessagesResult,
  type RawUsage,
} from './client.js';

// In-process MCP tool declarations (§5.4.4): agents/ declares plain specs; the chokepoint
// instantiates them on the SDK spawn (sdk-tools.ts). Only the spec type + wire-name helper
// cross the boundary — createSdkMcpServer/tool stay inside llm/.
export { mcpToolName, type SdkToolSpec } from './sdk-tools.js';

// Central credential custody: boot load, the /health claudeAuth field, admin set +
// the audit-logged HTTP provisioning path (F2).
export {
  loadCredential,
  setCredential,
  provisionCredential,
  claudeAuthStatus,
  currentMode,
  type ClaudeAuthStatus,
  type CredentialMode,
  type DecryptedCredential,
} from './credentials.js';

// The ekoa-local gateway sub-app + its /health counter.
export { registerGateway, gatewayRouter, gatewayUnmeteredCount, type GatewayDeps, type VerifyToken } from './gateway.js';

// The anonymisation ruleset seam (ch17 §17.7; F10): the composition root injects the per-org
// deny-list loader here. Only the seam crosses the boundary — pipeline internals stay inside.
export { setRulesetResolver, type RulesetResolver, type OrgRuleset } from './anonymise/index.js';

import { claudeAuthStatus, type ClaudeAuthStatus } from './credentials.js';
import { meteringAnomalyCount } from './attribution.js';
import { gatewayUnmeteredCount } from './gateway.js';

/** The LLM-chokepoint slice of `GET /health` (ch03 §3.8.23; §6.2.4, §6.3 rule 3, §6.5.4).
 *  server.ts spreads these into the health payload. */
export interface LlmHealth {
  claudeAuth: ClaudeAuthStatus;
  meteringAnomalies: number;
  gatewayUnmeteredCalls: number;
}

export function llmHealth(): LlmHealth {
  return {
    claudeAuth: claudeAuthStatus(),
    meteringAnomalies: meteringAnomalyCount(),
    gatewayUnmeteredCalls: gatewayUnmeteredCount(),
  };
}
