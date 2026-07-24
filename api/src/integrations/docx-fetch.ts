/**
 * DOCX fetcher (2C-S3, ekoa-dev port of cortex/src/services/docx-fetch.ts) - resolves a
 * lawyer-supplied link or cloud reference into the binary bytes of a real Word document
 * (.docx) for the redline pipeline.
 *
 * Three link shapes are supported:
 *  - OneDrive / SharePoint share links (1drv.ms, *.sharepoint.com, onedrive.live.com) -
 *    resolved via the Microsoft Graph shares API with the WORKSPACE's M365 connection.
 *  - Google Drive / Docs links - resolved via the workspace Google connection
 *    (native Docs auto-export to .docx by app-cloud-files download).
 *  - Plain https URLs - a guarded direct fetch through services/url-fetcher's
 *    `guardedFetchFollow`, which re-validates EVERY redirect hop through the SSRF guard
 *    (per-hop `assertSafeUrl` + resolved-IP re-check): a public URL must not 30x into
 *    loopback / private / cloud-metadata hosts.
 *
 * Plus workspace cloud storage by provider + fileId/query (fetchDocxFromCloud, used by
 * the docx_source_set agent tool).
 *
 * Every path enforces the 25 MB cap and verifies the bytes are a real docx (ZIP magic +
 * docx content-type/extension) so an HTML login page can never flow into the redline
 * engine. Errors are lawyer-facing PT-PT.
 *
 * Boundaries / seams (ekoa-code adaptation of the dev module):
 *  - Token access is INJECTED - `{ getStatus, getAccessToken }` (the same seam
 *    app-cloud-files.ts uses), NOT a token store import. The CLOUD branches (Graph /
 *    Drive / fetchDocxFromCloud) degrade HONESTLY: while the workspace credential store
 *    is not connected, `getStatus` reports not-connected (=> "ligue a integração" error)
 *    and `getAccessToken` throws a `not connected` Error - never a silent failure or a
 *    fake success. The direct-URL branch is fully live.
 *  - The SSRF crux reuses ekoa-code's EXISTING guarded fetcher (services/url-fetcher.ts
 *    `guardedFetchFollow`) rather than a hand-rolled redirect loop, so per-hop
 *    re-validation is the shared, audited implementation.
 *  - The cloud file operations (list / download / filename sanitize) are the sibling
 *    integrations/app-cloud-files.ts helpers, which take an explicit access token.
 */

import { isSafeUrl, SsrfError } from '../services/url-safety.js';
import { guardedFetchFollow } from '../services/url-fetcher.js';
import {
  downloadCloudFile,
  listCloudFiles,
  sanitizeCloudFileName,
  type CloudFileMeta,
  type CloudFilesStatus,
  type CloudProvider,
} from './app-cloud-files.js';

export interface FetchedDocx {
  buffer: Buffer;
  fileName: string;
  source: 'url' | 'graph-share';
}

export interface FetchedCloudDocx {
  buffer: Buffer;
  fileName: string;
  source: string;
  /** Present when a `query` picked the file: how many matched and which won. */
  chosenFrom?: { matches: number; name: string };
}

/**
 * The injected token-access seam. Kept intentionally minimal (`getStatus` +
 * `getAccessToken`) - the same shape app-cloud-files.ts consumes - so docx-fetch never
 * reaches into a credential store directly and the composition root controls custody.
 */
export interface DocxFetchDeps {
  /** Which workspace providers are usable right now. Injected. */
  getStatus: () => Promise<CloudFilesStatus>;
  /** A valid workspace access token for the provider. Throws `Error('...not connected...')`
   *  when unavailable - the honest cloud-degrade signal. Injected. */
  getAccessToken: (provider: CloudProvider) => Promise<string>;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const DOCX_MAX_BYTES = 25 * 1024 * 1024;
const DOCX_MIME_MARKER = 'officedocument.wordprocessingml';

const ERR_UNSAFE_URL = 'URL inválido ou não permitido. Use um link https público para o documento.';
const ERR_TOO_MANY_REDIRECTS = 'Não foi possível descarregar o ficheiro: demasiados redirecionamentos.';
const ERR_NOT_DOCX =
  'O URL não devolveu um ficheiro Word (.docx). Confirme que o link aponta diretamente para um documento .docx.';
const ERR_HTML_PAGE =
  'O URL devolveu uma página web (possivelmente de início de sessão) em vez de um ficheiro Word (.docx). ' +
  'Use um link de descarregamento direto ou um link de partilha do OneDrive/SharePoint ou Google Drive.';
const ERR_TOO_BIG = 'O ficheiro excede o limite de 25 MB.';
const ERR_M365_NOT_CONNECTED =
  'Este link do OneDrive/SharePoint requer a integração Microsoft 365. ' +
  'Ligue a Microsoft 365 em Integrações > Integrações de plataforma e tente novamente.';
const ERR_GOOGLE_NOT_CONNECTED =
  'Este link do Google Drive requer a integração Google Workspace. ' +
  'Ligue o Google Workspace em Integrações > Integrações de plataforma e tente novamente.';

// ---------------------------------------------------------------------------
// Link classification
// ---------------------------------------------------------------------------

type DocxLink =
  | { kind: 'graph-share' }
  | { kind: 'google-drive'; fileId: string }
  | { kind: 'direct' };

function classifyDocxUrl(url: URL): DocxLink {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '1drv.ms' || host === 'onedrive.live.com' || host === 'sharepoint.com' || host.endsWith('.sharepoint.com')) {
    return { kind: 'graph-share' };
  }
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    // /file/d/{id} (stored files) and /document/d/{id} (native Docs, exported
    // to .docx by app-cloud-files), plus the legacy open?id={id} form.
    const path = url.pathname.match(/\/(?:file|document)\/d\/([A-Za-z0-9_-]+)/);
    const fileId = path?.[1] ?? (url.pathname === '/open' ? url.searchParams.get('id') : null);
    if (fileId && /^[A-Za-z0-9_-]+$/.test(fileId)) return { kind: 'google-drive', fileId };
  }
  return { kind: 'direct' };
}

/**
 * Hint predicate for UI/agent routing: true when the URL is a cloud share
 * link this service can resolve or a direct .docx URL. Cheap and offline -
 * no network, no token access.
 */
export function isProbablyDocxUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return false;
  }
  const link = classifyDocxUrl(url);
  if (link.kind === 'google-drive') return true;
  const pathname = decodeURIComponent(url.pathname).toLowerCase();
  if (link.kind === 'graph-share') {
    const host = url.hostname.toLowerCase();
    // SharePoint encodes the document type in the path (:w: = Word); other
    // types (:x:, :p:) are not docx. Plain OneDrive short links stay opaque.
    if (host === 'sharepoint.com' || host.endsWith('.sharepoint.com')) {
      return pathname.includes('/:w:/') || pathname.endsWith('.docx');
    }
    return true;
  }
  return pathname.endsWith('.docx');
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

/** Every docx is a ZIP; the local-file-header magic is PK\x03\x04. */
function hasZipMagic(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function assertDocxBytes(buffer: Buffer): void {
  if (buffer.length > DOCX_MAX_BYTES) throw new Error(ERR_TOO_BIG);
  if (hasZipMagic(buffer)) return;
  const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  throw new Error(head.startsWith('<!doctype') || head.startsWith('<html') ? ERR_HTML_PAGE : ERR_NOT_DOCX);
}

function looksLikeDocx(name: string, mimeType: string): boolean {
  return mimeType.toLowerCase().includes(DOCX_MIME_MARKER) || name.toLowerCase().endsWith('.docx');
}

function ensureDocxFileName(raw: string): string {
  const name = sanitizeCloudFileName(raw);
  return name.toLowerCase().endsWith('.docx') ? name : `${name}.docx`;
}

// ---------------------------------------------------------------------------
// Plain https URLs (guarded direct fetch — per-hop SSRF re-validation)
// ---------------------------------------------------------------------------

async function fetchDirect(url: string): Promise<FetchedDocx> {
  // Follow redirects through the shared guarded fetcher so EVERY hop is re-validated by
  // the SSRF guard (per-hop assertSafeUrl + resolved-IP re-check) - a public URL must not
  // 30x into loopback / private / metadata hosts. Bounded to 5 redirects.
  let res: Response;
  try {
    res = await guardedFetchFollow(url, { headers: { 'User-Agent': 'Ekoa-Assistant/1.0' }, timeoutMs: 30_000 }, 5);
  } catch (err) {
    // Map the guarded fetcher's SSRF/redirect rejections onto the lawyer-facing PT-PT
    // errors, preserving the dev contract: a redirect hop into a private/loopback address
    // is refused as "URL não permitido"; an over-long redirect chain as "demasiados
    // redirecionamentos".
    if (err instanceof SsrfError) {
      throw new Error(/too many redirects/i.test(err.message) ? ERR_TOO_MANY_REDIRECTS : ERR_UNSAFE_URL);
    }
    throw err;
  }
  if (!res.ok) throw new Error(`Não foi possível descarregar o ficheiro (HTTP ${res.status}).`);

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/html')) throw new Error(ERR_HTML_PAGE);
  // guardedFetchFollow returns the FINAL hop's Response; its `.url` is the final URL for a
  // real fetch (empty for constructed test Responses, where no redirect occurred - fall
  // back to the input URL).
  const finalUrl = res.url && res.url.length > 0 ? res.url : url;
  const pathname = decodeURIComponent(new URL(finalUrl).pathname).toLowerCase();
  if (!contentType.includes(DOCX_MIME_MARKER) && !pathname.endsWith('.docx')) throw new Error(ERR_NOT_DOCX);
  // 25 MB enforcement #1: reject a declared Content-Length over the cap up front.
  const declaredLength = Number(res.headers.get('content-length') ?? 0);
  if (declaredLength > DOCX_MAX_BYTES) throw new Error(ERR_TOO_BIG);

  // 25 MB enforcement #2: stream the body with a running byte cap, aborting the moment it
  // is passed (a lying / absent Content-Length must not buffer an unbounded body).
  const buffer = await readBodyCapped(res);
  // 25 MB enforcement #3: final buffer-size guard (inside assertDocxBytes).
  assertDocxBytes(buffer);
  return { buffer, fileName: fileNameFromResponse(res, finalUrl), source: 'url' };
}

/**
 * Stream the response body, aborting the moment the cumulative size passes
 * the cap - a chunked response (no Content-Length) must not buffer unbounded
 * bytes before the size check.
 */
async function readBodyCapped(res: Response): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > DOCX_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(ERR_TOO_BIG);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function fileNameFromResponse(res: Response, finalUrl: string): string {
  const disposition = res.headers.get('content-disposition') ?? '';
  const star = disposition.match(/filename\*=(?:utf-8'')?([^;]+)/i);
  const starName = star?.[1]; // capture group is present whenever the regex matched
  if (starName) {
    try {
      return ensureDocxFileName(decodeURIComponent(starName.trim().replace(/^"|"$/g, '')));
    } catch {
      // fall through to the plain filename= form
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  const plainName = plain?.[1];
  if (plainName) return ensureDocxFileName(plainName.trim());
  let segment = new URL(finalUrl).pathname.split('/').pop() ?? '';
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // keep the raw segment when percent-decoding fails
  }
  return ensureDocxFileName(segment || 'documento');
}

/** Graph share-token: unpadded base64url of the share URL prefixed with "u!". */
function encodeShareToken(url: string): string {
  return `u!${Buffer.from(url, 'utf8').toString('base64url')}`;
}

/** Native Docs count too: app-cloud-files auto-exports them to .docx on download. */
function isDocxCloudMeta(f: CloudFileMeta): boolean {
  return (
    !f.isFolder &&
    (f.name.toLowerCase().endsWith('.docx') ||
      (f.mimeType ?? '').includes(DOCX_MIME_MARKER) ||
      f.mimeType === 'application/vnd.google-apps.document')
  );
}

// ---------------------------------------------------------------------------
// Factory — the token-access-dependent entry points
// ---------------------------------------------------------------------------

export interface DocxFetcher {
  fetchDocxFromUrl: (rawUrl: string) => Promise<FetchedDocx>;
  fetchDocxFromCloud: (provider: CloudProvider, opts: { fileId?: string; query?: string }) => Promise<FetchedCloudDocx>;
}

/**
 * Build the fetcher over the injected token-access seam. The direct-URL branch needs no
 * credentials (fully live); the cloud branches use `getStatus`/`getAccessToken` and
 * degrade honestly when the workspace credential store is not connected.
 */
export function createDocxFetcher(deps: DocxFetchDeps): DocxFetcher {
  // -- OneDrive / SharePoint share links (Microsoft Graph shares API) --
  async function fetchFromGraphShare(url: string): Promise<FetchedDocx> {
    const status = await deps.getStatus();
    if (!status.microsoft.connected) throw new Error(ERR_M365_NOT_CONNECTED);
    const accessToken = await deps.getAccessToken('microsoft');
    const auth = { Authorization: `Bearer ${accessToken}` };
    const token = encodeShareToken(url);

    // Graph is a fixed, trusted host (never a request-derived URL), so a raw fetch is
    // correct here - the SSRF guard is for user-supplied targets, which the direct branch
    // routes through guardedFetchFollow.
    const metaRes = await fetch(`${GRAPH}/shares/${token}/driveItem?$select=id,name,size,file`, { headers: auth });
    if (!metaRes.ok) {
      throw new Error(
        `Não foi possível aceder ao link partilhado com a conta Microsoft 365 ligada (HTTP ${metaRes.status}). ` +
        'Confirme que a conta ligada tem acesso ao documento.',
      );
    }
    const meta = await metaRes.json() as { name?: string; size?: number; file?: { mimeType?: string } };
    const name = meta.name ?? '';
    if (!looksLikeDocx(name, meta.file?.mimeType ?? '')) throw new Error(ERR_NOT_DOCX);
    if (typeof meta.size === 'number' && meta.size > DOCX_MAX_BYTES) throw new Error(ERR_TOO_BIG);

    const contentRes = await fetch(`${GRAPH}/shares/${token}/driveItem/content`, { headers: auth });
    if (!contentRes.ok) {
      throw new Error(`Não foi possível descarregar o documento partilhado (HTTP ${contentRes.status}).`);
    }
    const buffer = Buffer.from(await contentRes.arrayBuffer());
    assertDocxBytes(buffer);
    return { buffer, fileName: ensureDocxFileName(name || 'documento'), source: 'graph-share' };
  }

  // -- Google Drive links (workspace connection via app-cloud-files) --
  async function fetchFromGoogleDrive(fileId: string): Promise<FetchedDocx> {
    const status = await deps.getStatus();
    if (!status.google.connected) throw new Error(ERR_GOOGLE_NOT_CONNECTED);
    const accessToken = await deps.getAccessToken('google');
    const file = await downloadCloudFile('google', accessToken, fileId);
    if (!looksLikeDocx(file.name, file.mimeType)) throw new Error(ERR_NOT_DOCX);
    assertDocxBytes(file.data);
    return { buffer: file.data, fileName: ensureDocxFileName(file.name || 'documento'), source: 'url' };
  }

  async function fetchDocxFromUrl(rawUrl: string): Promise<FetchedDocx> {
    const normalized = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    if (!isSafeUrl(normalized)) throw new Error(ERR_UNSAFE_URL);
    const url = new URL(normalized);
    const link = classifyDocxUrl(url);
    if (link.kind === 'graph-share') return fetchFromGraphShare(normalized);
    if (link.kind === 'google-drive') return fetchFromGoogleDrive(link.fileId);
    return fetchDirect(normalized);
  }

  /**
   * The `provider` branch of docx_source_set: resolve a workspace cloud file (by id, or by
   * query picking the best .docx match), download it and verify it is a Word document.
   * `chosenFrom` reports which file a query picked so the tool can surface the choice.
   * Uses the injected `getAccessToken` (honest degrade when not connected).
   */
  async function fetchDocxFromCloud(
    provider: CloudProvider,
    opts: { fileId?: string; query?: string },
  ): Promise<FetchedCloudDocx> {
    const accessToken = await deps.getAccessToken(provider);
    let id = opts.fileId;
    let chosenFrom: FetchedCloudDocx['chosenFrom'];
    if (!id) {
      const candidates = (await listCloudFiles(provider, accessToken, opts.query)).filter(isDocxCloudMeta);
      const first = candidates[0]; // length-checked below (noUncheckedIndexedAccess)
      if (!first) {
        throw new Error(`No Word document matched "${opts.query}" in ${provider}.`);
      }
      id = first.id;
      chosenFrom = { matches: candidates.length, name: first.name };
    }
    const file = await downloadCloudFile(provider, accessToken, id);
    if (!looksLikeDocx(file.name, file.mimeType)) {
      throw new Error(`"${file.name}" is not a Word document (.docx).`);
    }
    const fileName = file.name.toLowerCase().endsWith('.docx') ? file.name : `${file.name}.docx`;
    return { buffer: file.data, fileName, source: `cloud:${provider}`, chosenFrom };
  }

  return { fetchDocxFromUrl, fetchDocxFromCloud };
}
