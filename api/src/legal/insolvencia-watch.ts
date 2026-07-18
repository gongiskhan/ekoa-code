/**
 * Publicações de insolvência - Citius área pública, o vigilante por NIF/nome (mega-run E4,
 * BRIEF §8 item 4). `08-portal-audit.md` §4: a poll listener is DECLARED (automation trigger
 * kind `'listener' { pollAction, pollIntervalMs }`, the citius integration's own
 * `listenerConfig`) but has NO runtime anywhere in the codebase - "the missing piece is a
 * small poll scheduler". That declared listener is bound to the SIGNED-IN eTribunal
 * integration (audit §1c) though, and BRIEF §10's "Run 2 note" excludes every signed-in
 * connector from this run (needs attended validation against a real portal, which conflicts
 * with the synthetic-only rule). Wiring the generic `pollIntervalMs` runtime here would make
 * that signed-in listener real too - reaching outside this slice's public-tier scope for a
 * connector this run never built.
 *
 * DECISION (BRIEF §8 item 2, "decide and document which"): no cron/scheduler exists cleanly
 * for a PUBLIC-tier connector either (08-portal-audit.md §4: "the only periodic loop in the
 * codebase is the delivery safety-net drain", which is `events/delivery.ts`'s webhook-target
 * dispatcher, not a general scheduler). So `pollInsolvencyWatches` below is a plain callable
 * an operator/cron invokes directly (looping the dossiês it cares about); `router.ts` also
 * exposes `POST /api/legal/portal/insolvency/poll` (`requireLegalSuiteApp` tier) so a test or
 * a future UI action can trigger one poll cycle for a single dossiê deterministically,
 * without waiting on a scheduler. Same "callable + manual route" shape `portal-connectors.ts`
 * already uses for E2/E3's on-demand retrieval.
 *
 * Discipline carried from citius.ts/portal-connectors.ts: a real HTTP client behind a
 * base-URL config (`config.ts`), an injected `fetchImpl` seam so every test drives committed
 * fixtures, `guardedFetch` (SSRF-guarded) as the live default, and an honest
 * `{ok:false,error}` on any failure - never a throw. `parsePublicacoes`/`decodeHtml` are
 * REUSED verbatim from citius.ts (same liberal table-walker: the insolvência consulta page is
 * the same ASP.NET WebForms results-grid shape, queried by subject name/NIF instead of
 * `NumProcesso`).
 *
 * Idempotency (BRIEF §8 constraint 3, "a seen-set"): each watch row keeps its OWN `seenRefs`
 * dedup set, not `events/queue.ts`'s trigger/event queue. That queue's `UNIQUE(triggerId,
 * dedupKey)` dedup is scoped to REAL registered `TriggerDoc`s; its rows are drained by
 * `delivery.ts`, which dead-letters any `triggerId` that does not resolve to one
 * (`delivery.ts:76-79`). A watch is not a webhook trigger, so reusing that store would leave
 * synthetic dead rows inside a subsystem that means something else to the ops/dead-letter
 * view. A ref is a stable hash of (subject, processo, tribunal, data, ato, texto) - the same
 * "no unique id on the source page" situation citius.ts already lives with for citações.
 */
import { createHash } from 'node:crypto';
import type { PortalEvent } from '@ekoa/shared';
import { guardedFetch } from '../services/url-fetcher.js';
import { loadPortalConnectorsConfig } from '../config.js';
import type { ActivityActor, LogActivityDeps } from '../data/activity.js';
import { parsePublicacoes, decodeHtml, type CitiusPublicacao } from './citius.js';
import { assertOwnerOrg, attachPortalEvent, type PortalSpineDeps } from './portal.js';
import type { ResolvedLegalApp } from './access-gate.js';
import type { FetchImpl, FetchLikeResponse } from './citius.js';

export type { FetchImpl, FetchLikeResponse };

/** The satellite collection watches live in - mirrors the documentos/eventos naming, the
 *  same `citius_`-prefix convention the triage engine already uses for Citius-derived rows
 *  (`citius_notificacoes`, 08-portal-audit.md §1d). A watch row `{processoId, subjects,
 *  lastSeen, seenRefs}` is ORDINARY dossiê data (BRIEF §8 constraint 0): it is written
 *  through the SAME generic owner-spine collections plane documentos/eventos already use
 *  (`/api/app-shared/citius_watches` from inside a served app, or directly via the
 *  CollectionsEngine from server-side code) - no dedicated registration endpoint, lowest
 *  viable tier. */
export const CITIUS_WATCH_COLLECTION = 'citius_watches';

/** Owner-spine seams for the watches collection (mirrors `PortalSpineDeps.listDocumentos`/
 *  `listEventos` - rows are plain records; this module reads only `processoId`/`subjects`/
 *  `seenRefs`/`id` off them, liberal-parsing the rest like every other legal/ connector). */
export interface InsolvencyWatchSpineDeps {
  /** Already filtered to the given processoId (server.ts wiring convention). */
  listWatches: (app: ResolvedLegalApp, processoId: string) => Promise<Array<Record<string, unknown>>>;
  /** Merge-patch by watch id (server.ts wires this onto the engine's upsert). */
  updateWatch: (app: ResolvedLegalApp, watchId: string, patch: Record<string, unknown>) => Promise<void>;
}

/** URL público da consulta de publicações de insolvência do Citius (mesmo domínio de
 *  `citius.ts`'s ConsultasCitacoes.aspx, outra página WebForms). */
export const CITIUS_INSOLVENCIA_PATH = '/portal/consultas/ConsultasInsolvencias.aspx';

function buildInsolvenciaUrl(baseUrl: string, subject: string): string {
  const u = new URL(CITIUS_INSOLVENCIA_PATH, baseUrl);
  u.searchParams.set('Nome', subject);
  return u.toString();
}

/** Milliseconds before the default (live) fetch aborts a hung portal request (citius.ts parity). */
const LIVE_FETCH_TIMEOUT_MS = 12_000;

/** Default live fetch: SSRF-guarded. Tests inject their own `fetchImpl`. */
const defaultFetch: FetchImpl = async (url, init) => guardedFetch(url, { headers: init?.headers, timeoutMs: LIVE_FETCH_TIMEOUT_MS });

export interface InsolvenciaSubjectFetchResult {
  ok: boolean;
  subject: string;
  publicacoes: CitiusPublicacao[];
  /** PT-PT message when `ok` is false. */
  error?: string;
}

/**
 * Fetches + parses the insolvência publications for ONE watched subject (NIF/nome). Never
 * throws: a network error or non-2xx upstream resolves to `{ok:false,error}` (citius.ts's
 * "unavailable" idiom). A genuinely empty result page (no publications for this subject) is
 * `{ok:true,publicacoes:[]}` - not an error.
 */
export async function fetchInsolvenciaPublicacoes(
  subject: string,
  opts: { fetchImpl?: FetchImpl; baseUrl?: string } = {},
): Promise<InsolvenciaSubjectFetchResult> {
  const s = String(subject || '').trim();
  if (!s) {
    return { ok: false, subject: s, publicacoes: [], error: 'Sujeito de vigilância em falta' };
  }
  const fetchImpl: FetchImpl = opts.fetchImpl ?? defaultFetch;
  const baseUrl = opts.baseUrl ?? loadPortalConnectorsConfig().citiusInsolvenciaBaseUrl;

  try {
    const res = await fetchImpl(buildInsolvenciaUrl(baseUrl, s), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EkoaLegal/1.0; +https://ekoa.io)',
        Accept: 'text/html',
      },
    });
    if (!res || !res.ok) {
      return { ok: false, subject: s, publicacoes: [], error: 'Publicações de insolvência indisponíveis' };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const html = decodeHtml(buf, res.headers.get('content-type') || '');
    return { ok: true, subject: s, publicacoes: parsePublicacoes(html) };
  } catch {
    return { ok: false, subject: s, publicacoes: [], error: 'Publicações de insolvência indisponíveis' };
  }
}

/** A stable dedup key for one publication, scoped to the subject that was queried (the same
 *  publication can legitimately match two different watched subjects on the same dossiê -
 *  e.g. two named réus - and each is its own watch.hit). */
function publicacaoRef(subject: string, pub: CitiusPublicacao): string {
  return createHash('sha256')
    .update([subject, pub.processo, pub.tribunal, pub.data, pub.ato, pub.texto].join('|'))
    .digest('hex')
    .slice(0, 24);
}

function readWatch(row: Record<string, unknown>): { id: string; subjects: string[]; seenRefs: string[] } {
  return {
    id: String(row.id ?? ''),
    subjects: Array.isArray(row.subjects) ? row.subjects.map((s) => String(s)).filter(Boolean) : [],
    seenRefs: Array.isArray(row.seenRefs) ? row.seenRefs.map((s) => String(s)) : [],
  };
}

export interface PollInsolvencyDeps extends InsolvencyWatchSpineDeps, PortalSpineDeps, LogActivityDeps {
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}

export interface PollInsolvencyResult {
  ok: true;
  processoId: string;
  newEvents: PortalEvent[];
}

/**
 * Runs one poll cycle for a dossiê's insolvência watches: for every watch registered on
 * `processoId`, fetches each watched subject's publications, diffs against the watch's own
 * `seenRefs` set, and for each genuinely NEW publication attaches a `PortalEvent
 * {kind:'watch.hit'}` onto the dossiê (`attachPortalEvent` - the documentos/eventos satellite
 * + the single `logActivity` seam, refs-only per the E1 audit-vocabulary finding) with a
 * PT-PT message ("Nova publicação para a contraparte X", BRIEF §8 item 4), then advances the
 * watch's `seenRefs`. A poll that finds nothing new emits NOTHING (BRIEF §8 constraint 3) -
 * `newEvents` is empty and no `attachPortalEvent` call happens. One subject's transient fetch
 * failure never blocks the other subjects on the same watch, or other watches on the dossiê.
 *
 * Org-scoped: `assertOwnerOrg` throws `PortalOrgMismatchError` BEFORE any fetch if `actor`
 * does not own the dossiê (the E1/E2/E3 discipline); `attachPortalEvent` re-checks per event
 * (defence in depth, same as `retrieveCertidao`).
 */
export async function pollInsolvencyWatches(
  app: ResolvedLegalApp,
  processoId: string,
  actor: ActivityActor,
  deps: PollInsolvencyDeps,
): Promise<PollInsolvencyResult> {
  await assertOwnerOrg(app, actor.orgId, deps);

  const rows = await deps.listWatches(app, processoId);
  const newEvents: PortalEvent[] = [];
  const observedAt = new Date(deps.now()).toISOString();

  // Bound seenRefs so a long-lived watch does not grow the row without limit. refs accumulate
  // with the most-recently-EMITTED at the tail, so slice(-CAP) keeps the newest CAP. v1 LIMITS
  // (fixture-driven; real-portal use is the attended signed-in follow-up run - BRIEF §8 run-2
  // note): (1) the cap assumes the portal's active result window stays under CAP, which holds
  // for the Citius publico insolvencia list (a handful of recent rows per subject); a single
  // cycle emitting >CAP genuinely-new publications for one dossiê is unrealistic. (2) the
  // emit-then-persist step is at-least-once, not atomic: if updateWatch itself fails AFTER a
  // durable event write, that one publication can re-emit on the next poll (a duplicate
  // timeline entry, never data loss / cross-org). Both are acceptable, documented v1 behaviour.
  const SEEN_REFS_CAP = 500;

  for (const row of rows) {
    const watch = readWatch(row);
    if (!watch.id) continue;
    const seen = new Set(watch.seenRefs);
    let refs = [...watch.seenRefs];

    for (const subject of watch.subjects) {
      const fetched = await fetchInsolvenciaPublicacoes(subject, { fetchImpl: deps.fetchImpl, baseUrl: deps.baseUrl });
      if (!fetched.ok) continue; // a transient failure on one subject never blocks the rest
      for (const pub of fetched.publicacoes) {
        const ref = publicacaoRef(subject, pub);
        if (seen.has(ref)) continue;

        const event: PortalEvent = {
          source: 'citius-insolvencia',
          kind: 'watch.hit',
          subjectRef: subject,
          dossierRef: processoId,
          observedAt,
          payload: {
            processo: pub.processo,
            tribunal: pub.tribunal,
            data: pub.data,
            ato: pub.ato,
            texto: pub.texto,
            // PT-PT surfaced message, exact BRIEF §8 item 4 shape.
            mensagem: `Nova publicação para a contraparte ${subject}`,
          },
        };
        // Emit FIRST, then persist this ref BEFORE the next emit: seenRefs advances atomically
        // with each durable event, so a mid-cycle attach failure never re-emits an already-
        // emitted publication on the next poll (review finding: double-emit on partial failure).
        await attachPortalEvent(app, event, actor, deps);
        seen.add(ref);
        refs = [...refs, ref].slice(-SEEN_REFS_CAP);
        await deps.updateWatch(app, watch.id, { lastSeen: observedAt, seenRefs: refs });
        newEvents.push(event);
      }
    }

    // Advance lastSeen even when nothing new emitted (a clean poll still ran).
    await deps.updateWatch(app, watch.id, { lastSeen: observedAt, seenRefs: refs });
  }

  return { ok: true, processoId, newEvents };
}
