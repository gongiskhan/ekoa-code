import { describe, it, expect } from 'vitest';
import {
  normalizeUrl, inScope, extractLinks, extractContent, decodeHtmlBuffer, docExtFor, readCapped, MIN_TEXT_CHARS,
} from '../../../src/knowledge/crawl/extract.js';

describe('normalizeUrl', () => {
  it('drops the fragment, keeps the query, strips a trailing slash on the path', () => {
    expect(normalizeUrl('https://dgsi.pt/a/b/#section')).toBe('https://dgsi.pt/a/b');
    expect(normalizeUrl('https://dgsi.pt/a?x=1#y')).toBe('https://dgsi.pt/a?x=1');
    expect(normalizeUrl('https://dgsi.pt/')).toBe('https://dgsi.pt/'); // root path is kept
  });
  it('resolves a relative URL against a base', () => {
    expect(normalizeUrl('/leis/x.php', 'https://pgdlisboa.pt/leis/lei_main.php')).toBe('https://pgdlisboa.pt/leis/x.php');
  });
  it('returns null for an unparseable URL', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('inScope', () => {
  const seed = 'https://www.dgsi.pt/';
  it('same-domain: exact host, www.-normalized, or a real subdomain all match', () => {
    expect(inScope('https://dgsi.pt/x', seed, 'same-domain')).toBe(true);
    expect(inScope('https://www.dgsi.pt/x', seed, 'same-domain')).toBe(true);
    expect(inScope('https://jurisprudencia.dgsi.pt/x', seed, 'same-domain')).toBe(true);
  });
  it('same-domain: a different host (even a lookalike) is out of scope', () => {
    expect(inScope('https://evil-dgsi.pt/x', seed, 'same-domain')).toBe(false);
    expect(inScope('https://dgsi.pt.evil.com/x', seed, 'same-domain')).toBe(false);
    expect(inScope('https://example.com/x', seed, 'same-domain')).toBe(false);
  });
  it('any: every host matches', () => {
    expect(inScope('https://example.com/x', seed, 'any')).toBe(true);
  });
  it('an unparseable candidate or seed is out of scope, never throws', () => {
    expect(inScope('not a url', seed, 'same-domain')).toBe(false);
    expect(inScope('https://dgsi.pt/x', 'not a url', 'same-domain')).toBe(false);
  });
});

describe('extractLinks', () => {
  it('extracts absolute, deduped http(s) links; drops #/mailto:/javascript:/tel: anchors', () => {
    const html = `<html><body>
      <a href="/a">A</a>
      <a href="https://dgsi.pt/a">A again (dup after resolve)</a>
      <a href="#top">skip</a>
      <a href="mailto:x@y.pt">skip</a>
      <a href="javascript:void(0)">skip</a>
      <a href="tel:+351123456789">skip</a>
      <a href="/b">B</a>
      <a>no href</a>
    </body></html>`;
    const links = extractLinks(html, 'https://dgsi.pt/');
    expect(links.sort()).toEqual(['https://dgsi.pt/a', 'https://dgsi.pt/b']);
  });
});

describe('extractContent', () => {
  it('reads the <title>, and the main-tag text as the body', () => {
    const html = `<html><head><title>Acórdão do STJ</title></head><body>
      <nav>menu chrome, must not appear</nav>
      <main><p>o prazo de recurso é de 30 dias</p></main>
      <footer>rodapé, must not appear</footer>
    </body></html>`;
    const { title, text } = extractContent(html, 'https://dgsi.pt/doc/1');
    expect(title).toBe('Acórdão do STJ');
    expect(text).toContain('prazo de recurso');
    expect(text).not.toContain('menu chrome');
    expect(text).not.toContain('rodapé');
  });

  it('falls back to <h1>, then the URL path, when there is no <title>', () => {
    const html = `<html><body><main><h1>Lei n.º 7/2009</h1><p>texto suficientemente longo para passar o piso mínimo de caracteres exigido pela extração de conteúdo</p></main></body></html>`;
    const { title } = extractContent(html, 'https://pgdlisboa.pt/leis/lei_main.php');
    expect(title).toBe('Lei n.º 7/2009');
  });

  it('pass 2 fallback: a legacy portal wrapping content in a site-wide <form> still yields text', () => {
    // Pass 1 strips <form>, which here happens to hold ALL the content - below MIN_TEXT_CHARS.
    // Pass 2 retries WITHOUT stripping structural wrappers and should recover the text.
    const longText = 'conteúdo legal '.repeat(10); // > 40 chars
    const html = `<html><body><form>${longText}</form></body></html>`;
    const { text } = extractContent(html, 'https://pgdlisboa.pt/leis/x.php');
    expect(text.length).toBeGreaterThanOrEqual(MIN_TEXT_CHARS);
    expect(text).toContain('conteúdo legal');
  });

  it('strips cookie-consent boilerplate (compound widget names only, never bare content mentioning "cookie")', () => {
    const html = `<html><body><main>
      <div id="cookie-bar">Este site utiliza cookies. <button>Aceito</button></div>
      <p>Texto sobre política de cookies em geral, sem ser um banner.</p>
    </main></body></html>`;
    const { text } = extractContent(html, 'https://act.gov.pt/');
    expect(text).not.toContain('utiliza cookies');
    expect(text).toContain('política de cookies em geral');
  });
});

describe('decodeHtmlBuffer', () => {
  it('decodes latin1 (ISO-8859-1) when the Content-Type charset says so, preserving PT accents', () => {
    const original = 'ações e prazos são contados em dias úteis';
    const buf = Buffer.from(original, 'latin1');
    const decoded = decodeHtmlBuffer(buf, 'text/html; charset=iso-8859-1');
    expect(decoded).toBe(original);
  });
  it('defaults to UTF-8 when no charset is declared', () => {
    const original = 'ações e prazos';
    const buf = Buffer.from(original, 'utf-8');
    expect(decodeHtmlBuffer(buf, 'text/html')).toBe(original);
  });
  it('falls back to a <meta charset> sniff when the header carries none', () => {
    const html = '<html><head><meta charset="windows-1252"></head><body>ok</body></html>';
    const buf = Buffer.from(html, 'latin1');
    expect(decodeHtmlBuffer(buf, 'text/html')).toContain('windows-1252');
  });
});

describe('docExtFor', () => {
  it('recognizes a document by Content-Type', () => {
    expect(docExtFor('application/pdf', 'https://x.pt/a')).toBe('pdf');
    expect(docExtFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'https://x.pt/a')).toBe('docx');
  });
  it('falls back to the URL extension when Content-Type is uninformative', () => {
    expect(docExtFor('application/octet-stream', 'https://x.pt/relatorio.pdf')).toBe('pdf');
    expect(docExtFor('', 'https://x.pt/ficha.docx')).toBe('docx');
  });
  it('returns null for an ordinary HTML page', () => {
    expect(docExtFor('text/html', 'https://x.pt/pagina')).toBeNull();
    expect(docExtFor('', 'https://x.pt/pagina')).toBeNull();
  });
});

describe('readCapped', () => {
  it('reads a body under the cap in full', async () => {
    const res = new Response('hello world');
    const buf = await readCapped(res, 1000);
    expect(buf.toString('utf8')).toBe('hello world');
  });
  it('stops at the byte cap on a body larger than it, never buffering past it', async () => {
    const res = new Response('a'.repeat(1000));
    const buf = await readCapped(res, 10);
    expect(buf.length).toBe(10);
  });
});
