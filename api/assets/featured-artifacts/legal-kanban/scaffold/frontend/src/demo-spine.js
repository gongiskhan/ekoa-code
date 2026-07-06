/*
 * Espinha de demonstração "Fonseca & Associados" - CANÓNICO, sincronizado por
 * scripts/sync-legal-shared.mjs. Editar AQUI, nunca as cópias nos scaffolds.
 *
 * Um ÚNICO conjunto de dados fictícios, coerente em toda a vertical, que conta
 * a história encadeada que nenhuma demonstração isolada consegue: a fatura de
 * 4.200,00 EUR da Construções Tejo viaja de cobranças -> injunção -> cálculos
 * -> prazos; a sociedade Vinhos do Douro alimenta o RCBE; a audiência do
 * processo da obra alimenta a transcrição (o excerto da testemunha menciona
 * exactamente esta fatura).
 *
 * REGRAS (brief §3.2.4, testadas):
 *  - TODOS os registos criados aqui levam { demo: true, demoSet: 'fonseca' }.
 *  - A remoção é atómica e apaga EXCLUSIVAMENTE registos demo-marcados;
 *    registos reais nas mesmas colecções sobrevivem sempre.
 *  - O modo de demonstração NUNCA toca sistemas externos reais - as
 *    integrações usadas pelas demos são simuladas nas próprias apps.
 *  - Enquanto instalado, o Layout mostra a faixa permanente (colecção
 *    demo_estado, lida pelo Layout sincronizado).
 */
import { listShared, createShared, deleteShared, registarEvento } from './shared.js';

const MARCA = { demo: true, demoSet: 'fonseca' };

/* Todas as colecções onde a remoção procura registos demo-marcados. Mantém-se
 * um superconjunto deliberado (inclui colecções onde as DEMOS criam registos
 * como acções do utilizador: envelopes, injuncoes, calculos, ...). */
export const DEMO_COLECOES = [
  'clientes', 'processos', 'faturas', 'cobrancas', 'despesas', 'documentos',
  'prazos', 'eventos', 'tarefas', 'lancamentos', 'lembretes_enviados',
  'notificacoes', 'comunicacoes',
  'envelopes', 'assinaturas', 'calculos', 'transcricoes', 'excertos',
  'injuncoes', 'rcbe_entidades', 'rcbe_obrigacoes', 'beneficiarios_efetivos',
  'insolvencias', 'reclamacoes_creditos', 'jurimetria_referencias',
  'modelos',
  'registo_eventos', 'demo_estado',
];

function dataRel(offsetDias) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDias);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------------- */
/* Conjunto de dados                                                          */
/* ------------------------------------------------------------------------- */

const CLIENTES = [
  { nome: 'Vinhos do Douro, Lda.', nif: '509876543', tipo: 'empresa', email: 'geral@vinhosdodouro.pt', telefone: '+351 254 300 010', morada: 'Quinta do Vale Escuro, 5050-011 Peso da Régua' },
  { nome: 'TransLima - Transportes, Lda.', nif: '507654321', tipo: 'empresa', email: 'geral@translima.pt', telefone: '+351 258 700 020', morada: 'Parque Empresarial de Viana, Lote 7, 4900-281 Viana do Castelo' },
  { nome: 'Construções Tejo, S.A.', nif: '506543210', tipo: 'empresa', email: 'geral@construcoestejo.pt', telefone: '+351 212 400 030', morada: 'Avenida do Estaleiro, 88, 2830-089 Barreiro' },
  { nome: 'Beatriz Fonseca Amaral', nif: '223456780', tipo: 'particular', email: 'beatriz.amaral@exemplo.pt', telefone: '+351 918 200 040' },
];

/* Processos activos, coerentes com a história encadeada. O processo da obra
 * (Construções Tejo) é o palco da audiência transcrita; o apenso de insolvência
 * serve a reclamação de créditos. */
function processosAtivos(clienteId) {
  return [
    { numeroProcesso: '2201/26.3T8LSB', tribunal: 'Juízo Central Cível de Lisboa', comarca: 'Lisboa', area: 'Cível', estado: 'ativo', advogadoResponsavel: 'Dr. Duarte Fonseca', descricao: 'Cobrança de fornecimentos - obra do armazém (Construções Tejo).', clienteId: clienteId['TransLima - Transportes, Lda.'] },
    { numeroProcesso: '2202/26.1T8STB', tribunal: 'Juízo de Comércio de Setúbal', comarca: 'Setúbal', area: 'Comercial', estado: 'ativo', advogadoResponsavel: 'Dra. Helena Fonseca', descricao: 'Insolvência de Construções Tejo, S.A. - acompanhamento do credor.', clienteId: clienteId['TransLima - Transportes, Lda.'] },
    { numeroProcesso: '2203/26.9T8VRL', tribunal: 'Juízo Local Cível de Vila Real', comarca: 'Vila Real', area: 'Cível', estado: 'ativo', advogadoResponsavel: 'Dr. Duarte Fonseca', descricao: 'Litígio de fornecimento vitivinícola.', clienteId: clienteId['Vinhos do Douro, Lda.'] },
    { numeroProcesso: '2204/26.5T8BRG', tribunal: 'Juízo de Família e Menores de Braga', comarca: 'Braga', area: 'Família', estado: 'ativo', advogadoResponsavel: 'Dra. Helena Fonseca', descricao: 'Inventário por divórcio.', clienteId: clienteId['Beatriz Fonseca Amaral'] },
  ];
}

/* 36 processos findos com durações realistas por área - o comparador interno
 * da jurimetria precisa de uma amostra de findos com abertura/fecho. */
function processosFindos() {
  const areas = [
    ['Cível', 14, 30], ['Laboral', 8, 18], ['Comercial', 16, 34],
    ['Família', 10, 22], ['Execução', 18, 40], ['Administrativo', 20, 44],
  ];
  const rows = [];
  for (let i = 0; i < 36; i += 1) {
    const [area, minM, maxM] = areas[i % areas.length];
    const durMeses = minM + ((i * 7) % (maxM - minM + 1));
    const fechoOffset = -30 - i * 9;
    const aberturaOffset = fechoOffset - durMeses * 30;
    rows.push({
      numeroProcesso: `${1000 + i}/24.${i % 10}T8FON`,
      tribunal: 'Juízo Central Cível de Lisboa',
      comarca: ['Lisboa', 'Porto', 'Braga', 'Setúbal'][i % 4],
      area,
      estado: 'arquivado',
      dataAbertura: dataRel(aberturaOffset),
      dataFecho: dataRel(fechoOffset),
      resultado: ['procedente', 'parcialmente procedente', 'transacao', 'improcedente'][i % 4],
      descricao: `Processo findo de demonstração (${area.toLowerCase()}).`,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------------- */
/* Ciclo de vida                                                              */
/* ------------------------------------------------------------------------- */

export async function demoInstalada() {
  const estado = await listShared('demo_estado');
  return estado.some((r) => r && r.ativo && r.demoSet !== false);
}

/*
 * Instala o conjunto Fonseca & Associados. Idempotente. DISCIPLINA
 * tudo-ou-nada: qualquer falha de criação desencadeia a remoção best-effort de
 * tudo o que esta invocação já criou e relança o erro. Risco residual honesto:
 * se a PRÓPRIA remoção falhar (ex.: rede a meio), podem ficar órfãos
 * demo-marcados - `removerDemo()` limpa-os em qualquer altura, porque procura
 * pela marca e não por esta sessão.
 */
export async function instalarDemo() {
  if (await demoInstalada()) return { jaInstalada: true };

  const criados = []; // [colecao, id] para rollback
  const criar = async (colecao, row) => {
    const created = await createShared(colecao, { ...row, ...MARCA });
    if (!created || !created.id) throw new Error(`criação falhou em ${colecao}`);
    criados.push([colecao, created.id]);
    return created;
  };

  try {
    const contagem = {};
    const conta = (c, n = 1) => { contagem[c] = (contagem[c] || 0) + n; };

    // 1) Clientes primeiro - capturamos os ids reais para as FKs.
    const clienteId = {};
    for (const c of CLIENTES) {
      const row = await criar('clientes', c);
      clienteId[c.nome] = row.id;
      conta('clientes');
    }

    // 2) Processos (ativos + findos para a jurimetria).
    const procId = {};
    for (const p of processosAtivos(clienteId)) {
      const row = await criar('processos', p);
      procId[p.numeroProcesso] = row.id;
      conta('processos');
    }
    for (const p of processosFindos()) {
      await criar('processos', p);
      conta('processos');
    }

    // 3) A fatura da história encadeada: 4.200,00 EUR, vencida há ~14 meses,
    //    devida pela Construções Tejo - alimenta cobranças -> injunção ->
    //    cálculos -> prazos. A colecção CANÓNICA do aging é `cobrancas`
    //    (legal-cobrancas lê `cobrancas`, não `faturas`).
    await criar('cobrancas', {
      clienteId: clienteId['Construções Tejo, S.A.'],
      processoId: procId['2201/26.3T8LSB'],
      descricao: 'Fatura FT 2025/118 - fornecimento de transporte, obra do armazém',
      valor: 4200, dataVencimento: dataRel(-426), estado: 'pendente', metodo: 'transferencia',
    });
    conta('cobrancas');
    // Cobrança regularizada, para contraste no aging.
    await criar('cobrancas', {
      clienteId: clienteId['Vinhos do Douro, Lda.'],
      descricao: 'Fatura FT 2026/031 - avença mensal de contencioso',
      valor: 950, dataVencimento: dataRel(-30), estado: 'paga', metodo: 'transferencia',
    });
    conta('cobrancas');
    // Sequência de lembretes ESGOTADA na vencida (alimenta a timeline de
    // cobranças e justifica a escalada para injunção na história encadeada).
    await criar('lembretes_enviados', {
      cobrancaDescricao: 'Fatura FT 2025/118 - fornecimento de transporte, obra do armazém',
      passoIndex: 0, canal: 'email', enviadoEm: dataRel(-420) + 'T10:00:00.000Z', estado: 'enviado',
      destinatario: 'geral@construcoestejo.pt',
    });
    await criar('lembretes_enviados', {
      cobrancaDescricao: 'Fatura FT 2025/118 - fornecimento de transporte, obra do armazém',
      passoIndex: 1, canal: 'email', enviadoEm: dataRel(-406) + 'T10:00:00.000Z', estado: 'enviado',
      destinatario: 'geral@construcoestejo.pt',
    });
    await criar('lembretes_enviados', {
      cobrancaDescricao: 'Fatura FT 2025/118 - fornecimento de transporte, obra do armazém',
      passoIndex: 2, canal: 'whatsapp', enviadoEm: dataRel(-390) + 'T10:00:00.000Z', estado: 'enviado',
      destinatario: '+351 212 400 030',
    });
    conta('lembretes_enviados', 3);
    // Lançamentos/despesas mínimos (enumerados no brief; alimentam finanças).
    await criar('lancamentos', {
      processoId: procId['2201/26.3T8LSB'], descricao: 'Honorários - preparação da injunção',
      valor: 380, tipo: 'honorarios', data: dataRel(-10),
    });
    conta('lancamentos');
    await criar('despesas', {
      processoId: procId['2202/26.1T8STB'], descricao: 'Certidão do processo de insolvência',
      valor: 35.7, categoria: 'certidoes', data: dataRel(-5), comprovativo: null,
    });
    conta('despesas');
    // Sessão de agenda (reservas/eventos de equipa).
    await criar('eventos', {
      titulo: 'Reunião de acompanhamento - TransLima', tipo: 'reuniao',
      data: dataRel(3), local: 'escritório', clienteId: clienteId['TransLima - Transportes, Lda.'],
    });
    conta('eventos');

    // 4) Documentos: a procuração forense da demo de assinatura.
    await criar('documentos', {
      nome: 'Procuração forense - TransLima (minuta).pdf', tipo: 'procuracao',
      processoId: procId['2201/26.3T8LSB'], origem: 'demonstracao',
      descricao: 'Minuta de procuração forense para o envelope de assinatura da demonstração.',
    });
    conta('documentos');

    // 5) Prazos e eventos coerentes com o radar.
    await criar('prazos', {
      descricao: 'Contestação - cobrança de fornecimentos', processoId: procId['2201/26.3T8LSB'],
      numeroProcesso: '2201/26.3T8LSB', dataLimite: dataRel(6), estado: 'pendente',
    });
    conta('prazos');
    await criar('prazos', {
      descricao: 'Reclamação de créditos (CIRE - sem suspensão nas férias)', processoId: procId['2202/26.1T8STB'],
      numeroProcesso: '2202/26.1T8STB', dataLimite: dataRel(19), estado: 'pendente', regime: 'cire',
    });
    conta('prazos');
    await criar('eventos', {
      titulo: 'Audiência de julgamento - inquirição de testemunhas', processoId: procId['2201/26.3T8LSB'],
      data: dataRel(-7), tipo: 'audiencia', local: 'Juízo Central Cível de Lisboa, sala 4',
    });
    conta('eventos');

    // 6) Tarefas.
    await criar('tarefas', {
      titulo: 'Preparar requerimento de injunção (Construções Tejo)', estado: 'pendente',
      processoId: procId['2201/26.3T8LSB'], responsavel: 'Dr. Duarte Fonseca', prioridade: 'alta',
    });
    conta('tarefas');

    // 7) RCBE: a sociedade cliente com dois beneficiários efetivos (>= 25%),
    //    partilhando a colecção única de BOs (P2-007).
    const entidade = await criar('rcbe_entidades', {
      nome: 'Vinhos do Douro, Lda.', nipc: '509876543', clienteId: clienteId['Vinhos do Douro, Lda.'],
      formaJuridica: 'sociedade por quotas',
    });
    conta('rcbe_entidades');
    await criar('beneficiarios_efetivos', {
      entidadeNipc: '509876543', entidadeId: entidade.id, nome: 'Manuel Sarmento Vale', nif: '198765432',
      natureza: 'capital', percentagem: 60,
    });
    await criar('beneficiarios_efetivos', {
      entidadeNipc: '509876543', entidadeId: entidade.id, nome: 'Rita Sarmento Vale', nif: '187654321',
      natureza: 'capital', percentagem: 40,
    });
    conta('beneficiarios_efetivos', 2);
    // Obrigação anual em atraso simulado - a demo do RCBE parte daqui.
    await criar('rcbe_obrigacoes', {
      entidadeId: entidade.id, entidadeNipc: '509876543', tipo: 'confirmacao_anual',
      dataLimite: dataRel(-12), estado: 'em_atraso',
    });
    conta('rcbe_obrigacoes');

    // 8) A audiência gravada que alimenta a transcrição (o áudio entra na
    //    própria demo da app; aqui fica o registo do trabalho por iniciar).
    await criar('transcricoes', {
      titulo: 'Audiência 2201/26.3T8LSB - inquirição da testemunha',
      processoId: procId['2201/26.3T8LSB'], numeroProcesso: '2201/26.3T8LSB',
      dataAudiencia: dataRel(-7), estado: 'por_transcrever',
    });
    conta('transcricoes');

    // 9) Estado + evento de proveniência (marcado demo).
    await criar('demo_estado', { ativo: true, conjunto: 'fonseca', instaladaEm: new Date().toISOString() });
    conta('demo_estado');
    await registarEvento({
      app: 'demo-spine', acao: 'instalar', demo: true,
      fundamentacao: 'Instalação do conjunto de demonstração Fonseca & Associados.',
      proveniencia: 'demo',
      extra: { demoSet: 'fonseca' },
    });

    return { instalada: true, contagem };
  } catch (err) {
    // Rollback best-effort do que ESTA invocação criou, por ordem inversa.
    for (const [colecao, id] of criados.reverse()) {
      try { await deleteShared(colecao, id); } catch { /* remoção continua */ }
    }
    throw err;
  }
}

/*
 * Remove o conjunto de demonstração: percorre TODAS as colecções conhecidas e
 * apaga exclusivamente registos { demo: true, demoSet: 'fonseca' }. Nunca toca
 * registos sem a marca. O evento de proveniência da remoção NÃO é demo-marcado
 * de propósito: sobrevive como rasto de auditoria da própria remoção.
 */
export async function removerDemo() {
  const contagem = {};
  for (const colecao of DEMO_COLECOES) {
    const rows = await listShared(colecao);
    const alvo = rows.filter((r) => r && r.demo === true && r.demoSet === 'fonseca');
    for (const row of alvo) {
      const ok = await deleteShared(colecao, row.id);
      if (ok) contagem[colecao] = (contagem[colecao] || 0) + 1;
    }
  }
  await registarEvento({
    app: 'demo-spine', acao: 'remover', demo: false,
    fundamentacao: 'Remoção atómica do conjunto de demonstração Fonseca & Associados (apenas registos demo-marcados).',
    proveniencia: 'demo',
    extra: { removidos: contagem },
  });
  return { removida: true, contagem };
}
