/**
 * App Cloud Files (ch03 §3.9). Send/get files to the WORKSPACE's connected cloud storage
 * (Google Drive / OneDrive) from served apps, via `window.__ekoa.cloudFiles`. Ported from
 * cortex/src/services/cloud-files.ts + cortex/src/routes/app-cloud-files.ts.
 *
 * Scoping follows app-files exactly: `X-Ekoa-App-Id` header (no JWT); the workspace-
 * integration credential is injected server-side and NEVER reaches the page. `status`
 * tells the app which providers are usable so it can show/hide its buttons. Upload
 * protocol mirrors /api/app-files: raw bytes + `X-Filename` (encodeURIComponent'd) +
 * `Content-Type`. Amendment 2: the artifact owner's activation gates the plane.
 *
 * Provider quirks handled here so generated apps never carry them:
 *  - Google Drive multipart upload (< 5 MB) vs resumable session (larger).
 *  - Graph simple PUT upload (< 4 MB) vs createUploadSession (larger, 320 KiB chunks).
 *  - Google-native files (Docs/Sheets/Slides) exported to their Office equivalent on
 *    download (alt=media is rejected for them).
 *
 * Boundaries: integrations/ may not import apps/; the app resolution (`resolveAppScope`)
 * and the workspace credential seams (`getStatus` / `getAccessToken`) are injected by
 * server.ts so the router stays tier-clean and unit-testable without a live provider.
 */
import { Router, raw as expressRaw, type Request, type Response as ExpressResponse } from 'express';
import { checkOwnerActivation, type ResolveAppScope } from './app-scope.js';

export type CloudProvider = 'google' | 'microsoft';

export interface CloudProviderStatus { connected: boolean; needsReauth: boolean }
export interface CloudFilesStatus { google: CloudProviderStatus; microsoft: CloudProviderStatus }
export interface CloudFileMeta {
  id: string;
  name: string;
  mimeType?: string;
  webUrl?: string;
  modifiedAt?: string;
  size?: number;
  isFolder?: boolean;
}
export interface CloudDownload { name: string; mimeType: string; data: Buffer }

const GRAPH = 'https://graph.microsoft.com/v1.0';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Simple-upload ceilings per provider docs; larger files use session uploads. */
const GRAPH_SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const DRIVE_MULTIPART_MAX = 5 * 1024 * 1024;
/** Graph upload-session chunks must be multiples of 320 KiB; 8 MiB is 25×. */
const GRAPH_CHUNK = 8 * 1024 * 1024;

export function isCloudProvider(value: string): value is CloudProvider {
  return value === 'google' || value === 'microsoft';
}

/** Strip path separators, control chars, provider-illegal chars; a filename, never a path. */
export function sanitizeCloudFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[/\\]/g, ' ').replace(/[\x00-\x1f<>:"|?*]/g, '').trim();
  return cleaned || 'documento';
}

async function providerFetch(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers as Record<string, string> | undefined) } });
}
async function throwUpstream(provider: CloudProvider, action: string, res: Response): Promise<never> {
  const body = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`${provider} ${action} failed: HTTP ${res.status} ${body}`);
}

// --- Upload ----------------------------------------------------------------------------

export async function uploadCloudFile(
  provider: CloudProvider,
  accessToken: string,
  file: { name: string; mimeType: string; data: Buffer },
): Promise<CloudFileMeta> {
  const name = sanitizeCloudFileName(file.name);
  return provider === 'google'
    ? uploadToDrive(accessToken, name, file.mimeType, file.data)
    : uploadToOneDrive(accessToken, name, file.mimeType, file.data);
}

async function uploadToDrive(token: string, name: string, mimeType: string, data: Buffer): Promise<CloudFileMeta> {
  const fields = 'id,name,mimeType,webViewLink,modifiedTime,size';
  if (data.length < DRIVE_MULTIPART_MAX) {
    const boundary = `ekoa-${Date.now().toString(36)}`;
    const meta = JSON.stringify({ name });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await providerFetch(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(fields)}`,
      token,
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) },
    );
    if (!res.ok) await throwUpstream('google', 'upload', res);
    return normalizeDriveItem((await res.json()) as Record<string, unknown>);
  }
  const start = await providerFetch(
    `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=${encodeURIComponent(fields)}`,
    token,
    { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType }, body: JSON.stringify({ name }) },
  );
  if (!start.ok) await throwUpstream('google', 'upload session start', start);
  const sessionUrl = start.headers.get('location');
  if (!sessionUrl) throw new Error('google upload session start returned no location header');
  const put = await fetch(sessionUrl, { method: 'PUT', headers: { 'Content-Type': mimeType, 'Content-Length': String(data.length) }, body: new Uint8Array(data) });
  if (!put.ok) await throwUpstream('google', 'upload session put', put);
  return normalizeDriveItem((await put.json()) as Record<string, unknown>);
}

async function uploadToOneDrive(token: string, name: string, mimeType: string, data: Buffer): Promise<CloudFileMeta> {
  const itemPath = `${GRAPH}/me/drive/root:/${encodeURIComponent(name)}`;
  if (data.length < GRAPH_SIMPLE_UPLOAD_MAX) {
    const res = await providerFetch(`${itemPath}:/content`, token, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: new Uint8Array(data) });
    if (!res.ok) await throwUpstream('microsoft', 'upload', res);
    return normalizeGraphItem((await res.json()) as Record<string, unknown>);
  }
  const start = await providerFetch(`${itemPath}:/createUploadSession`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name } }),
  });
  if (!start.ok) await throwUpstream('microsoft', 'upload session start', start);
  const { uploadUrl } = (await start.json()) as { uploadUrl?: string };
  if (!uploadUrl) throw new Error('microsoft upload session returned no uploadUrl');
  let lastJson: Record<string, unknown> = {};
  for (let offset = 0; offset < data.length; offset += GRAPH_CHUNK) {
    const chunk = data.subarray(offset, Math.min(offset + GRAPH_CHUNK, data.length));
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${data.length}` },
      body: new Uint8Array(chunk),
    });
    if (!res.ok) await throwUpstream('microsoft', 'upload session chunk', res);
    lastJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }
  return normalizeGraphItem(lastJson);
}

// --- List / search ---------------------------------------------------------------------

export async function listCloudFiles(provider: CloudProvider, accessToken: string, query?: string): Promise<CloudFileMeta[]> {
  if (provider === 'google') {
    const q = query ? `trashed = false and name contains '${query.replace(/['\\]/g, ' ')}'` : 'trashed = false';
    const url = `${DRIVE}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=25&fields=${encodeURIComponent('files(id,name,mimeType,webViewLink,modifiedTime,size)')}`;
    const res = await providerFetch(url, accessToken);
    if (!res.ok) await throwUpstream('google', 'list', res);
    const json = (await res.json()) as { files?: Array<Record<string, unknown>> };
    return (json.files ?? []).map(normalizeDriveItem);
  }
  const url = query
    ? `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(query.replace(/'/g, ' '))}')?$top=25`
    : `${GRAPH}/me/drive/recent?$top=25`;
  const res = await providerFetch(url, accessToken);
  if (!res.ok) await throwUpstream('microsoft', 'list', res);
  const json = (await res.json()) as { value?: Array<Record<string, unknown>> };
  return (json.value ?? []).map(normalizeGraphItem);
}

// --- Download --------------------------------------------------------------------------

/** Google-native types exported to their Office equivalent on download. */
const GOOGLE_EXPORT: Record<string, { mimeType: string; ext: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
};

export async function downloadCloudFile(provider: CloudProvider, accessToken: string, id: string): Promise<CloudDownload> {
  if (!/^[A-Za-z0-9!_.~-]+$/.test(id)) throw new Error('invalid file id');
  if (provider === 'google') {
    const metaRes = await providerFetch(`${DRIVE}/files/${id}?fields=${encodeURIComponent('name,mimeType')}`, accessToken);
    if (!metaRes.ok) await throwUpstream('google', 'download meta', metaRes);
    const meta = (await metaRes.json()) as { name: string; mimeType: string };
    const exportAs = GOOGLE_EXPORT[meta.mimeType];
    const contentUrl = exportAs
      ? `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(exportAs.mimeType)}`
      : `${DRIVE}/files/${id}?alt=media`;
    const res = await providerFetch(contentUrl, accessToken);
    if (!res.ok) await throwUpstream('google', 'download', res);
    const data = Buffer.from(await res.arrayBuffer());
    return {
      name: exportAs && !meta.name.endsWith(exportAs.ext) ? meta.name + exportAs.ext : meta.name,
      mimeType: exportAs ? exportAs.mimeType : meta.mimeType,
      data,
    };
  }
  const metaRes = await providerFetch(`${GRAPH}/me/drive/items/${id}?$select=name,file`, accessToken);
  if (!metaRes.ok) await throwUpstream('microsoft', 'download meta', metaRes);
  const meta = (await metaRes.json()) as { name: string; file?: { mimeType?: string } };
  const res = await providerFetch(`${GRAPH}/me/drive/items/${id}/content`, accessToken);
  if (!res.ok) await throwUpstream('microsoft', 'download', res);
  const data = Buffer.from(await res.arrayBuffer());
  return { name: meta.name, mimeType: meta.file?.mimeType || 'application/octet-stream', data };
}

// --- Normalizers -----------------------------------------------------------------------

function normalizeDriveItem(item: Record<string, unknown>): CloudFileMeta {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    mimeType: item.mimeType ? String(item.mimeType) : undefined,
    webUrl: item.webViewLink ? String(item.webViewLink) : undefined,
    modifiedAt: item.modifiedTime ? String(item.modifiedTime) : undefined,
    size: item.size != null ? Number(item.size) : undefined,
    isFolder: item.mimeType === 'application/vnd.google-apps.folder' || undefined,
  };
}
function normalizeGraphItem(item: Record<string, unknown>): CloudFileMeta {
  const file = item.file as { mimeType?: string } | undefined;
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    mimeType: file?.mimeType,
    webUrl: item.webUrl ? String(item.webUrl) : undefined,
    modifiedAt: item.lastModifiedDateTime ? String(item.lastModifiedDateTime) : undefined,
    size: item.size != null ? Number(item.size) : undefined,
    isFolder: item.folder != null || undefined,
  };
}

// --- Router ----------------------------------------------------------------------------

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export interface CloudFilesDeps {
  resolveAppScope: ResolveAppScope;
  /** Which providers are usable right now (workspace integration state). Injected. */
  getStatus: () => Promise<CloudFilesStatus>;
  /** A valid workspace access token for the provider. Throws Error('...not connected...')
   *  when unavailable — surfaced as 409 to the app. Injected. */
  getAccessToken: (provider: CloudProvider) => Promise<string>;
}

export function appCloudFilesRouter(deps: CloudFilesDeps): Router {
  const r = Router();
  const maxSize = process.env.EKOA_APP_CLOUD_FILES_MAX_SIZE || '30mb';

  /** header charset-check + resolve + owner activation. Writes the error and returns null
   *  on refusal (byte-compat: header errors are string bodies; activation is CONV-2). */
  async function admit(req: Request, res: ExpressResponse): Promise<{ appId: string; ownerUserId: string } | null> {
    const app = await deps.resolveAppScope((req.headers['x-ekoa-app-id'] as string | undefined) || '');
    if (!app) { res.status(400).json({ error: 'Missing or invalid X-Ekoa-App-Id header' }); return null; }
    const gate = checkOwnerActivation(app.ownerUserId);
    if (!gate.ok) { res.status(gate.status).json(gate.body); return null; }
    return { appId: app.appId, ownerUserId: app.ownerUserId };
  }

  /** "Not connected" errors are caller-actionable (409); provider failures are 502s. */
  function sendCloudError(res: ExpressResponse, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not connected')) { res.status(409).json({ error: msg }); return; }
    console.error('[app-cloud-files]', msg);
    res.status(502).json({ error: 'cloud provider request failed' });
  }

  r.options(/^\/(status|.+)$/, (_req, res) => { res.status(204).end(); });

  r.get('/status', async (req, res) => {
    if (!(await admit(req, res))) return;
    try {
      res.json({ success: true, data: await deps.getStatus() });
    } catch (err) {
      sendCloudError(res, err);
    }
  });

  r.post('/:provider/upload', expressRaw({ type: '*/*', limit: maxSize }), async (req, res) => {
    if (!(await admit(req, res))) return;
    const { provider } = req.params as { provider: string };
    if (!isCloudProvider(provider)) { res.status(400).json({ error: 'provider must be google or microsoft' }); return; }
    const rawName = req.headers['x-filename'];
    if (typeof rawName !== 'string' || !rawName) { res.status(400).json({ error: 'Missing X-Filename header' }); return; }
    let name = rawName;
    try { name = decodeURIComponent(rawName); } catch { /* keep raw */ }
    const declaredLen = parseInt((req.headers['content-length'] as string | undefined) || '0', 10) || 0;
    if (!Buffer.isBuffer(req.body) && declaredLen > 0) {
      res.status(400).json({ error: 'Raw body required — request body was consumed by another parser' });
      return;
    }
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (data.length === 0) { res.status(400).json({ error: 'Empty file body' }); return; }
    const mimeType = (req.headers['content-type'] as string | undefined) || 'application/octet-stream';
    try {
      const token = await deps.getAccessToken(provider);
      res.status(201).json({ success: true, data: await uploadCloudFile(provider, token, { name, mimeType, data }) });
    } catch (err) {
      sendCloudError(res, err);
    }
  });

  r.get('/:provider/list', async (req, res) => {
    if (!(await admit(req, res))) return;
    const { provider } = req.params as { provider: string };
    if (!isCloudProvider(provider)) { res.status(400).json({ error: 'provider must be google or microsoft' }); return; }
    const query = typeof req.query.query === 'string' && req.query.query.trim() ? req.query.query.trim() : undefined;
    try {
      const token = await deps.getAccessToken(provider);
      res.json({ success: true, data: await listCloudFiles(provider, token, query) });
    } catch (err) {
      sendCloudError(res, err);
    }
  });

  r.get('/:provider/download', async (req, res) => {
    if (!(await admit(req, res))) return;
    const { provider } = req.params as { provider: string };
    if (!isCloudProvider(provider)) { res.status(400).json({ error: 'provider must be google or microsoft' }); return; }
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) { res.status(400).json({ error: 'id is required' }); return; }
    try {
      const token = await deps.getAccessToken(provider);
      const file = await downloadCloudFile(provider, token, id);
      res.status(200);
      res.set('Content-Type', file.mimeType);
      res.set('Content-Disposition', contentDisposition(file.name));
      res.set('X-Filename', encodeURIComponent(file.name));
      res.send(file.data);
    } catch (err) {
      sendCloudError(res, err);
    }
  });

  return r;
}
