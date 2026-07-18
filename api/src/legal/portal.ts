/**
 * Portal connector receiving surface (BRIEF §8 Part E, run 20260717-190134-9d4c1cbf,
 * slice E1). `docs/autothing/runs/20260717-190134-9d4c1cbf/analysis/08-portal-audit.md`
 * "Part E pins" #1-#2 bind the shape: the shared/ contract (`PortalDocument`/
 * `PortalEvent`) is the WIRE shape every connector writes through - E2 (certidão
 * comercial), E3 (certidão predial/registo civil), E4 (insolvência watcher) and E5
 * (DGSI/DRE, verify-only) this run, and the signed-in connectors of the follow-up run.
 * This module is the ONE seam that attaches one onto a dossiê (a `processos` row on the
 * shared owner-spine) as a `documentos`/`eventos` satellite row, mirroring the app's own
 * conventions (DocumentosTab.jsx:287-305, CronologiaTab.jsx) so legal-dossie renders
 * portal records with ZERO UI invention. E1 ships the records + this seam + the read
 * route (`router.ts`); there is NO retrieval/parsing logic here - E2-E5 add connectors
 * that call `attachPortalDocument`/`attachPortalEvent` with an already-normalized record.
 *
 * Auth-tier decision (08-portal-audit.md pin 6): `attachPortalDocument`/
 * `attachPortalEvent` are plain TS functions, not HTTP endpoints - connector code
 * (server-side jobs/triggers) calls them directly, exactly like calculos.ts's
 * `emitirAlarmeTabelas`. The only HTTP surface this module reaches is the READ route
 * (`GET /api/legal/portal`, wired in `router.ts`), which the legal-dossie served app
 * calls in-browser to render - it sits on the SAME `requireLegalSuiteApp` tier as every
 * other legal-suite route (header-scoped + per-endpoint allowlist + owner-activation
 * gate), not a dashboard `user` JWT tier (served apps carry no platform JWT) and not the
 * unauthenticated generic `/api/app-shared` plane (no allowlist/rate-limit there).
 *
 * Org-scoping: `ResolvedLegalApp` carries only `ownerUserId`, no `orgId` - no prior
 * legal-suite route has ever needed one, because a served-app request carries no org
 * claim to compare against. A portal connector DOES carry one (the org on whose behalf
 * it retrieved the document), so the attach functions take the caller's `orgId` via
 * `actor.orgId` and refuse with `PortalOrgMismatchError` unless it matches the dossiê
 * owner's real org, resolved through the injected `getOwnerOrgId` seam (wired at
 * server.ts from the users store) - the "a dossiê belongs to an org" check the brief
 * asks for.
 *
 * Owner-spine reads/writes are an INJECTED seam (`PortalSpineDeps`), matching the
 * established legal/ convention (calculos.ts's `AlarmeStore`, transcricao.ts's
 * `getRow`/`updateRow`): this module never imports data/collections-engine.ts itself,
 * so every gate here runs on committed fixtures. `logActivity` is imported directly -
 * tier 5 (`legal/`) -> tier 0 (`data/`) is a normal downward import; apps/assistant-
 * tools.ts does the same for its landed `app-assistant.action.*` rows.
 */
import { PortalDocument, PortalEvent, type PortalSource } from '@ekoa/shared';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';
import type { ResolvedLegalApp } from './access-gate.js';

export class PortalOrgMismatchError extends Error {
  constructor() {
    super('Dossiê pertence a outra organização.');
    this.name = 'PortalOrgMismatchError';
  }
}

/** The owner-spine seam (server.ts wires these to the real CollectionsEngine + a users
 *  lookup, exactly like calculos.ts's AlarmeStore / transcricao.ts's getRow/updateRow). */
export interface PortalSpineDeps {
  /** The dossiê owner's real org, or null if unresolvable (fails the attach CLOSED). */
  getOwnerOrgId: (ownerUserId: string) => Promise<string | null>;
  createDocumento: (app: ResolvedLegalApp, row: Record<string, unknown>) => Promise<Record<string, unknown>>;
  createEvento: (app: ResolvedLegalApp, row: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Already filtered to the given processoId (server.ts wiring). */
  listDocumentos: (app: ResolvedLegalApp, processoId: string) => Promise<Array<Record<string, unknown>>>;
  /** Already filtered to the given processoId (server.ts wiring). */
  listEventos: (app: ResolvedLegalApp, processoId: string) => Promise<Array<Record<string, unknown>>>;
}

const SOURCE_LABELS_PT: Record<PortalSource, string> = {
  'certidao-comercial': 'Certidão comercial',
  'certidao-predial': 'Certidão predial',
  'certidao-civil': 'Certidão civil',
  'citius-insolvencia': 'Publicação de insolvência (Citius)',
  dgsi: 'Jurisprudência (DGSI)',
  dre: 'Diário da República',
};

const EVENT_TITLES_PT: Record<string, string> = {
  'document.retrieved': 'Documento obtido do portal',
  'watch.hit': 'Nova publicação encontrada',
};

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Fail-closed org ownership check (exported so callers can assert BEFORE expensive side
 *  effects like a blob save, not only inside the attach). */
export async function assertOwnerOrg(
  app: ResolvedLegalApp,
  orgId: string,
  deps: Pick<PortalSpineDeps, 'getOwnerOrgId'>,
): Promise<void> {
  const ownerOrgId = await deps.getOwnerOrgId(app.ownerUserId);
  if (!ownerOrgId || ownerOrgId !== orgId) throw new PortalOrgMismatchError();
}

/**
 * Attach a retrieved `PortalDocument` to a dossiê: a `documentos` satellite row
 * (DocumentosTab.jsx-compatible fields + the portal record's own fields, so it renders
 * with zero UI invention AND round-trips through `PortalDocument` for the read route),
 * plus a best-effort `portal.document.retrieved` activity row (A5 vocabulary memo).
 * Throws `PortalOrgMismatchError` if `actor.orgId` does not own `app`'s dossiê.
 */
export async function attachPortalDocument(
  app: ResolvedLegalApp,
  processoId: string,
  doc: PortalDocument,
  actor: ActivityActor,
  deps: PortalSpineDeps & LogActivityDeps,
): Promise<Record<string, unknown>> {
  const parsed = PortalDocument.parse(doc);
  await assertOwnerOrg(app, actor.orgId, deps);

  const row: Record<string, unknown> = {
    nome: `${SOURCE_LABELS_PT[parsed.source]}${parsed.type ? ` - ${parsed.type}` : ''}`,
    tipo: parsed.type,
    processoId,
    data: toDateOnly(parsed.retrievedAt),
    origem: 'portal',
    ficheiro: parsed.fileRef,
    versao: 1,
    // Portal provenance, retained flat (never nested) so the read route can reconstruct
    // the exact PortalDocument shape without a translation table.
    source: parsed.source,
    subjectIds: parsed.subjectIds,
    retrievedAt: parsed.retrievedAt,
    ...(parsed.parsed ? { parsed: parsed.parsed } : {}),
  };
  const created = await deps.createDocumento(app, row);

  try {
    // Refs only (A5 vocabulary rule): the dossier + document type + the file id + a COUNT of
    // subjects. Raw subjectIds (NIFs/names - the very identifiers the platform tokenizes before
    // egress) are NOT written into the persisted audit row; they live only on the documentos
    // row itself, which is the dossier's own data (codex E1 finding 3).
    await logActivity(actor, 'portal', 'document.retrieved', deps, {
      dossierId: processoId,
      source: parsed.source,
      type: parsed.type,
      subjectCount: parsed.subjectIds.length,
      fileId: parsed.fileRef.fileId,
    });
  } catch {
    // Best-effort audit (app-assistant.action.* idiom, apps/assistant-tools.ts) - never
    // fails the attach itself.
  }
  return created;
}

/**
 * Append a `PortalEvent` to a dossiê's `eventos` timeline: an eventos row
 * (CronologiaTab.jsx-compatible fields + the portal record's own fields), plus a
 * best-effort `portal.<kind>` activity row (A5 vocabulary memo - `portal.watch.hit` for
 * a watcher match, E4). Throws `PortalOrgMismatchError` if `actor.orgId` does not own
 * `app`'s dossiê.
 */
export async function attachPortalEvent(
  app: ResolvedLegalApp,
  ev: PortalEvent,
  actor: ActivityActor,
  deps: PortalSpineDeps & LogActivityDeps,
): Promise<Record<string, unknown>> {
  const parsed = PortalEvent.parse(ev);
  await assertOwnerOrg(app, actor.orgId, deps);

  // A portal event's payload may carry a PT-PT `mensagem` (e.g. the watcher's "Nova publicação
  // para a contraparte X"): surface it as the eventos row's `descricao` so it RENDERS in the
  // dossiê's CronologiaTab (which shows titulo + descricao), not only in the raw payload.
  const mensagem = typeof parsed.payload?.mensagem === 'string' ? parsed.payload.mensagem : undefined;
  const row: Record<string, unknown> = {
    processoId: parsed.dossierRef,
    titulo: EVENT_TITLES_PT[parsed.kind] ?? EVENT_TITLES_PT['document.retrieved'],
    ...(mensagem ? { descricao: mensagem } : {}),
    data: toDateOnly(parsed.observedAt),
    tipo: `portal.${parsed.kind}`,
    origem: 'portal',
    source: parsed.source,
    kind: parsed.kind,
    subjectRef: parsed.subjectRef,
    observedAt: parsed.observedAt,
    payload: parsed.payload,
  };
  const created = await deps.createEvento(app, row);

  try {
    // Refs only: the dossier + source + kind. subjectRef (a NIF/name) is NOT persisted to the
    // audit row - it lives on the eventos row (the dossier's own data) (codex E1 finding 3).
    await logActivity(actor, 'portal', parsed.kind, deps, {
      dossierId: parsed.dossierRef,
      source: parsed.source,
      kind: parsed.kind,
    });
  } catch {
    // Best-effort audit - never fails the attach itself.
  }
  return created;
}

/**
 * Read surface for `GET /api/legal/portal`: a dossiê's portal-sourced documents +
 * events, mapped back from their stored (DocumentosTab/CronologiaTab-shaped) rows into
 * the `PortalDocument`/`PortalEvent` wire contract. Rows failing to round-trip (e.g. a
 * stray non-portal row that slipped the `origem` filter) are skipped, never thrown - the
 * citius.ts "never throws" discipline (08-portal-audit.md pin 4).
 */
export async function listPortalDossierRecords(
  app: ResolvedLegalApp,
  processoId: string,
  deps: Pick<PortalSpineDeps, 'listDocumentos' | 'listEventos'>,
): Promise<{ documentos: PortalDocument[]; eventos: PortalEvent[] }> {
  // Isolation on this READ path is structural, not a comparison: `listDocumentos`/`listEventos`
  // resolve to the collections engine scoped by the app's SERVER-RESOLVED ownerUserId
  // (scopeKey `usr.<ownerUserId>`, never client input), so a processoId belonging to another
  // owner is filtered out at the DB query before any row is seen. The app is the principal on
  // this header-scoped route (no independent actor org exists to assert against - that would be
  // a tautology); a cross-owner read returning zero rows is covered by the portal.test.ts
  // ownedByB case. The WRITE path additionally asserts actor.orgId == owner org.
  const [documentoRows, eventoRows] = await Promise.all([
    deps.listDocumentos(app, processoId),
    deps.listEventos(app, processoId),
  ]);

  const documentos = documentoRows
    .filter((r) => r.origem === 'portal')
    .map((r) =>
      PortalDocument.safeParse({
        source: r.source,
        type: r.tipo,
        subjectIds: r.subjectIds,
        retrievedAt: r.retrievedAt,
        fileRef: r.ficheiro,
        ...(r.parsed ? { parsed: r.parsed } : {}),
      }),
    )
    .filter((r): r is { success: true; data: PortalDocument } => r.success)
    .map((r) => r.data);

  const eventos = eventoRows
    .filter((r) => r.origem === 'portal')
    .map((r) =>
      PortalEvent.safeParse({
        source: r.source,
        kind: r.kind,
        subjectRef: r.subjectRef,
        dossierRef: r.processoId,
        observedAt: r.observedAt,
        payload: r.payload,
      }),
    )
    .filter((r): r is { success: true; data: PortalEvent } => r.success)
    .map((r) => r.data);

  return { documentos, eventos };
}
