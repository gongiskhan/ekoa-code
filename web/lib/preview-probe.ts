/**
 * Served-app preview document probe (findings ledger F-2026-07-12-preview-502).
 *
 * An <iframe> never fires its error event for an HTTP error response — the
 * browser renders the error body (e.g. a proxy's raw 502 text) and fires
 * `load`, so retry machinery keyed on the error event never runs and a
 * transient serving blip sticks in the preview until a manual refresh. The
 * panel therefore verifies the document plane out-of-band with a HEAD request
 * (the /apps/* plane answers with Access-Control-Allow-Origin: *, and HEAD is
 * a simple request — no preflight) and classifies the answer:
 *
 * - 'ok'        2xx — the plane answered; the document is renderable.
 * - 'transient' network failure or 5xx — a proxy/edge blip or a mid-build 503;
 *               retry-worthy.
 * - 'hard'      any other status (401/404/410) — a deliberate server page
 *               (e.g. the revoked-share 410); render it as-is, retrying will
 *               not change it.
 *
 * Callers that pass a signal must check `signal.aborted` after awaiting — an
 * aborted probe reports 'transient' rather than throwing.
 */
export type PreviewProbeResult = 'ok' | 'transient' | 'hard';

export async function probePreviewDocument(
  url: string,
  signal?: AbortSignal,
): Promise<PreviewProbeResult> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store', signal });
    if (res.ok) return 'ok';
    return res.status >= 500 ? 'transient' : 'hard';
  } catch {
    return 'transient';
  }
}
