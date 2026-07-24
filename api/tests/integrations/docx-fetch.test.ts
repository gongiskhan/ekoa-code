/**
 * Unit tests for integrations/docx-fetch.ts (2C-S3, ekoa-dev port of
 * cortex/tests/docx/docx-fetch.test.ts) - the binary docx fetcher behind the Word redline
 * pipeline.
 *
 * Adaptations from the dev suite (assertions/intent preserved):
 *  - Token access is the INJECTED `{ getStatus, getAccessToken }` seam (dev imported
 *    getCloudFilesStatus + getValidTokens directly) - the fetcher is built via
 *    createDocxFetcher(deps). getAccessToken returns a provider-scoped token, so the cloud
 *    calls now thread that token (assertions updated to include it - never weakened).
 *  - The cloud file ops live in integrations/app-cloud-files.ts (dev: services/cloud-files);
 *    listCloudFiles/downloadCloudFile are mocked there, sanitizeCloudFileName stays real.
 *  - The direct branch runs through ekoa-code's REAL guardedFetchFollow (services/
 *    url-fetcher), so the SSRF per-hop tests exercise the shared audited guard (the block
 *    happens at the literal host guard, deterministic offline; the resolved-IP re-check
 *    fail-opens on lookup error). No url-fetcher/url-safety mock.
 *
 * Load-bearing (do not weaken): the SSRF per-hop rejection tests, the 25 MB TRIPLE
 * enforcement (declared Content-Length, streaming cap+cancel on a lying/absent length,
 * final buffer guard), and the cloud-degrade-honestly (not-connected => PT error) tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DocxFetcher } from '../../src/integrations/docx-fetch.js';

const listCloudFiles = vi.fn();
const downloadCloudFile = vi.fn();
vi.mock('../../src/integrations/app-cloud-files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/app-cloud-files.js')>();
  return {
    ...actual,
    listCloudFiles: (...args: unknown[]) => listCloudFiles(...args),
    downloadCloudFile: (...args: unknown[]) => downloadCloudFile(...args),
  };
});

const { createDocxFetcher, isProbablyDocxUrl, DOCX_MAX_BYTES } = await import('../../src/integrations/docx-fetch.js');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Minimal bytes that pass the ZIP local-file-header magic check (PK\x03\x04). */
function docxBytes(extra = 'docx-payload'): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(extra)]);
}

function binaryResponse(body: Buffer, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(new Uint8Array(body), { status, headers });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const getStatus = vi.fn();
const getAccessToken = vi.fn();
let fetchDocxFromUrl: DocxFetcher['fetchDocxFromUrl'];
let fetchDocxFromCloud: DocxFetcher['fetchDocxFromCloud'];

/** Provider-scoped injected tokens (dev's getValidTokens -> access_token, per provider). */
function accessTokenFor(provider: string): string {
  return provider === 'microsoft' ? 'graph-tok' : 'gdrive-tok';
}

function connected(google: boolean, microsoft: boolean): void {
  getStatus.mockResolvedValue({
    google: { connected: google, needsReauth: false },
    microsoft: { connected: microsoft, needsReauth: false },
  });
}

beforeEach(() => {
  getStatus.mockReset();
  downloadCloudFile.mockReset();
  listCloudFiles.mockReset();
  getAccessToken.mockReset();
  getAccessToken.mockImplementation(async (provider: string) => accessTokenFor(provider));
  const fetcher = createDocxFetcher({ getStatus, getAccessToken });
  fetchDocxFromUrl = fetcher.fetchDocxFromUrl;
  fetchDocxFromCloud = fetcher.fetchDocxFromCloud;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isProbablyDocxUrl()', () => {
  it('recognizes OneDrive share links', () => {
    expect(isProbablyDocxUrl('https://1drv.ms/w/s!AbCdEf123')).toBe(true);
    expect(isProbablyDocxUrl('https://onedrive.live.com/redir?resid=X!123')).toBe(true);
  });

  it('recognizes SharePoint links only for the Word (:w:) type or .docx path', () => {
    expect(isProbablyDocxUrl('https://firma.sharepoint.com/:w:/g/pessoal/abc123')).toBe(true);
    expect(isProbablyDocxUrl('https://firma.sharepoint.com/sites/legal/Contrato.docx')).toBe(true);
    expect(isProbablyDocxUrl('https://firma.sharepoint.com/:x:/g/pessoal/folha123')).toBe(false);
  });

  it('recognizes Google Drive file and Docs document links', () => {
    expect(isProbablyDocxUrl('https://drive.google.com/file/d/1AbC_dEf-123/view')).toBe(true);
    expect(isProbablyDocxUrl('https://docs.google.com/document/d/1AbC_dEf-123/edit')).toBe(true);
    expect(isProbablyDocxUrl('https://drive.google.com/open?id=1AbC_dEf-123')).toBe(true);
    expect(isProbablyDocxUrl('https://drive.google.com/drive/folders/1AbC')).toBe(false);
  });

  it('recognizes direct .docx URLs (also without scheme) and rejects the rest', () => {
    expect(isProbablyDocxUrl('https://example.com/docs/contrato.docx')).toBe(true);
    expect(isProbablyDocxUrl('example.com/contrato.docx')).toBe(true);
    expect(isProbablyDocxUrl('https://example.com/docs/contrato%20final.docx')).toBe(true);
    expect(isProbablyDocxUrl('https://example.com/relatorio.pdf')).toBe(false);
    expect(isProbablyDocxUrl('not a url at all')).toBe(false);
  });
});

describe('fetchDocxFromUrl() - SSRF guard', () => {
  it('blocks private/loopback targets before any fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchDocxFromUrl('http://127.0.0.1:4111/contrato.docx')).rejects.toThrow(/não permitido/);
    await expect(fetchDocxFromUrl('http://169.254.169.254/latest/meta-data.docx')).rejects.toThrow(/não permitido/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('blocks a redirect hop to a private target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:4111/internal.docx' } })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/não permitido/);
  });

  it('rejects a redirect chain longer than five hops', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) =>
      new Response(null, { status: 302, headers: { location: `${String(url)}x` } })));
    await expect(fetchDocxFromUrl('https://example.com/loop.docx')).rejects.toThrow(/redirecionamentos/);
  });
});

describe('fetchDocxFromUrl() - direct URLs', () => {
  it('downloads a real docx and takes the filename from content-disposition', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(docxBytes(), {
      'Content-Type': DOCX_MIME,
      'Content-Disposition': 'attachment; filename="minuta final.docx"',
    })));
    const out = await fetchDocxFromUrl('https://example.com/download?id=9');
    expect(out.source).toBe('url');
    expect(out.fileName).toBe('minuta final.docx');
    expect(out.buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('decodes the RFC 5987 filename* form with PT accents', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(docxBytes(), {
      'Content-Type': DOCX_MIME,
      'Content-Disposition': "attachment; filename*=UTF-8''revis%C3%A3o.docx",
    })));
    const out = await fetchDocxFromUrl('https://example.com/download?id=9');
    expect(out.fileName).toBe('revisão.docx');
  });

  it('falls back to the URL path segment for the filename', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(docxBytes(), { 'Content-Type': DOCX_MIME })));
    const out = await fetchDocxFromUrl('https://example.com/docs/contrato%20social.docx?v=2');
    expect(out.fileName).toBe('contrato social.docx');
  });

  it('accepts octet-stream when the URL path ends in .docx and bytes are a ZIP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(docxBytes(), { 'Content-Type': 'application/octet-stream' })));
    const out = await fetchDocxFromUrl('https://example.com/files/contrato.docx');
    expect(out.fileName).toBe('contrato.docx');
  });

  it('rejects an HTML content-type with the login-page message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/página web/);
  });

  it('rejects a non-docx content-type without .docx extension', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(docxBytes(), { 'Content-Type': 'application/pdf' })));
    await expect(fetchDocxFromUrl('https://example.com/relatorio.pdf')).rejects.toThrow(/ficheiro Word \(\.docx\)/);
  });

  it('rejects an HTML body served with a docx content-type (magic check)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<!DOCTYPE html><html>sign in</html>', { status: 200, headers: { 'Content-Type': DOCX_MIME } })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/página web/);
  });

  it('rejects non-ZIP bytes served as .docx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(Buffer.from('plain text'), { 'Content-Type': DOCX_MIME })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/ficheiro Word \(\.docx\)/);
  });

  it('rejects a declared content-length above 25MB before reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(docxBytes(), {
      'Content-Type': DOCX_MIME,
      'Content-Length': String(DOCX_MAX_BYTES + 1),
    })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/25 MB/);
  });

  it('rejects an actual body above 25MB even without content-length', async () => {
    const big = Buffer.concat([docxBytes(), Buffer.alloc(DOCX_MAX_BYTES)]);
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(big, { 'Content-Type': DOCX_MIME })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/25 MB/);
  });

  it('surfaces upstream HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/HTTP 404/);
  });
});

describe('fetchDocxFromUrl() - chunked bodies (no Content-Length)', () => {
  const MIB = 1024 * 1024;

  it('aborts a chunked stream the moment it passes 25MB instead of buffering it all', async () => {
    const chunk = Buffer.alloc(MIB, 0x61); // 1 MiB per pull
    const totalChunks = 100; // 100 MiB available upstream
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= totalChunks) {
          controller.close();
          return;
        }
        pulled++;
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(stream, { status: 200, headers: { 'Content-Type': DOCX_MIME } })));
    await expect(fetchDocxFromUrl('https://example.com/contrato.docx')).rejects.toThrow(/25 MB/);
    // The reader must cancel at the cap, not drain the whole stream.
    expect(pulled).toBeLessThan(totalChunks);
    expect(pulled).toBeLessThanOrEqual(Math.ceil(DOCX_MAX_BYTES / MIB) + 2);
  });

  it('accepts a chunked docx under the cap (bytes split across chunks)', async () => {
    const bytes = docxBytes('chunked-body');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes.subarray(0, 2)));
        controller.enqueue(new Uint8Array(bytes.subarray(2)));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(stream, { status: 200, headers: { 'Content-Type': DOCX_MIME } })));
    const out = await fetchDocxFromUrl('https://example.com/contrato.docx');
    expect(out.buffer.equals(bytes)).toBe(true);
    expect(out.fileName).toBe('contrato.docx');
  });
});

describe('fetchDocxFromUrl() - OneDrive/SharePoint share links (Graph)', () => {
  const shareUrl = 'https://firma.sharepoint.com/:w:/g/pessoal/goncalo/EaBcD?e=xyz';

  it('resolves the share via an unpadded base64url u! token and downloads content', async () => {
    connected(false, true);
    const expectedToken = `u!${Buffer.from(shareUrl, 'utf8').toString('base64url')}`;
    expect(expectedToken).toMatch(/^u![A-Za-z0-9_-]+$/);
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      urls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer graph-tok');
      if (String(url).endsWith('/content')) return binaryResponse(docxBytes());
      return jsonResponse({ id: 'it1', name: 'Contrato v3.docx', size: 2048, file: { mimeType: DOCX_MIME } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchDocxFromUrl(shareUrl);
    expect(urls[0]).toBe(`https://graph.microsoft.com/v1.0/shares/${expectedToken}/driveItem?$select=id,name,size,file`);
    expect(urls[1]).toBe(`https://graph.microsoft.com/v1.0/shares/${expectedToken}/driveItem/content`);
    expect(out).toMatchObject({ fileName: 'Contrato v3.docx', source: 'graph-share' });
  });

  it('routes 1drv.ms and onedrive.live.com links through Graph too', async () => {
    connected(false, true);
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/content')) return binaryResponse(docxBytes());
      return jsonResponse({ id: 'x', name: 'nota.docx', size: 10, file: { mimeType: DOCX_MIME } });
    }));
    const short = await fetchDocxFromUrl('https://1drv.ms/w/s!AbCdEf123');
    expect(short.source).toBe('graph-share');
    const live = await fetchDocxFromUrl('https://onedrive.live.com/redir?resid=X!123');
    expect(live.source).toBe('graph-share');
  });

  it('throws the M365-not-connected PT error without touching Graph', async () => {
    connected(false, false);
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchDocxFromUrl(shareUrl)).rejects.toThrow(/integração Microsoft 365/);
    expect(spy).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('surfaces a Graph access failure with the status code', async () => {
    connected(false, true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    await expect(fetchDocxFromUrl(shareUrl)).rejects.toThrow(/HTTP 403/);
  });

  it('rejects a shared item that is not a Word document before downloading', async () => {
    connected(false, true);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: 'x', name: 'folha.xlsx', size: 10, file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDocxFromUrl('https://1drv.ms/x/s!AbC')).rejects.toThrow(/ficheiro Word \(\.docx\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized shared item from metadata alone', async () => {
    connected(false, true);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: 'x', name: 'grande.docx', size: DOCX_MAX_BYTES + 1, file: { mimeType: DOCX_MIME } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDocxFromUrl(shareUrl)).rejects.toThrow(/25 MB/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchDocxFromUrl() - Google Drive links', () => {
  it('downloads via cloud-files with the extracted file id', async () => {
    connected(true, false);
    downloadCloudFile.mockResolvedValue({ name: 'Parecer.docx', mimeType: DOCX_MIME, data: docxBytes() });
    const out = await fetchDocxFromUrl('https://drive.google.com/file/d/1AbC_dEf-123/view?usp=sharing');
    expect(downloadCloudFile).toHaveBeenCalledWith('google', 'gdrive-tok', '1AbC_dEf-123');
    expect(out).toMatchObject({ fileName: 'Parecer.docx', source: 'url' });
  });

  it('handles native Docs links (exported to .docx by cloud-files)', async () => {
    connected(true, false);
    downloadCloudFile.mockResolvedValue({ name: 'Minuta.docx', mimeType: DOCX_MIME, data: docxBytes() });
    const out = await fetchDocxFromUrl('https://docs.google.com/document/d/1DocId_-abc/edit');
    expect(downloadCloudFile).toHaveBeenCalledWith('google', 'gdrive-tok', '1DocId_-abc');
    expect(out.fileName).toBe('Minuta.docx');
  });

  it('throws the Google-not-connected PT error without downloading', async () => {
    connected(false, false);
    await expect(fetchDocxFromUrl('https://drive.google.com/file/d/1AbC/view')).rejects.toThrow(/integração Google Workspace/);
    expect(downloadCloudFile).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a Drive file that is not a Word document', async () => {
    connected(true, false);
    downloadCloudFile.mockResolvedValue({ name: 'digitalizacao.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7') });
    await expect(fetchDocxFromUrl('https://drive.google.com/file/d/1AbC/view')).rejects.toThrow(/ficheiro Word \(\.docx\)/);
  });
});

describe('fetchDocxFromCloud() - workspace cloud storage (provider + fileId/query)', () => {
  const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

  it('query: filters to .docx/native-Docs candidates, picks the first and reports the choice', async () => {
    listCloudFiles.mockResolvedValue([
      { id: 'f0', name: 'Contratos', mimeType: 'application/vnd.google-apps.folder', isFolder: true },
      { id: 'f1', name: 'folha.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', isFolder: false },
      { id: 'f2', name: 'Contrato v2.docx', mimeType: DOCX_MIME, isFolder: false },
      { id: 'f3', name: 'Minuta antiga', mimeType: GOOGLE_DOC_MIME, isFolder: false },
    ]);
    downloadCloudFile.mockResolvedValue({ name: 'Contrato v2.docx', mimeType: DOCX_MIME, data: docxBytes() });

    const out = await fetchDocxFromCloud('google', { query: 'contrato' });
    expect(listCloudFiles).toHaveBeenCalledWith('google', 'gdrive-tok', 'contrato');
    expect(downloadCloudFile).toHaveBeenCalledWith('google', 'gdrive-tok', 'f2');
    expect(out.fileName).toBe('Contrato v2.docx');
    expect(out.source).toBe('cloud:google');
    expect(out.chosenFrom).toEqual({ matches: 2, name: 'Contrato v2.docx' });
  });

  it('query: a native Google Doc counts as a candidate and gets .docx appended', async () => {
    listCloudFiles.mockResolvedValue([
      { id: 'g1', name: 'Parecer fiscal', mimeType: GOOGLE_DOC_MIME, isFolder: false },
    ]);
    downloadCloudFile.mockResolvedValue({ name: 'Parecer fiscal', mimeType: DOCX_MIME, data: docxBytes() });
    const out = await fetchDocxFromCloud('google', { query: 'parecer' });
    expect(out.fileName).toBe('Parecer fiscal.docx');
    expect(out.chosenFrom).toEqual({ matches: 1, name: 'Parecer fiscal' });
  });

  it('query with no .docx match throws the no-match error without downloading', async () => {
    listCloudFiles.mockResolvedValue([
      { id: 'x1', name: 'orcamento.xlsx', mimeType: 'application/vnd.ms-excel', isFolder: false },
    ]);
    await expect(fetchDocxFromCloud('microsoft', { query: 'contrato' }))
      .rejects.toThrow('No Word document matched "contrato" in microsoft.');
    expect(downloadCloudFile).not.toHaveBeenCalled();
  });

  it('fileId: downloads directly without listing and without chosenFrom', async () => {
    downloadCloudFile.mockResolvedValue({ name: 'Acordo.docx', mimeType: DOCX_MIME, data: docxBytes() });
    const out = await fetchDocxFromCloud('microsoft', { fileId: 'item-9' });
    expect(listCloudFiles).not.toHaveBeenCalled();
    expect(downloadCloudFile).toHaveBeenCalledWith('microsoft', 'graph-tok', 'item-9');
    expect(out).toMatchObject({ fileName: 'Acordo.docx', source: 'cloud:microsoft' });
    expect(out.chosenFrom).toBeUndefined();
  });

  it('fileId: rejects a downloaded file that is not a Word document', async () => {
    downloadCloudFile.mockResolvedValue({ name: 'scan.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7') });
    await expect(fetchDocxFromCloud('google', { fileId: 'pdf-1' }))
      .rejects.toThrow('"scan.pdf" is not a Word document (.docx).');
  });
});
