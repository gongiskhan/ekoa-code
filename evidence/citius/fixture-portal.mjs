// Citius / eTribunal acceptance fixture: a stand-in for the Portal dos Mandatarios.
// Plain node http, zero deps. Sibling of evidence/cornerstone/fixture-portal.mjs and built the
// same way, for the same reason: the real portal cannot be a development loop.
//
// WHY A FIXTURE AT ALL, stated plainly so nobody mistakes this for the real thing.
// portal.tribunais.org.pt authenticates with an Ordem dos Advogados certificate or Chave Movel
// Digital, both interactive and both two-factor. Every attempt costs a human a physical
// authentication, so it cannot be an inner loop; and repeatedly driving a scraper against a live
// national court portal to debug our own code is not a thing to do. So the rail is developed and
// proven here, and the real portal is met ONCE, attended, with the rail already known to work.
//
// WHAT IS ASSUMED, and where it could be wrong. The pages below are server-rendered shells whose
// own JS fetches a private JSON API - the shape of the rebuilt eTribunal mandatario area, not the
// classic ASP.NET WebForms of the public www.citius.mj.pt consultation. That assumption is what
// makes the learn -> zero-model replay leg reachable, because a recipe compiles the calls a page
// makes. If the real portal turns out to be server-rendered with no JSON underneath, the recipe
// will compile no injected calls and every run stays on the vision path: slower and costlier, but
// still correct. Nothing here is evidence about the real portal's DOM.
//
//   GET  /                              -> login page, or redirect to /mandatario when authed
//   POST /login                         -> sets the session cookie (cedula 12345 / demo123)
//   GET  /mandatario                    -> the reserved area shell
//   GET  /mandatario/notificacoes       -> notifications shell; its JS fetches the API
//   GET  /mandatario/processos          -> process search shell
//   GET  /mandatario/processo/<num>     -> one process, with its documents tab
//   GET  {API}/notificacoes?pagina=N    -> private JSON, paginated (401 without the cookie)
//   GET  {API}/processo/<num>           -> private JSON: the process and its movements
//   GET  {API}/processo/<num>/documentos?pagina=N -> private JSON: paginated document list
//   GET  {API}/documento/<ref>          -> the file itself (application/pdf)
//
// EKOA_FIXTURE_BREAK=1 moves the whole private API from /api to /api/v2 and rewrites the page JS
// to match, simulating the drift the self-heal must survive. It changes NOTHING else - in
// particular the sessions persist across a restart (see below), so the break flag moves exactly
// one variable.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 45190);

// SESSIONS SURVIVE A RESTART, and that is what makes the drift step mean anything. With the
// session set held only in memory, restarting under EKOA_FIXTURE_BREAK=1 would also destroy the
// captured session, so the next run would meet a LOGIN WALL rather than a moved endpoint and what
// got exercised would be re-authentication instead of self-heal. Two variables moving at once
// means the step tests the wrong one. (Carried verbatim from the cornerstone fixture, which
// learned it the hard way.)
const STORE = join(tmpdir(), 'ekoa-fixture-citius-sessions.json');
function loadSessions() {
  try {
    return new Set(JSON.parse(readFileSync(STORE, 'utf8')));
  } catch {
    return new Set();
  }
}
const sessions = loadSessions();
function persist() {
  try {
    writeFileSync(STORE, JSON.stringify([...sessions]));
  } catch {
    /* a fixture that cannot persist still serves; it just forgets across restarts. */
  }
}

const BROKEN = process.env.EKOA_FIXTURE_BREAK === '1';
const API = BROKEN ? '/api/v2' : '/api';

const MANDATARIO = { nome: 'Dra. Ana Ribeiro Costa', cedula: '12345' };

// ---------------------------------------------------------------------------------------------
// The data. Three processes with real-looking unique numbers (NNNN/AA.DTTLLL), each with its own
// documents; notifications reference them. Two pages of notifications, so the pagination step in
// the automation template has something to do.
// ---------------------------------------------------------------------------------------------
const PROCESSOS = {
  '1234/26.0T8LSB': {
    processo: '1234/26.0T8LSB',
    tribunal: 'Tribunal Judicial da Comarca de Lisboa - Juizo Central Civel de Lisboa - Juiz 3',
    especie: 'Acao de processo comum',
    estado: 'Pendente',
    partes: { autor: 'Alfa Construcoes, Lda.', reu: 'Beta Imobiliaria, S.A.' },
    movimentos: [
      { data: '2026-08-24', ato: 'Contestacao apresentada' },
      { data: '2026-07-30', ato: 'Citacao do reu - realizada' },
      { data: '2026-06-15', ato: 'Peticao inicial - distribuida' },
    ],
    documentos: [
      { ref: 'doc-1234-001', nome: 'Peticao inicial.pdf', tipo: 'Peticao inicial', data: '2026-06-15', paginas: 24 },
      { ref: 'doc-1234-002', nome: 'Procuracao forense.pdf', tipo: 'Procuracao', data: '2026-06-15', paginas: 2 },
      { ref: 'doc-1234-003', nome: 'Documento 1 - contrato de empreitada.pdf', tipo: 'Documento', data: '2026-06-15', paginas: 11 },
      { ref: 'doc-1234-004', nome: 'Citacao do reu.pdf', tipo: 'Citacao', data: '2026-07-30', paginas: 3 },
      { ref: 'doc-1234-005', nome: 'Contestacao.pdf', tipo: 'Contestacao', data: '2026-08-24', paginas: 31 },
      { ref: 'doc-1234-006', nome: 'Despacho saneador.pdf', tipo: 'Despacho', data: '2026-08-28', paginas: 5 },
    ],
  },
  '987/25.4T8PRT': {
    processo: '987/25.4T8PRT',
    tribunal: 'Tribunal Judicial da Comarca do Porto - Juizo do Trabalho do Porto - Juiz 1',
    especie: 'Acao de impugnacao de despedimento',
    estado: 'Pendente',
    partes: { autor: 'Carlos Meireles', reu: 'Gamma Servicos Unipessoal, Lda.' },
    movimentos: [
      { data: '2026-08-20', ato: 'Audiencia de partes designada' },
      { data: '2026-07-11', ato: 'Requerimento inicial - distribuido' },
    ],
    documentos: [
      { ref: 'doc-0987-001', nome: 'Requerimento inicial.pdf', tipo: 'Requerimento', data: '2026-07-11', paginas: 9 },
      { ref: 'doc-0987-002', nome: 'Contrato de trabalho.pdf', tipo: 'Documento', data: '2026-07-11', paginas: 4 },
      { ref: 'doc-0987-003', nome: 'Notificacao de audiencia de partes.pdf', tipo: 'Notificacao', data: '2026-08-20', paginas: 2 },
    ],
  },
  '55/26.1T8CBR': {
    processo: '55/26.1T8CBR',
    tribunal: 'Tribunal Judicial da Comarca de Coimbra - Juizo Local Civel de Coimbra - Juiz 2',
    especie: 'Injuncao convertida em accao',
    estado: 'Pendente',
    partes: { autor: 'Delta Comercio, Lda.', reu: 'Epsilon Retalho, Lda.' },
    movimentos: [{ data: '2026-08-29', ato: 'Oposicao apresentada' }],
    documentos: [
      { ref: 'doc-0055-001', nome: 'Requerimento de injuncao.pdf', tipo: 'Injuncao', data: '2026-05-02', paginas: 6 },
      { ref: 'doc-0055-002', nome: 'Oposicao.pdf', tipo: 'Oposicao', data: '2026-08-29', paginas: 14 },
    ],
  },
};

const NOTIFICACOES = [
  { id: 'NOT-2026-000412', processo: '55/26.1T8CBR', data: '2026-08-29', tribunal: PROCESSOS['55/26.1T8CBR'].tribunal, ato: 'Notificacao de oposicao', temDocumento: true, prazoDias: 10, dataLimite: '2026-09-12' },
  { id: 'NOT-2026-000408', processo: '1234/26.0T8LSB', data: '2026-08-28', tribunal: PROCESSOS['1234/26.0T8LSB'].tribunal, ato: 'Despacho saneador', temDocumento: true, prazoDias: 10, dataLimite: '2026-09-11' },
  { id: 'NOT-2026-000397', processo: '1234/26.0T8LSB', data: '2026-08-24', tribunal: PROCESSOS['1234/26.0T8LSB'].tribunal, ato: 'Notificacao de contestacao', temDocumento: true, prazoDias: 10, dataLimite: '2026-09-07' },
  { id: 'NOT-2026-000381', processo: '987/25.4T8PRT', data: '2026-08-20', tribunal: PROCESSOS['987/25.4T8PRT'].tribunal, ato: 'Designacao de audiencia de partes', temDocumento: true, prazoDias: null, dataLimite: null },
  { id: 'NOT-2026-000362', processo: '1234/26.0T8LSB', data: '2026-07-30', tribunal: PROCESSOS['1234/26.0T8LSB'].tribunal, ato: 'Citacao - realizada', temDocumento: true, prazoDias: 30, dataLimite: '2026-08-29' },
];
const POR_PAGINA = 3;

function authed(req) {
  const m = (req.headers.cookie ?? '').match(/citius_session=([a-f0-9-]+)/);
  return m !== null && sessions.has(m[1]);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function html(title, body) {
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${title} - Portal dos Mandatarios</title></head><body>${body}</body></html>`;
}

/** The reserved-area chrome every authenticated page carries - the marker the `verify` step looks for. */
function chrome(inner) {
  return `
    <header>
      <span id="portal">Portal dos Mandatarios</span>
      <span id="mandatario">${MANDATARIO.nome}</span>
      <span id="cedula">Cedula ${MANDATARIO.cedula}</span>
    </header>
    <nav id="menu">
      <a href="/mandatario/notificacoes" id="nav-notificacoes">Notificacoes</a>
      <a href="/mandatario/processos" id="nav-processos">Os meus processos</a>
    </nav>
    <main>${inner}</main>`;
}

/** A minimal, valid one-page PDF naming the document - enough to be a real file, not a stub. */
function pdfFor(doc) {
  const text = `${doc.nome} (${doc.tipo}, ${doc.data})`.replace(/[()\\]/g, '');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 12 Tf 60 760 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // ---- login ---------------------------------------------------------------------------------
  if (req.method === 'POST' && path === '/login') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const p = new URLSearchParams(raw);
      if (p.get('cedula') === MANDATARIO.cedula && p.get('senha') === 'demo123') {
        const sid = randomUUID();
        sessions.add(sid);
        persist();
        res.writeHead(302, { 'Set-Cookie': `citius_session=${sid}; HttpOnly; Path=/`, Location: '/mandatario/notificacoes' });
        return res.end();
      }
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Autenticacao', '<p id="erro">Credenciais invalidas.</p>'));
    });
    return;
  }

  // ---- the private API -----------------------------------------------------------------------

  // THE OLD PATH IS GONE, AND IT SAYS SO. Under EKOA_FIXTURE_BREAK the API moves to /api/v2, and
  // without this the abandoned /api/... would fall through to the page handler and answer 302 to
  // the dashboard - which is indistinguishable from an EXPIRED SESSION redirecting to login. The
  // drift step would then be testing re-authentication again, the exact confusion the persisted
  // session set exists to avoid. A moved JSON endpoint answers 404; that is both the honest signal
  // and the one a replay can classify correctly.
  if (BROKEN && path.startsWith('/api/') && !path.startsWith(`${API}/`)) {
    return json(res, 404, { erro: 'rota desconhecida' });
  }

  if (path.startsWith(`${API}/`)) {
    if (!authed(req)) return json(res, 401, { erro: 'sessao necessaria' });
    const rest = path.slice(API.length + 1);

    if (rest === 'notificacoes') {
      const pagina = Math.max(1, Number(url.searchParams.get('pagina') ?? 1));
      const desde = url.searchParams.get('desde');
      const all = desde ? NOTIFICACOES.filter((n) => n.data >= desde) : NOTIFICACOES;
      const slice = all.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
      return json(res, 200, {
        notificacoes: slice,
        pagina,
        // The count of PAGES. Named unambiguously on purpose: `pageTotal` meant two different
        // quantities across the old sync's seams and certified a truncated sweep as complete
        // (docs/findings.md, hazard 1 of legal/citius-sync.ts).
        totalPaginas: Math.max(1, Math.ceil(all.length / POR_PAGINA)),
        totalNotificacoes: all.length,
        // The listener's cursor field.
        highWater: all.length > 0 ? all[0].id : null,
      });
    }

    const proc = /^processo\/([^/]+)(?:\/(documentos))?$/.exec(rest);
    if (proc) {
      const numero = decodeURIComponent(proc[1]);
      const p = PROCESSOS[numero];
      if (!p) return json(res, 404, { erro: `processo ${numero} nao encontrado` });
      if (proc[2] === 'documentos') {
        const pagina = Math.max(1, Number(url.searchParams.get('pagina') ?? 1));
        const slice = p.documentos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
        return json(res, 200, {
          processo: numero,
          documentos: slice.map((d) => ({ ...d, url: `${API}/documento/${d.ref}` })),
          pagina,
          totalPaginas: Math.max(1, Math.ceil(p.documentos.length / POR_PAGINA)),
          totalDocumentos: p.documentos.length,
        });
      }
      const { documentos, ...semDocs } = p;
      return json(res, 200, { ...semDocs, totalDocumentos: documentos.length });
    }

    const docm = /^documento\/([^/]+)$/.exec(rest);
    if (docm) {
      const ref = decodeURIComponent(docm[1]);
      for (const p of Object.values(PROCESSOS)) {
        const d = p.documentos.find((x) => x.ref === ref);
        if (d) {
          const body = pdfFor(d);
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': body.length,
            'Content-Disposition': `attachment; filename="${d.ref}.pdf"`,
          });
          return res.end(body);
        }
      }
      return json(res, 404, { erro: `documento ${ref} nao encontrado` });
    }

    return json(res, 404, { erro: 'rota desconhecida' });
  }

  // ---- authenticated pages -------------------------------------------------------------------
  const gate = () => {
    res.writeHead(302, { Location: '/' });
    res.end();
  };

  if (path === '/mandatario' || path === '/mandatario/') {
    if (!authed(req)) return gate();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html('Area reservada', chrome('<h1 id="titulo">Area reservada do mandatario</h1>')));
  }

  if (path === '/mandatario/notificacoes') {
    if (!authed(req)) return gate();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html('Notificacoes', chrome(`
      <h1 id="titulo">Notificacoes eletronicas</h1>
      <form id="filtro"><label>Desde <input id="desde" name="desde" type="date"></label>
      <button type="button" id="aplicar">Aplicar</button></form>
      <table id="tabela-notificacoes"><thead><tr>
        <th>Processo</th><th>Data</th><th>Tribunal</th><th>Acto</th><th>Documento</th><th>Prazo</th>
      </tr></thead><tbody id="linhas"></tbody></table>
      <div id="paginacao"></div>
      <script>
        let pagina = 1;
        function carregar() {
          const desde = document.getElementById('desde').value;
          const q = new URLSearchParams({ pagina: String(pagina) });
          if (desde) q.set('desde', desde);
          fetch('${API}/notificacoes?' + q).then(r => r.json()).then(d => {
            const tb = document.getElementById('linhas');
            tb.innerHTML = '';
            for (const n of d.notificacoes) {
              const tr = document.createElement('tr');
              tr.setAttribute('data-id', n.id);
              for (const v of [n.processo, n.data, n.tribunal, n.ato, n.temDocumento ? 'Sim' : 'Nao', n.dataLimite || '-']) {
                const td = document.createElement('td');
                td.textContent = v;
                tr.appendChild(td);
              }
              tb.appendChild(tr);
            }
            const pg = document.getElementById('paginacao');
            pg.innerHTML = 'Pagina ' + d.pagina + ' de ' + d.totalPaginas + ' ';
            if (d.pagina < d.totalPaginas) {
              const b = document.createElement('button');
              b.id = 'proxima-pagina';
              b.textContent = 'Pagina seguinte';
              b.onclick = () => { pagina += 1; carregar(); };
              pg.appendChild(b);
            }
          });
        }
        document.getElementById('aplicar').onclick = () => { pagina = 1; carregar(); };
        carregar();
      </script>`)));
  }

  // SEARCH ANSWERS WITH A RESULTS LIST, NOT THE RECORD. The automation templates model the real
  // portal as search -> results -> open, and a fixture that jumped straight to the record would
  // leave the "abrir-processo" step with nothing to click: the loop would appear to pass while
  // never exercising a step the real portal will certainly need.
  if (path === '/mandatario/processos') {
    if (!authed(req)) return gate();
    const q = (url.searchParams.get('numeroProcesso') ?? '').trim();
    const matches = q
      ? Object.keys(PROCESSOS).filter((n) => n.toLowerCase().includes(q.toLowerCase()))
      : Object.keys(PROCESSOS);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html('Os meus processos', chrome(`
      <h1 id="titulo">Os meus processos</h1>
      <form id="pesquisa" method="get" action="/mandatario/processos">
        <label>Numero unico de processo
          <input id="numeroProcesso" name="numeroProcesso" value="${q.replace(/"/g, '&quot;')}"
                 placeholder="1234/26.0T8LSB"></label>
        <button type="submit" id="pesquisar">Pesquisar</button>
      </form>
      ${matches.length === 0
        ? `<p id="sem-resultados">Sem resultados para "${q.replace(/</g, '&lt;')}".</p>`
        : `<table id="resultados"><thead><tr><th>Processo</th><th>Tribunal</th><th>Especie</th></tr></thead><tbody>
            ${matches.map((n) => `<tr data-processo="${n}">
              <td><a id="abrir-${n.replace(/[^A-Za-z0-9]/g, '-')}"
                     href="/mandatario/processo?numeroProcesso=${encodeURIComponent(n)}">${n}</a></td>
              <td>${PROCESSOS[n].tribunal}</td><td>${PROCESSOS[n].especie}</td></tr>`).join('')}
          </tbody></table>`}`)));
  }

  if (path === '/mandatario/processo') {
    if (!authed(req)) return gate();
    const numero = url.searchParams.get('numeroProcesso') ?? '';
    if (!PROCESSOS[numero]) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html('Processo', chrome(`<p id="sem-resultados">Sem resultados para "${numero}".</p>`)));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html(`Processo ${numero}`, chrome(`
      <h1 id="titulo">Processo ${numero}</h1>
      <dl id="ficha"><dt>Tribunal</dt><dd id="tribunal"></dd>
      <dt>Especie</dt><dd id="especie"></dd><dt>Estado</dt><dd id="estado"></dd></dl>
      <h2 id="tab-movimentos">Movimentos</h2><ul id="movimentos"></ul>
      <h2 id="tab-documentos">Documentos / pecas processuais</h2>
      <table id="tabela-documentos"><thead><tr>
        <th>Nome</th><th>Tipo</th><th>Data</th><th>Ficheiro</th>
      </tr></thead><tbody id="linhas-documentos"></tbody></table>
      <div id="paginacao-documentos"></div>
      <script>
        const numero = ${JSON.stringify(numero)};
        let pagina = 1;
        fetch('${API}/processo/' + encodeURIComponent(numero)).then(r => r.json()).then(p => {
          document.getElementById('tribunal').textContent = p.tribunal;
          document.getElementById('especie').textContent = p.especie;
          document.getElementById('estado').textContent = p.estado;
          const ul = document.getElementById('movimentos');
          for (const m of p.movimentos) {
            const li = document.createElement('li');
            li.textContent = m.data + ' - ' + m.ato;
            ul.appendChild(li);
          }
        });
        function carregarDocs() {
          fetch('${API}/processo/' + encodeURIComponent(numero) + '/documentos?pagina=' + pagina)
            .then(r => r.json()).then(d => {
              const tb = document.getElementById('linhas-documentos');
              tb.innerHTML = '';
              for (const doc of d.documentos) {
                const tr = document.createElement('tr');
                tr.setAttribute('data-ref', doc.ref);
                for (const v of [doc.nome, doc.tipo, doc.data]) {
                  const td = document.createElement('td');
                  td.textContent = v;
                  tr.appendChild(td);
                }
                const td = document.createElement('td');
                const a = document.createElement('a');
                a.href = doc.url;
                a.id = 'descarregar-' + doc.ref;
                a.textContent = 'Descarregar';
                td.appendChild(a);
                tr.appendChild(td);
                tb.appendChild(tr);
              }
              const pg = document.getElementById('paginacao-documentos');
              pg.innerHTML = 'Pagina ' + d.pagina + ' de ' + d.totalPaginas + ' ';
              if (d.pagina < d.totalPaginas) {
                const b = document.createElement('button');
                b.id = 'proxima-pagina-documentos';
                b.textContent = 'Pagina seguinte';
                b.onclick = () => { pagina += 1; carregarDocs(); };
                pg.appendChild(b);
              }
            });
        }
        carregarDocs();
      </script>`)));
  }

  // ---- login page (or straight in when the session is live) -----------------------------------
  if (authed(req)) {
    res.writeHead(302, { Location: '/mandatario/notificacoes' });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html('Autenticacao', `
    <h1 id="titulo">Portal dos Mandatarios - autenticacao</h1>
    <p>Autentique-se com o certificado da Ordem dos Advogados ou com a Chave Movel Digital.</p>
    <form method="post" action="/login">
      <label>Cedula profissional <input name="cedula" id="cedula"></label>
      <label>Palavra-passe <input name="senha" id="senha" type="password"></label>
      <button type="submit" id="entrar">Entrar</button>
    </form>`));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `citius fixture on http://127.0.0.1:${PORT} (api at ${API}, ` +
      `${Object.keys(PROCESSOS).length} processos, ${NOTIFICACOES.length} notificacoes, ` +
      `${sessions.size} session(s) restored)`,
  );
});
