/**
 * Per-app UI ACTION MANIFEST (operator-run C2) — the operate contract of a
 * generated app: the typed vocabulary of UI commands the app's operator
 * assistant (and the test harness) may drive, declared at build time as the
 * `ui_actions` section of the app's MANIFEST.md, side by side with the
 * data-plane `capabilities` (manifest-level unification, memos/registry.md).
 *
 * Actions dispatch through the app's OWN state layer in-page — the same events
 * a human interaction produces — so validation and business logic always apply.
 * `destructive: true` demands a client-side confirmation step before dispatch
 * (a UX affordance; server-side authorisation is asserted in the security
 * block, never here). `target` names the element's registry id — the SAME
 * namespace as `data-demo-target`, which is what keeps generated-tour
 * selectors stable across rebuilds.
 */
import { z } from 'zod';

/** Typed parameter of an app action. `option` values must name one of `options`. */
export const AppActionParam = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'option']),
  required: z.boolean().default(false),
  /** For type 'option': the closed value set the UI offers. */
  options: z.array(z.string().min(1)).optional(),
  /** PT-PT label shown in confirmation/summary surfaces. */
  labelPt: z.string().min(1).optional(),
}).superRefine((p, ctx) => {
  if (p.type === 'option' && (!p.options || p.options.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `param "${p.name}": type 'option' requires non-empty options` });
  }
});
export type AppActionParam = z.infer<typeof AppActionParam>;

export const APP_ACTION_KINDS = [
  'navigate',
  'setField',
  'toggle',
  'select',
  'highlight',
  'startTour',
  'custom',
] as const;

export const AppAction = z.object({
  /** Stable kebab identifier, unique within the app (`registry id`). */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'action id must be kebab-case'),
  kind: z.enum(APP_ACTION_KINDS),
  /** PT-PT human label (lawyer-facing surfaces render this). */
  labelPt: z.string().min(1),
  /** What the action does — consumed as the assistant tool description. */
  description: z.string().min(1),
  /** Element registry id the action operates on (data-demo-target namespace).
   *  Required for element-scoped kinds; navigate/startTour/custom may omit it. */
  target: z.string().min(1).optional(),
  /** Route for kind 'navigate' (app-relative, e.g. "/clientes"). */
  route: z.string().min(1).optional(),
  /** Tour id for kind 'startTour'. */
  tourId: z.string().min(1).optional(),
  params: z.array(AppActionParam).default([]),
  /** Destructive actions (submit/delete/send) get a client-side confirmation
   *  step before dispatch. UX affordance only — not an authorisation boundary. */
  destructive: z.boolean().default(false),
}).superRefine((a, ctx) => {
  if (a.kind === 'navigate' && !a.route) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${a.id}": kind 'navigate' requires route` });
  }
  if (a.kind === 'startTour' && !a.tourId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${a.id}": kind 'startTour' requires tourId` });
  }
  if ((a.kind === 'setField' || a.kind === 'toggle' || a.kind === 'select' || a.kind === 'highlight') && !a.target) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${a.id}": kind '${a.kind}' requires target` });
  }
});
export type AppAction = z.infer<typeof AppAction>;

export const AppActionManifest = z.object({
  version: z.literal(1),
  actions: z.array(AppAction).max(200).superRefine((actions, ctx) => {
    const seen = new Set<string>();
    for (const a of actions) {
      if (seen.has(a.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate action id "${a.id}"` });
      }
      seen.add(a.id);
    }
  }),
});
export type AppActionManifest = z.infer<typeof AppActionManifest>;
