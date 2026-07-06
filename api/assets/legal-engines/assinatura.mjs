/**
 * Motor determinístico de ENVELOPES de assinatura (legal-assinatura). Zero
 * retrieval, mostra o seu trabalho. É a fonte de verdade da máquina de estados
 * de um envelope e do certificado de auditoria probatório.
 *
 * PURO e ISOMÓRFICO: opera sobre valores simples (objectos-envelope), não toca
 * na plataforma, no browser nem em rede. A persistência (espinha partilhada
 * `envelopes`/`assinaturas`), o cálculo de hashes SHA-256 dos documentos e a
 * emissão de eventos de proveniência (`registarEvento`) vivem na app - o motor
 * recebe os hashes JÁ CALCULADOS e devolve novos valores-envelope. É o mesmo
 * padrão dos restantes motores da suite (honorarios.mjs, prazo.mjs): entradas
 * validadas LOUDLY, aritmética/estado explícitos, `showWork`.
 *
 * Este ficheiro é CANÓNICO em ekoa-data/legal-engines/ e é copiado (vendored)
 * APENAS para o scaffold de legal-assinatura em engine/assinatura.mjs. Nenhum
 * outro app importa este motor (fronteira de serviço: os consumidores criam
 * envelopes pelo cliente `assinatura-cliente.js`).
 *
 * MÁQUINA DE ESTADOS
 *   rascunho -> pronto -> em_assinatura -> concluido | recusado | anulado
 *   rascunho -> anulado ;  pronto -> rascunho | anulado ;  pronto -> em_assinatura
 *   concluido | recusado | anulado são TERMINAIS (sem saída).
 * Transições inválidas LANÇAM (nunca degradam em silêncio).
 *
 * CERTIFICADO DE AUDITORIA
 *   Registo interno probatório determinístico: id do envelope, hashes SHA-256 dos
 *   documentos (dados como entrada), signatários com método/carimbo/proveniência,
 *   e o trilho de proveniência. NÃO é uma atestação de validade jurídica - a
 *   validação qualificada é feita no validador oficial (ver a app, Verificar).
 */

/** Estados possíveis de um envelope, pela ordem do ciclo de vida. */
export const ESTADOS = ['rascunho', 'pronto', 'em_assinatura', 'concluido', 'recusado', 'anulado'];

/** Estados terminais (sem transições de saída). */
export const ESTADOS_TERMINAIS = ['concluido', 'recusado', 'anulado'];

/**
 * Métodos de assinatura reconhecidos por signatário. O registo de fornecedores
 * (metadados de UI) vive em providers.js na app; aqui só validamos a chave.
 *  - cmd-orquestrado : Chave Móvel Digital, fluxo orquestrado à volta da app
 *                      oficial Autenticação.Gov (assinatura qualificada; método
 *                      por omissão do advogado). Exige atestação de inscrição OA.
 *  - cc-middleware   : Cartão de Cidadão via middleware local (qualificada).
 *  - adobe           : Adobe Acrobat Sign (avançada, NÃO qualificada).
 *  - simulado        : assina instantaneamente - apenas demonstrações e testes.
 *  - cmd-nativo      : CMD via API oficial (stub - disponível após registo AMA).
 *  - digitalsign / multicert : fornecedores qualificados (stubs).
 */
export const METODOS = [
  'cmd-orquestrado',
  'cc-middleware',
  'adobe',
  'simulado',
  'cmd-nativo',
  'digitalsign',
  'multicert',
];

/** Métodos orquestrados/qualificados que exigem atestação de inscrição na OA em vigor. */
export const METODOS_EXIGEM_ATESTACAO_OA = ['cmd-orquestrado', 'cc-middleware'];

/** Estados possíveis de cada signatário. */
export const ESTADOS_SIGNATARIO = ['pendente', 'assinado', 'recusado'];

/** Grafo de transições válidas do envelope. */
const TRANSICOES = {
  rascunho: ['pronto', 'anulado'],
  pronto: ['em_assinatura', 'rascunho', 'anulado'],
  em_assinatura: ['concluido', 'recusado', 'anulado'],
  concluido: [],
  recusado: [],
  anulado: [],
};

/* --------------------------------------------------------------------------
 * Utilitários internos.
 * ------------------------------------------------------------------------ */

/** Clone profundo de dados simples (envelopes são JSON-seguros). */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} é obrigatório (texto não vazio): ${JSON.stringify(value)}`);
  }
  return value.trim();
}

function assertQuando(value, label = 'quando') {
  // Carimbo ISO; determinístico porque o chamador o fornece. Sem valor, usa
  // agora (só nos usos não-testados; os testes passam sempre um carimbo).
  if (value == null) return new Date().toISOString();
  const s = String(value);
  if (Number.isNaN(new Date(s).getTime())) {
    throw new Error(`${label} inválido (carimbo de data/hora): ${JSON.stringify(value)}`);
  }
  return s;
}

/** Normaliza um signatário de entrada, validando LOUDLY os campos obrigatórios. */
function normalizarSignatario(sig, index) {
  if (!sig || typeof sig !== 'object') {
    throw new Error(`signatário #${index + 1} inválido (tem de ser um objecto).`);
  }
  const nome = assertString(sig.nome, `nome do signatário #${index + 1}`);
  const papel = assertString(sig.papel, `papel do signatário #${index + 1}`);
  const metodo = assertString(sig.metodo, `método do signatário #${index + 1}`);
  if (!METODOS.includes(metodo)) {
    throw new Error(`método do signatário #${index + 1} desconhecido: ${metodo} (aceites: ${METODOS.join(', ')}).`);
  }
  const ordem = sig.ordem == null ? index + 1 : Number(sig.ordem);
  if (!Number.isInteger(ordem) || ordem < 1) {
    throw new Error(`ordem do signatário #${index + 1} inválida (inteiro >= 1): ${JSON.stringify(sig.ordem)}`);
  }
  const estado = sig.estado == null ? 'pendente' : String(sig.estado);
  if (!ESTADOS_SIGNATARIO.includes(estado)) {
    throw new Error(`estado do signatário #${index + 1} inválido: ${estado}.`);
  }
  const out = { nome, papel, metodo, ordem, estado };
  if (sig.email != null && String(sig.email).trim() !== '') out.email = String(sig.email).trim();
  if (sig.assinadoEm != null) out.assinadoEm = String(sig.assinadoEm);
  if (sig.recusadoEm != null) out.recusadoEm = String(sig.recusadoEm);
  if (sig.proveniencia != null) out.proveniencia = String(sig.proveniencia);
  if (sig.motivo != null) out.motivo = String(sig.motivo);
  if (sig.id != null) out.id = String(sig.id);
  return out;
}

/** Normaliza um documento de entrada. `hash` (SHA-256 hex) é dado, não calculado. */
function normalizarDocumento(doc, index) {
  if (!doc || typeof doc !== 'object') {
    throw new Error(`documento #${index + 1} inválido (tem de ser um objecto).`);
  }
  const nome = assertString(doc.nome, `nome do documento #${index + 1}`);
  const out = { nome };
  if (doc.hash != null && String(doc.hash).trim() !== '') {
    const hash = String(doc.hash).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`hash do documento #${index + 1} não é um SHA-256 hex (64 hex): ${doc.hash}`);
    }
    out.hash = hash;
  }
  if (doc.docId != null) out.docId = String(doc.docId);
  if (doc.mime != null) out.mime = String(doc.mime);
  if (doc.fileId != null) out.fileId = String(doc.fileId);
  if (doc.url != null) out.url = String(doc.url);
  return out;
}

/** Acrescenta uma entrada ao trilho de proveniência (não muta o original). */
function comTrilho(env, entrada) {
  const trilho = Array.isArray(env.trilho) ? env.trilho.slice() : [];
  trilho.push(entrada);
  return { ...env, trilho };
}

/* --------------------------------------------------------------------------
 * Transições da máquina de estados.
 * ------------------------------------------------------------------------ */

/** A transição `de -> para` é válida? (não considera guardas de conteúdo). */
export function podeTransitar(de, para) {
  return Array.isArray(TRANSICOES[de]) && TRANSICOES[de].includes(para);
}

/** Valida a transição LOUDLY; lança se inválida. */
export function assertTransicao(de, para) {
  if (!ESTADOS.includes(para)) {
    throw new Error(`Estado-alvo desconhecido: ${JSON.stringify(para)}.`);
  }
  if (!podeTransitar(de, para)) {
    throw new Error(`Transição inválida: ${de} -> ${para}.`);
  }
}

/**
 * Cria um envelope no estado `rascunho`. Puro: valida e devolve o valor, NÃO
 * persiste (a app faz `createShared('envelopes', ...)` com o resultado).
 *
 * @param {{ titulo:string, documentos?:Array, signatarios?:Array,
 *   processoId?:string, metodoPadrao?:string, criadoEm?:string, id?:string }} input
 */
export function criarEnvelope(input = {}) {
  const titulo = assertString(input.titulo, 'título do envelope');
  const criadoEm = assertQuando(input.criadoEm, 'criadoEm');

  const documentos = (Array.isArray(input.documentos) ? input.documentos : []).map(normalizarDocumento);

  const signatariosRaw = (Array.isArray(input.signatarios) ? input.signatarios : []).map(normalizarSignatario);
  // Ordena por `ordem` de forma estável (assinatura sequencial).
  const signatarios = signatariosRaw
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.ordem - b.s.ordem) || (a.i - b.i))
    .map(({ s }) => s);

  let metodoPadrao;
  if (input.metodoPadrao != null) {
    metodoPadrao = assertString(input.metodoPadrao, 'metodoPadrao');
    if (!METODOS.includes(metodoPadrao)) {
      throw new Error(`metodoPadrao desconhecido: ${metodoPadrao}.`);
    }
  } else {
    // Por omissão, o método orquestrado da CMD (fluxo do advogado).
    metodoPadrao = 'cmd-orquestrado';
  }

  const env = {
    titulo,
    estado: 'rascunho',
    metodoPadrao,
    documentos,
    signatarios,
    trilho: [{ acao: 'criado', quando: criadoEm, detalhe: `Envelope criado com ${documentos.length} documento(s) e ${signatarios.length} signatário(s).` }],
    criadoEm,
    atualizadoEm: criadoEm,
  };
  if (input.processoId != null) env.processoId = String(input.processoId);
  if (input.id != null) env.id = String(input.id);
  return env;
}

/**
 * Normaliza um envelope JÁ EXISTENTE (linha da espinha), preservando o `estado`,
 * `id`, `criadoEm` e o trilho. É a porta de entrada do app quando lê uma linha
 * `envelopes` que pode ter sido criada por um consumidor (formulários, portal,
 * modelos, peças) pelo cliente `assinatura-cliente.js` - que não importa o motor
 * e escreve uma forma mínima. Validação LOUDLY dos campos obrigatórios.
 */
export function normalizarEnvelope(row = {}) {
  if (!row || typeof row !== 'object') throw new Error('envelope inválido.');
  const titulo = assertString(row.titulo, 'título do envelope');
  const estado = row.estado == null ? 'rascunho' : String(row.estado);
  if (!ESTADOS.includes(estado)) throw new Error(`estado do envelope inválido: ${estado}.`);

  const documentos = (Array.isArray(row.documentos) ? row.documentos : []).map(normalizarDocumento);
  const signatarios = (Array.isArray(row.signatarios) ? row.signatarios : [])
    .map(normalizarSignatario)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.ordem - b.s.ordem) || (a.i - b.i))
    .map(({ s }) => s);

  let metodoPadrao = row.metodoPadrao == null ? 'cmd-orquestrado' : String(row.metodoPadrao);
  if (!METODOS.includes(metodoPadrao)) metodoPadrao = 'cmd-orquestrado';

  const criadoEm = row.criadoEm != null ? String(row.criadoEm) : assertQuando(null);
  const trilho = Array.isArray(row.trilho) && row.trilho.length > 0
    ? row.trilho.map((t) => ({ ...t }))
    : [{ acao: 'criado', quando: criadoEm, detalhe: `Envelope com ${documentos.length} documento(s) e ${signatarios.length} signatário(s).` }];

  const env = {
    titulo,
    estado,
    metodoPadrao,
    documentos,
    signatarios,
    trilho,
    criadoEm,
    atualizadoEm: row.atualizadoEm != null ? String(row.atualizadoEm) : criadoEm,
  };
  if (row.id != null) env.id = String(row.id);
  if (row.processoId != null) env.processoId = String(row.processoId);
  if (row.origem != null) env.origem = String(row.origem);
  return env;
}

/**
 * Transição de estado genérica e validada. Aplica as GUARDAS de conteúdo:
 *  - -> pronto        : >= 1 documento E >= 1 signatário.
 *  - -> concluido     : todos os signatários `assinado`.
 * Devolve um NOVO envelope; nunca muta o recebido.
 *
 * @param {object} envelope
 * @param {string} novoEstado
 * @param {{ quando?:string, ator?:string, motivo?:string, detalhe?:string }} [opts]
 */
export function transitar(envelope, novoEstado, opts = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('envelope inválido.');
  const de = envelope.estado;
  assertTransicao(de, novoEstado);
  const quando = assertQuando(opts.quando, 'quando');

  if (novoEstado === 'pronto') {
    if (!Array.isArray(envelope.documentos) || envelope.documentos.length === 0) {
      throw new Error('Não é possível marcar como pronto: o envelope não tem documentos.');
    }
    if (!Array.isArray(envelope.signatarios) || envelope.signatarios.length === 0) {
      throw new Error('Não é possível marcar como pronto: o envelope não tem signatários.');
    }
  }
  if (novoEstado === 'concluido') {
    const porAssinar = (envelope.signatarios || []).filter((s) => s.estado !== 'assinado');
    if (porAssinar.length > 0) {
      throw new Error(`Não é possível concluir: ${porAssinar.length} signatário(s) por assinar.`);
    }
  }

  const entrada = {
    acao: `estado:${novoEstado}`,
    de,
    para: novoEstado,
    quando,
  };
  if (opts.ator != null) entrada.ator = String(opts.ator);
  if (opts.motivo != null) entrada.motivo = String(opts.motivo);
  if (opts.detalhe != null) entrada.detalhe = String(opts.detalhe);

  const out = comTrilho(envelope, entrada);
  out.estado = novoEstado;
  out.atualizadoEm = quando;
  return clone(out);
}

/** Localiza um signatário por `id`, `index` ou `email` (nessa ordem de precedência). */
function localizarSignatario(envelope, alvo) {
  const lista = Array.isArray(envelope.signatarios) ? envelope.signatarios : [];
  if (alvo.signatarioId != null) {
    const i = lista.findIndex((s) => s.id === String(alvo.signatarioId));
    if (i < 0) throw new Error(`Signatário com id ${alvo.signatarioId} não existe no envelope.`);
    return i;
  }
  if (alvo.signatarioIndex != null) {
    const i = Number(alvo.signatarioIndex);
    if (!Number.isInteger(i) || i < 0 || i >= lista.length) {
      throw new Error(`signatarioIndex fora do intervalo: ${alvo.signatarioIndex}.`);
    }
    return i;
  }
  if (alvo.email != null) {
    const email = String(alvo.email).trim().toLowerCase();
    const i = lista.findIndex((s) => (s.email || '').toLowerCase() === email);
    if (i < 0) throw new Error(`Signatário com email ${alvo.email} não existe no envelope.`);
    return i;
  }
  throw new Error('É necessário identificar o signatário (signatarioId, signatarioIndex ou email).');
}

/**
 * Próximo signatário a assinar, respeitando a ORDEM: o de menor `ordem` ainda
 * `pendente`. Devolve `{ index, signatario }` ou `null` se não houver pendentes.
 */
export function proximoSignatario(envelope) {
  const lista = Array.isArray(envelope.signatarios) ? envelope.signatarios : [];
  let escolhido = null;
  lista.forEach((s, index) => {
    if (s.estado !== 'pendente') return;
    if (escolhido == null || s.ordem < lista[escolhido].ordem) escolhido = index;
  });
  return escolhido == null ? null : { index: escolhido, signatario: lista[escolhido] };
}

/**
 * Regista a assinatura de um signatário. Aplica a ORDEM (todos os signatários de
 * `ordem` inferior têm de estar `assinado`) e, para métodos orquestrados/
 * qualificados (CMD, Cartão de Cidadão), EXIGE `atestacaoOA === true` - a
 * atestação de que a inscrição na Ordem dos Advogados está em vigor. Quando o
 * último signatário assina, transita automaticamente para `concluido`.
 *
 * @param {object} envelope
 * @param {{ signatarioId?:string, signatarioIndex?:number, email?:string,
 *   quando?:string, proveniencia?:string, ator?:string, atestacaoOA?:boolean }} opts
 */
export function registarAssinatura(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('envelope inválido.');
  if (envelope.estado !== 'em_assinatura') {
    throw new Error(`Só se assina um envelope em assinatura (estado actual: ${envelope.estado}).`);
  }
  const quando = assertQuando(opts.quando, 'quando');
  const idx = localizarSignatario(envelope, opts);
  const lista = envelope.signatarios.map((s) => ({ ...s }));
  const sig = lista[idx];

  if (sig.estado === 'assinado') throw new Error(`O signatário "${sig.nome}" já assinou.`);
  if (sig.estado === 'recusado') throw new Error(`O signatário "${sig.nome}" recusou; não pode assinar.`);

  // Ordem: nenhum signatário de ordem inferior pode estar por assinar.
  const anterioresPorAssinar = lista.filter((s) => s.ordem < sig.ordem && s.estado !== 'assinado');
  if (anterioresPorAssinar.length > 0) {
    throw new Error(`Assinatura fora de ordem: faltam ${anterioresPorAssinar.length} signatário(s) anterior(es) por assinar.`);
  }

  // Atestação OA para os métodos orquestrados/qualificados.
  if (METODOS_EXIGEM_ATESTACAO_OA.includes(sig.metodo) && opts.atestacaoOA !== true) {
    throw new Error('A assinatura orquestrada (CMD / Cartão de Cidadão) exige a atestação de inscrição na Ordem dos Advogados em vigor.');
  }

  const proveniencia = opts.proveniencia != null
    ? String(opts.proveniencia)
    : (sig.metodo === 'simulado' ? 'simulada' : 'manual-assistido');

  sig.estado = 'assinado';
  sig.assinadoEm = quando;
  sig.proveniencia = proveniencia;
  if (opts.atestacaoOA === true) sig.atestacaoOA = true;

  let out = { ...envelope, signatarios: lista };
  out = comTrilho(out, {
    acao: 'assinatura',
    signatario: sig.nome,
    papel: sig.papel,
    metodo: sig.metodo,
    proveniencia,
    quando,
    ...(opts.ator != null ? { ator: String(opts.ator) } : {}),
  });
  out.atualizadoEm = quando;

  // Se todos assinaram, conclui automaticamente.
  const todosAssinados = lista.every((s) => s.estado === 'assinado');
  if (todosAssinados) {
    return transitar(out, 'concluido', { quando, detalhe: 'Todos os signatários assinaram.' });
  }
  return clone(out);
}

/**
 * Regista a recusa de um signatário. Transita o envelope para `recusado`
 * (terminal). Um envelope recusado não pode ser reaberto.
 */
export function registarRecusa(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('envelope inválido.');
  if (envelope.estado !== 'em_assinatura') {
    throw new Error(`Só se recusa um envelope em assinatura (estado actual: ${envelope.estado}).`);
  }
  const quando = assertQuando(opts.quando, 'quando');
  const idx = localizarSignatario(envelope, opts);
  const lista = envelope.signatarios.map((s) => ({ ...s }));
  const sig = lista[idx];
  if (sig.estado === 'assinado') throw new Error(`O signatário "${sig.nome}" já assinou; não pode recusar.`);

  const motivo = opts.motivo != null ? String(opts.motivo) : '';
  sig.estado = 'recusado';
  sig.recusadoEm = quando;
  if (motivo) sig.motivo = motivo;

  let out = { ...envelope, signatarios: lista };
  out = comTrilho(out, {
    acao: 'recusa',
    signatario: sig.nome,
    papel: sig.papel,
    metodo: sig.metodo,
    quando,
    ...(motivo ? { motivo } : {}),
    ...(opts.ator != null ? { ator: String(opts.ator) } : {}),
  });
  out.atualizadoEm = quando;
  return transitar(out, 'recusado', { quando, motivo: motivo || undefined, detalhe: `Recusado por ${sig.nome}.` });
}

/**
 * Anula um envelope. Só é possível a partir de um estado NÃO terminal
 * (rascunho / pronto / em_assinatura); anular um envelope já concluído,
 * recusado ou anulado LANÇA.
 */
export function anular(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('envelope inválido.');
  const quando = assertQuando(opts.quando, 'quando');
  return transitar(envelope, 'anulado', {
    quando,
    motivo: opts.motivo != null ? String(opts.motivo) : undefined,
    ator: opts.ator,
    detalhe: 'Envelope anulado.',
  });
}

/* --------------------------------------------------------------------------
 * Certificado de auditoria.
 * ------------------------------------------------------------------------ */

/**
 * Gera o certificado de auditoria PROBATÓRIO do envelope - determinístico dado o
 * mesmo envelope e `emitidoEm`. Inclui: id do envelope, hashes SHA-256 dos
 * documentos, signatários (método/carimbo/proveniência) e o trilho de
 * proveniência completo. NÃO atesta validade jurídica.
 *
 * @param {object} envelope
 * @param {{ emitidoEm?:string, documentosHashes?:Record<string,string> }} [opts]
 */
export function gerarCertificado(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('envelope inválido.');
  const emitidoEm = assertQuando(opts.emitidoEm, 'emitidoEm');
  const hashesOverride = opts.documentosHashes && typeof opts.documentosHashes === 'object' ? opts.documentosHashes : null;

  const documentos = (envelope.documentos || []).map((d) => {
    const hash = hashesOverride && hashesOverride[d.nome] != null ? String(hashesOverride[d.nome]).toLowerCase() : (d.hash || null);
    return {
      nome: d.nome,
      algoritmo: hash ? 'sha-256' : null,
      hash: hash || null,
      ...(d.docId != null ? { docId: d.docId } : {}),
    };
  });

  const signatarios = (envelope.signatarios || []).map((s) => ({
    nome: s.nome,
    email: s.email || null,
    papel: s.papel,
    metodo: s.metodo,
    ordem: s.ordem,
    estado: s.estado,
    assinadoEm: s.assinadoEm || null,
    proveniencia: s.proveniencia || null,
    ...(s.atestacaoOA ? { atestacaoOA: true } : {}),
    ...(s.motivo ? { motivo: s.motivo } : {}),
  }));

  const trilhoProveniencia = (envelope.trilho || []).map((t) => ({ ...t }));

  const assinados = signatarios.filter((s) => s.estado === 'assinado').length;
  const resumo = {
    totalDocumentos: documentos.length,
    totalSignatarios: signatarios.length,
    assinados,
    documentosComHash: documentos.filter((d) => d.hash).length,
  };

  const passos = [
    `Envelope ${envelope.id || '(sem id)'} - "${envelope.titulo}" no estado ${envelope.estado}.`,
    `${documentos.length} documento(s), ${resumo.documentosComHash} com impressão digital SHA-256.`,
    `${assinados} de ${signatarios.length} signatário(s) assinaram.`,
    `Trilho de proveniência com ${trilhoProveniencia.length} evento(s).`,
    'Registo interno de auditoria - a validação jurídica qualificada é feita no validador oficial (validador.autenticacao.gov.pt).',
  ];

  return {
    versao: 1,
    tipo: 'certificado-auditoria',
    envelopeId: envelope.id || null,
    titulo: envelope.titulo,
    estado: envelope.estado,
    processoId: envelope.processoId || null,
    emitidoEm,
    documentos,
    signatarios,
    trilhoProveniencia,
    resumo,
    aviso: 'Verificação de presença de assinatura e registo de proveniência - não constitui atestação de validade jurídica.',
    showWork: { passos },
  };
}
