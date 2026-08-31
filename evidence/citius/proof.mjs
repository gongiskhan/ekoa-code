// Live proof of the Citius rail against the committed fixture. Not a test: a driver that says
// exactly what happened at each step, so a failure names its own cause.
const API = process.env.API ?? 'http://127.0.0.1:4211';
const PORTAL = process.env.PORTAL ?? 'http://127.0.0.1:45190';

const j = (r) => r.json().catch(() => null);
let token = '';
async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await j(r) };
}
const show = (label, r) => {
  const s = JSON.stringify(r.body);
  console.log(`${label}: ${r.status} ${s && s.length > 900 ? s.slice(0, 900) + '…' : s}`);
};

// 1. login
const login = await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'tmp12345' });
token = login.body?.token ?? login.body?.accessToken ?? '';
console.log(`1. login: ${login.status} token=${token ? 'yes' : 'NO -> ' + JSON.stringify(login.body)}`);
if (!token) process.exit(1);

// 2. connect the integration, pointing it at the fixture
show('2. connect', await call('POST', '/api/v1/integrations/configs', {
  integrationKey: 'citius',
  configValues: { cedula_profissional: '12345', portal_url: PORTAL, nome_mandatario: 'Dra. Ana Ribeiro Costa' },
}));

// 3. the ceremony address must now be the FIXTURE, not portal.tribunais.org.pt
const sess = await call('GET', '/api/v1/integrations/citius/session');
console.log(`3. session.loginUrl = ${JSON.stringify(sess.body?.sessionConnect?.loginUrl)} (want ${PORTAL})`);
console.log(`   available=${sess.body?.sessionConnect?.available} message=${JSON.stringify(sess.body?.sessionConnect?.message)}`);

// 4. provision the automations
show('4. provision', await call('POST', '/api/v1/integrations/citius/provision-automations'));

// 5. the action that could never resolve its automation
show('5. consultar_notificacoes', await call('POST', '/api/v1/integrations/citius/actions/consultar_notificacoes/execute', { args: {} }));

// 6. the listener trigger: it must be a POLLED LISTENER, not a webhook nothing calls
const trig = await call('POST', '/api/v1/triggers', {
  integrationKey: 'citius',
  eventName: 'notificacao.recebida',
  target: { kind: 'artifact-backend', artifactId: 'legal-citius', entrypoint: 'onNotificacaoCitius' },
});
const t = trig.body?.trigger;
console.log(`6. trigger kind=${t?.kind} pollConfig=${JSON.stringify(t?.pollConfig)} -> ${t?.entrypoint}`);
