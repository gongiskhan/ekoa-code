/*
 * Cliente do serviço de assinatura (legal-assinatura) - CANÓNICO, sincronizado
 * por scripts/sync-legal-shared.mjs. Editar AQUI, nunca as cópias nos scaffolds.
 *
 * FRONTEIRA DE SERVIÇO (P2-001): legal-assinatura é dono da assinatura
 * (envelopes, orquestração, arquivo probatório). Os consumidores (formulários,
 * portal, modelos, peças) criam envelopes por ESTE cliente - nunca chamam o
 * adaptador/rotas de assinatura da plataforma diretamente, nem duplicam a
 * máquina de estados. Este cliente é DELIBERADAMENTE livre do motor
 * (`legal-engines/assinatura.mjs`, presente só no scaffold de legal-assinatura):
 * escreve uma linha `envelopes` mínima e bem-formada, que a app normaliza na
 * leitura (motor `normalizarEnvelope`). A app é que corre a máquina de estados.
 *
 * API:
 *   criarEnvelope({ titulo?, documentoId?|ficheiro?|documentos?, signatarios,
 *                   metodo?, processoId? })
 *      -> Promise<{ id, href }>   (href aponta para /envelopes/<id> em legal-assinatura)
 *   estadoEnvelope(id)            -> Promise<estado|null>
 *   onEnvelopeConcluido(id, opts) -> function stop()   (sondagem até estado terminal)
 */

import { createShared, getShared, appHref } from './shared.js';

const APP_ID = 'legal-assinatura';

/* Métodos aceites (espelham providers.js na app; mantidos aqui sem importar o motor). */
const METODOS = ['cmd-orquestrado', 'cc-middleware', 'adobe', 'simulado', 'cmd-nativo', 'digitalsign', 'multicert'];
const ESTADOS_TERMINAIS = ['concluido', 'recusado', 'anulado'];

/* Qual o app consumidor a criar o envelope (proveniência da origem). */
function origemAtual() {
  return (typeof window !== 'undefined' && window.__EKOA_APP_ID) || null;
}

/* Constrói a lista de documentos do envelope a partir das várias formas de entrada. */
async function resolverDocumentos({ documentoId, ficheiro, documentos }) {
  const docs = [];
  if (Array.isArray(documentos)) {
    for (const d of documentos) {
      if (d && d.nome) {
        const doc = { nome: String(d.nome) };
        if (d.hash) doc.hash = String(d.hash);
        if (d.docId) doc.docId = String(d.docId);
        if (d.fileId) doc.fileId = String(d.fileId);
        if (d.url) doc.url = String(d.url);
        if (d.mime) doc.mime = String(d.mime);
        docs.push(doc);
      }
    }
  }
  if (ficheiro && (ficheiro.nome || ficheiro.fileId)) {
    const doc = { nome: String(ficheiro.nome || 'Documento') };
    if (ficheiro.fileId) doc.fileId = String(ficheiro.fileId);
    if (ficheiro.url) doc.url = String(ficheiro.url);
    if (ficheiro.mime) doc.mime = String(ficheiro.mime);
    if (ficheiro.hash) doc.hash = String(ficheiro.hash);
    docs.push(doc);
  }
  if (documentoId) {
    // Referência a uma linha `documentos` da espinha - lê o nome e o ficheiro.
    let row = null;
    try { row = await getShared('documentos', documentoId); } catch { row = null; }
    const doc = { nome: String((row && row.nome) || 'Documento'), docId: String(documentoId) };
    if (row && row.ficheiro) {
      if (row.ficheiro.fileId) doc.fileId = String(row.ficheiro.fileId);
      if (row.ficheiro.url) doc.url = String(row.ficheiro.url);
      if (row.ficheiro.mime) doc.mime = String(row.ficheiro.mime);
    }
    docs.push(doc);
  }
  return docs;
}

/**
 * Cria um envelope de assinatura na espinha partilhada (`envelopes`) e devolve o
 * seu id e uma ligação profunda para o abrir em legal-assinatura. O envelope
 * nasce em `rascunho`; a app conduz a máquina de estados (marcar pronto, iniciar
 * assinatura, assinar, arquivar).
 */
export async function criarEnvelope(input = {}) {
  const { titulo, documentoId, ficheiro, documentos, signatarios, metodo, processoId } = input;

  const docs = await resolverDocumentos({ documentoId, ficheiro, documentos });
  const metodoPadrao = METODOS.includes(metodo) ? metodo : 'cmd-orquestrado';

  const tituloFinal = String(titulo || (docs[0] && docs[0].nome) || 'Envelope de assinatura').trim();

  const sigs = (Array.isArray(signatarios) ? signatarios : []).map((s, i) => {
    const row = {
      nome: String((s && s.nome) || '').trim(),
      papel: String((s && s.papel) || 'signatário').trim(),
      metodo: METODOS.includes(s && s.metodo) ? s.metodo : metodoPadrao,
      ordem: Number.isInteger(s && s.ordem) && s.ordem >= 1 ? s.ordem : i + 1,
      estado: 'pendente',
    };
    if (s && s.email) row.email = String(s.email).trim();
    return row;
  });

  const quando = new Date().toISOString();
  const row = await createShared('envelopes', {
    titulo: tituloFinal,
    estado: 'rascunho',
    metodoPadrao,
    processoId: processoId || undefined,
    origem: origemAtual() || undefined,
    documentos: docs,
    signatarios: sigs,
    trilho: [{ acao: 'criado', quando, detalhe: `Envelope criado a partir de ${origemAtual() || 'aplicação'}.` }],
  });

  if (!row || !row.id) {
    throw new Error('Não foi possível criar o envelope de assinatura.');
  }
  return { id: row.id, href: appHref(APP_ID, `envelopes/${row.id}`) };
}

/** Devolve o estado atual de um envelope, ou null se não existir/indisponível. */
export async function estadoEnvelope(id) {
  if (!id) return null;
  try {
    const row = await getShared('envelopes', id);
    return row ? row.estado : null;
  } catch {
    return null;
  }
}

/**
 * Sonda um envelope até este atingir um estado TERMINAL (concluido / recusado /
 * anulado). Chama `onConcluido(row)` quando concluído e `onTerminal(estado, row)`
 * em qualquer estado terminal (inclui concluído). Devolve uma função para
 * cancelar a sondagem. Melhor-esforço: nunca lança.
 */
export function onEnvelopeConcluido(id, opts = {}) {
  const { onConcluido, onTerminal, intervalMs = 4000, timeoutMs = 0 } = opts;
  let parado = false;
  let timer = null;
  const inicio = Date.now();

  const stop = () => {
    parado = true;
    if (timer) { clearTimeout(timer); timer = null; }
  };

  async function tick() {
    if (parado) return;
    let row = null;
    try { row = await getShared('envelopes', id); } catch { row = null; }
    const estado = row ? row.estado : null;
    if (estado && ESTADOS_TERMINAIS.includes(estado)) {
      if (estado === 'concluido' && typeof onConcluido === 'function') { try { onConcluido(row); } catch { /* não fatal */ } }
      if (typeof onTerminal === 'function') { try { onTerminal(estado, row); } catch { /* não fatal */ } }
      stop();
      return;
    }
    if (timeoutMs > 0 && Date.now() - inicio >= timeoutMs) { stop(); return; }
    if (!parado) timer = setTimeout(tick, intervalMs);
  }

  timer = setTimeout(tick, intervalMs);
  return stop;
}
