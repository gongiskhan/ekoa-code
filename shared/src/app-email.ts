/** Served-app email plane contract — `/api/app-email/*`.
 *
 * A served app that needs to email somebody (a payment reminder, a proposal, a notice) has three
 * bad options and one good one. It can ship its own SMTP credentials (a secret in a browser
 * bundle), it can ask the platform for a provider token (the same secret, one indirection away),
 * or it can hardcode `actionName === 'send_email'` against whichever provider its owner happens to
 * have connected. This plane is the fourth: the app asks WHAT it can send with, picks one, and the
 * platform executes it under the OWNER's connection. No token ever reaches the page.
 *
 * DISCOVERY IS BY CAPABILITY, NOT BY NAME. An action is an email sender because it declares
 * `email-send` in its `capabilities`, not because it is spelled `send_email`. That is the whole
 * point: providers name the same act differently (`send_email` vs `send_email_simple`), and an app
 * that matches on names breaks the day a package is renamed or a third provider is added.
 *
 * WHY DRAFTS EXIST HERE. Sending on a schedule is the thing a collections app most wants and the
 * thing its user is least comfortable letting it do. So the plane also parks a message in the
 * owner's own Drafts folder with the recipient in place: the human opens their normal mail client,
 * reads it, edits it, sends it. The app gets the outcome it wanted without ever being trusted to
 * hit send.
 *
 * The wire shape is deliberately `{ success, error?, code? }` rather than the CONV-2 envelope: the
 * served-app planes answer pages, not the dashboard, and an app that gets `success: false` with a
 * machine-readable `code` can decide what to do without parsing prose. Admission refusals (bad
 * header, unknown app, locked owner) still speak CONV-2, exactly like the sibling served-app
 * planes — those are not outcomes of a send, they are refusals to begin one.
 */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

/** The capability tag that classifies an action as an email sender. */
export const EMAIL_SEND_CAPABILITY = 'email-send';
/** Capability tag for actions that create a provider-side email DRAFT. */
export const EMAIL_DRAFT_CAPABILITY = 'email-draft';
/** Capability tag for actions that send an existing provider-side draft. */
export const EMAIL_DRAFT_SEND_CAPABILITY = 'email-draft-send';

/** One email-capable action the app may send through, with live connection state. */
export const AppEmailIntegration = z.object({
  integrationKey: z.string(),
  actionName: z.string(),
  displayName: z.string(),
  provider: z.string().optional(),
  /** True for the workspace-global OAuth integrations (Microsoft 365 / Google Workspace). */
  platform: z.boolean(),
  /** Usable right now: connected, enabled, and the token is not stale. */
  connected: z.boolean(),
  /** Connected once, but the grant has to be renewed — the app shows "reconnect", not "connect". */
  needsReauth: z.boolean(),
  /** The same integration also exposes an `email-draft` action (provider-side drafts). */
  supportsDrafts: z.boolean(),
});
export type AppEmailIntegration = z.infer<typeof AppEmailIntegration>;

export const AppEmailIntegrationsResponse = z.object({
  success: z.literal(true),
  data: z.array(AppEmailIntegration),
});
export type AppEmailIntegrationsResponse = z.infer<typeof AppEmailIntegrationsResponse>;

/**
 * Why a send can fail, as a token rather than a sentence. `awaiting_consent` is the one worth
 * calling out: it is NOT an error in the app's flow, it is the platform's write gate saying a
 * human has not yet approved this exact action for this owner. The app should surface "approve
 * this in Integrações", not "sending failed".
 */
export const AppEmailFailureCode = z.enum([
  'invalid_recipients',
  'unknown_action',
  'not_email_capable',
  'unsupported_action',
  'unsupported_integration',
  'not_connected',
  'awaiting_consent',
  'provider_error',
]);
export type AppEmailFailureCode = z.infer<typeof AppEmailFailureCode>;

export const SendAppEmailRequest = z.object({
  integrationKey: z.string().min(1),
  actionName: z.string().min(1),
  to: z.array(z.string()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  /** 'Text' (default) or 'HTML' — honoured where the provider action supports it. */
  bodyContentType: z.enum(['Text', 'HTML']).optional(),
});
export type SendAppEmailRequest = z.infer<typeof SendAppEmailRequest>;

export const SendAppEmailResponse = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  code: AppEmailFailureCode.optional(),
});
export type SendAppEmailResponse = z.infer<typeof SendAppEmailResponse>;

/** A draft request names no action: the plane picks the integration's `email-draft` action itself. */
export const CreateAppEmailDraftRequest = z.object({
  integrationKey: z.string().min(1),
  to: z.array(z.string()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  bodyContentType: z.enum(['Text', 'HTML']).optional(),
});
export type CreateAppEmailDraftRequest = z.infer<typeof CreateAppEmailDraftRequest>;

export const CreateAppEmailDraftResponse = z.object({
  success: z.boolean(),
  /** Provider draft id (Graph message id; Gmail draft id). */
  draftId: z.string().optional(),
  /** Deep link that opens the draft. Graph returns a per-message webLink; Gmail has none, so the
   *  Drafts folder is the closest stable link. */
  webLink: z.string().optional(),
  error: z.string().optional(),
  code: AppEmailFailureCode.optional(),
});
export type CreateAppEmailDraftResponse = z.infer<typeof CreateAppEmailDraftResponse>;

export const SendAppEmailDraftRequest = z.object({
  integrationKey: z.string().min(1),
  draftId: z.string().min(1),
});
export type SendAppEmailDraftRequest = z.infer<typeof SendAppEmailDraftRequest>;

/** The workspace's own mailbox address — where "you have drafts waiting" notices should go. */
export const AppEmailInboxResponse = z.object({
  success: z.boolean(),
  address: z.string().optional(),
  error: z.string().optional(),
  code: AppEmailFailureCode.optional(),
});
export type AppEmailInboxResponse = z.infer<typeof AppEmailInboxResponse>;

export const appEmailEndpoints = {
  emailIntegrations: {
    method: 'GET',
    path: '/api/app-email/integrations',
    auth: 'header-scoped',
    response: AppEmailIntegrationsResponse,
  },
  emailSend: {
    method: 'POST',
    path: '/api/app-email/send',
    auth: 'header-scoped',
    request: SendAppEmailRequest,
    response: SendAppEmailResponse,
    // A refused send is a 502 carrying the same typed body — the app reads `code`, not the status.
    successStatus: [200, 502],
  },
  emailDraft: {
    method: 'POST',
    path: '/api/app-email/draft',
    auth: 'header-scoped',
    request: CreateAppEmailDraftRequest,
    response: CreateAppEmailDraftResponse,
    successStatus: [200, 502],
  },
  emailDraftSend: {
    method: 'POST',
    path: '/api/app-email/draft/send',
    auth: 'header-scoped',
    request: SendAppEmailDraftRequest,
    response: SendAppEmailResponse,
    successStatus: [200, 502],
  },
  emailInbox: {
    method: 'GET',
    path: '/api/app-email/inbox',
    auth: 'header-scoped',
    response: AppEmailInboxResponse,
    successStatus: [200, 502],
  },
} as const satisfies DomainDescriptorMap;
