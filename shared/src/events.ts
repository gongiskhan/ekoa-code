import { z } from 'zod';

/**
 * The four SSE event unions (CONV-4, ch03 §3.6). Exactly four streams for web clients:
 * chat run, build/brand-research job, automation run, per-user notifications.
 * The protocol-parity gate (ch13 §13.5 item 4) asserts server-emittable == this union
 * == client-subscribed, per stream.
 */

/** 1. GET /api/v1/chat/runs/:id/events (ch03 §3.6.1). */
export const ChatRunEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), runId: z.string() }),
  z.object({ type: z.literal('text_chunk'), text: z.string() }),
  // The agent's working commentary (intermediate turns + thinking blocks), classified at the
  // llm/ transport and streamed on its own channel so the web can render it as a collapsible
  // "thinking" section distinct from the answer. The text is engine-identity-redacted
  // server-side (ch12 white-label): the persona governs answers, not thinking, so the run
  // pipeline redacts this channel before it reaches the wire. Chat stream only.
  z.object({ type: z.literal('thinking_chunk'), text: z.string() }),
  z.object({
    type: z.literal('tool_event'),
    phase: z.enum(['started', 'finished', 'failed']),
    tool: z.string(),
    args: z.record(z.unknown()).optional(),
    result: z.unknown().optional(),
    isError: z.boolean().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({ type: z.literal('context_event'), name: z.string(), action: z.enum(['loaded', 'used']) }),
  z.object({
    type: z.literal('complete'),
    result: z.unknown().optional(),
    durationMs: z.number(),
    delegate: z
      .object({ kind: z.enum(['build', 'integration']), request: z.record(z.unknown()) })
      .optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatRunEvent = z.infer<typeof ChatRunEvent>;

/** 2. GET /api/v1/jobs/:id/events — build + brand-research (ch03 §3.6.2). */
export const JobEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), jobId: z.string() }),
  z.object({ type: z.literal('routing'), tier: z.string(), reason: z.string() }),
  z.object({ type: z.literal('text_chunk'), text: z.string() }),
  // Working-commentary channel (mirrors ChatRunEvent.thinking_chunk): the agent's intermediate
  // narration, marker-filtered and engine-identity-redacted server-side. Renders in the
  // collapsible thinking UI, never as regular transcript messages.
  z.object({ type: z.literal('thinking_chunk'), text: z.string() }),
  z.object({
    type: z.literal('tool_event'),
    phase: z.enum(['started', 'finished', 'failed']),
    tool: z.string(),
    args: z.record(z.unknown()).optional(),
    result: z.unknown().optional(),
    isError: z.boolean().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({ type: z.literal('context_event'), name: z.string(), action: z.enum(['loaded', 'used']) }),
  z.object({
    type: z.literal('plan_step'),
    status: z.string(),
    description: z.string().optional(),
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal('preview_reload') }),
  // Emitted as soon as the build's artifact is scaffolded + registered (before the agent runs):
  // the client can show the LIVE preview and the real file tree from second zero instead of
  // waiting for `complete` (the scaffold is served immediately; watcher rebuilds then stream
  // `preview_reload` as the agent writes).
  z.object({
    type: z.literal('artifact'),
    artifactId: z.string(),
    appUrl: z.string(),
    slug: z.string().optional(),
  }),
  z.object({
    type: z.literal('complete'),
    durationMs: z.number(),
    result: z.unknown().optional(),
    artifactId: z.string().optional(),
    slug: z.string().optional(),
    appUrl: z.string().optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type JobEvent = z.infer<typeof JobEvent>;

/** 3. GET /api/v1/automations/runs/:id/events (ch03 §3.6.3). */
export const AutomationRunEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), runId: z.string() }),
  // The per-step update. `runId/stepIndex/status` are the thin core an old client relied on; the
  // enrichment fields (all OPTIONAL, so pre-enrichment clients stay valid) carry what the run UI
  // needs to show a step's outcome without a follow-up fetch: the resolved step id, the resolution
  // tier, a one-line failure message, the served screenshot URL (`/automation-screenshots/...`),
  // the non-browser step output panel payload, and the wall-clock. Kept lean on purpose — no a11y
  // snapshots, no raw screenshot bytes (the URL is a capability path served by the static plane).
  z.object({
    type: z.literal('step'),
    runId: z.string(),
    stepIndex: z.number(),
    status: z.string(),
    stepId: z.string().optional(),
    tier: z.string().optional(),
    error: z.string().optional(),
    // Structured failure context for the step (integration request/redacted-response, api_call
    // request/response). Already redacted + length-bounded at the executor before it reaches the
    // record, so it is safe to forward verbatim — the web renders it in the expandable
    // IntegrationErrorPanel. Kept off the persisted RunStepRecord (the Histórico detail shows the
    // one-line message, not this panel).
    errorDetails: z.unknown().optional(),
    screenshotUrl: z.string().optional(),
    output: z.unknown().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('step_output_chunk'),
    stepIndex: z.number(),
    stream: z.enum(['stdout', 'stderr']),
    chunk: z.string(),
  }),
  z.object({ type: z.literal('patch'), patch: z.record(z.unknown()) }),
  z.object({ type: z.literal('paused'), service: z.string() }),
  z.object({
    type: z.literal('pause_for_user'),
    stepIndex: z.number(),
    reasoning: z.string(),
    userInstructions: z.string(),
    failureMessage: z.string().optional(),
    screenshotUrl: z.string().optional(),
  }),
  z.object({ type: z.literal('resumed') }),
  z.object({
    type: z.literal('streaming_available'),
    token: z.string(),
    wsUrl: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
  }),
  z.object({
    type: z.literal('awaiting_consent'),
    stepIndex: z.number(),
    shape: z.string(),
    argv: z.array(z.string()),
    description: z.string(),
  }),
  z.object({
    type: z.literal('awaiting_daemon'),
    stepIndex: z.number(),
    capability: z.enum(['browser', 'bash']),
    reason: z.string(),
  }),
  z.object({ type: z.literal('complete'), summary: z.string() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AutomationRunEvent = z.infer<typeof AutomationRunEvent>;

/**
 * 4. GET /api/v1/notifications/events — per-user push channel (ch03 §3.6.4).
 * P-04 fixes exactly five PAYLOAD events; §3.6 SSE mechanics additionally state every one
 * of the four streams opens with a `ready` event. The `ready` ack is a stream mechanic
 * (like keepalive), not one of the five payload events — it is included here so the union
 * can represent what the server emits, which the ch13 §13.5 protocol-parity gate requires.
 */
export const NotificationEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('build_intent'),
    sessionId: z.string(),
    sourceRunId: z.string(),
    request: z.object({ description: z.string(), artifactId: z.string().optional() }).passthrough(),
  }),
  z.object({ type: z.literal('chat_answer'), sessionId: z.string(), sourceRunId: z.string(), text: z.string() }),
  z.object({ type: z.literal('integration_build_intent'), sessionId: z.string(), hint: z.string().optional() }),
  z.object({ type: z.literal('integration_ready'), integrationKey: z.string() }),
  z.object({ type: z.literal('usage_updated') }),
  // Org branding changed (brand research applied) - clients refetch the company/branding
  // config so the header logo + theme update live instead of waiting for a page reload.
  z.object({ type: z.literal('branding_updated') }),
]);
export type NotificationEvent = z.infer<typeof NotificationEvent>;

/** The four stream names — used by the route census / protocol-parity gate. */
export const SSE_STREAMS = ['chat', 'job', 'automation', 'notifications'] as const;
export type SseStream = (typeof SSE_STREAMS)[number];
