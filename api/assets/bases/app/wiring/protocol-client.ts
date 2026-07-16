/**
 * Protocol client for the `app` base.
 *
 * The typed surface over the platform's INJECTED served-app runtime
 * (`window.__ekoa`, stamped into every served document - see the served-app
 * byte-compat plane, api-contract 3.9). It wraps the sanctioned client calls:
 * end-user SSO identity (whoami / signIn / signOut), the visitor's Microsoft 365
 * Graph proxy (graphFetch), server-side PDF export (exportPdf), and workspace
 * cloud files (cloudFiles).
 *
 * Persistence is NOT here - use `./jsonStore` (the /api/app-data plane).
 *
 * There is NO client-side generic action envelope and NO direct integration
 * calls: an app never reaches an external API itself. Cross-service work is done
 * by platform-executed `integration.call` capabilities declared in MANIFEST.md;
 * the only in-app integration path is the authenticated visitor's own Microsoft
 * 365 via `graphFetch`.
 *
 * Every wrapper degrades cleanly when the runtime is absent (standalone preview,
 * file://, the screenshot pipeline): `whoami()` resolves `null`; the action
 * wrappers throw `RuntimeUnavailable`, which callers can catch to render a
 * fallback. The shell must render fully with no runtime present.
 */

export interface WhoAmI {
  email: string;
  name: string | null;
  oid: string | null;
  tid: string | null;
  /** Whether the visitor granted the delegated Graph scopes (Mail.Send, Calendars). */
  canSendMail: boolean;
}

export interface PdfExportOptions {
  filename?: string;
  format?: 'A4' | 'Letter' | 'Legal';
  landscape?: boolean;
  /** Explicit HTML to render; defaults to the live document (scripts/.no-print stripped). */
  html?: string;
  /** Set false to receive the result without triggering a browser download. */
  download?: boolean;
}

export interface PdfExportResult {
  url: string;
  [key: string]: unknown;
}

export interface CloudFileRef {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CloudFileDownload {
  name: string;
  type: string;
  blob: Blob;
}

export interface CloudFilesClient {
  status(): Promise<unknown>;
  upload(file: Blob, opts: { provider?: string; name?: string; type?: string }): Promise<unknown>;
  list(provider: string, query?: string): Promise<CloudFileRef[]>;
  download(provider: string, id: string): Promise<CloudFileDownload>;
}

/** The subset of the injected `window.__ekoa` surface this client wraps. */
export interface EkoaRuntime {
  fetch(path: string, options?: RequestInit): Promise<Response>;
  whoami(): Promise<WhoAmI | null>;
  signIn(returnPath?: string): void;
  signOut(): Promise<boolean>;
  graphFetch(path: string, options?: RequestInit): Promise<Response>;
  exportPdf(opts?: PdfExportOptions): Promise<PdfExportResult>;
  cloudFiles: CloudFilesClient;
}

declare global {
  interface Window {
    __EKOA_APP_ID?: string;
    __ekoa?: EkoaRuntime;
  }
}

/** Thrown by the action wrappers when the served-app runtime is not present. */
export class RuntimeUnavailable extends Error {
  readonly feature: string;
  constructor(feature: string) {
    super(`Ekoa runtime unavailable - ${feature} needs the served-app context (open at /apps/<id>/).`);
    this.name = 'RuntimeUnavailable';
    this.feature = feature;
  }
}

/** The injected runtime, or undefined outside a served-app document. */
export function getRuntime(): EkoaRuntime | undefined {
  return typeof window !== 'undefined' ? window.__ekoa : undefined;
}

function requireRuntime(feature: string): EkoaRuntime {
  const rt = getRuntime();
  if (!rt) throw new RuntimeUnavailable(feature);
  return rt;
}

/**
 * The signed-in visitor, or null when logged out or the runtime is absent.
 * NON-THROWING - safe to call unconditionally on mount.
 *
 * Calls GET /api/app-sso/session (200 in BOTH states) instead of the runtime's
 * whoami() (GET /me, which 401s when signed out): the browser logs every non-2xx
 * to the console, so the on-load probe must never produce one. Same identity
 * payload and same cookie - the per-app session cookie is Path=/api/app-sso,
 * which covers the sibling route.
 */
export async function whoami(): Promise<WhoAmI | null> {
  const appId = typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
  if (!appId || !getRuntime()) return null;
  try {
    const res = await fetch('/api/app-sso/session', {
      headers: { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': appId },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: WhoAmI | null };
    return json && json.data ? json.data : null;
  } catch {
    return null;
  }
}

/** Start the full-page Microsoft sign-in. Throws RuntimeUnavailable with no runtime. */
export function signIn(returnPath?: string): void {
  requireRuntime('signIn').signIn(returnPath);
}

/** End the visitor session. Throws RuntimeUnavailable with no runtime. */
export function signOut(): Promise<boolean> {
  return requireRuntime('signOut').signOut();
}

/**
 * Proxy a Microsoft Graph request AS THE VISITOR (their delegated SSO session).
 * `path` is relative to the Graph proxy root (e.g. `me`, `me/messages`).
 * Throws RuntimeUnavailable with no runtime; the caller catches to render an
 * IntegrationNeededBoundary when the visitor has not connected Microsoft 365.
 */
export function graphFetch(path: string, options?: RequestInit): Promise<Response> {
  return requireRuntime('graphFetch').graphFetch(path, options);
}

/** Server-rendered PDF of the live document (or `opts.html`). Throws RuntimeUnavailable with no runtime. */
export function exportPdf(opts?: PdfExportOptions): Promise<PdfExportResult> {
  return requireRuntime('exportPdf').exportPdf(opts);
}

/**
 * Workspace cloud files (Google Drive / OneDrive) for save-to-cloud flows.
 * Each method throws RuntimeUnavailable with no runtime.
 */
export const cloudFiles: CloudFilesClient = {
  status: () => requireRuntime('cloudFiles.status').cloudFiles.status(),
  upload: (file, opts) => requireRuntime('cloudFiles.upload').cloudFiles.upload(file, opts),
  list: (provider, query) => requireRuntime('cloudFiles.list').cloudFiles.list(provider, query),
  download: (provider, id) => requireRuntime('cloudFiles.download').cloudFiles.download(provider, id),
};
