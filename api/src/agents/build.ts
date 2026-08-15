/**
 * Build jobs (ch05 §5.6.2). The §5.2 pipeline plus build specifics: follow-up detection and the
 * in-build classifier (under the abort rules of §5.3.2), the first-build reservation (§5.3.3) and
 * the one-follow-up-per-artifact 409 (§5.3.5), routing floored at the expert tier, the inactivity
 * + wall-clock timers (§5.3.6), session resume via sdkSessionId persisted-only-when-changed
 * (§5.4.5), the completion sequence (§5.6.2 steps 1-8) including the per-build verification stage
 * (step 5, ch07 §7.2.6), the provider-error reroute (§5.3.7), the dual-fire guard (§5.3.4), and
 * the P-10 persistence + in-process zombie net.
 */
import { runErrorText, type RunErrorCode } from '@ekoa/shared';
import type { Actor } from '@ekoa/shared';
import { join } from 'node:path';
import { loadAgentsConfig } from '../config.js';
import { checkAllowance } from '../billing/index.js';
import { BILLING_PAGE_URL } from '../billing/constants.js';
import { runAgent, decideForTask, LlmAbortedError, type AgentRunResult } from '../llm/index.js';
import { runPostRunExtraction } from '../memory/index.js';
import { userSettings } from '../data/stores.js';
import {
  registerRun,
  getRun,
  removeRun,
  finalizeOnce,
  hasLiveJobForArtifact,
  reserveFirstBuild,
  bindReservation,
  releaseReservation,
} from './registry.js';
import { JobStreamSink, emitIntegrationBuildIntent, emitChatAnswer, type ToolEventInput } from './streaming.js';
import { classifyRunFailure } from './run-failure.js';
import { MarkerProcessor, scanProviderError } from './markers.js';
import { StreamingIdentityRedactor } from './branding.js';
import { toolPolicyFor } from './tools.js';
import { knowledgeToolSpecs, loadContextToolSpec, delegateToolSpec, docxToolSpecs } from './sdk-tools.js';
import { classifyBuildAmbition, classifyInBuildIntent } from './guided-build.js';
import {
  persistJob,
  patchJob,
  getJob,
  jobView,
  nonTerminalJobForArtifact,
  resetArtifactToDraft,
  type JobRecord,
} from './jobs.js';
import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, ingestBuildKnowledge, verifyRunner } from './seams.js';
import { detectDomainHeavy, knowledgeScopingNarration, knowledgeIndexedNarration, knowledgeNotIndexedNarration } from './domain-scoping.js';
import { logActivity } from '../data/activity.js';
import { loadHistory, renderPrompt, capHistory } from './context.js';

/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
 *  or any prompt text). The single audit write path (FIXED-8); best-effort so bookkeeping never
 *  fails a build. `type` is created | completed | failed | cancelled. */
function auditBuild(input: BuildCreateInput, type: string, metadata: Record<string, unknown>): void {
  void logActivity(
    { userId: input.actor.userId, username: input.username, orgId: input.actor.orgId },
    'build',
    type,
    input.deps,
    metadata,
  ).catch(() => undefined);
}

/** Attachment display names (DO #4): `attachments` rides as opaque `UploadRef[]`-shaped
 *  `unknown[]` on the wire; pull out just the filenames the classifier prompt wants. Tolerant of
 *  any shape - never throws, drops anything that isn't a real string name. */
function attachmentNamesOf(attachments: unknown[] | undefined): string[] {
  if (!attachments) return [];
  return attachments
    .map((a) => {
      const name = a && typeof a === 'object' ? (a as Record<string, unknown>).displayName : undefined;
      return typeof name === 'string' && name.trim() ? name.trim() : undefined;
    })
    .filter((n): n is string => Boolean(n));
}

export interface BuildCreateInput {
  actor: Actor;
  username: string;
  sessionId: string;
  description: string;
  language: string;
  templateId?: string;
  integrationKeys?: string[];
  artifactId?: string;
  attachments?: unknown[];
  fieldValues?: Record<string, unknown>;
  configValues?: Record<string, unknown>;
  /** WS6 incident fix: the user's ORIGINAL words for this build request, carried alongside
   *  `description` (the chat-agent's <=15-word build paraphrase, when this request came from a
   *  chat delegation). `description` still names the artifact (it is good at that); this drives
   *  the artifact-type classifier AND is what the build agent is actually briefed on - a
   *  paraphrase used to be the classifier input, the artifact name, AND the build agent's entire
   *  prompt, so "a construir uma apresentação do teu produto Cobranças" briefed a slide deck when
   *  the user asked for a website. Absent on a direct composer build, where `description` already
   *  IS the user's own text (nothing to carry separately). */
  originalMessage?: string;
  /** F1 knowledge-during-build: scoping-provided reference documents to ingest into the org
   *  knowledge area DURING a domain-heavy first build (org-scoped by the run's actor, immediately
   *  searchable to the run's knowledge tools). Additive + optional; carried by JobCreateRequest
   *  (shared/src/jobs.ts, size/count-capped there) and forwarded by the jobs route. */
  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
  deps: { now: () => number; genId: () => string };
}

export type BuildCreateResult =
  | { status: 'created'; job: ReturnType<typeof jobView>; fire: () => void }
  | { status: 'answered'; reason: string }
  | { status: 'conflict' };

/**
 * Handle `POST /jobs` (build) up to the response (§5.6.2). First builds reserve synchronously and
 * respond `created`; follow-ups run the in-build classifier and may respond `answered` with no
 * job. A concurrent follow-up on the same artifact is `conflict` → the route returns 409
 * DUPLICATE_BUILD.
 */
export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
}

// --- First build -------------------------------------------------------------------------

async function handleFirstBuild(input: BuildCreateInput): Promise<BuildCreateResult> {
  // Reserve synchronously BEFORE any async work (§5.3.3). A live reservation binds the second
  // POST to the running job and returns it (the build_intent broadcast reaches every open tab).
  const reservation = reserveFirstBuild(input.sessionId, input.deps.now());
  if (!reservation.ok) {
    // Bound to the existing job — return it as `created` pointing at the running job.
    const existingId = reservation.jobId;
    return {
      status: 'created',
      job: { id: existingId, status: 'running', createdAt: new Date(input.deps.now()).toISOString() },
      fire: () => {},
    };
  }

  const jobId = input.deps.genId();
  bindReservation(input.sessionId, jobId);
  const abort = new AbortController();
  registerRun({
    id: jobId,
    ownerUserId: input.actor.userId,
    orgId: input.actor.orgId,
    kind: 'build',
    abort,
    startedAt: input.deps.now(),
    sessionId: input.sessionId,
  });

  const record: JobRecord = {
    _id: jobId,
    kind: 'build',
    status: 'created',
    userId: input.actor.userId,
    sessionId: input.sessionId,
    request: {
      description: input.description,
      language: input.language,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.integrationKeys ? { integrationKeys: input.integrationKeys } : {}),
      ...(input.fieldValues ? { fieldValues: input.fieldValues } : {}),
      ...(input.configValues ? { configValues: input.configValues } : {}),
    },
    createdAt: new Date(input.deps.now()).toISOString(),
  };
  // Persist BEFORE responding so `GET /jobs/:id` finds the record as soon as the 202 returns
  // ("respond early once the record exists", §5.2 step 2).
  await persistJob(record);
  auditBuild(input, 'created', { jobId }); // Registo (F3)

  return {
    status: 'created',
    job: jobView(record),
    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
  };
}

// --- Follow-up ---------------------------------------------------------------------------

async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
  // One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
  // artifact — two would resume the same SDK transcript and corrupt it.
  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
    return { status: 'conflict' };
  }

  const jobId = input.deps.genId();
  const abort = new AbortController();
  registerRun({
    id: jobId,
    ownerUserId: input.actor.userId,
    orgId: input.actor.orgId,
    kind: 'build',
    abort,
    startedAt: input.deps.now(),
    artifactId,
    sessionId: input.sessionId,
  });

  // In-build message classifier BEFORE any build work, under the abort rules of §5.3.2.
  let intent: Awaited<ReturnType<typeof classifyInBuildIntent>>;
  try {
    intent = await classifyInBuildIntent(input.description, input.actor.userId, abort.signal);
  } catch (err) {
    removeRun(jobId);
    if (err instanceof LlmAbortedError) {
      // Abort NEVER falls through to a build (§5.3.2): zero jobs created, zero side effects.
      return { status: 'answered', reason: 'Execução cancelada.' };
    }
    // Non-abort classifier failure is non-fatal and defaults to proceeding (§5.6.2) — handled by
    // classifyInBuildIntent's own fallback, so reaching here is an unexpected error: answer safely.
    return { status: 'answered', reason: 'Não foi possível processar o pedido.' };
  }

  if (intent === 'integration-build') {
    emitIntegrationBuildIntent(input.actor.userId, { sessionId: input.sessionId });
    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'Vou ligar essa integração primeiro.' });
    removeRun(jobId);
    return { status: 'answered', reason: 'integration-build' };
  }
  if (intent === 'question') {
    // In-build answer flow (cheap tier), delivered as chat_answer; no job (§5.6.2).
    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'A aplicação está a ser construída; posso ajudar com isso.' });
    removeRun(jobId);
    return { status: 'answered', reason: 'question' };
  }

  // modification → proceed with the build. projectDir resolved server-side from the artifact.
  const record: JobRecord = {
    _id: jobId,
    kind: 'build',
    status: 'created',
    userId: input.actor.userId,
    sessionId: input.sessionId,
    artifactId,
    request: { description: input.description, language: input.language },
    createdAt: new Date(input.deps.now()).toISOString(),
  };
  await persistJob(record);
  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
  return {
    status: 'created',
    job: jobView(record),
    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
  };
}

// --- Execution ---------------------------------------------------------------------------

interface ExecOpts {
  firstBuild: boolean;
  artifactId?: string;
}

/**
 * F16 steering: the build agent's system prompt names the served entrypoint and forbids the
 * orphan-HTML failure mode (the app compiled and served is ALWAYS the manifest entrypoint —
 * `frontend/src/index.jsx` importing `App.jsx`; a standalone top-level HTML file is never
 * served). The honest-completion gate below is the SYSTEM's catch for when the model errs
 * anyway — this prompt just makes the miss rare.
 */
/** Hard cap on scoping-provided knowledge docs ingested per first build. The contract
 *  (JobCreateRequest.knowledgeDocs) enforces the same cap + per-doc size at the boundary;
 *  this re-cap protects direct programmatic callers of handleBuildCreate. */
const MAX_KNOWLEDGE_DOCS = 20;

/**
 * One user-facing progress line for a tool event, or null when the event is not worth narrating.
 *
 * PT-PT and product-level on purpose: this text lands in the same transcript the end user reads,
 * so it obeys the white-label rule the final message does - no file paths dressed up as progress, no
 * bundler/tool names. `frontend/src/pages/Contactos.jsx` narrates as "Contactos", not as a path.
 * Returns null for the read-only tools (Read/Glob/Grep) - they are how the agent thinks, not what
 * it is doing, and narrating them buries the real steps.
 */
export function buildProgressLine(e: ToolEventInput): string | null {
  // Only the leading edge narrates: `started` and `finished` both fire for one step, and
  // reporting both would double every line. The rule lives HERE rather than in the caller so it
  // cannot be lost by a second call site.
  if (e.phase !== 'started') return null;
  const args = (e.args ?? {}) as Record<string, unknown>;
  const rawPath = typeof args.file_path === 'string' ? args.file_path : '';
  const screenName = (p: string): string => {
    const base = (p.split('/').pop() ?? '').replace(/\.(jsx|tsx|js|ts|css)$/i, '');
    if (!base) return '';
    if (/^index$/i.test(base)) return '';
    if (/^App$/i.test(base)) return '';
    // PascalCase / kebab-case -> a human label ("CasosRecentes" -> "Casos Recentes").
    return base.replace(/[-_]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').trim();
  };

  switch (e.tool) {
    case 'Write':
    case 'Edit': {
      if (/\.css$/i.test(rawPath)) return 'A afinar o aspeto e o espaçamento...';
      if (/MANIFEST\.md$/i.test(rawPath)) return 'A declarar as capacidades da aplicação...';
      if (/App\.(jsx|tsx)$/i.test(rawPath)) return 'A montar a estrutura da aplicação...';
      const name = screenName(rawPath);
      return name ? `A construir "${name}"...` : 'A escrever a aplicação...';
    }
    case 'Bash':
      return 'A compilar e verificar...';
    case 'knowledge_search':
    case 'knowledge_read':
      return 'A consultar a base de legislação e jurisprudência...';
    default:
      return null; // Read/Glob/Grep and everything else: thinking, not progress.
  }
}

const BUILD_SYSTEM_PROMPT = [
  'You are building a web app inside an Ekoa app workspace.',
  'The served application is compiled from the manifest entrypoint: frontend/src/index.jsx, which renders frontend/src/App.jsx.',
  'Make ALL user-visible changes by editing frontend/src/App.jsx (and files it imports under frontend/src/).',
  'NEVER write a standalone top-level *.html file as the deliverable - top-level HTML files are not served; only the compiled entrypoint bundle is.',
  'Do not edit dist/ by hand - it is build output, regenerated from frontend/src/.',
  // Turn economy (operator directive 2026-08-10). Every turn replays the whole context, so turn
  // count - not code size - is what a build actually costs. The measured failure mode was a run
  // that explored, re-read files it had just written, and nibbled at CSS one Edit at a time until
  // it exhausted the context window.
  'Work in few, large steps. Decide the structure first, then WRITE each file complete in one pass - do not build a file up through a series of small edits, and do not re-read a file you just wrote (you know what is in it). Read a file only when you genuinely do not know its contents. Do not explore the tree beyond what the task needs: the scaffold layout is described above and in the base conventions.',
  'Prefer editing the files the scaffold already gives you over adding new ones. A handful of well-organised files beats a deep tree of tiny components for an artifact of this size.',
  // White-label (ch12; operator report 2026-07-11: the final summary named `window.__ekoa.exportPdf`).
  'Your FINAL message is read by a non-technical end user. Write it in the language of their request.',
  'In that final message NEVER mention internal platform APIs (window.__ekoa or any of its members), file paths, bundlers, manifests, libraries, or any implementation machinery.',
  'Describe what the app DOES in product terms ("um botão que descarrega o documento em PDF"), never HOW it is wired.',
  // Design quality bar (operator directive 2026-08-07, plugin swapped to impeccable
  // 2026-08-08): the impeccable skill ships as a plugin on every build run — use its craft, but the
  // deliverable stays the compiled React entrypoint (no standalone-HTML deliverable framing in
  // skill text overrides the entrypoint rule).
  // The impeccable skill is the design authority on build runs (mounted below as a plugin). The
  // three lines that follow are its Cortex operating contract: WHICH flows to run, and how its
  // interactive steps degrade in this headless harness. Kept in the prompt (not a skill fork) so
  // the vendored skill stays byte-comparable with upstream for updates.
  // 2026-08-10 (operator directive, after a live "site about our legal apps" build): the previous
  // two lines ordered the agent through impeccable's new-work flow INCLUDING the concept-seed
  // roll. Measured cost of that instruction on job 48c1c600: 142 turns, ~15M tokens, 34+ minutes,
  // a context-window exhaustion + auto-compaction mid-run - and the roll assigned an "atrium with
  // porticoes and floors" world rendered in dark teal, i.e. it contradicted the house-style line
  // that follows it AND re-created the WS7 incident (a site request answered with a dark themed
  // artefact) through a different door. `reference/` is 315 KB of markdown; the flow pulls
  // several of those docs into a context that already carries the base conventions.
  // The craft floor is what actually produced quality, so it is stated HERE, compactly, instead
  // of being loaded. The plugin stays mounted for its mechanical detector and for named commands
  // on refinements - it is simply no longer the thing that decides the design.
  'Do NOT run impeccable\'s new-work flow or its concept-seed roll, and do not read its reference/ docs for a routine build - the direction is already decided by the house style below and the base scaffold you were given. Build on the scaffold that is already in frontend/src/ (it ships the design system for this artifact type: tokens, primitives, states, motion) rather than inventing a visual world. On a REFINEMENT of an existing surface you may load one matching impeccable command doc (polish, layout, typeset...) if it earns its place.',
  'Craft floor, applied without announcing it: body text >= 4.5:1 contrast and large text >= 3:1; shadows carry an offset and a soft blur; tighter space inside a group than between groups, and more space above a heading than below it; body measure 65-75ch; display type gets tight leading and slightly negative tracking; every interactive element covers hover, active, focus-visible and disabled; real empty, loading and error states; theme the browser surfaces you did not draw (text selection, caret, focus ring, scrollbars); copy in the product\'s own language, where controls name their action and errors name the problem and the recovery.',
  // Restored from the craft floor after the FIRST build on this prompt shipped a page whose
  // middle sections were permanently invisible (2026-08-10, artifact 7d82d4b7): the agent wrote
  // entrance reveals with an `opacity: 0` resting state and a trigger that never fired, so the
  // content existed in the DOM at opacity 0 with no animation attached. Invisible content is a
  // worse failure than no animation, so the rule is stated as a hard floor, not a nicety.
  'Motion: ONE authored moment, not an identical entrance bolted onto every section, and it animates FROM AN ALREADY-VISIBLE DEFAULT. Never leave content at `opacity: 0` (or hidden/zero-height) waiting to be revealed - if the trigger does not fire, the page ships blank and that is a broken build, not a missed flourish. Scroll-triggered reveals must therefore start visible and only enhance; prefer CSS transitions on hover/focus/state, which cannot strand content. Everything animated respects prefers-reduced-motion.',
  'Anti-slop, these are the category defaults you must NOT reach for: a grid of same-size cards (icon + heading + text) as the page structure; nested cards; a small uppercase kicker/eyebrow above a heading (never - the heading carries itself); section numbers unless the sequence is information; gradient text; glass/blur as decoration; a coloured left border thicker than 1px; hard offset shadows; monospace as a costume for "technical"; unicode glyphs or emoji standing in for icons (draw an SVG); sparklines and progress rings standing in for content.',
  'This harness is headless and unattended: there is no user to ask mid-build, and no image generation. Never block on a question, a decision page, or a generated asset - decide, build, and state your assumptions in the run output. Screenshot/inspection passes are bounded: build it fully, inspect once, fix what that pass shows, and stop. Open-ended self-QA loops are the single most expensive way to make a build slightly worse.',
  'Company brand: /api/design-tokens.css is the authority for colors and fonts. When it defines --logo-url (non-empty), the company has a REAL logo served under /brand-assets/ - place it in the header (and footer where one exists) of any Persuade surface (site, landing, marketing) via that CSS variable or an <img> to the same asset. NEVER invent, draw, or generate a substitute logo; when --logo-url is empty, use the company name as text in the surface\'s own typography.',
  // WS7 house style (operator directive 2026-08-08, post-incident: a "site" request built a
  // dark serif slide deck). "Pick a deliberate visual direction" alone was permission enough for
  // that answer - replaced with an explicit default direction. A build may still deviate FROM it
  // deliberately when the user's own brand/request calls for something else (e.g. an existing
  // dark brand), but the default the agent reaches for absent such a signal is this one.
  'Never ship a default-looking UI: no framework-default styling, no generic AI aesthetics (Inter-on-white, purple gradients, cookie-cutter cards).',
  'House style, unless the user\'s brand or request clearly calls for something else: clean, professional, modern, high-impact. Light background by default (dark themes are a deliberate choice for a specific brand, never the default reach). Generous whitespace over dense packing. Confident sans-first typography - a serif is a deliberate choice for an editorial/luxury/publication brand, never the default. Purposeful motion: staggered entrance reveals, smooth state/page transitions, hover and scroll-triggered micro-interactions - subtle and consistent, never gratuitous.',
  // Motion library availability (verified 2026-08-08 against the REAL builder pipeline -
  // api/apps/builder.ts sharedBuildOptions, not a standalone esbuild invocation - api/package.json
  // carries `motion` as an explicit dependency so this is a guaranteed part of the build, not an
  // accident of some other package hoisting it in): `import { motion, AnimatePresence } from
  // 'motion/react'` bundles correctly, pinned by api/tests/apps/builder.test.ts.
  // Cost measured 2026-08-08 with THIS builder (it never minifies - sharedBuildOptions hardcodes
  // minify:false - so these are the exact bytes served, not a hypothetical minified estimate): a
  // baseline app (React + ReactDOM, no motion) bundles to ~1,126 KB; the same app importing motion
  // for ONE fading div bundles to ~1,444 KB - a ~318 KB tax paid the moment `motion/react` is
  // imported AT ALL. Going from that one fade all the way to AnimatePresence + drag + gestures +
  // orchestrated variants adds only ~12 KB more - esbuild does not meaningfully tree-shake this
  // library under IIFE, so the cost tracks WHETHER you import it, not how much of it you use. The
  // decision is binary: pay ~318 KB once where motion IS the point, or don't import it at all.
  "The `motion` package is available and bundles at build time: `import { motion, AnimatePresence } from 'motion/react'` works. Importing it costs a flat ~318 KB of served JS the moment you use it at all - using more of it (AnimatePresence, gestures, variants) barely adds to that once the tax is paid, so if you reach for it, use it well. Reach for it where motion IS the point: presentations, landing/marketing pages, portfolio work, a hero moment. For dense, data-heavy screens (tables, forms, dashboards a professional uses all day) prefer plain CSS transitions and keyframes, which cost nothing and cover hover, focus and simple state changes well. Do not import `motion/react` merely to fade a list in.",
  // Stack reconciliation (WS7): the design skills' own examples assume Tailwind + Next.js - this
  // platform is neither. Told here so the agent is not left to resolve the contradiction itself.
  "The impeccable skill's examples and detector were authored against general web stacks (Tailwind, Next.js, Astro...). This platform is plain React (JSX, automatic runtime) bundled by esbuild - there is no Next.js, no Tailwind, no package.json, no npm install (content/coding-agent). Take the skill's DESIGN judgment (worlds, composition, hierarchy, craft floor, anti-slop rules) and express it as plain CSS using the runtime design-tokens contract (`var(--color-…)`, `var(--space-…)`, `var(--text-…)`, served by /api/design-tokens.css) - never Tailwind classes or `next/font`/`next/image` code. Its PRODUCT.md/DESIGN.md live in the project root and survive follow-up builds: write DESIGN.md at finish exactly as the skill directs, so the next build inherits the world instead of re-rolling it.",
].join('\n');

/**
 * Run the build job through the chokepoint and drive the completion sequence (§5.6.2). Terminal
 * state is owned by the finalize path (dual-fire guarded). The in-process zombie net lives in the
 * `finally`: a run left non-terminal is flipped to `failed { PIPELINE_STUCK }` and the artifact
 * reset to draft (§5.2.1).
 */
export async function executeBuildJob(jobId: string, input: BuildCreateInput, abort: AbortController, opts: ExecOpts): Promise<void> {
  const entry = getRun(jobId);
  const sink = new JobStreamSink(jobId);
  const start = input.deps.now();
  const cfg = loadAgentsConfig();
  const mech = getBuildMechanics();

  let artifactId = opts.artifactId ?? '';
  let projectDir = '';
  let slug = '';
  let appUrl = '';
  let resumeSessionId: string | undefined;
  let terminalReached = false;

  /**
   * Terminal failure. Takes a CODE (+ structured params); the user-facing text comes from the
   * one shared vocabulary at the sink. `detail` is the honest internal cause: it is logged and
   * persisted on the JobRecord (operators read it there and via the audit trail) but NEVER put
   * on the wire — `jobView` has always stripped the persisted message for exactly this reason,
   * and the stream now matches it (finding `run-error-text-leak`).
   */
  const finishError = async (code: RunErrorCode, params?: Record<string, string>, detail?: unknown): Promise<void> => {
    if (finalizeOnce(jobId)) {
      if (detail !== undefined) {
        console.error(`[build][job ${jobId}] terminal ${code}:`, detail instanceof Error ? (detail.stack ?? detail.message) : detail);
      }
      sink.error(code, params);
      const persisted = detail === undefined
        ? runErrorText(code, 'pt', params)
        : `${runErrorText(code, 'pt', params)} | ${detail instanceof Error ? detail.message : String(detail)}`;
      await patchJob(jobId, { status: 'failed', error: { code, message: persisted }, endedAt: new Date(input.deps.now()).toISOString() });
      if (artifactId) await resetArtifactToDraft(artifactId); // artifact stays draft on error (§5.6.2)
    }
    terminalReached = true;
  };

  // Inactivity + wall-clock timers (§5.3.6). Inactivity resets on every stream/tool/plan
  // callback; wall clock is absolute. On a timeout: if abort is already set (cancel owns terminal
  // state) stay quiet; otherwise route through the finalized-guarded error path.
  let inactivityTimer: NodeJS.Timeout;
  const resetInactivity = (): void => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(onTimeout, cfg.buildInactivityTimeoutMs);
  };
  const wallClock = setTimeout(onTimeout, cfg.buildWallClockMs);
  function onTimeout(): void {
    if (abort.signal.aborted) return; // cancel owns the terminal state
    if (entry) entry.timedOut = true;
    abort.abort();
  }
  resetInactivity();

  try {
    await patchJob(jobId, { status: 'running', startedAt: new Date(input.deps.now()).toISOString() });

    // Billing gate (§5.2 step 3).
    const allow = await checkAllowance(input.actor.userId);
    if (abort.signal.aborted) { await settleAborted(); return; }
    if (!allow.ok) {
      clearTimers();
      if (finalizeOnce(jobId)) {
        const url = allow.billingUrl ?? BILLING_PAGE_URL;
        // The billing URL is STRUCTURED (`params.billingUrl`), not concatenated into prose.
        sink.error('BILLING_BLOCKED', { billingUrl: url });
        await patchJob(jobId, { status: 'failed', error: { code: 'BILLING_BLOCKED', message: allow.message ?? 'Faturação bloqueada.' }, endedAt: new Date(input.deps.now()).toISOString() });
      }
      terminalReached = true;
      return;
    }

    // First-build vs follow-up resolution.
    let basePromptSections: string[] = [];
    if (opts.firstBuild) {
      const prep = await mech.prepareFirstBuild({
        userId: input.actor.userId,
        sessionId: input.sessionId,
        description: input.description,
        language: input.language,
        ...(input.templateId ? { templateId: input.templateId } : {}),
        ...(input.originalMessage?.trim() ? { originalMessage: input.originalMessage } : {}),
        ...(input.attachments ? { attachmentNames: attachmentNamesOf(input.attachments) } : {}),
      });
      artifactId = prep.artifactId;
      projectDir = prep.projectDir;
      slug = prep.slug;
      appUrl = prep.appUrl;
      basePromptSections = prep.basePromptSections ?? [];
      if (entry) entry.artifactId = artifactId;
      await patchJob(jobId, { artifactId });
    } else {
      // TOCTOU close (H1 MEDIUM): the create-time writability gate on POST /jobs can be stale by the
      // time this queued follow-up runs — the owner may have flipped the artifact org→private, or
      // deleted it, between check and execution. Re-validate writability at USE time (through the
      // mechanics seam — agents/ reaches apps/ only via the seam, ch02 §2.7) and FAIL the job rather
      // than resume a code-writing agent against an artifact the actor may no longer write.
      const writeVerdict = await mech.revalidateWritable(input.actor, artifactId);
      if (writeVerdict !== 'ok') {
        clearTimers();
        if (finalizeOnce(jobId)) {
          sink.error('EDIT_FORBIDDEN');
          await patchJob(jobId, { status: 'failed', error: { code: 'EDIT_FORBIDDEN', message: `write revalidation: ${writeVerdict}` }, endedAt: new Date(input.deps.now()).toISOString() });
        }
        terminalReached = true;
        return;
      }
      const resolved = await mech.resolveFollowUp(artifactId);
      if (!resolved) { clearTimers(); await finishError('ADAPTER_ERROR'); return; }
      projectDir = resolved.projectDir;
      resumeSessionId = resolved.resumeSessionId;
      slug = resolved.slug;
      appUrl = resolved.appUrl;
      basePromptSections = resolved.basePromptSections ?? [];
    }
    if (abort.signal.aborted) { await settleAborted(); return; }

    // Live build surface: the scaffold (or the existing app, on a follow-up) is served ALREADY —
    // tell the client where, so the preview iframe + real file tree show from second zero, and
    // wire the watcher so every incremental rebuild reloads the preview as the agent writes.
    if (artifactId && appUrl) {
      sink.artifact({ artifactId, appUrl, ...(slug ? { slug } : {}) });
      if (projectDir) await mech.watchRebuilds({ artifactId, projectDir, onRebuild: () => sink.previewReload() });
    }

    // Routing floor (§5.2 step 5, re-decided 2026-08-14): a FIRST build's floor follows the
    // brief's AMBITION, not a blanket frontier mandate. The FAST classifier labels the brief
    // 'basic' (standard internal tool) or 'ambitious' (design-led / public-facing /
    // multi-domain); basic floors at EXPERT, ambitious keeps the frontier GENIUS floor
    // (operator directive 2026-08-07, effort since lowered max→high). Measured basis
    // (2026-08-13, a basic time-tracking app): the blanket GENIUS-max floor spent ~68K of
    // 96K output tokens THINKING — ~14 of 20.5 minutes. Follow-ups keep the EXPERT floor.
    let routingReason = 'follow-up build';
    let routingFloor: 'GENIUS' | 'EXPERT' = 'EXPERT';
    if (opts.firstBuild) {
      let ambition: Awaited<ReturnType<typeof classifyBuildAmbition>>;
      try {
        ambition = await classifyBuildAmbition(input.description, input.actor.userId, abort.signal);
      } catch (err) {
        if (err instanceof LlmAbortedError) { await settleAborted(); return; } // Stop pressed mid-classify: never start a build (§5.3.2)
        throw err;
      }
      routingFloor = ambition === 'ambitious' ? 'GENIUS' : 'EXPERT';
      routingReason = `first build (${ambition})`;
    }
    const decision = decideForTask(input.description, undefined, routingFloor);
    sink.routing(decision.tier, routingReason);
    await patchJob(jobId, { routing: { tier: decision.tier, reason: routingReason } });

    // F1 knowledge-during-build (§5.5.2 knowledge area). The first-build scoping phase runs a
    // DETERMINISTIC domain-heavy detector (no model call, no egress) over the request. A
    // domain-heavy app NARRATES a knowledge request on the build stream (upload reference
    // documents to the org knowledge area) and, when the request carried scoping-provided
    // documents, ingests them into the org knowledge area for THIS run - org-scoped by the run's
    // actor, refused for the reserved _shared partition, and immediately searchable to the
    // knowledge tools mounted below. The ingest IS awaited before the run starts - deliberately,
    // so the docs are searchable to this same run - but it is bounded (doc count/size capped at
    // the contract, count re-capped here) and non-fatal per doc: one bad document neither fails
    // the build nor blocks the remaining documents.
    if (opts.firstBuild) {
      try {
        const scope = detectDomainHeavy(input.description);
        if (scope.domainHeavy) {
          sink.planStep('knowledge-scope', knowledgeScopingNarration(scope.domains));
          const docs = (input.knowledgeDocs ?? []).slice(0, MAX_KNOWLEDGE_DOCS);
          let indexed = 0;
          for (const doc of docs) {
            try {
              const { id } = await ingestBuildKnowledge(
                input.actor,
                { collection: doc.collection || 'uploads', title: doc.title, text: doc.text, sourceType: 'build-scoping' },
                input.deps,
              );
              if (id) indexed++;
            } catch (err) {
              console.warn(`[build] knowledge doc "${doc.title}" not ingested (non-fatal):`, err instanceof Error ? err.message : err);
            }
          }
          // Honest confirmation: partial ingests name the shortfall; an all-failed ingest is
          // narrated too (review-f1 Low: it used to be silent), never pretending success.
          if (indexed > 0) sink.planStep('knowledge-indexed', knowledgeIndexedNarration(indexed, docs.length));
          else if (docs.length > 0) sink.planStep('knowledge-indexed', knowledgeNotIndexedNarration(docs.length));
        }
      } catch (err) {
        console.warn('[build] knowledge scoping failed (non-fatal):', err instanceof Error ? err.message : err);
      }
    }

    const policy = toolPolicyFor('build');
    let liveMarkers = new MarkerProcessor(); // replaced on `text_reset` (B7 retraction)
    let capturedSessionId: string | undefined;

    // Progress narration (operator directive 2026-08-10). Before this, a build emitted
    // `knowledge-scope` and then NOTHING until the post-agent `verifying` phase - on a 34-minute
    // run that is half an hour of "A analisar..." with no evidence anything is happening, which
    // reads as a hang. The agent's own streamed commentary is not a substitute: it arrives as
    // unpunctuated mid-thought fragments on the thinking channel.
    // Derived from tool events, so it reports what the run DID, never what it promised. Deduped
    // on the rendered line: a file edited five times narrates once, and the noisy tools
    // (Read/Glob/Grep) never narrate at all.
    const narratedSteps = new Set<string>();
    const narrateProgress = (e: ToolEventInput): void => {
      const line = buildProgressLine(e); // null for read-only tools and non-`started` edges

      if (!line || narratedSteps.has(line)) return;
      narratedSteps.add(line);
      sink.planStep('building', line);
    };

    // The coding kind's content sections lead the build system prompt (before this run's F16
    // entrypoint steering) — pre-fix, builds sent ONLY the 6-line inline prompt and the whole
    // coding-agent content package was dead weight. The grounding block self-gates (legal-context
    // builds only, §5.5.2 layer 2); both layers are non-fatal.
    // WS6 incident fix: the model is briefed on the user's ORIGINAL words, never the chat-agent's
    // <=15-word build paraphrase (`input.description`) - that paraphrase is what used to be the
    // build agent's ENTIRE prompt, so "a construir uma apresentação do teu produto Cobranças"
    // briefed a slide deck when the user asked for a website. `description` keeps doing what it
    // is good at: naming the artifact (deriveAppName, build-mechanics.ts) and the classifier text
    // when no original message is carried (a direct composer build, where description already IS
    // the user's own words).
    const buildQuery = input.originalMessage?.trim() || input.description;
    let contentSections: string[] = [];
    let groundingBlock = '';
    try {
      contentSections = (await assembleAgentContext({ agentKind: 'coding', userId: input.actor.userId })).promptSections;
      groundingBlock = await knowledgeGrounding({ userId: input.actor.userId, orgId: input.actor.orgId, query: buildQuery, agentKind: 'coding' });
    } catch (err) {
      console.warn('[build] content/grounding assembly failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    // First-build conversation continuity (WS6 DO #2): no SDK session exists yet to resume, so
    // without this the build agent sees ONLY the current message - the same loss chat.ts already
    // fixed for chat turns (context.ts renderPrompt). Follow-ups skip this: they resume the real
    // SDK session (`resumeSessionId` below), which already carries the prior turns; re-injecting
    // history there would just duplicate context the engine already has. Capped like ekoa-dev's
    // conversation-transcript injection (cortex/src/adapters/external.ts) - non-fatal, a history
    // load failure just falls back to the bare query.
    let buildPrompt = buildQuery;
    if (opts.firstBuild && input.sessionId) {
      try {
        const history = capHistory(await loadHistory(input.sessionId), { maxTurns: 16, totalBudgetChars: 48_000, maxTurnChars: 24_000 });
        buildPrompt = renderPrompt(history, buildQuery);
      } catch (err) {
        console.warn('[build] conversation-history injection failed (non-fatal):', err instanceof Error ? err.message : err);
      }
    }

    // Overload resilience (finding 2026-08-13, the "20-minute todo app"): a run that dies to
    // provider overload BEFORE anything user-visible streamed gets ONE transparent in-job retry
    // instead of a terminal "Tente novamente". The manual retry it replaces was worse than slow:
    // because the failed first build had already created the artifact, the human's retry routed
    // as a FOLLOW-UP and silently dropped the GENIUS first-build directive (2026-08-07) — the
    // in-job retry keeps this run's own routing decision. Two triggers, one retry:
    //   - a thrown overload (the SDK's error-result throw classifies ADAPTER_ERROR, a transport
    //     5xx classifies PROVIDER_UNAVAILABLE — auth/rate-cap/unknown throws keep their existing
    //     terminal path untouched);
    //   - the first-event deadline: the SDK retries 529s internally and invisibly (measured
    //     4m10s of silence), so an attempt with ZERO events inside buildFirstEventDeadlineMs is
    //     aborted per-attempt (never the job) and treated as a dead overload window.
    // Anything already streamed to the user forfeits the retry (never re-stream a transcript).
    const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> =>
      new Promise((resolve) => {
        if (signal.aborted) { resolve(); return; }
        const onAbort = (): void => { clearTimeout(t); resolve(); };
        const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal.addEventListener('abort', onAbort);
      });
    let result!: AgentRunResult;
    let streamedAny = false; // ANSWER chunks only: thinking must not mask a provider-error-as-result
    for (let attempt = 0; ; attempt++) {
      streamedAny = false;
      liveMarkers = new MarkerProcessor();
      // Per-ATTEMPT abort: linked to the job's controller (user Stop / job timers still land
      // here), plus the first-event deadline that must kill only this attempt.
      const attemptAbort = new AbortController();
      const onJobAbort = (): void => attemptAbort.abort();
      abort.signal.addEventListener('abort', onJobAbort);
      if (abort.signal.aborted) attemptAbort.abort();
      let firstEventSeen = false;
      let deadlineFired = false;
      const firstEventTimer = setTimeout(() => {
        if (!firstEventSeen) { deadlineFired = true; attemptAbort.abort(); }
      }, cfg.buildFirstEventDeadlineMs);
      const sawEvent = (): void => {
        firstEventSeen = true;
      };

      let thrown: unknown;
      try {
        const handle = runAgent(
          {
            prompt: buildPrompt,
            // F16: pin the agent to the served entrypoint. Nothing else names it (settingSources is
            // empty, §5.4.2), so without this the agent may write a standalone HTML file that is
            // never served while the scaffold keeps being compiled. Flows through runAgent's
            // anonymise path like every prompt (client.ts systemPrompt handling).
            // Base conventions (operator-run B1) sit between the universal coding sections and
            // the grounding block: universal judgment first, then the selected base's structural
            // invariants, then dynamic knowledge, then the F16 entrypoint steer.
            systemPrompt: [
              ...contentSections,
              ...basePromptSections,
              groundingBlock,
              BUILD_SYSTEM_PROMPT,
              // The impeccable scripts' concrete location. Without this the agent guesses the
              // upstream default (`.claude/skills/impeccable/...`), finds nothing in the sandbox,
              // and SELF-ASSIGNS its direction - observed on the second live build (2026-08-08):
              // "scripts do plugin indisponiveis no sandbox" in its DESIGN.md, i.e. the argmax rut
              // the concept-seed roll exists to break. Absolute path, resolved server-side.
              cfg.impeccablePluginDir
                ? `The impeccable skill's scripts live at ${join(cfg.impeccablePluginDir, 'skills', 'impeccable', 'scripts')} (absolute path; the upstream docs' \`.claude/skills/impeccable/...\` path does not exist in this sandbox). Example: \`node ${join(cfg.impeccablePluginDir, 'skills', 'impeccable', 'scripts', 'concept-seed.mjs')} --scope direction --mode persuade\`. Run them from your project directory; never copy them into it.`
                : '',
            ].filter(Boolean).join('\n\n'),
            decision,
            allowedTools: policy.allowedTools,
            maxTurns: policy.maxTurns,
            // Builds mount the knowledge tools + the context-loading tool + the §5.4.8 local-bridge
            // delegation tool as in-process MCP (§5.4.4; ch18 §18.2), plus the three ekoa-docx tools
            // (2C-S5). The docx tools are ARTIFACT-BOUND: appId = artifactId, so the linked Word
            // document they read/link/redline is the one on the artifact being built - never an id
            // the model can name. Attribution ("<user> (Ekoa)" on every w:ins/w:del) and the path
            // jail for `path` arguments (the run's projectDir) likewise bind HERE, from the run, not
            // from tool arguments. Before the first build resolves an artifact, appId is undefined
            // and the artifact-bound tools say so honestly.
            sdkTools: [
              ...knowledgeToolSpecs(input.actor),
              loadContextToolSpec(input.actor, 'coding'),
              delegateToolSpec(input.actor, input.sessionId),
              ...docxToolSpecs({ appId: artifactId || undefined, userName: input.username, allowedDirs: projectDir ? [projectDir] : [] }),
            ],
            cwd: projectDir || undefined,
            homeDir: projectDir || undefined, // build runs set HOME = projectDir (§5.4.1)
            // Design-skill plugin: the vendored impeccable skill (api/content/plugins/impeccable,
            // Apache-2.0 fork of pbakaus/impeccable v4.0.4), mounted as an Agent SDK local plugin so
            // it loads by progressive disclosure on design-shaped work. It REPLACES the ekoa-design
            // mount: two design skills with competing directives is the same class of contradiction
            // the WS7 incident traced. Server-resolved config path; EKOA_IMPECCABLE_PLUGIN_DIR=""
            // disables. Its concept-seed/serve-question scripts self-detect this headless harness and
            // degrade exactly as their own docs specify (assigned direction, no browser page); the
            // roll API is additionally forced offline via env at server boot (server.ts).
            ...(cfg.impeccablePluginDir ? { plugins: [cfg.impeccablePluginDir] } : {}),
            ...(resumeSessionId ? { resume: resumeSessionId } : {}),
            steerable: true, // Conduzir: mid-run user messages join this run (POST /jobs/:id/steer)
            signal: attemptAbort.signal,
            callbacks: {
              onToolEvent: (e) => { sawEvent(); resetInactivity(); sink.toolEvent(e); narrateProgress(e); },
              onSessionId: (sid) => { sawEvent(); capturedSessionId = sid; },
              onPlanNotification: () => { sawEvent(); resetInactivity(); },
            },
          },
          { kind: 'user_work', agentType: 'build', billeeUserId: input.actor.userId, sessionId: input.sessionId, runId: jobId, artifactId },
        );
        const liveEntry = getRun(jobId);
        if (liveEntry) liveEntry.steer = (text) => handle.steer(text);

        // Two channels, mirroring chat.ts (§5.6.1): the ANSWER stream (`text`) and the working
        // commentary (`thinking` — intermediate-turn narration + thinking blocks, where the engine
        // happily self-identifies). Pre-fix, build funneled BOTH into text_chunk, so the user's
        // transcript filled with mid-word fragments of internal narration rendered as regular
        // messages (operator report 2026-07-11). Each channel gets its own marker filter; the
        // thinking channel is additionally engine-identity-redacted (branding.ts).
        const thinkingMarkers = new MarkerProcessor();
        const thinkingRedactor = new StreamingIdentityRedactor();
        const emitThinking = (piece: string): void => {
          if (piece) sink.thinking(piece);
        };
        for await (const ev of handle.events) {
          sawEvent();
          resetInactivity();
          if (ev.type === 'thinking') {
            emitThinking(thinkingRedactor.push(thinkingMarkers.push(ev.text)));
            continue;
          }
          if (ev.type === 'text_reset') {
            // B7 retraction: deltas streamed so far this turn were narration, not the answer.
            // Fresh marker state; streamedAny returns to false so the §5.3.7 error-as-result
            // scan still applies when only retracted narration streamed. FORWARDED to the client
            // (codex B7 finding): the wire event is the ONLY signal on which the client drops its
            // buffered stream — never inferred from a tool_event.
            streamedAny = false;
            liveMarkers = new MarkerProcessor();
            sink.textReset();
            continue;
          }
          streamedAny = true;
          const clean = liveMarkers.push(ev.text);
          if (clean) sink.text(clean);
        }
        const thinkingTail = thinkingMarkers.end();
        emitThinking(thinkingRedactor.push(thinkingTail.text) + thinkingRedactor.end());
        const tail = liveMarkers.end();
        if (tail.text) sink.text(tail.text);
        result = await handle.result;
      } catch (err) {
        thrown = err;
      } finally {
        clearTimeout(firstEventTimer);
        abort.signal.removeEventListener('abort', onJobAbort);
      }

      // A JOB-level abort (user Stop / the job timers) terminates exactly as before — the
      // attempt machinery never swallows it.
      if (abort.signal.aborted) { await settleAborted(); return; }

      // §5.6.2 completion sequence, step 1: provider-error-as-result reroute (§5.3.7). Scanned
      // only on the nothing-streamed fallback shape — same reasoning as chat.ts (F20 made
      // result.text the full accumulation; legitimate build narration can mention error terms).
      // Only the TRANSIENT class retries — an auth-classed error-as-result is operator work,
      // not an overload window, and goes terminal immediately exactly as before.
      const errorClass = !thrown && !result.aborted && !streamedAny ? scanProviderError(result.text) : null;
      const errorAsResult = errorClass !== null;
      const thrownCode = thrown !== undefined ? classifyRunFailure(thrown) : undefined;
      const overloadThrow = thrownCode === 'ADAPTER_ERROR' || thrownCode === 'PROVIDER_UNAVAILABLE';
      const attemptDied = thrown !== undefined || errorAsResult || (deadlineFired && result.aborted);

      if (!attemptDied) {
        if (result.aborted) { await settleAborted(); return; } // defensive: no known path here
        break; // healthy result — continue the completion sequence
      }
      // Auth / rate-cap / unknown throws keep their existing terminal classification. A
      // deadline-fired attempt is overload BY CONSTRUCTION, whatever its abort surfaced as
      // (the per-attempt abort can reach here as a thrown LlmAbortedError, which would
      // otherwise classify TIMEOUT and wrongly terminal the job).
      if (thrown !== undefined && !overloadThrow && !deadlineFired) throw thrown;

      const cause = deadlineFired
        ? `no model activity within ${cfg.buildFirstEventDeadlineMs}ms (overload window)`
        : thrown !== undefined
          ? (thrown instanceof Error ? thrown.message : String(thrown))
          : `provider error result (${errorClass})`;
      const canRetry = attempt === 0 && !streamedAny && errorClass !== 'auth';
      if (!canRetry) {
        if (thrown !== undefined && !deadlineFired) throw thrown;
        await finishError('ADAPTER_ERROR', undefined, attempt > 0 ? `${cause}; retry exhausted` : cause);
        return;
      }
      console.warn(`[build][job ${jobId}] attempt ${attempt + 1} died to provider overload (${cause}); retrying once in ${cfg.buildOverloadRetryDelayMs}ms`);
      sink.planStep('retrying', 'O serviço está momentaneamente sobrecarregado. A repetir automaticamente...');
      await abortableDelay(cfg.buildOverloadRetryDelayMs, abort.signal);
      if (abort.signal.aborted) { await settleAborted(); return; }
      resetInactivity();
    }
    clearTimers();

    // Session resume (§5.4.5): persist sdkSessionId ONLY when it differs from what we resumed with.
    if (capturedSessionId && capturedSessionId !== resumeSessionId) {
      await mech.persistSdkSessionId(artifactId, capturedSessionId);
    }

    // Step 2: final bundle. Step 3: version snapshot (broken builds snapshotted with a failure tag).
    const bundle = await mech.finalizeBundle({ artifactId, projectDir });
    await mech.snapshot({ artifactId, projectDir, broken: !bundle.ok });

    // Step 4: slug — preserved on follow-ups, generated on first builds (already resolved in prep).

    // Step 5a (F16): honest-completion gate. Deterministic evidence the work reached the SERVED
    // surface — an untouched entrypoint subtree / scaffold-fingerprinted dist means the user's
    // app was never built (the classic miss: the real app written to an orphan top-level HTML
    // that is never served). A gate hit is a DISTINCT non-success terminal: it surfaces to the
    // user and the job fails — never a clean `completed` over a scaffold. Runs before the model
    // verification (step 5) so a scaffold build is never billed a verification pass.
    const progress = await mech.assertProgress({ artifactId, projectDir });
    if (!progress.clean) {
      if (finalizeOnce(jobId)) {
        // `progress.reasons` are gate diagnostics (entrypoint subtrees, scaffold fingerprints):
        // operator detail, not user copy. Persisted + logged, never streamed.
        const detail = progress.reasons.join('; ');
        console.error(`[build][job ${jobId}] terminal BUILD_UNFULFILLED:`, detail);
        sink.error('BUILD_UNFULFILLED');
        await patchJob(jobId, { status: 'failed', error: { code: 'BUILD_UNFULFILLED', message: detail }, endedAt: new Date(input.deps.now()).toISOString() });
      }
      terminalReached = true;
      return;
    }

    // Step 5: per-build verification (default ON per user's build.verifyBuilds). Full acceptance
    // pass on a first build; scoped tests + smoke on a follow-up. The runner receives the user's
    // REQUEST and asserts request-fulfilment (F28), not mere rendering. Verdict semantics:
    //   - ran+passed  → clean, no note.
    //   - ran+FAILED  → GATES completion (F28): a distinct non-success terminal that surfaces to
    //     the user — never a silent `completed` with a note (that was verification theater: the
    //     gate that exists to catch a served scaffold passed it and billed for the pass).
    //   - not-run (e.g. credential-skip) → honest note-only, never a failure (§5.6.2 step 5).
    let verifyNote: string | undefined;
    const verifyEnabled = (await userSettings.get(input.actor.userId))?.build?.verifyBuilds ?? true;
    if (verifyEnabled) {
      sink.planStep('verifying', 'A testar a aplicação...');
      // The verify stage streams its narration through the thinking channel — it used to be a
      // silent multi-minute void (operator report 2026-07-11). Its own filter chain: raw runner
      // text → marker filter → engine-identity redaction. Verify is bounded by its own wall
      // clock inside the runner (verifyWallClockMs), not the build timers (cleared above).
      const verifyMarkers = new MarkerProcessor();
      const verifyRedactor = new StreamingIdentityRedactor();
      // Per-action live progress (operator ask 2026-07-14): the verify agent marks each
      // discrete action with ">> " (verify-runner buildPrompt). The scan is MARKER-anchored,
      // not line-anchored: live runs showed the model gluing ">>" to the end of the previous
      // sentence ("Vou registar o pedido.>> A ir para Aprovações"), which a startsWith('>>')
      // line parser silently drops. An action runs from a ">>" to the next newline or the
      // next ">>". Chunks are scanned AFTER the same marker+identity scrub as the thinking
      // copy; each action re-emits as a same-status plan_step - the client shows it beside
      // the spinner and in the Output tab without adding chat messages.
      const VERIFY_ACTION_MAX = 200;
      let verifyLineBuf = '';
      const emitVerifyActions = (clean: string): void => {
        verifyLineBuf += clean;
        for (;;) {
          const start = verifyLineBuf.indexOf('>>');
          if (start < 0) {
            // No marker: keep one char so a ">" pair split across chunks still matches.
            verifyLineBuf = verifyLineBuf.slice(-1);
            return;
          }
          const rest = verifyLineBuf.slice(start + 2);
          const nl = rest.indexOf('\n');
          const next = rest.indexOf('>>');
          const end = nl >= 0 && (next < 0 || nl < next) ? nl : next;
          if (end < 0) {
            // Incomplete action: wait for more text, bounded so a marker mid-prose
            // cannot grow the buffer without ever emitting.
            verifyLineBuf = verifyLineBuf.slice(start);
            if (verifyLineBuf.length > 2 + VERIFY_ACTION_MAX) {
              const action = verifyLineBuf.slice(2, 2 + VERIFY_ACTION_MAX).trim();
              if (action) sink.planStep('verifying', action);
              verifyLineBuf = '';
            }
            return;
          }
          const action = rest.slice(0, end).trim().slice(0, VERIFY_ACTION_MAX);
          if (action) sink.planStep('verifying', action);
          verifyLineBuf = rest.slice(end + (nl >= 0 && end === nl ? 1 : 0));
        }
      };
      const verdict = await verifyRunner({
        artifactId,
        projectDir,
        appUrl,
        userId: input.actor.userId,
        depth: opts.firstBuild ? 'full' : 'scoped',
        request: input.description,
        onProgress: (text) => {
          const clean = verifyRedactor.push(verifyMarkers.push(text));
          if (clean) {
            sink.thinking(clean);
            emitVerifyActions(clean);
          }
        },
      });
      // Flush the scrub chain's hold-back tails (MarkerProcessor + redactor buffer partial
      // input to catch split markers) - without this the final characters of the verify
      // narration, and any last un-terminated ">> " action line, were silently dropped.
      const verifyTail = verifyMarkers.end();
      const verifyTailClean = verifyRedactor.push(verifyTail.text) + verifyRedactor.end();
      if (verifyTailClean) {
        sink.thinking(verifyTailClean);
        emitVerifyActions(verifyTailClean);
      }
      if (verifyLineBuf.trim().startsWith('>>')) {
        const lastAction = verifyLineBuf.trim().slice(2).trim().slice(0, VERIFY_ACTION_MAX);
        if (lastAction) sink.planStep('verifying', lastAction);
      }
      verifyLineBuf = '';
      if (verdict.ran && !verdict.passed) {
        if (finalizeOnce(jobId)) {
          // `verdict.note` is MODEL-DERIVED and can quote app data (a NIF/IBAN the verifier read)
          // — the same reason `jobView` refuses to serve the persisted message. It stays
          // server-side; the stream carries the code alone.
          sink.error('VERIFY_FAILED');
          await patchJob(jobId, { status: 'failed', error: { code: 'VERIFY_FAILED', message: verdict.note ?? '' }, endedAt: new Date(input.deps.now()).toISOString() });
        }
        terminalReached = true;
        return;
      }
      if (!verdict.ran && verdict.note) verifyNote = verdict.note;
    }

    // Step 6: complete event. Notes (bundle error / honest verify not-run) are APPENDED to the
    // agent's user-facing summary, never a replacement for it — pre-fix, any note clobbered the
    // whole summary, so the user's "done" message was just "verification did not run: ..."
    // (operator report 2026-07-11).
    // `bundle.error` is `result.errors.join('; ')` from esbuild - raw compiler diagnostics
    // carrying SANDBOX FILE PATHS and internal module names. The 2026-07-11 operator fix was
    // about notes not CLOBBERING the summary; it never asked for the diagnostic itself to be
    // user copy. The user gets a fixed sentence, operators get the diagnostic in the log and on
    // the persisted job record (finding `run-error-text-leak`).
    if (!bundle.ok) console.error(`[build][job ${jobId}] final bundle failed:`, bundle.error ?? '(no detail)');
    const notes = [bundle.ok ? '' : 'A compilação final da aplicação falhou.', verifyNote ?? ''].filter(Boolean).join(' ');
    const completionText = [result.text, notes].filter(Boolean).join('\n\n') || notes;
    if (finalizeOnce(jobId)) {
      sink.complete({ result: completionText, artifactId, slug, appUrl }, input.deps.now() - start);
      await patchJob(jobId, { status: 'completed', result: { text: completionText, slug, appUrl }, endedAt: new Date(input.deps.now()).toISOString() });
    }
    terminalReached = true;

    // Step 7: artifact → active with a MERGE onto its data bag (§5.6.2 step 7).
    // projectDir lets activation capture the app's declared UI action manifest (C2).
    await mech.activateArtifact({ artifactId, slug, appUrl, ...(projectDir ? { projectDir } : {}) });
    // Step 8: fire-and-forget screenshot + post-run memory extraction OFF the terminal event.
    mech.screenshot(artifactId);
    void runPostRunExtraction({ userId: input.actor.userId, username: input.username, orgId: input.actor.orgId, sessionId: input.sessionId, runId: jobId, transcript: `${input.description}\n\n${result.text}`, deps: input.deps }).catch(() => undefined);
  } catch (err) {
    clearTimers();
    // Classify (a dead platform credential is AUTH_ERROR, not a retryable blip) and LOG. The old
    // `void err` swallowed the cause outright: a failed build left nothing behind to diagnose it.
    await finishError(classifyRunFailure(err), undefined, err);
  } finally {
    clearTimers();
    // In-process zombie net (§5.2.1): a run somehow still non-terminal after the pipeline exits is
    // flipped to failed { PIPELINE_STUCK } and its artifact reset to draft.
    if (!terminalReached && finalizeOnce(jobId)) {
      sink.error('PIPELINE_STUCK');
      await patchJob(jobId, { status: 'failed', error: { code: 'PIPELINE_STUCK', message: 'Pipeline stuck.' }, endedAt: new Date(input.deps.now()).toISOString() });
      if (artifactId) await resetArtifactToDraft(artifactId);
    }
    if (input.sessionId) releaseReservation(input.sessionId, jobId); // guarded by job id (§5.3.3)
    removeRun(jobId);
    // Registo (F3): ONE terminal row per build, from the record's final status (guaranteed-once
    // here — every terminal transition has already patched the store). Metadata is ids/codes only.
    // Best-effort: a store read that fails (e.g. the DB went away as the process exits) must NOT
    // become an unhandled rejection on this fire-and-forget pipeline — swallow it like the audit
    // write itself (a missed bookkeeping row never fails a build).
    try {
      const finalJob = await getJob(jobId);
      const st = finalJob?.status;
      if (st === 'completed') auditBuild(input, 'completed', { jobId, ...(artifactId ? { artifactId } : {}) });
      else if (st === 'failed') auditBuild(input, 'failed', { jobId, code: finalJob?.error?.code ?? 'UNKNOWN' });
      else if (st === 'cancelled') auditBuild(input, 'cancelled', { jobId });
    } catch {
      /* terminal-audit read failed (shutdown/db hiccup) — best-effort, never fails the build */
    }
  }

  function clearTimers(): void {
    clearTimeout(inactivityTimer);
    clearTimeout(wallClock);
  }

  // Cancelled/plain-abort terminal: set the cancelled status (cancel set it BEFORE the abort, so
  // the terminal transition here is the cancelled one; a plain abort stays quiet).
  async function bail(): Promise<void> {
    clearTimers();
    if (entry?.cancelled && finalizeOnce(jobId)) {
      await patchJob(jobId, { status: 'cancelled', endedAt: new Date(input.deps.now()).toISOString() });
    }
    terminalReached = true;
  }

  // Abort resolution (§5.3.6): a timeout surfaces a terminal ERROR wherever the abort lands —
  // including the early checkpoints before the stream — while a user Stop stays silent (cancel
  // owns the terminal state). Found by the G7B fresh-context review: bail() alone is
  // timeout-blind, so a timeout during checkAllowance/prepare was misreported as a cancel.
  async function settleAborted(): Promise<void> {
    clearTimers();
    if (entry?.timedOut && !entry.cancelled) await finishError('TIMEOUT');
    else await bail();
  }
}

export { getJob };
