/*
 * Camada de acesso a dados da app Cobranças - a ÚNICA porta para o exterior.
 *
 * Três superfícies, todas via window.__ekoa (injetado pela plataforma):
 *  - POR-APP (window.__ekoa.list/get/create/update/delete): as coleções da
 *    própria app (dividas, perfis, pagamentos, ...).
 *  - PARTILHADA (window.__ekoa.shared.*): a espinha jurídica da conta -
 *    `clientes` (a base comum de clientes do espaço de trabalho, que a app LÊ
 *    e nunca duplica) e `documentos`/`lancamentos` do Honorários (leitura
 *    ESTRITA - a app nunca escreve dados do Honorários).
 *  - ROTAS DE CAPACIDADE (window.__ekoa.fetch): /api/app-email/* (Integrações
 *    de email), /api/app-vision/extract (leitura de faturas e extratos).
 *
 * Sem window.__ekoa (pré-visualização isolada) degrada para listas vazias e
 * operações sem efeito, com `disponivel() === false` para a UI avisar.
 */

function api() {
  return (typeof window !== 'undefined' && window.__ekoa) || null;
}

export function disponivel() {
  return !!api();
}

/* ------------------------------- por-app -------------------------------- */

export async function listar(colecao) {
  const a = api();
  if (!a) return [];
  const r = await a.list(colecao);
  return Array.isArray(r) ? r : [];
}

export async function obter(colecao, id) {
  const a = api();
  if (!a) return null;
  return a.get(colecao, id);
}

export async function criar(colecao, dados) {
  const a = api();
  if (!a) throw new Error('Plataforma indisponível.');
  return a.create(colecao, dados);
}

export async function atualizar(colecao, id, patch) {
  const a = api();
  if (!a) throw new Error('Plataforma indisponível.');
  return a.update(colecao, id, patch);
}

export async function apagar(colecao, id) {
  const a = api();
  if (!a) throw new Error('Plataforma indisponível.');
  return a.delete(colecao, id);
}

/* ------------------------------ partilhada ------------------------------ */

export async function listarPartilhada(colecao) {
  const a = api();
  if (!a || !a.shared || typeof a.shared.list !== 'function') return [];
  try {
    const r = await a.shared.list(colecao);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

/**
 * Escreve na coleção PARTILHADA. Usado APENAS para criar clientes na base
 * comum do espaço de trabalho (a app nunca duplica a base de clientes; os
 * dados do Honorários continuam estritamente de leitura).
 */
export async function criarPartilhada(colecao, dados) {
  const a = api();
  if (!a || !a.shared || typeof a.shared.create !== 'function') {
    throw new Error('Base partilhada indisponível.');
  }
  return a.shared.create(colecao, dados);
}

/* --------------------------- linha do tempo ----------------------------- */

/**
 * Registo IMUTÁVEL na linha do tempo (auditoria; pode acabar em tribunal -
 * brief). Só CREATE - nenhuma parte da app edita ou apaga linhas desta
 * coleção. Nunca lança: um falhanço de registo não trava o fluxo de origem,
 * mas fica na consola.
 */
export async function registarEvento({ clienteId, dividaId = null, prestacaoId = null, tipo, titulo, detalhe = '', conteudo = null, meta = null }) {
  try {
    return await criar('linha_tempo', {
      clienteId,
      dividaId,
      prestacaoId,
      tipo,
      titulo,
      detalhe,
      conteudo,
      meta,
      data: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cobrancas] falha ao registar evento na linha do tempo:', err);
    return null;
  }
}

/* ------------------------------ definições ------------------------------ */

export const DEFINICOES_OMISSAO = {
  chave: 'singleton',
  idioma: 'pt',
  emailIntegrationKey: null,
  emailActionName: null,
  alocacao: 'antiga-primeiro',
  prazoPagamentoHonorarios: 30,
  iban: '',
  scoreLimiares: { sugerirSuave: 70, sugerirAssertivo: 40 },
};

/** Lê (ou cria na primeira utilização) a linha única de definições. */
export async function carregarDefinicoes() {
  const linhas = await listar('definicoes');
  const atual = linhas.find((l) => l.chave === 'singleton') || linhas[0];
  if (atual) return { ...DEFINICOES_OMISSAO, ...atual };
  if (!disponivel()) return { ...DEFINICOES_OMISSAO, id: null };
  const criada = await criar('definicoes', DEFINICOES_OMISSAO);
  return { ...DEFINICOES_OMISSAO, ...criada };
}

export async function gravarDefinicoes(id, patch) {
  return atualizar('definicoes', id, patch);
}

/* --------------------------- rotas de capacidade ------------------------ */

async function fetchJson(path, options) {
  const a = api();
  if (!a || typeof a.fetch !== 'function') {
    return { ok: false, status: 0, body: { error: 'Plataforma indisponível.' } };
  }
  try {
    const res = await a.fetch(path, options);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

/** Integrações com capacidade de envio de email (classificação da plataforma). */
export async function listarIntegracoesEmail() {
  const r = await fetchJson('/api/app-email/integrations');
  if (!r.ok) return { ok: false, erro: r.body?.error || 'Falha ao listar integrações.', integracoes: [] };
  return { ok: true, integracoes: r.body?.data || [] };
}

/** Envia UM email pela integração selecionada. Nunca lança. */
export async function enviarEmail({ integrationKey, actionName, to, subject, body }) {
  const r = await fetchJson('/api/app-email/send', {
    method: 'POST',
    body: JSON.stringify({ integrationKey, actionName, to, subject, body }),
  });
  if (!r.ok) {
    return {
      success: false,
      error: r.body?.error || `Falha no envio (HTTP ${r.status}).`,
      code: r.body?.code || 'http_error',
    };
  }
  return { success: true };
}

/** Cria um RASCUNHO na caixa de correio do fornecedor (Outlook/Gmail). */
export async function criarRascunhoEmail({ integrationKey, to, subject, body }) {
  const r = await fetchJson('/api/app-email/draft', {
    method: 'POST',
    body: JSON.stringify({ integrationKey, to, subject, body }),
  });
  if (!r.ok) {
    return { success: false, error: r.body?.error || `Falha ao criar o rascunho (HTTP ${r.status}).`, code: r.body?.code };
  }
  return { success: true, draftId: r.body?.draftId, webLink: r.body?.webLink };
}

/** Envia um rascunho EXISTENTE do fornecedor (com as edições feitas lá). */
export async function enviarRascunhoEmail({ integrationKey, draftId }) {
  const r = await fetchJson('/api/app-email/draft/send', {
    method: 'POST',
    body: JSON.stringify({ integrationKey, draftId }),
  });
  if (!r.ok) {
    return { success: false, error: r.body?.error || `Falha no envio do rascunho (HTTP ${r.status}).`, code: r.body?.code };
  }
  return { success: true };
}

/** Endereço da própria caixa de correio do espaço de trabalho. */
export async function obterInboxWorkspace(integrationKey) {
  const r = await fetchJson(`/api/app-email/inbox?integrationKey=${encodeURIComponent(integrationKey)}`);
  if (!r.ok) return { success: false, error: r.body?.error };
  return { success: true, address: r.body?.address };
}

/** Pergunta ao assistente integrado ({reply} do endpoint /api/app-assistant). */
export async function perguntarAssistente({ message, history, context }) {
  const r = await fetchJson('/api/app-assistant', {
    method: 'POST',
    body: JSON.stringify({ message, history, context }),
  });
  if (!r.ok) {
    return { success: false, error: r.body?.error || `O assistente está indisponível (HTTP ${r.status}).` };
  }
  return { success: true, reply: r.body?.reply || '' };
}

/** Extração de fatura (imagem ou PDF) via visão do Cortex. */
export async function extrairDocumento({ kind, imageBase64, mediaType, pdfBase64, language }) {
  const r = await fetchJson('/api/app-vision/extract', {
    method: 'POST',
    body: JSON.stringify({ kind, imageBase64, mediaType, pdfBase64, language }),
  });
  if (!r.ok) {
    return {
      success: false,
      error: r.body?.error || `Falha na extração (HTTP ${r.status}).`,
      code: r.body?.code || 'http_error',
    };
  }
  return { success: true, data: r.body?.data };
}

/** Exporta a página atual como PDF (renderização servidor-side da plataforma). */
export async function exportarPdf(opts = {}) {
  const a = api();
  if (!a || typeof a.exportPdf !== 'function') {
    return { ok: false, erro: 'Exportação PDF indisponível nesta plataforma.' };
  }
  try {
    await a.exportPdf(opts);
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------- ficheiros ------------------------------ */

/** Converte um File/Blob para base64 (sem prefixo data:). */
export function ficheiroParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error('Falha a ler o ficheiro.'));
    reader.readAsDataURL(file);
  });
}

/** Exportação CSV no browser (dados da app -> ficheiro descarregado). */
export function descarregarCsv(nome, cabecalho, linhas) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const conteudo = [cabecalho, ...linhas].map((l) => l.map(esc).join(';')).join('\r\n');
  const blob = new Blob([`﻿${conteudo}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
