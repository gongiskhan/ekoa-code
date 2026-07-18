/**
 * Portal retrieval-by-access-code connectors (mega-run E2/E3, BRIEF §8 items 1-3):
 * certidão permanente comercial, certidão predial permanente, certidão do registo civil
 * (where available - see below). Same discipline as `citius.ts` (08-portal-audit.md "Part
 * E pins" #4): a real HTTP client behind a base-URL config (`config.ts`), an injected
 * `fetchImpl` seam so every test drives committed fixtures, `guardedFetch` (SSRF-guarded)
 * as the live default, and an honest `{ ok:false, error }` on any failure - never a throw.
 *
 * Portuguese registries: comercial and predial certidões permanentes are both served today
 * from the "Certidão Permanente" umbrella (justica.gov.pt) by a client-supplied "código de
 * acesso" - no sign-in. Registo civil rides the SAME access-code shape there, so this run
 * builds all three uniformly rather than degrading civil (BRIEF: "where available" - it is
 * available, at the same shape as comercial/predial); a real base-URL swap needs no code
 * change (config.ts).
 *
 * Shape: `fetchCertidao` does retrieval + parse only (a pure function of accessCode ->
 * `{record, bytes}` or a PT-PT error); `retrieveCertidao` is the orchestration that also
 * saves the fetched bytes as an app-files blob and ATTACHES the result onto the dossiê via
 * E1's `attachPortalDocument` (documentos row) + `attachPortalEvent` (a `document.retrieved`
 * eventos row - the kind `shared/src/portal.ts` reserves exactly for this, so a certidão
 * retrieval renders in BOTH the dossiê's Documentos tab and its Cronologia). No partial
 * attach: a fetch/parse failure returns before any blob is saved or any row is written.
 *
 * `accessCode` is an ORDINARY client-supplied dossiê field, never a secret (BRIEF §8
 * constraint 0) - it authenticates to the EXTERNAL portal only. It is never logged, never
 * placed in a stored record, and never reaches `attachPortalDocument`'s audit metadata
 * (which is refs-only by construction, `portal.ts`).
 */
import type { PortalCertidaoSource, PortalEvent } from '@ekoa/shared';
import { PortalDocument } from '@ekoa/shared';
import { guardedFetch } from '../services/url-fetcher.js';
import { loadPortalConnectorsConfig } from '../config.js';
import type { ActivityActor, LogActivityDeps } from '../data/activity.js';
import { decodeHtml, parseCampoValorTable } from './portal-html.js';
import { assertOwnerOrg, attachPortalDocument, attachPortalEvent, type PortalSpineDeps } from './portal.js';
import type { ResolvedLegalApp } from './access-gate.js';
import type { FetchImpl, FetchLikeResponse } from './citius.js';

export type { FetchImpl, FetchLikeResponse };

/** A saved app-files blob, shaped exactly like `PortalDocument.fileRef` (E1). */
export interface SavedPortalBlob {
  fileId: string;
  url: string;
  mime: string;
  size: number;
}

/** Persists the retrieved bytes as an app-files blob (the E1-established
 *  app-files/documentos storage path). Wired at server.ts onto the real
 *  `apps/app-files.ts` store; tests inject an in-memory fake. */
export type SaveBlobFn = (appId: string, name: string, contentType: string, bytes: Buffer) => Promise<SavedPortalBlob>;

const SOURCE_LABEL_PT: Record<PortalCertidaoSource, string> = {
  'certidao-comercial': 'Certidão permanente comercial',
  'certidao-predial': 'Certidão predial permanente',
  'certidao-civil': 'Certidão do registo civil',
};

/** A field the parsed "campo/valor" table must carry for the page to count as a genuine
 *  result (vs. an invalid-code / empty-result page). */
const REQUIRED_FIELD: Record<PortalCertidaoSource, string> = {
  'certidao-comercial': 'nif',
  'certidao-predial': 'matricula',
  'certidao-civil': 'nome',
};

/** Splits a `;`-separated field value into trimmed, non-empty entries (multi-valued
 *  fields like "registos"/"proprietarios"/"onus" - the portal fixtures join them this way,
 *  the same liberal-parsing posture as citius.ts's cell walker). */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Maps the parsed campo/valor field map onto the source's structured record shape
 *  (company record for comercial: name/NIF/legal form/capital/registrations; property
 *  record for predial: description/registration/owners/charges; civil: name/act type/
 *  date/conservatória - BRIEF §8 items 1-3). */
function buildRecord(source: PortalCertidaoSource, fields: Record<string, string>): Record<string, unknown> {
  switch (source) {
    case 'certidao-comercial':
      return {
        nome: fields.firma ?? fields.nome ?? '',
        nif: fields.nif ?? '',
        formaJuridica: fields.forma_juridica ?? '',
        capitalSocial: fields.capital_social ?? '',
        registos: parseList(fields.registos ?? fields.matricula),
      };
    case 'certidao-predial':
      return {
        descricao: fields.descricao ?? '',
        matricula: fields.matricula ?? '',
        proprietarios: parseList(fields.proprietarios),
        onus: parseList(fields.onus ?? fields.encargos),
      };
    case 'certidao-civil':
      return {
        nome: fields.nome ?? '',
        tipoAto: fields.tipo_de_ato ?? fields.tipo_ato ?? '',
        data: fields.data ?? '',
        conservatoria: fields.conservatoria ?? '',
      };
  }
}

function baseUrlFor(source: PortalCertidaoSource, override?: Partial<Record<PortalCertidaoSource, string>>): string {
  if (override?.[source]) return override[source]!;
  const cfg = loadPortalConnectorsConfig();
  switch (source) {
    case 'certidao-comercial':
      return cfg.certidaoComercialBaseUrl;
    case 'certidao-predial':
      return cfg.certidaoPredialBaseUrl;
    case 'certidao-civil':
      return cfg.certidaoCivilBaseUrl;
  }
}

/** Builds the consulta URL for an access-code retrieval. */
export function buildCertidaoUrl(source: PortalCertidaoSource, baseUrl: string, accessCode: string): string {
  const u = new URL('/consulta', baseUrl);
  u.searchParams.set('codigoAcesso', accessCode);
  return u.toString();
}

/** Milliseconds before the default (live) fetch aborts a hung portal request (citius.ts parity). */
const LIVE_FETCH_TIMEOUT_MS = 12_000;

/** Default live fetch: SSRF-guarded. Tests inject their own `fetchImpl`. */
const defaultFetch: FetchImpl = async (url, init) => {
  return guardedFetch(url, { headers: init?.headers, timeoutMs: LIVE_FETCH_TIMEOUT_MS });
};

export interface CertidaoFetchResult {
  ok: boolean;
  source: PortalCertidaoSource;
  record?: Record<string, unknown>;
  bytes?: Buffer;
  contentType?: string;
  /** PT-PT message when `ok` is false. Never leaks the access code or upstream internals. */
  error?: string;
}

export interface FetchCertidaoOptions {
  fetchImpl?: FetchImpl;
  /** Per-source base-URL override (tests only; production reads `config.ts`). */
  baseUrls?: Partial<Record<PortalCertidaoSource, string>>;
}

/**
 * Fetches + parses one certidão by access code. Never throws: any failure (missing input,
 * network error, non-2xx, or a result page that fails the source's minimum-field check -
 * the "bad/expired access code" case) returns `{ ok:false, error }`, mirroring citius.ts's
 * `looksUnavailable`/503 idiom.
 */
export async function fetchCertidao(
  source: PortalCertidaoSource,
  accessCode: string,
  opts: FetchCertidaoOptions = {},
): Promise<CertidaoFetchResult> {
  const code = String(accessCode || '').trim();
  const label = SOURCE_LABEL_PT[source];
  if (!code) {
    return { ok: false, source, error: 'Código de acesso em falta' };
  }

  const fetchImpl: FetchImpl = opts.fetchImpl ?? defaultFetch;
  const url = buildCertidaoUrl(source, baseUrlFor(source, opts.baseUrls), code);

  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EkoaLegal/1.0; +https://ekoa.io)',
        Accept: 'text/html',
      },
    });
    if (!res || !res.ok) {
      return { ok: false, source, error: `${label} indisponível` };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'text/html';
    const html = decodeHtml(bytes, contentType);
    const fields = parseCampoValorTable(html);
    const requiredField = REQUIRED_FIELD[source];
    if (!fields[requiredField]) {
      // Missing the minimum field this source needs to count as a genuine result - an
      // invalid/expired code page or an unrecognised response shape. Honest "unavailable",
      // never a false-empty record.
      return { ok: false, source, error: `${label} indisponível` };
    }

    return { ok: true, source, record: buildRecord(source, fields), bytes, contentType };
  } catch {
    return { ok: false, source, error: `${label} indisponível` };
  }
}

export interface RetrieveCertidaoDeps extends PortalSpineDeps, LogActivityDeps {
  fetchImpl?: FetchImpl;
  saveBlob: SaveBlobFn;
  baseUrls?: Partial<Record<PortalCertidaoSource, string>>;
}

export type RetrieveCertidaoResult =
  | { ok: true; record: Record<string, unknown>; document: PortalDocument }
  | { ok: false; error: string };

/**
 * Retrieval + attach in one call: fetches + parses the certidão, saves the raw bytes as an
 * app-files blob, attaches a `PortalDocument` (documentos row) AND a `PortalEvent` of kind
 * `document.retrieved` (eventos row - renders in the dossiê's Cronologia too) onto the
 * dossiê, and returns the structured record + the attached document. On any failure,
 * returns `{ ok:false, error }` WITHOUT saving a blob or writing any row (no partial
 * attach).
 */
export async function retrieveCertidao(
  app: ResolvedLegalApp,
  processoId: string,
  source: PortalCertidaoSource,
  accessCode: string,
  subjectIds: string[],
  actor: ActivityActor,
  deps: RetrieveCertidaoDeps,
): Promise<RetrieveCertidaoResult> {
  // Org ownership is checked BEFORE any side effect (the blob save) so a wrong-org call never
  // leaves an orphan blob (codex E2/E3 finding); the attach re-checks too (defence in depth).
  await assertOwnerOrg(app, actor.orgId, deps);

  const fetched = await fetchCertidao(source, accessCode, { fetchImpl: deps.fetchImpl, baseUrls: deps.baseUrls });
  if (!fetched.ok || !fetched.record || !fetched.bytes) {
    return { ok: false, error: fetched.error || `${SOURCE_LABEL_PT[source]} indisponível` };
  }

  // Idempotency (E2/E3 review): a retry after an unacknowledged success must not duplicate the
  // authoritative documentos row. The fetch above is a safe idempotent GET; before saving a new
  // blob + attaching, look for an existing portal document on THIS dossiê for the same source +
  // subjects and return it instead. Access codes are never persisted, so the dedup key is the
  // dossiê-scoped (source, subjectIds) tuple that a re-fetch reproduces. JSON-encoded so distinct
  // subject arrays cannot collide (e.g. ['a|b','c'] vs ['a','b|c']).
  const subjectKey = JSON.stringify([...subjectIds].sort());
  const existingRows = await deps.listDocumentos(app, processoId);
  const dup = existingRows.find(
    (r) =>
      r.origem === 'portal' &&
      r.source === source &&
      Array.isArray(r.subjectIds) &&
      JSON.stringify([...(r.subjectIds as string[])].sort()) === subjectKey,
  );
  if (dup && dup.ficheiro) {
    const existing = PortalDocument.safeParse({
      source, type: SOURCE_LABEL_PT[source], subjectIds,
      retrievedAt: (dup.retrievedAt as string) ?? new Date(deps.now()).toISOString(),
      fileRef: dup.ficheiro, ...(dup.parsed ? { parsed: dup.parsed } : {}),
    });
    if (existing.success) return { ok: true, record: fetched.record, document: existing.data };
  }

  const retrievedAt = new Date(deps.now()).toISOString();
  const blob = await deps.saveBlob(app.appId, `${source}-${processoId}.html`, fetched.contentType ?? 'text/html', fetched.bytes);

  const document: PortalDocument = {
    source,
    type: SOURCE_LABEL_PT[source],
    subjectIds,
    retrievedAt,
    fileRef: { fileId: blob.fileId, appId: app.appId, url: blob.url, mime: blob.mime, size: blob.size },
    parsed: fetched.record,
  };
  // The documentos row is the authoritative deliverable and is written FIRST. The eventos
  // timeline entry is a secondary annotation (like the best-effort audit): a failure writing
  // it must NOT fail the whole retrieval and leave a half-attached dossiê the client can only
  // "fix" by retrying (which would then duplicate the document). Ordering doc-first + making
  // the event best-effort closes the E2/E3 partial-attach gap (review finding).
  await attachPortalDocument(app, processoId, document, actor, deps);

  const event: PortalEvent = {
    source,
    kind: 'document.retrieved',
    subjectRef: subjectIds[0] ?? processoId,
    dossierRef: processoId,
    observedAt: retrievedAt,
    payload: { fileId: document.fileRef.fileId, type: document.type },
  };
  try {
    await attachPortalEvent(app, event, actor, deps);
  } catch {
    // Timeline annotation failed; the document is attached (the deliverable). Not fatal.
  }

  return { ok: true, record: fetched.record, document };
}
