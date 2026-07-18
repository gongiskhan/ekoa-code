/**
 * llm/attribution.ts — the compile-time-required attribution contract (ch06 §6.3) and the
 * agent-type tag vocabularies (ch06 §6.4), plus the runtime assertion that fires on any
 * `platform`-attributed call (zero legitimate call sites at launch).
 *
 * Attribution is a required positional parameter on every chokepoint entry (llm/client.ts):
 * there is no overload without it and no default value, so an unbilled model call is
 * inexpressible. The `agentType` vocabularies below are the billing-breakdown reporting
 * contract (`GET /billing/breakdown` groups ledger events by `agentType`, §6.3 rule 4) —
 * they are carried verbatim from the normative map and must not be renamed without a
 * ledger migration.
 */

/** user_work agent tags — the 14 carried sites (§6.4.1) plus the two Amendment 2 additions
 *  (`memory-extract` A1, `build-verify` A2). `artifact-backend:<entrypoint>` is a family: an
 *  artifact backend's model capability, tagged with its entrypoint, billed to the artifact
 *  owner (site 14). */
export type UserWorkAgentType =
  | 'chat'
  | 'build'
  | 'assistant-chat'
  | 'integration-builder'
  | 'brand-research'
  | 'agent-face'
  | 'pi-fast-loop'
  | 'gateway-client'
  | 'automation-plan'
  | 'automation-rehearse'
  | 'vision-resolve'
  | 'vision-verify'
  | 'answer-about-build'
  | 'answer-about-ekoa'
  | 'memory-extract'
  | 'build-verify'
  | `artifact-backend:${string}`;

/** classifier agent tags — the 6 sites (§6.4.2), each FAST with a deterministic fallback. */
export type ClassifierAgentType =
  | 'detect-build-intent'
  | 'detect-integration-needs'
  | 'select-base-template'
  | 'classify-in-build-intent'
  | 'classify-tui-turn'
  | 'vision-classify-human-action';

/**
 * The attribution union, exactly as speced (§6.3):
 *   - `user_work` REQUIRES `billeeUserId` (who pays); artifact-mediated calls bill the
 *     artifact owner and stamp `artifactId`.
 *   - `classifier` bills the requesting user at FAST weight.
 *   - `platform` has ZERO legitimate runtime call sites at launch; the member exists so
 *     design-time tooling and any future addition must still declare itself with a prose
 *     `justification`. Every platform call is asserted at runtime (below).
 */
export type LlmAttribution =
  | {
      kind: 'user_work';
      agentType: UserWorkAgentType;
      billeeUserId: string;
      artifactId?: string;
      sessionId?: string;
      runId?: string;
    }
  | {
      kind: 'classifier';
      agentType: ClassifierAgentType;
      billeeUserId: string;
    }
  | {
      kind: 'platform';
      agentType: string;
      justification: string;
    };

// --- Runtime platform-call alarm + /health metering-anomaly counter (§6.3 rule 3) --------

let meteringAnomalies = 0;

/** The metering-anomaly count surfaced on `GET /health` (§6.3 rule 3, §6.10 rule 4). A
 *  platform-attributed call appearing in production telemetry is a defect, not a cost line;
 *  this counter makes it observable. Reads zero across the cutover shadow-traffic window. */
export function meteringAnomalyCount(): number {
  return meteringAnomalies;
}

/** Test-only reset of the anomaly counter. */
export function __resetAttributionCountersForTests(): void {
  meteringAnomalies = 0;
}

/**
 * Assert on a platform-attributed call: increment the /health anomaly counter and emit a
 * structured error log. Does NOT throw and does NOT drop the call — platform usage that
 * somehow occurs is still ledgered (against the platform admin, resolved by `billing/`),
 * never silently dropped (§6.3 rule 3). Callers invoke this before metering.
 */
export function assertNotPlatformCall(attribution: LlmAttribution): void {
  if (attribution.kind === 'platform') {
    meteringAnomalies++;
    console.error(
      '[llm][metering-anomaly] platform-attributed call — zero legitimate call sites at launch (ch06 §6.3 rule 3)',
      { agentType: attribution.agentType, justification: attribution.justification },
    );
  }
}

/** Guard against a future optional-parameter regression: every chokepoint entry runs this so
 *  a call constructed without attribution (defeating the compile-time requirement via `any`)
 *  is rejected at runtime rather than silently unbilled (§6.10 rule 3). */
export function requireAttribution(attribution: LlmAttribution | undefined | null): asserts attribution is LlmAttribution {
  if (!attribution || typeof attribution !== 'object' || typeof (attribution as { kind?: unknown }).kind !== 'string') {
    throw new TypeError('LLM chokepoint call is missing its required attribution (ch06 §6.3).');
  }
}

/** The billee id to record for a call. user_work/classifier bill their `billeeUserId`;
 *  platform has no user billee — it ledgers against the platform admin, resolved by
 *  `billing/` from the empty billee + `attributionKind: 'platform'`. */
export function billeeOf(attribution: LlmAttribution): string {
  return attribution.kind === 'platform' ? '' : attribution.billeeUserId;
}
