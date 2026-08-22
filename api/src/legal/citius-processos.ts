/**
 * legal/citius-processos.ts - THE "ONGOING PROCESSES" READ (slice S9).
 *
 * ================================ WHAT THIS ANSWERS, EXACTLY ====================================
 *
 * "Which processes does this mandatário have running at CITIUS?" - answered from the notification
 * metadata the Citius sync rail has ALREADY LANDED for that mandatário, and from nothing else.
 * There is no portal request here, no session, no automation and no credential: by the time this
 * function runs, the contacting was done by `legal/citius-sync.ts` under its own five-hazard
 * completeness reasoning, and this module is a projection over the result.
 *
 * ================================ WHY THIS IS THE HONEST BACKING ================================
 *
 * S9's brief allowed two shapes, and the choice between them is recorded in `docs/decisions.md`
 * (D-S9-1). The alternative was a `list-ongoing-processes` browser-steps template walking the
 * portal's "Os meus processos" grid. It was rejected for three reasons, in descending order of
 * weight:
 *
 *   1. IT WOULD BE A SECOND CITIUS ENUMERATOR (Capability Contract rule 1). The portal walk exists
 *      once, in the sync rail, and the sync rail's docblock is five named hazards long - a
 *      `pageTotal` that is two different quantities, a `pages` that is a number upstream and an
 *      array downstream, a `maxPages` that exists on both sides, an actor term that must be in the
 *      state key, and two coordinate systems in one comparison that was a LIVE silent miss until
 *      CS8. A second walk would re-derive every one of those, and four of the five are silent when
 *      got wrong: a truncated sweep certified as complete looks exactly like a short list.
 *   2. NOTHING COULD PROVE IT. A browser-steps template against an authenticated portal cannot run
 *      in CI at all, so the whole action would ship as a fixture with a promise attached - which is
 *      precisely what the OPEN finding this slice closes was complaining about.
 *   3. IT WOULD NEED A SESSION PER CALL. The sync spends one session and lands rows that every
 *      later read is free; a per-call walk re-authenticates a portal whose lock-out policy is
 *      unobserved (CS5's caller contract), on a rail a schedule can fire.
 *
 * ================================ AND WHAT IT HONESTLY COSTS ====================================
 *
 * THE COVERAGE IS "PROCESSES WITH NOTIFICATIONS", NOT "PROCESSES". Stated here, in the action's own
 * `description`, and in `docs/findings.md`, because it is the one thing a reader could otherwise
 * assume wrongly: a process that has generated no notification inside the window the sync has swept
 * DOES NOT APPEAR. A dormant case - fully constituted, waiting on a court that has not moved - is
 * invisible to this read until the next act on it arrives in the inbox.
 *
 * That is a real limitation and it is not hidden by the answer: every row carries how many
 * notifications it was derived from and when the most recent one arrived, and the payload names its
 * own provenance in `origem`. A caller can therefore tell a list of ACTIVE processes from a list of
 * ALL processes without reading this file. The portal's own process list is the thing that would
 * lift the limitation, and lifting it is the acceptance run's work, not CI's.
 *
 * AND HOW FRESH IT IS, which the first cut left out and is a different question from coverage: see
 * `CitiusSincronizacaoView`. Knowing the list is notification-derived does not tell a lawyer whether
 * the sync ran this morning or died three weeks ago, and both used to answer with the same empty
 * document.
 *
 * ================================ TENANCY (Capability Contract rule 5) ==========================
 *
 * NO NEW STORE. This module holds no collection handle at all: it calls
 * `listCitiusNotificationRows`, which is scoped by `syncStateKeyFor` - the SAME derivation the sync
 * writer uses, including the actor term that makes one org's two lawyers two different inboxes
 * (hazard 4). The scope arrives from the executor as the (orgId, ownerUserId) it already resolved
 * and gated; nothing in the action's package or in the caller's `args` can name a tenant.
 *
 * ================================ IT DEREFERENCES NOTHING =======================================
 *
 * The sync's operator-locked invariant is that it reads notification METADATA ONLY and never opens
 * a document. This module is downstream of that and keeps it: it reads `temDocumento`, a boolean,
 * and COUNTS it. It never reads `documentoRef` - the inert captured token - and never emits it, so
 * the process rows this action returns carry no handle to a document for anything downstream to
 * follow. `api/tests/security/citius-sync-metadata-only.test.ts`'s class of proof applies to the
 * new surface: the guard suite pins the absence as source text.
 */
import type { Actor } from '@ekoa/shared';
import type { TenantReadHandler } from '../integrations/action-executor.js';
import {
  listCitiusNotificationRows,
  readCitiusSyncState,
  type CitiusLandedNotification,
} from './citius-sync.js';

/**
 * The dataset name the shipped `citius` package declares (`tenantRead.dataset`).
 *
 * Namespaced by integration on purpose: `dataset` keys a CLOSED set of readers bound at the
 * composition root, and a bare `processos` would be the first entry in a namespace where the second
 * one collides. The package and this constant are pinned against each other by
 * `api/tests/legal/citius-processos.test.ts`, so a rename in one file cannot silently unbind the
 * action in the other - the failure mode being an action that resolves, gates, and then answers
 * `unknown_dataset` in production.
 */
export const CITIUS_PROCESSOS_DATASET = 'citius.processos';

/** The ONE integration key allowed to declare the dataset above. See the check in
 *  `legalTenantReadHandler` for why a dataset with no declaring integration is an open surface. */
export const CITIUS_INTEGRATION_PACKAGE = 'citius';

/** How the payload names where it came from. A constant, and a load-bearing one: it is what lets a
 *  consumer joining these rows tell a notification-derived list from a portal process list. */
export const CITIUS_PROCESSOS_ORIGEM = 'citius-notificacoes-sincronizadas';

/**
 * One process, as this read knows it.
 *
 * FIELD NAMES ARE PART OF THE CONTRACT IN A WAY THEY USUALLY ARE NOT, because the compose rung of
 * the reuse ladder offers them to a planning model as the set it may join on (`promptSafeFields`).
 * `processo` is therefore the portal's own word for the process number, matching
 * `CitiusNotificacaoMeta.processo`, so a tenant collection that records a case number under any
 * reasonable name has something recognisable to be joined against.
 */
export interface CitiusProcessoRow {
  /** Número único de processo, verbatim as the portal rendered it. */
  processo: string;
  /** The court as the most recent notification named it. Absent when no notification carried one. */
  tribunal?: string;
  /** The most recent act type (citação, sentença, despacho…). */
  ultimoAto?: string;
  /** The newest notification's date for this process (`citiusItemDate`'s reading - see SPIKE A). */
  ultimaNotificacao: string;
  /** The oldest one the sync still holds. NOT "when the process started": the seen-set prunes. */
  primeiraNotificacao: string;
  /** How many landed notifications this row was derived from. */
  notificacoes: number;
  /** How many of them ADVERTISED an attached document. A count of booleans - never a reference. */
  comDocumento: number;
}

/**
 * How fresh this answer is (review round).
 *
 * WITHOUT THIS THE ANSWER CANNOT BE JUDGED. "the sync never ran", "the sync broke three weeks ago"
 * and "the sync ran this morning and there is genuinely nothing" produced an IDENTICAL
 * `success: true` payload with an empty list. The direction of failure is the one this repo hunts:
 * a confident wrong answer. A lawyer whose Citius session lapsed got a stale list with nothing on
 * the wire marking it, and a schedule firing `processos` hourly recorded `ok` runs over dead data
 * for as long as it kept firing - which is the very hazard the sibling suite fixed for the
 * unbound-reader case and left open for this one.
 *
 * NO SECOND SOURCE OF TRUTH: every field here is projected from `readCitiusSyncState`, the existing
 * single reader of the sync's own state, under the IDENTICAL `syncStateKeyFor` scope the rows come
 * from. This module computes no freshness of its own.
 */
export interface CitiusSincronizacaoView {
  /** When the sync last RAN for this mandatário. Absent when it has never run. */
  ultimaCorridaEm?: string;
  /** How that run ended (`complete` / `incomplete` / `failed`). Absent when it has never run. */
  ultimoResultado?: string;
  /** The completeness watermark. `null` until a run has proved a complete sweep. */
  marcaDagua: string | null;
  /** How many notification rows the sync currently holds for this mandatário. */
  notificacoesGuardadas: number;
}

export interface CitiusProcessosResult {
  processos: CitiusProcessoRow[];
  /** Provenance, in the payload rather than only in the docs. See `CITIUS_PROCESSOS_ORIGEM`. */
  origem: string;
  /** How fresh the answer is. See `CitiusSincronizacaoView` for why an answer without it cannot be
   *  judged. Additive under Rule 7: no consumer has ever received this payload without it, because
   *  the payload itself is new in the same unreleased slice. */
  sincronizacao: CitiusSincronizacaoView;
}

/**
 * Group landed notifications into processes. PURE - no store, no clock, no actor - so the grouping
 * rule is testable without a database and the tenancy is decided entirely by the caller above it.
 *
 * ORDERING IS TOTAL AND DETERMINISTIC: most recently active first, ties broken by process number.
 * Not a nicety - an unstable order makes `COMPOSE_MAX_ITEMS` truncation non-reproducible, so the
 * same question would return different 200 rows on different runs.
 *
 * DATES ARE COMPARED AS STRINGS, and that is correct for the values that actually arrive here
 * rather than a shortcut: `citiusItemDate` emits an ISO instant, which sorts lexicographically in
 * time order. A cell whose shape it did not recognise is passed through VERBATIM (SPIKE A), and
 * those sort among themselves rather than against the ISO ones. That is the honest degradation:
 * an unparsed date cannot be placed on a timeline, and inventing a position for it would be worse
 * than grouping it predictably. It never drops a row.
 */
export function groupNotificationsByProcess(
  rows: readonly CitiusLandedNotification[],
): CitiusProcessoRow[] {
  const byProcess = new Map<string, CitiusProcessoRow>();
  for (const row of rows) {
    const processo = row.notificacao.processo.trim();
    // A row with no process number names no process. Skipped rather than grouped under `''`, which
    // would be one fake row aggregating every unparseable notification the tenant has.
    if (!processo) continue;
    const date = row.itemDate || row.notificacao.data || '';
    const existing = byProcess.get(processo);
    if (!existing) {
      byProcess.set(processo, {
        processo,
        ...(row.notificacao.tribunal ? { tribunal: row.notificacao.tribunal } : {}),
        ...(row.notificacao.ato ? { ultimoAto: row.notificacao.ato } : {}),
        ultimaNotificacao: date,
        primeiraNotificacao: date,
        notificacoes: 1,
        comDocumento: row.notificacao.temDocumento ? 1 : 0,
      });
      continue;
    }
    existing.notificacoes += 1;
    if (row.notificacao.temDocumento) existing.comDocumento += 1;
    if (date > existing.ultimaNotificacao) {
      existing.ultimaNotificacao = date;
      // THE HEADER FIELDS TRACK THE NEWEST NOTIFICATION, not the first one seen. `ultimoAto` says
      // "último" and would be a lie otherwise, and a court can change (a case moves between juízos),
      // in which case the newest notification is the one that knows where the process is now.
      if (row.notificacao.tribunal) existing.tribunal = row.notificacao.tribunal;
      if (row.notificacao.ato) existing.ultimoAto = row.notificacao.ato;
    }
    if (date < existing.primeiraNotificacao) existing.primeiraNotificacao = date;
  }
  return [...byProcess.values()].sort((a, b) =>
    a.ultimaNotificacao === b.ultimaNotificacao
      ? a.processo.localeCompare(b.processo)
      : (a.ultimaNotificacao < b.ultimaNotificacao ? 1 : -1));
}

/**
 * The read itself, for one actor. The `integrationKey`/`actionKey` scope terms default to the sync
 * rail's own (`caixa-citius` / `sync_notificacoes`) inside `syncStateKeyFor`, so this reads exactly
 * the rows that rail writes and there is no second opinion about where they live.
 */
export async function readCitiusProcessos(actor: Actor): Promise<CitiusProcessosResult> {
  const rows = await listCitiusNotificationRows({ actor });
  const state = await readCitiusSyncState({ actor });
  return {
    processos: groupNotificationsByProcess(rows),
    origem: CITIUS_PROCESSOS_ORIGEM,
    sincronizacao: {
      ...(state.lastRunAt === undefined ? {} : { ultimaCorridaEm: state.lastRunAt }),
      ...(state.lastOutcome === undefined ? {} : { ultimoResultado: state.lastOutcome }),
      marcaDagua: state.watermark,
      notificacoesGuardadas: state.landed,
    },
  };
}

/**
 * The `ExecutorDeps.readTenantDataset` implementation, bound once by the composition root.
 *
 * IT LIVES HERE AND NOT IN `server.ts` FOR THE REASON THE A2 REVIEW GAVE: a lambda in the
 * composition root cannot be exercised by a test, so the dispatch - including the refusal of an
 * unknown dataset - would be the one part of this rail with no suite behind it.
 *
 * AN UNRECOGNISED DATASET IS REFUSED, NEVER APPROXIMATED. The set is closed and small; a package
 * naming something outside it is a package defect, and answering it with the nearest reader would
 * make the dataset string a query against whatever this deployment happens to bind.
 */
export const legalTenantReadHandler: TenantReadHandler = async (input) => {
  if (input.dataset !== CITIUS_PROCESSOS_DATASET) {
    return {
      success: false,
      code: 'unknown_dataset',
      error: `no reader is bound for the "${input.dataset}" dataset`,
    };
  }
  // THE DATASET IS BOUND TO THE INTEGRATION THAT DECLARES IT (review round).
  //
  // The dataset name is a closed set of READERS; without this line it is an open set of DECLARERS.
  // Any definition in the tenant - including a package published by another org and installed here,
  // whose hand-written actions are trusted by construction - could declare
  // `tenantRead: { dataset: 'citius.processos' }` under a name and description of the publisher's
  // choosing, and serve the caller's own court data through it.
  //
  // NO CROSS-TENANT LEAK WAS EVER POSSIBLE (the executor hands down the acting caller's own
  // orgId/ownerUserId and the reader scopes by `syncStateKeyFor`), and that is exactly why this is
  // worth stating: what an alias takes is not the DATA but the DESCRIPTION. D-S9-1 words the
  // COBERTURA limit carefully because a caller decides what the list MEANS from it, and an alias
  // detaches the read from that wording - it can call this "todos os processos do escritorio" and
  // win goals the shipped name would never match.
  if (input.integrationKey !== CITIUS_INTEGRATION_PACKAGE) {
    return {
      success: false,
      code: 'unknown_dataset',
      error: `the "${CITIUS_PROCESSOS_DATASET}" dataset is served only for the "${CITIUS_INTEGRATION_PACKAGE}" integration, not "${input.integrationKey}"`,
    };
  }
  // THE SCOPE IS THE EXECUTOR'S, VERBATIM. Built here from the two terms the seam handed down and
  // from nothing else - not from `args`, which is the caller's request shape and never a tenant.
  const actor: Actor = { orgId: input.orgId, userId: input.ownerUserId, role: 'user' };
  try {
    return { success: true, data: await readCitiusProcessos(actor) };
  } catch (err) {
    // A refused scope (`CitiusSyncError` - an empty org or user) and a store failure both land here
    // and both are `tenant_read_failed`: neither contacted anything, and neither is a reason for a
    // caller to retry against the portal.
    return {
      success: false,
      code: 'tenant_read_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
