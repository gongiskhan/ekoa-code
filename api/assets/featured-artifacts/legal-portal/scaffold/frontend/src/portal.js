/*
 * Lógica local do Portal do Cliente (não sincronizada - vive só neste app).
 *
 * MODELO DE ACESSO E CREDENCIAIS
 * ------------------------------
 * As credenciais do portal vivem na colecção POR-APP `utilizadores`
 * (window.__ekoa.list/create/update/delete), NUNCA na espinha partilhada, para
 * que as palavras-passe dos clientes fiquem fora do núcleo do escritório. Uma
 * linha de utilizador tem a forma:
 *   { email, nome, clienteId, role:'cliente', estado, passwordHash?, conviteToken?, criadoEm }
 *
 * A autenticação usa o login de app da plataforma (window.__ekoa.passwordSignIn
 * -> POST /api/app-sso/login), que verifica `passwordHash` (bcrypt) na linha de
 * `utilizadores` e cria a sessão de app (cookie por-app). whoami()/signOut()
 * funcionam sobre essa sessão.
 *
 * PROVISIONAMENTO DA PRIMEIRA PALAVRA-PASSE
 * -----------------------------------------
 * /api/app-sso/set-password exige uma sessão PRIVILEGIADA pré-existente, pelo
 * que não serve para a PRIMEIRA palavra-passe de um utilizador novo (nenhuma
 * sessão existe ainda). O caminho realmente suportado pela plataforma para
 * semear o primeiro hash é calcular o bcrypt do lado do cliente e escrevê-lo na
 * linha - o servidor verifica-o com bcrypt.compare no login (mesma biblioteca,
 * `bcryptjs`, hashes cruzadamente compatíveis). É o que o passo "definir
 * palavra-passe" (aberto por um LINK de convite com token) faz.
 *
 * INVISÍVEL POR OMISSÃO
 * ---------------------
 * A face do cliente mostra SÓ o que foi EXPLICITAMENTE partilhado (linhas
 * `portal_partilhas`). Não há partilha implícita: sem linhas, o cliente não vê
 * processos, documentos, eventos nem nomes de outros clientes.
 */

import bcrypt from 'bcryptjs';
import { listShared, createShared, updateShared, deleteShared } from './shared.js';

export const PORTAL_ROLE = 'cliente';
/** Colecção por-app onde vivem as credenciais do portal (fora da espinha). */
export const UTILIZADORES = 'utilizadores';

function ekoa() {
  return typeof window !== 'undefined' && window.__ekoa ? window.__ekoa : null;
}

export function appId() {
  return typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
}

/* ---------------------------------------------------------------------------
 * Loja por-app de utilizadores (credenciais). Degrada para vazio/no-op sem
 * contexto de app injectado.
 * ------------------------------------------------------------------------- */

export async function listUtilizadores() {
  const api = ekoa();
  if (!api || typeof api.list !== 'function') return [];
  try {
    const rows = await api.list(UTILIZADORES);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function createUtilizador(data) {
  const api = ekoa();
  if (!api || typeof api.create !== 'function') return null;
  return api.create(UTILIZADORES, data);
}

export async function updateUtilizador(id, patch) {
  const api = ekoa();
  if (!api || typeof api.update !== 'function') return null;
  return api.update(UTILIZADORES, id, patch);
}

export async function deleteUtilizador(id) {
  const api = ekoa();
  if (!api || typeof api.delete !== 'function') return false;
  return api.delete(UTILIZADORES, id);
}

const normEmail = (v) => String(v || '').trim().toLowerCase();

export async function findUtilizadorByEmail(email) {
  const want = normEmail(email);
  if (!want) return null;
  const users = await listUtilizadores();
  return users.find((u) => normEmail(u.email) === want) || null;
}

/* ---------------------------------------------------------------------------
 * Credenciais - token de convite (URL-safe, alta entropia) e hash bcrypt do
 * lado do cliente (o servidor verifica-o no login).
 * ------------------------------------------------------------------------- */

export function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  (typeof crypto !== 'undefined' ? crypto : window.crypto).getRandomValues(arr);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** bcrypt do lado do cliente. As rondas ficam embebidas no hash; o servidor
 *  verifica com bcrypt.compare independentemente das rondas usadas aqui. */
export async function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}

/* ---------------------------------------------------------------------------
 * Sessão de app (via a plataforma). Fina camada sobre window.__ekoa.
 * ------------------------------------------------------------------------- */

export async function whoami() {
  const api = ekoa();
  if (!api || typeof api.whoami !== 'function') return null;
  try {
    return await api.whoami();
  } catch {
    return null;
  }
}

export async function passwordSignIn(email, password) {
  const api = ekoa();
  if (!api || typeof api.passwordSignIn !== 'function') {
    return { ok: false, status: 0, error: 'sem_contexto' };
  }
  return api.passwordSignIn(normEmail(email), password);
}

export async function signOut() {
  const api = ekoa();
  if (!api || typeof api.signOut !== 'function') return false;
  try {
    return await api.signOut();
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Convite (escritório) - cria a linha partilhada `portal_acessos` (estado
 * visível ao escritório) e a linha por-app `utilizadores` (sem palavra-passe
 * ainda), devolvendo o token de uso único para o link de "definir palavra-passe".
 * Re-convidar um cliente já existente regenera o token e volta a "convidado".
 * ------------------------------------------------------------------------- */

export async function convidarCliente(cliente) {
  const email = normEmail(cliente && cliente.email);
  if (!email) throw new Error('sem_email');
  const now = new Date().toISOString();
  const token = randomToken();

  const users = await listUtilizadores();
  const existing = users.find((u) => normEmail(u.email) === email);
  let user;
  if (existing) {
    await updateUtilizador(existing.id, {
      conviteToken: token,
      estado: 'convidado',
      clienteId: cliente.id,
      nome: cliente.nome || existing.nome || email,
    });
    user = { ...existing, conviteToken: token, estado: 'convidado', clienteId: cliente.id };
  } else {
    user = await createUtilizador({
      email,
      nome: cliente.nome || email,
      clienteId: cliente.id,
      role: PORTAL_ROLE,
      estado: 'convidado',
      passwordHash: '',
      conviteToken: token,
      criadoEm: now,
    });
  }

  const acessos = await listShared('portal_acessos');
  const acesso = acessos.find((a) => a.clienteId === cliente.id);
  if (acesso) {
    await updateShared('portal_acessos', acesso.id, { email, estado: 'convidado' });
  } else {
    await createShared('portal_acessos', {
      clienteId: cliente.id,
      email,
      estado: 'convidado',
      criadoEm: now,
    });
  }

  return { user, token };
}

/** Constrói o link de "definir palavra-passe" (token na query). Aberto pelo
 *  cliente, uma vez, para semear a primeira palavra-passe. O app é servido em
 *  /apps/<slug>/ ; a rota do cliente é /cliente/definir. */
export function definirLink(token) {
  if (typeof window === 'undefined' || !window.location) {
    return `/cliente/definir?token=${encodeURIComponent(token)}`;
  }
  const m = window.location.pathname.match(/^(\/apps\/[^/]+)/);
  const root = m ? m[1] : '';
  return `${window.location.origin}${root}/cliente/definir?token=${encodeURIComponent(token)}`;
}

/** Estado do convite -> troca a palavra-passe (hash do lado do cliente) e marca
 *  o utilizador + o acesso partilhado como 'ativo'. */
export async function definirPalavraPasse(token, password) {
  const t = String(token || '');
  if (!t) throw new Error('convite_invalido');
  const users = await listUtilizadores();
  const user = users.find((u) => u.conviteToken && u.conviteToken === t && u.estado === 'convidado');
  if (!user) throw new Error('convite_invalido');
  const passwordHash = await hashPassword(password);
  await updateUtilizador(user.id, { passwordHash, estado: 'ativo', conviteToken: '' });
  const acessos = await listShared('portal_acessos');
  const acesso = acessos.find((a) => a.clienteId === user.clienteId);
  if (acesso) await updateShared('portal_acessos', acesso.id, { estado: 'ativo' });
  return user;
}

/** Suspender / reactivar um acesso (escritório). Mantém a palavra-passe; a face
 *  do cliente é que recusa a sessão quando o estado é 'suspenso'. */
export async function definirEstadoAcesso(clienteId, estado) {
  const users = await listUtilizadores();
  const user = users.find((u) => u.clienteId === clienteId);
  if (user) await updateUtilizador(user.id, { estado });
  const acessos = await listShared('portal_acessos');
  const acesso = acessos.find((a) => a.clienteId === clienteId);
  if (acesso) await updateShared('portal_acessos', acesso.id, { estado });
}

/* ---------------------------------------------------------------------------
 * Partilhas explícitas (escritório). Cada linha `portal_partilhas` liga um
 * cliente a UM item (documento | evento | estado de processo). refId é o id do
 * item; processoId é sempre preenchido (para o estado é o próprio processo).
 * ------------------------------------------------------------------------- */

export async function partilhar({ clienteId, tipo, refId, processoId, partilhadoPor }) {
  return createShared('portal_partilhas', {
    clienteId,
    tipo,
    refId,
    processoId: processoId || null,
    partilhadoEm: new Date().toISOString(),
    partilhadoPor: partilhadoPor || 'Escritório',
  });
}

export async function retirar(partilhaId) {
  return deleteShared('portal_partilhas', partilhaId);
}

/*
 * Resolve o que UM cliente vê, a partir SÓ das suas linhas `portal_partilhas`.
 * Devolve os processos (estado), documentos e eventos partilhados, o conjunto de
 * processos a que pode anexar uploads, e `empty` quando nada foi partilhado.
 */
export function resolveVisibility(clienteId, partilhas, processos, documentos, eventos) {
  const mine = (partilhas || []).filter((p) => p.clienteId === clienteId);
  const procById = new Map((processos || []).map((p) => [p.id, p]));
  const docById = new Map((documentos || []).map((d) => [d.id, d]));
  const evById = new Map((eventos || []).map((e) => [e.id, e]));

  const estados = [];
  const docs = [];
  const evs = [];
  const procIds = new Set();

  for (const p of mine) {
    if (p.tipo === 'estado') {
      const proc = procById.get(p.refId || p.processoId);
      if (proc) {
        estados.push({ partilha: p, processo: proc });
        procIds.add(proc.id);
      }
    } else if (p.tipo === 'documento') {
      const doc = docById.get(p.refId);
      if (doc) {
        docs.push({ partilha: p, documento: doc });
        if (doc.processoId) procIds.add(doc.processoId);
      }
    } else if (p.tipo === 'evento') {
      const ev = evById.get(p.refId);
      if (ev) {
        evs.push({ partilha: p, evento: ev });
        if (ev.processoId) procIds.add(ev.processoId);
      }
    }
  }

  const uploadProcessos = [...procIds].map((id) => procById.get(id)).filter(Boolean);
  return {
    estados,
    docs,
    evs,
    uploadProcessos,
    empty: estados.length === 0 && docs.length === 0 && evs.length === 0,
  };
}

/* ---------------------------------------------------------------------------
 * Auditoria - cada acesso/consulta/upload do cliente escreve um evento na
 * espinha (tipo 'portal_acesso'), visível na cronologia do processo quando tem
 * processoId. Nunca fatal.
 * ------------------------------------------------------------------------- */

export async function writeAudit({ clienteId, processoId, titulo, descricao }) {
  const row = { tipo: 'portal_acesso', data: new Date().toISOString(), titulo };
  if (descricao) row.descricao = descricao;
  if (clienteId) row.clienteId = clienteId;
  if (processoId) row.processoId = processoId;
  try {
    return await createShared('eventos', row);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Mensagens do portal - comunicações de canal 'portal'. O cliente envia
 * (direction 'in' -> aparece no Núcleo); o escritório pode responder (direction
 * 'out'). A face do cliente mostra SÓ as suas mensagens de canal 'portal'.
 * ------------------------------------------------------------------------- */

export async function enviarMensagemCliente(clienteId, body) {
  return createShared('comunicacoes', {
    canal: 'portal',
    direction: 'in',
    clienteId,
    body,
    receivedAt: new Date().toISOString(),
    status: 'associada',
  });
}

export function mensagensDoCliente(comunicacoes, clienteId) {
  return (comunicacoes || [])
    .filter((c) => c.canal === 'portal' && c.clienteId === clienteId)
    .sort((a, b) => new Date(a.receivedAt || a.createdAt || 0) - new Date(b.receivedAt || b.createdAt || 0));
}
