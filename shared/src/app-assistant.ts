/** Served-app assistant endpoint contract (ch03 §3.9.1; operator-run D1).
 *
 * EVOLVED ADDITIVELY (D1): the base request stayed `{ message, history? }` and the base
 * response stayed `{ reply }` (both back-compatible — every new field is optional), so an old
 * caller keeps working and `reply` is always present. D1 layers the served-app assistant's
 * three capabilities on top:
 *   - `mode` ('do' | 'show' | 'teach') — the assistant OPERATES the app (do), gives an overview
 *     (show), or teaches/tutorials (teach). The client may pin it; otherwise the server infers it
 *     from the message and echoes the inferred value back.
 *   - request `context` — the panel's current screen state (route + prior action results) so the
 *     assistant grounds its answer in what the visitor is looking at.
 *   - response `citations` — the knowledge excerpts the reply drew on (cite-your-source), one per
 *     grounding hit, addressed by (collection, docId) — the pair `knowledge_read` takes.
 *   - response `actions` — the app-actions the assistant wants the in-page runtime (C3) to
 *     execute. The server proposes; it never dispatches. Each names a manifest tool + its input.
 */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';
import { AppAction } from './action-manifest.js';

export const AssistantChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type AssistantChatMessage = z.infer<typeof AssistantChatMessage>;

/** The assistant's operating mode: operate the app / give an overview / teach. */
export const AssistantChatMode = z.enum(['do', 'show', 'teach']);
export type AssistantChatMode = z.infer<typeof AssistantChatMode>;

/** The panel's current screen state, forwarded so the assistant grounds in what the visitor sees.
 *  `actionResults` are opaque outputs of previously-dispatched app-actions (client-shaped). */
export const AssistantChatContext = z.object({
  route: z.string().optional(),
  actionResults: z.array(z.unknown()).optional(),
});
export type AssistantChatContext = z.infer<typeof AssistantChatContext>;

export const AssistantChatRequest = z.object({
  message: z.string(),
  history: z.array(AssistantChatMessage).optional(),
  /** The panel's current screen state (D1). */
  context: AssistantChatContext.optional(),
  /** Pin the mode; when absent the server infers it and echoes it back on the response (D1). */
  mode: AssistantChatMode.optional(),
});
export type AssistantChatRequest = z.infer<typeof AssistantChatRequest>;

/** One knowledge citation the reply drew on — addressed by (collection, docId), title for display. */
export const AssistantCitation = z.object({
  collection: z.string(),
  docId: z.string(),
  title: z.string(),
});
export type AssistantCitation = z.infer<typeof AssistantCitation>;

/** One app-action the assistant asks the in-page runtime (C3) to execute. `toolName` is a
 *  manifest tool name (`app_action__<id>`); `input` is the tool's validated arguments (VALUES).
 *
 *  `action` is the SERVER-RESOLVED manifest AppAction (kind/target/route/tourId/labelPt/destructive/
 *  params-definitions). D1 attaches it because the C3 same-document runtime's `perform()` needs a
 *  full AppAction (it fails `invalid-action` without `action.kind`) and the served page is NOT
 *  injected with the manifest — so the client cannot resolve `toolName → AppAction` on its own. The
 *  client dispatches `execute({ ...action, params: input })` (input overrides the definition-shaped
 *  params with VALUES at execute time). Keeping the executable shape server-authoritative (from the
 *  app's own activation-time manifest) means neither the model nor the anonymous visitor can forge a
 *  kind/target. Optional for back-compat; D1 always populates it for a validated toolName. */
export const AssistantAction = z.object({
  toolName: z.string(),
  input: z.record(z.unknown()),
  action: AppAction.optional(),
});
export type AssistantAction = z.infer<typeof AssistantAction>;

export const AssistantChatResponse = z.object({
  reply: z.string(),
  /** Knowledge excerpts the reply cited (D1; cite-your-source). Absent when nothing was grounded. */
  citations: z.array(AssistantCitation).optional(),
  /** App-actions the assistant wants the client runtime to execute (D1). Absent when none. */
  actions: z.array(AssistantAction).optional(),
  /** The mode the assistant operated in — the client's pin, or the server's inference (D1). */
  mode: AssistantChatMode.optional(),
});
export type AssistantChatResponse = z.infer<typeof AssistantChatResponse>;

export const appAssistantEndpoints = {
  assistantChat: {
    method: 'POST',
    path: '/api/app-assistant',
    auth: 'header-scoped',
    request: AssistantChatRequest,
    response: AssistantChatResponse,
  },
} as const satisfies DomainDescriptorMap;
