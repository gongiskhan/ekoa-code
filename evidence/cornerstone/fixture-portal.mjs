// K7 acceptance fixture: a login-gated "portal" with a private JSON API underneath.
// Plain node http, zero deps. State: in-memory session cookie.
//   GET  /            -> login page (form) or dashboard when authenticated
//   POST /login       -> sets the session cookie (user: demo / pass: demo123)
//   GET  /painel      -> dashboard HTML; its own JS fetches /api/pedidos and renders a list
//   GET  /api/pedidos -> the private API (401 without the cookie)
// EKOA_FIXTURE_BREAK=1 moves the API to /api/v2/pedidos and rewrites the dashboard JS,
// simulating the site drift the self-heal must survive.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 45180);
const sessions = new Set();
const BROKEN = process.env.EKOA_FIXTURE_BREAK === '1';
const API_PATH = BROKEN ? '/api/v2/pedidos' : '/api/pedidos';

const PEDIDOS = [
  { id: 101, cliente: 'Alfa Lda', estado: 'pendente', total: 420.5 },
  { id: 102, cliente: 'Beta SA', estado: 'pendente', total: 1290.0 },
  { id: 103, cliente: 'Gamma Unip', estado: 'aprovado', total: 88.2 },
];

function authed(req) {
  const cookie = req.headers.cookie ?? '';
  const m = cookie.match(/fixture_session=([a-f0-9-]+)/);
  return m !== null && sessions.has(m[1]);
}

function html(body) {
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Portal Fixture</title></head><body>${body}</body></html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/login') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const params = new URLSearchParams(raw);
      if (params.get('user') === 'demo' && params.get('pass') === 'demo123') {
        const sid = randomUUID();
        sessions.add(sid);
        res.writeHead(302, { 'Set-Cookie': `fixture_session=${sid}; HttpOnly; Path=/`, Location: '/painel' });
        return res.end();
      }
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('<p id="erro">Credenciais erradas.</p>'));
    });
    return;
  }

  if (url.pathname === API_PATH) {
    if (!authed(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'sessao necessaria' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ pedidos: PEDIDOS, total: PEDIDOS.length }));
  }

  if (url.pathname === '/painel') {
    if (!authed(req)) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html(`
      <h1 id="titulo">Pedidos pendentes</h1>
      <ul id="lista-pedidos"></ul>
      <script>
        fetch('${API_PATH}').then(r => r.json()).then(d => {
          const ul = document.getElementById('lista-pedidos');
          for (const p of d.pedidos) {
            const li = document.createElement('li');
            li.textContent = p.id + ' - ' + p.cliente + ' - ' + p.estado + ' - ' + p.total;
            ul.appendChild(li);
          }
        });
      </script>`));
  }

  // Login page (or straight to the dashboard when the session is live).
  if (authed(req)) {
    res.writeHead(302, { Location: '/painel' });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html(`
    <h1>Entrar no Portal Fixture</h1>
    <form method="post" action="/login">
      <label>Utilizador <input name="user" id="user"></label>
      <label>Palavra-passe <input name="pass" id="pass" type="password"></label>
      <button type="submit" id="entrar">Entrar</button>
    </form>`));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fixture portal on http://127.0.0.1:${PORT} (api at ${API_PATH})`);
});
