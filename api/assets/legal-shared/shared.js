/*
 * Camada de acesso à espinha jurídica PARTILHADA pela conta - CANÓNICA.
 *
 * Este ficheiro é a ÚNICA fonte de verdade da camada partilhada dos seis apps
 * da edição jurídica (Núcleo, Prazos, Caixa Citius, Dossiê, Honorários,
 * Contratos). É sincronizado para cada scaffold por `scripts/sync-legal-shared.mjs`
 * - nunca editar as cópias, editar aqui.
 *
 * A plataforma injecta `window.__ekoa.shared` com:
 *   list(collection)             -> Promise<item[]>
 *   get(collection, id)          -> Promise<item|null>
 *   create(collection, data)     -> Promise<item>
 *   update(collection, id, patch)-> Promise<item>
 *   delete(collection, id)       -> Promise<boolean>
 *
 * Cada item recebe `id`, `createdAt` e `updatedAt` atribuídos pela plataforma,
 * além dos campos próprios. Esta é a namespace partilhada (não os dados por-app):
 * todos os apps da edição jurídica lêem e escrevem aqui a mesma espinha.
 *
 * Só o Núcleo semeia a espinha (`seedSpine`); os apps satélite lêem o que já
 * existe e escrevem as suas próprias colecções. Se `window.__ekoa.shared`
 * estiver ausente, degradamos para listas vazias e operações sem efeito, de modo
 * a que o ecrã renderize na mesma.
 *
 * CONVENÇÃO DE ÂNCORAS DE DEMONSTRAÇÃO (data-demo-*):
 *   - raiz de cada página:        data-demo-page="<app-key>/<rota>"
 *   - CTA principal da página:    data-demo-target="<app-key>-<acção>"   (verbos PT: forms-preencher)
 *   - KPI/resultado de destaque:  data-demo-target="<app-key>-<métrica>" (ex.: recursos-saldo-ferias)
 *   - painel "mostra o trabalho": data-demo-target="<app-key>-explicacao"
 * Demos e testes seleccionam APENAS por data-testid/data-demo-*, nunca por
 * classes CSS. O cliente da ponte de demos é injectado pela plataforma
 * (window.__ekoaDemo); o açúcar React vive em demo.js (sincronizado).
 *
 * COLECÇÕES DA FASE 2 (a espinha é schemaless; documentadas aqui):
 *   envelopes, assinaturas            - legal-assinatura (envelopes e atos de assinatura)
 *   calculos, tabelas_taxas           - legal-calculos (cálculos citados; overlay de taxas do crawler)
 *   transcricoes, excertos            - legal-transcricao (trabalhos STT; excertos art. 640.º)
 *   injuncoes                         - legal-injuncoes (máquina de estados da injunção)
 *   rcbe_entidades, rcbe_obrigacoes   - legal-rcbe (entidades e calendário de obrigações)
 *   beneficiarios_efetivos            - estrutura ÚNICA de BOs partilhada por legal-kyc e legal-rcbe
 *   insolvencias, reclamacoes_creditos- legal-insolvencias (lado do credor)
 *   jurimetria_referencias            - legal-jurimetria (referências públicas versionadas, fonte citada)
 *   registo_eventos                   - proveniência dos fluxos assistidos (ver registarEvento)
 *   demo_estado                       - marcador do conjunto de demonstração (faixa no Layout)
 */

import { useCallback, useEffect, useState } from 'react';

function sharedApi() {
  if (typeof window !== 'undefined' && window.__ekoa && window.__ekoa.shared) {
    return window.__ekoa.shared;
  }
  return null;
}

export async function listShared(collection) {
  const api = sharedApi();
  if (!api || typeof api.list !== 'function') return [];
  const result = await api.list(collection);
  return Array.isArray(result) ? result : [];
}

export async function getShared(collection, id) {
  const api = sharedApi();
  if (!api || typeof api.get !== 'function') return null;
  return api.get(collection, id);
}

export async function createShared(collection, data) {
  const api = sharedApi();
  if (!api || typeof api.create !== 'function') return null;
  return api.create(collection, data);
}

export async function updateShared(collection, id, patch) {
  const api = sharedApi();
  if (!api || typeof api.update !== 'function') return null;
  return api.update(collection, id, patch);
}

export async function deleteShared(collection, id) {
  const api = sharedApi();
  if (!api || typeof api.delete !== 'function') return false;
  return api.delete(collection, id);
}

/*
 * Adaptador de dados sobre a espinha PARTILHADA - superconjunto `{ list, get,
 * create, update }`. Os motores de cada app (Citius, Honorários, Contratos,
 * Dossiê) recebem-no e usam apenas os métodos de que precisam.
 */
export const spineApi = { list: listShared, get: getShared, create: createShared, update: updateShared };

/*
 * Hook de leitura de uma colecção partilhada. Lê a colecção e devolve as linhas;
 * re-executa apenas quando `name` muda. A sementeira é da EXCLUSIVA
 * responsabilidade de `seedSpine` (Núcleo) - este hook nunca semeia.
 *
 * O segundo argumento é aceite e IGNORADO, por compatibilidade com chamadas
 * antigas que passavam `{ seed, seedOnEmpty }` (todas mortas: seed era sempre
 * null). Passar um objecto de opções desconhecido não tem efeito.
 */
export function useSharedCollection(name, _legacyOptions) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listShared(name);
      setItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}

/*
 * Hook de valor com atraso (debounce) - usado nas caixas de pesquisa para não
 * refiltrar a cada tecla. Devolve `value` estabilizado após `ms` sem alterações.
 */
export function useDebounced(value, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(handle);
  }, [value, ms]);
  return debounced;
}

/* ---------------------------------------------------------------------------
 * Sementeira da espinha - exclusiva do Núcleo.
 *
 * Cria os clientes primeiro, captura os ids REAIS atribuídos pela plataforma e
 * só depois cria as colecções dependentes (processos, eventos, prazos, tarefas,
 * lançamentos, acordos, modelos, documentos, comunicações e notificações) com
 * as chaves estrangeiras a apontar para os ids capturados.
 *
 * ALL-OR-NOTHING: só arranca quando `clientes` está vazio (após leitura
 * bem-sucedida). Se já existem clientes, a espinha já foi semeada e não se mexe.
 * Protegida por uma promessa de módulo para correr uma única vez.
 *
 * As datas (prazos/tarefas/eventos/…) são COMPUTADAS no momento da sementeira a
 * partir de `Date.now()`, de modo a que os intervalos (vencido / hoje / próximos
 * 7 / próximos 30 dias) se mantenham verdadeiros independentemente da data.
 * --------------------------------------------------------------------------- */

/* 'YYYY-MM-DD' local, deslocado por `offsetDays` a partir de hoje. */
function seedDate(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Carimbo ISO completo, deslocado por `offsetDays` (para receivedAt / data ISO). */
function seedStamp(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

const CLIENTES_SEED = [
  // Os dois primeiros são mantidos EXACTAMENTE (mesmos NIF) - âncoras dos testes.
  { nome: 'Marília Costa', nif: '210000017', email: 'marilia.costa@exemplo.pt', telefone: '+351 912 000 001', tipo: 'particular' },
  { nome: 'Padaria Central, Lda.', nif: '510000028', email: 'geral@padariacentral.pt', telefone: '+351 220 000 002', tipo: 'empresa' },
  { nome: 'João Almeida Ferreira', nif: '234567891', email: 'joao.ferreira@exemplo.pt', telefone: '+351 913 445 210', tipo: 'particular', morada: 'Rua das Flores, 45, 3.º Dto, 1200-192 Lisboa' },
  { nome: 'Construções Horizonte, S.A.', nif: '512334455', email: 'geral@construcoeshorizonte.pt', telefone: '+351 253 208 190', tipo: 'empresa', morada: 'Zona Industrial da Maia, Lote 12, 4470-605 Maia' },
  { nome: 'Sofia Rebelo Nunes', nif: '245901238', email: 'sofia.nunes@exemplo.pt', telefone: '+351 927 010 556', tipo: 'particular', morada: 'Avenida Central, 210, 4700-024 Braga' },
  { nome: "Farmácia Sant'Ana, Unipessoal Lda.", nif: '514550091', email: 'geral@farmaciasantana.pt', telefone: '+351 289 512 044', tipo: 'empresa', morada: 'Rua Dr. Teixeira Guedes, 8, 8000-042 Faro' },
];

const PROCESSOS_SEED = [
  // Os dois primeiros são mantidos EXACTAMENTE.
  { numeroProcesso: '1234/26.0T8LSB', tribunal: 'Juízo Central Cível de Lisboa', comarca: 'Lisboa', area: 'Cível', estado: 'ativo', advogadoResponsavel: 'Dra. Marília', descricao: 'Acção de responsabilidade civil extracontratual.' },
  { numeroProcesso: '5678/26.1T8PRT', tribunal: 'Juízo do Trabalho do Porto', comarca: 'Porto', area: 'Laboral', estado: 'ativo', descricao: 'Impugnação de despedimento.' },
  { numeroProcesso: '342/25.7T8SNT', tribunal: 'Juízo de Comércio de Sintra', comarca: 'Sintra', area: 'Comercial', estado: 'ativo', advogadoResponsavel: 'Dr. Nuno Aparício', descricao: 'Insolvência de sociedade comercial - apenso de reclamação de créditos.', contraparte: { nome: 'Padaria Central, Lda.', nif: '510000028' } },
  { numeroProcesso: '891/26.2T8BRG', tribunal: 'Juízo de Família e Menores de Braga', comarca: 'Braga', area: 'Família', estado: 'ativo', advogadoResponsavel: 'Dra. Marília', descricao: 'Regulação das responsabilidades parentais.' },
  { numeroProcesso: '77/26.4T8FAR', tribunal: 'Juízo Local Criminal de Faro', comarca: 'Faro', area: 'Criminal', estado: 'suspenso', advogadoResponsavel: 'Dr. Nuno Aparício', descricao: 'Defesa em processo comum singular.' },
  { numeroProcesso: '123/26.0BEALM', tribunal: 'Tribunal Administrativo e Fiscal de Almada', comarca: 'Almada', area: 'Administrativo', estado: 'ativo', advogadoResponsavel: 'Dra. Sofia Rebelo', descricao: 'Impugnação de acto tributário em sede de IMI.' },
  { numeroProcesso: '456/24.9T8LSB', tribunal: 'Juízo Central Cível de Lisboa', comarca: 'Lisboa', area: 'Cível', estado: 'arquivado', advogadoResponsavel: 'Dra. Marília', descricao: 'Acção de despejo, finda por transacção.' },
  { numeroProcesso: '789/26.5T8PRT', tribunal: 'Juízo de Comércio do Porto', comarca: 'Porto', area: 'Comercial', estado: 'ativo', advogadoResponsavel: 'Dr. Nuno Aparício', descricao: 'Acção de cobrança de dívida comercial.' },
];

/*
 * Equipa do escritório - semeada como colecção-mãe (os ids reais alimentam
 * ausências, alocações, disponibilidades e registos de tempo). Os nomes
 * correspondem EXACTAMENTE aos valores usados em `responsavel`/`advogadoResponsavel`
 * nas outras colecções. O campo `cpas` é meramente informativo (advogados
 * descontam para a CPAS, não para a Segurança Social).
 */
const PESSOAS_SEED = [
  { nome: 'Dra. Marília', nomeCompleto: 'Marília Santos Vieira', papel: 'advogado', email: 'marilia@escritorio.pt', dataAdmissao: '2019-09-01', cedula: '45678L', cpas: true, ativo: true },
  { nome: 'Dr. Nuno Aparício', nomeCompleto: 'Nuno Aparício Ramos', papel: 'advogado', email: 'nuno.aparicio@escritorio.pt', dataAdmissao: '2021-02-15', cedula: '52341P', cpas: true, ativo: true },
  { nome: 'Dra. Sofia Rebelo', nomeCompleto: 'Sofia Rebelo Martins', papel: 'advogado', email: 'sofia.rebelo@escritorio.pt', dataAdmissao: '2023-05-02', cedula: '60112C', cpas: true, ativo: true },
  { nome: 'Tiago Osório', nomeCompleto: 'Tiago Osório Lima', papel: 'estagiario', email: 'tiago.osorio@escritorio.pt', dataAdmissao: '2025-10-01', cedula: '71204E', cpas: true, ativo: true },
  { nome: 'Carla Mendes', nomeCompleto: 'Carla Mendes Rocha', papel: 'administrativo', email: 'carla.mendes@escritorio.pt', dataAdmissao: '2020-03-16', cpas: false, ativo: true },
];

const SESSAO_TIPOS_SEED = [
  { nome: 'Consulta inicial', duracaoMin: 30, preco: 60, pagamentoObrigatorio: true, local: 'online', bufferMin: 10, publico: true, descricao: 'Primeira consulta para avaliação do caso.' },
  { nome: 'Reunião de acompanhamento', duracaoMin: 45, preco: null, pagamentoObrigatorio: false, local: 'escritorio', bufferMin: 15, publico: true, descricao: 'Ponto de situação de processo em curso.' },
  { nome: 'Preparação de julgamento', duracaoMin: 90, preco: null, pagamentoObrigatorio: false, local: 'escritorio', bufferMin: 15, publico: false, descricao: 'Sessão interna de preparação com o cliente.' },
];

const SEQUENCIAS_LEMBRETE_SEED = [
  {
    nome: 'Sequência padrão',
    passos: [
      { offsetDias: 0, canal: 'email', template: 'Exmo.(a) Sr.(a) {{nome}}, informamos que a fatura {{descricao}} no valor de {{valor}} se encontra vencida. Agradecemos a regularização.' },
      { offsetDias: 7, canal: 'email', template: 'Exmo.(a) Sr.(a) {{nome}}, relembramos que a fatura {{descricao}} aguarda pagamento. Caso já tenha regularizado, ignore esta mensagem.' },
      { offsetDias: 15, canal: 'whatsapp', template: 'Exmo.(a) Sr.(a) {{nome}}, a fatura {{descricao}} permanece por regularizar. Para qualquer esclarecimento, contacte o escritório.' },
      { offsetDias: 30, canal: 'email', template: 'Exmo.(a) Sr.(a) {{nome}}, na ausência de regularização da fatura {{descricao}}, o assunto será encaminhado para contencioso.' },
    ],
  },
];

const MODELO_SERVICOS_CORPO = [
  'CONTRATO DE PRESTAÇÃO DE SERVIÇOS JURÍDICOS',
  '',
  'Entre {{cliente_nome}}, com o NIF {{cliente_nif}} e morada em {{cliente_morada}}, adiante designado por PRIMEIRO OUTORGANTE, e o mandatário signatário, adiante designado por SEGUNDO OUTORGANTE, é celebrado o presente contrato, que se rege pelas cláusulas seguintes.',
  '',
  'CLÁUSULA PRIMEIRA (Objecto)',
  'O SEGUNDO OUTORGANTE obriga-se a prestar ao PRIMEIRO OUTORGANTE serviços de patrocínio jurídico no âmbito do processo n.º {{processo_numero}}, incluindo a prática de todos os actos processuais necessários à sua boa condução.',
  '',
  'CLÁUSULA SEGUNDA (Honorários)',
  'Os honorários serão calculados de acordo com o tempo despendido e a tabela acordada entre as partes, acrescidos das despesas e encargos legalmente devidos.',
  '',
  'CLÁUSULA TERCEIRA (Deveres deontológicos)',
  'O SEGUNDO OUTORGANTE exerce o mandato com independência, sigilo profissional e no estrito cumprimento do Estatuto da Ordem dos Advogados.',
].join('\n');

const MODELO_CONFIDENCIALIDADE_CORPO = [
  'ACORDO DE CONFIDENCIALIDADE',
  '',
  'Entre {{cliente_nome}}, com o NIF {{cliente_nif}} e morada em {{cliente_morada}}, e a contraparte identificada nos autos do processo n.º {{processo_numero}}, é celebrado o presente acordo de confidencialidade.',
  '',
  'CLÁUSULA PRIMEIRA (Informação confidencial)',
  'Consideram-se confidenciais todas as informações, documentos e dados a que as partes tenham acesso por força da presente relação, independentemente do suporte em que se encontrem.',
  '',
  'CLÁUSULA SEGUNDA (Dever de sigilo)',
  'As partes obrigam-se a não divulgar a terceiros a informação confidencial, salvo mediante autorização escrita da parte titular ou por imposição legal.',
  '',
  'CLÁUSULA TERCEIRA (Vigência)',
  'O dever de confidencialidade mantém-se durante a vigência da relação e pelo prazo de cinco anos após o seu termo.',
].join('\n');

const MODELOS_SEED = [
  {
    nome: 'Contrato de prestação de serviços jurídicos',
    area: 'Cível',
    descricao: 'Minuta-base de honorários e patrocínio, com cláusulas deontológicas.',
    corpo: MODELO_SERVICOS_CORPO,
    variaveis: [
      { chave: 'cliente_nome', rotulo: 'Nome do cliente', origem: 'cliente.nome', obrigatoria: true },
      { chave: 'cliente_nif', rotulo: 'NIF do cliente', origem: 'cliente.nif', obrigatoria: true },
      { chave: 'cliente_morada', rotulo: 'Morada do cliente', origem: 'cliente.morada', obrigatoria: false },
      { chave: 'processo_numero', rotulo: 'Número do processo', origem: 'processo.numero', obrigatoria: false },
    ],
  },
  {
    nome: 'Acordo de confidencialidade',
    area: 'Comercial',
    descricao: 'Minuta de NDA bilateral, com dever de sigilo e prazo de vigência.',
    corpo: MODELO_CONFIDENCIALIDADE_CORPO,
    variaveis: [
      { chave: 'cliente_nome', rotulo: 'Nome do cliente', origem: 'cliente.nome', obrigatoria: true },
      { chave: 'cliente_nif', rotulo: 'NIF do cliente', origem: 'cliente.nif', obrigatoria: true },
      { chave: 'cliente_morada', rotulo: 'Morada do cliente', origem: 'cliente.morada', obrigatoria: false },
      { chave: 'processo_numero', rotulo: 'Número do processo', origem: 'processo.numero', obrigatoria: false },
    ],
  },
];

/*
 * Uma linha é REJEITADA se declarar uma chave estrangeira (processoId/clienteId)
 * que resolveu para null/undefined - nunca se persiste uma FK inválida. Linhas
 * que OMITEM a chave (ex.: comunicação "por-associar", notificação sem processo)
 * passam sem problema.
 */
function dropNullFk(row) {
  if (!row || typeof row !== 'object') return false;
  if ('processoId' in row && row.processoId == null) return false;
  if ('clienteId' in row && row.clienteId == null) return false;
  if ('pessoaId' in row && row.pessoaId == null) return false;
  if ('sessaoTipoId' in row && row.sessaoTipoId == null) return false;
  if ('sequenciaId' in row && row.sequenciaId == null) return false;
  return true;
}

/*
 * Semeia uma colecção dependente apenas se estiver VAZIA (após leitura
 * bem-sucedida) - AUTO-RECUPERÁVEL: se uma sementeira anterior tiver ficado a
 * meio (clientes criados, dependentes não), a colecção em falta continua vazia
 * e é preenchida na carga seguinte. Filtra as FKs nulas via dropNullFk. Os
 * creates correm em paralelo (o backend serializa por-colecção, e Promise.all
 * preserva a ordem). Nunca semeia após um erro de leitura. Não fatal.
 */
async function seedCollectionIfEmpty(name, rows) {
  const clean = (Array.isArray(rows) ? rows : []).filter(dropNullFk);
  if (clean.length === 0) return;
  let existing;
  try {
    existing = await listShared(name);
  } catch {
    return; // leitura falhou -> nunca semear
  }
  if (existing.length > 0) return; // já tem dados (ou já foi semeada)
  try {
    await Promise.all(clean.map((row) => createShared(name, row)));
  } catch {
    // Sementeira parcial de uma colecção dependente - ignora (não fatal).
  }
}

let seedPromise = null;

/*
 * Sementeira IDEMPOTENTE e AUTO-RECUPERÁVEL da espinha (exclusiva do Núcleo).
 *
 * - Clientes: se a colecção estiver vazia, cria os 6 (capturando os ids reais);
 *   caso contrário REUTILIZA os ids das linhas existentes, por ordem de listagem.
 * - Processos: seeds só se vazio (FK ao cliente por ciclo); senão reutiliza ids.
 * - Cada colecção dependente é semeada INDEPENDENTEMENTE (só se vazia), com as
 *   FKs resolvidas a partir das listas ACTUAIS de clientes/processos. Assim uma
 *   sementeira interrompida a meio cura-se na carga seguinte, e uma segunda
 *   passagem com a espinha cheia é um no-op.
 *
 * CONCORRÊNCIA: a promessa de módulo (seedPromise) evita a corrida DENTRO de
 * uma aba; entre abas do mesmo browser a exclusão é garantida pelo Web Lock
 * 'legal-spine-seed' (ver runSeedExclusive). Entre máquinas/browsers não há
 * atomicidade na API partilhada; essa corrida residual é aceite (o custo é
 * duplicados, nunca órfãos - as FKs continuam a resolver para ids reais).
 */
async function doSeedSpine() {
  // Sem API partilhada não há nada a semear (degrada para vazio).
  if (!sharedApi()) return;

  // 1) Clientes - cria-os se a colecção estiver vazia (capturando ids, ordem
  //    preservada por Promise.all) ou REUTILIZA os ids das linhas existentes.
  let clientes;
  try {
    clientes = await listShared('clientes');
  } catch {
    return; // leitura falhou -> nunca semear
  }
  let clienteIds;
  if (clientes.length === 0) {
    try {
      const created = await Promise.all(CLIENTES_SEED.map((row) => createShared('clientes', row)));
      clienteIds = created.map((c) => (c && c.id) || null);
    } catch {
      return; // criação parcial de clientes -> não semear dependentes órfãos
    }
  } else {
    clienteIds = clientes.map((c) => c.id);
  }
  clienteIds = clienteIds.filter(Boolean);
  if (clienteIds.length === 0) return; // nenhum cliente válido -> aborta

  const cli = (i) => clienteIds[i % clienteIds.length];

  // 2) Processos - cria-os se vazio (FK ao cliente por ciclo) ou reutiliza ids.
  let processos;
  try {
    processos = await listShared('processos');
  } catch {
    return;
  }
  let processoIds;
  if (processos.length === 0) {
    try {
      const created = await Promise.all(
        PROCESSOS_SEED.map((p, i) => createShared('processos', { ...p, clienteId: cli(i) })),
      );
      processoIds = created.map((p) => (p && p.id) || null);
    } catch {
      return; // sem processos não há como ligar as restantes colecções
    }
  } else {
    processoIds = processos.map((p) => p.id);
  }
  processoIds = processoIds.filter(Boolean);
  const prc = (i) => (processoIds.length ? processoIds[i % processoIds.length] : null);

  // 2b) Pessoas (equipa) - colecção-mãe da expansão: cria-as se vazio ou
  //     reutiliza os ids existentes (mesmo padrão de clientes/processos).
  let pessoas;
  try {
    pessoas = await listShared('pessoas');
  } catch {
    pessoas = null;
  }
  let pessoaIds = [];
  if (Array.isArray(pessoas)) {
    if (pessoas.length === 0) {
      try {
        const created = await Promise.all(PESSOAS_SEED.map((row) => createShared('pessoas', row)));
        pessoaIds = created.map((p) => (p && p.id) || null);
      } catch {
        pessoaIds = [];
      }
    } else {
      pessoaIds = pessoas.map((p) => p.id);
    }
  }
  pessoaIds = pessoaIds.filter(Boolean);
  const pes = (i) => (pessoaIds.length ? pessoaIds[i % pessoaIds.length] : null);

  // 2c) Tipos de sessão (agenda) - colecção-mãe das reservas.
  let sessaoTipos;
  try {
    sessaoTipos = await listShared('sessao_tipos');
  } catch {
    sessaoTipos = null;
  }
  let sessaoTipoIds = [];
  if (Array.isArray(sessaoTipos)) {
    if (sessaoTipos.length === 0 && pessoaIds.length === 0) {
      // Sem pessoas nao se semeiam tipos de sessao (ficariam sem participantes
      // obrigatorios e a coleccao nao-vazia nunca se auto-repararia). A
      // coleccao fica vazia e cura-se na carga seguinte.
    } else if (sessaoTipos.length === 0) {
      try {
        const created = await Promise.all(
          SESSAO_TIPOS_SEED.map((row, i) => createShared('sessao_tipos', {
            ...row,
            participantesNecessarios: [pes(0), i === 0 ? pes(1) : null].filter(Boolean),
          })),
        );
        sessaoTipoIds = created.map((s) => (s && s.id) || null);
      } catch {
        sessaoTipoIds = [];
      }
    } else {
      sessaoTipoIds = sessaoTipos.map((s) => s.id);
    }
  }
  sessaoTipoIds = sessaoTipoIds.filter(Boolean);
  const ses = (i) => (sessaoTipoIds.length ? sessaoTipoIds[i % sessaoTipoIds.length] : null);

  // 2d) Sequências de lembrete (cobranças) - colecção-mãe das cobranças.
  let sequencias;
  try {
    sequencias = await listShared('sequencias_lembrete');
  } catch {
    sequencias = null;
  }
  let sequenciaIds = [];
  if (Array.isArray(sequencias)) {
    if (sequencias.length === 0) {
      try {
        const created = await Promise.all(SEQUENCIAS_LEMBRETE_SEED.map((row) => createShared('sequencias_lembrete', row)));
        sequenciaIds = created.map((s) => (s && s.id) || null);
      } catch {
        sequenciaIds = [];
      }
    } else {
      sequenciaIds = sequencias.map((s) => s.id);
    }
  }
  sequenciaIds = sequenciaIds.filter(Boolean);
  const seq = (i) => (sequenciaIds.length ? sequenciaIds[i % sequenciaIds.length] : null);

  // 3) Colecções dependentes - cada uma semeada só se vazia, com as FKs das
  //    listas actuais. Correm em paralelo (ficheiros distintos -> sem corrida).
  await Promise.all([
  seedCollectionIfEmpty('eventos', [
    { processoId: prc(0), data: seedDate(-52), titulo: 'Citação da Ré', descricao: 'Junta aos autos o aviso de recepção da citação.', tipo: 'juntada' },
    { processoId: prc(0), data: seedDate(-31), titulo: 'Contestação apresentada', tipo: 'juntada' },
    { processoId: prc(0), data: seedDate(-14), titulo: 'Audiência prévia', descricao: 'Designada para tentativa de conciliação.', tipo: 'audiencia' },
    { processoId: prc(1), data: seedDate(-40), titulo: 'Despacho saneador', tipo: 'despacho' },
    { processoId: prc(2), data: seedDate(-24), titulo: 'Reclamação de créditos', descricao: 'Apenso de reclamação e verificação de créditos.', tipo: 'juntada' },
    { processoId: prc(3), data: seedDate(-18), titulo: 'Relatório social', descricao: 'Junta relatório da segurança social.', tipo: 'outro' },
    { processoId: prc(4), data: seedDate(-9), titulo: 'Audiência de julgamento', tipo: 'audiencia' },
  ]),

  // 4) Prazos - pelo menos 8. Distribuição: 2 vencidos, 1 hoje, 3 nos próximos
  //    7 dias, 2 nos próximos 30 dias. Datas COMPUTADAS a partir de hoje.
  seedCollectionIfEmpty('prazos', [
    { processoId: prc(0), descricao: 'Contestação', dataLimite: seedDate(-6), estado: 'pendente', origem: 'citius', notas: 'Prazo peremptório.' },
    { processoId: prc(1), descricao: 'Requerimento probatório', dataLimite: seedDate(-2), estado: 'cumprido', origem: 'manual', notas: 'Apresentado dentro do prazo.' },
    { processoId: prc(0), descricao: 'Junção de documentos', dataLimite: seedDate(0), estado: 'pendente', origem: 'citius' },
    { processoId: prc(2), descricao: 'Reclamação de créditos', dataLimite: seedDate(3), estado: 'pendente', origem: 'citius' },
    { processoId: prc(3), descricao: 'Alegações', dataLimite: seedDate(5), estado: 'pendente', origem: 'manual' },
    { processoId: prc(4), descricao: 'Exercício do contraditório', dataLimite: seedDate(6), estado: 'pendente', origem: 'manual' },
    { processoId: prc(5), descricao: 'Impugnação do acto tributário', dataLimite: seedDate(18), estado: 'pendente', origem: 'citius' },
    { processoId: prc(0), descricao: 'Pagamento de taxa de justiça', dataLimite: seedDate(26), estado: 'cumprido', origem: 'manual' },
  ]),

  // 5) Tarefas - pelo menos 7. Urgências mistas; 2 vencidas, 2 hoje, restantes
  //    futuras; 1 concluída.
  seedCollectionIfEmpty('tarefas', [
    { titulo: 'Preparar contestação', descricao: 'Rever factos e articular defesa.', processoId: prc(0), clienteId: cli(0), responsavel: 'Dra. Marília', prazo: seedDate(-3), urgencia: 'alta', estado: 'em_curso', origem: 'manual' },
    { titulo: 'Contactar testemunha', processoId: prc(1), responsavel: 'Dr. Nuno Aparício', prazo: seedDate(-1), urgencia: 'media', estado: 'aberta', origem: 'manual' },
    { titulo: 'Reunião com o cliente', clienteId: cli(2), responsavel: 'Dra. Marília', prazo: seedDate(0), urgencia: 'alta', estado: 'aberta', origem: 'manual' },
    { titulo: 'Rever minuta de acordo', processoId: prc(5), responsavel: 'Dra. Sofia Rebelo', prazo: seedDate(0), urgencia: 'baixa', estado: 'aberta', origem: 'manual' },
    { titulo: 'Submeter requerimento no Citius', processoId: prc(2), responsavel: 'Dr. Nuno Aparício', prazo: seedDate(4), urgencia: 'media', estado: 'aberta', origem: 'manual' },
    { titulo: 'Pedir certidão predial', clienteId: cli(3), responsavel: 'Dra. Marília', prazo: seedDate(9), urgencia: 'baixa', estado: 'aberta', origem: 'manual' },
    { titulo: 'Enviar proposta de honorários', clienteId: cli(4), responsavel: 'Dra. Sofia Rebelo', prazo: seedDate(-8), urgencia: 'media', estado: 'concluida', origem: 'manual', concluidaEm: seedStamp(-7) },
  ]),

  // 6) Lançamentos (honorários e despesas) - pelo menos 5.
  seedCollectionIfEmpty('lancamentos', [
    { processoId: prc(0), clienteId: cli(0), tipo: 'honorario', modo: 'hora', descricao: 'Estudo do processo e petição inicial', horas: 6, tarifaHora: 120, valor: 720, data: seedDate(-20), faturado: false },
    { processoId: prc(0), clienteId: cli(0), tipo: 'despesa', modo: 'fixo', descricao: 'Taxa de justiça inicial', valor: 306, data: seedDate(-18), faturado: false },
    { processoId: prc(1), clienteId: cli(1), tipo: 'honorario', modo: 'hora', descricao: 'Audiência de partes', horas: 3, tarifaHora: 120, valor: 360, data: seedDate(-12), faturado: false },
    { processoId: prc(2), clienteId: cli(2), tipo: 'honorario', modo: 'avenca', descricao: 'Avença mensal', valor: 500, data: seedDate(-10), faturado: true },
    { processoId: prc(3), clienteId: cli(3), tipo: 'despesa', modo: 'fixo', descricao: 'Deslocação a Braga', valor: 84.5, data: seedDate(-5), faturado: false },
  ]),

  // 7) Acordos de honorários - 1.
  seedCollectionIfEmpty('acordos', [
    { clienteId: cli(0), tipo: 'hora', tarifaHora: 120, notas: 'Acordo de honorários à hora, revisto anualmente.' },
  ]),

  // 8) Modelos de contratos - 2 (prestação de serviços + confidencialidade).
  seedCollectionIfEmpty('modelos', MODELOS_SEED),

  // 9) Documentos - 2 notas (com texto) + 2 metadados legados (sem bloco ficheiro).
  seedCollectionIfEmpty('documentos', [
    { nome: 'Nota de estratégia', tipo: 'nota', processoId: prc(0), clienteId: cli(0), data: seedDate(-15), origem: 'nota', texto: 'Cliente pretende acordo extrajudicial; aguarda proposta da parte contrária.', versao: 1 },
    { nome: 'Nota sobre testemunha', tipo: 'nota', processoId: prc(1), data: seedDate(-9), origem: 'nota', texto: 'Testemunha confirmou disponibilidade para a audiência.', versao: 1 },
    { nome: 'Petição inicial.pdf', tipo: 'pdf', processoId: prc(0), data: seedDate(-19), origem: 'upload', versao: 1 },
    { nome: 'Procuração forense.docx', tipo: 'docx', processoId: prc(2), data: seedDate(-11), origem: 'upload', versao: 1 },
  ]),

  // 10) Comunicações - 3 (2 associadas, 1 por associar).
  seedCollectionIfEmpty('comunicacoes', [
    { canal: 'whatsapp', direction: 'in', clienteId: cli(0), processoId: prc(0), fromAddr: '+351912000001', fromName: 'Marília Costa', body: 'Bom dia, Dra. Confirmo a reunião de quinta-feira.', sourceRef: 'wamid.SEED0001', receivedAt: seedStamp(-2), status: 'associada', matchInfo: 'Número corresponde ao cliente Marília Costa.' },
    { canal: 'email', direction: 'in', clienteId: cli(1), processoId: prc(1), fromAddr: 'geral@padariacentral.pt', fromName: 'Padaria Central', subject: 'Documentos do processo laboral', body: 'Boa tarde, seguem em anexo os recibos de vencimento solicitados.', sourceRef: 'msg-seed-0002', receivedAt: seedStamp(-1), status: 'associada', matchInfo: 'Email corresponde ao cliente Padaria Central, Lda.' },
    { canal: 'whatsapp', direction: 'in', fromAddr: '+351939887766', body: 'Boa tarde, gostaria de marcar uma consulta sobre um despedimento.', sourceRef: 'wamid.SEED0003', receivedAt: seedStamp(0), status: 'por-associar' },
  ]),

  // 11) Notificações - 3 por ler (alimentam o sino no cabeçalho).
  seedCollectionIfEmpty('notificacoes', [
    { tipo: 'citius', titulo: 'Nova notificação Citius', corpo: 'Processo 342/25.7T8SNT: reclamação de créditos.', processoId: prc(2), href: appHref('legal-citius'), lida: false, data: seedStamp(-1) },
    { tipo: 'prazo', titulo: 'Prazo a terminar hoje', corpo: 'Contestação com prazo para hoje.', processoId: prc(0), href: appHref('legal-prazos'), lida: false, data: seedStamp(0) },
    { tipo: 'comunicacao', titulo: 'Nova mensagem por associar', corpo: 'WhatsApp de um número desconhecido.', href: appHref('legal-nucleo'), lida: false, data: seedStamp(0) },
  ]),

  /* ---- Expansão (15 satélites novos) - cada colecção só se vazia. ---- */

  // 12) Ausências (RH) - férias aprovadas + baixa SEM detalhe clínico (minimização).
  seedCollectionIfEmpty('ausencias', [
    { pessoaId: pes(0), tipo: 'ferias', dataInicio: seedDate(10), dataFim: seedDate(14), estado: 'aprovada', notas: 'Férias de verão (1.ª quinzena).' },
    { pessoaId: pes(1), tipo: 'ferias', dataInicio: seedDate(30), dataFim: seedDate(41), estado: 'pedida' },
    { pessoaId: pes(3), tipo: 'baixa', dataInicio: seedDate(-4), dataFim: seedDate(-2), estado: 'aprovada' },
    { pessoaId: pes(2), tipo: 'formacao', dataInicio: seedDate(6), dataFim: seedDate(6), estado: 'aprovada', notas: 'Formação OA sobre RGPD.' },
  ]),

  // 13) Alocações da equipa aos processos.
  seedCollectionIfEmpty('alocacoes', [
    { pessoaId: pes(0), processoId: prc(0), percentagem: 60, dataInicio: seedDate(-60) },
    { pessoaId: pes(1), processoId: prc(2), percentagem: 40, dataInicio: seedDate(-30) },
    { pessoaId: pes(2), processoId: prc(5), percentagem: 50, dataInicio: seedDate(-20) },
    { pessoaId: pes(3), processoId: prc(0), percentagem: 30, dataInicio: seedDate(-15) },
  ]),

  // 14) Disponibilidades semanais (agenda) - janelas por pessoa.
  seedCollectionIfEmpty('disponibilidades', [
    { pessoaId: pes(0), diaSemana: 1, horaInicio: '09:00', horaFim: '13:00' },
    { pessoaId: pes(0), diaSemana: 3, horaInicio: '14:00', horaFim: '18:00' },
    { pessoaId: pes(1), diaSemana: 1, horaInicio: '10:00', horaFim: '13:00' },
    { pessoaId: pes(1), diaSemana: 3, horaInicio: '14:00', horaFim: '17:00' },
    { pessoaId: pes(2), diaSemana: 2, horaInicio: '09:00', horaFim: '12:30' },
    { pessoaId: pes(2), diaSemana: 4, horaInicio: '14:00', horaFim: '18:00' },
  ]),

  // 15) Reservas - 1 confirmada (alimenta a agenda e a conta corrente da demo).
  seedCollectionIfEmpty('reservas', [
    { sessaoTipoId: ses(0), inicio: `${seedDate(2)}T10:00:00`, fim: `${seedDate(2)}T10:30:00`, nome: 'Marília Costa', email: 'marilia.costa@exemplo.pt', telefone: '+351 912 000 001', estado: 'confirmada', pagamento: { metodo: 'mbway', ref: 'SEED-MBW-0001', valor: 60 } },
  ]),

  // 16) Despesas (finanças) - ligadas a processo/cliente, estados mistos.
  seedCollectionIfEmpty('despesas', [
    { processoId: prc(0), clienteId: cli(0), categoria: 'taxas', descricao: 'Taxa de justiça - articulado superveniente', valor: 102, data: seedDate(-9), reembolsavel: true, estado: 'registada' },
    { processoId: prc(2), clienteId: cli(2), categoria: 'certidoes', descricao: 'Certidão permanente da insolvente', valor: 25, data: seedDate(-6), reembolsavel: true, estado: 'aprovada' },
    { processoId: prc(1), clienteId: cli(1), categoria: 'deslocacoes', descricao: 'Deslocação ao Porto (audiência)', valor: 63.4, data: seedDate(-3), reembolsavel: false, estado: 'registada' },
  ]),

  // 17) Conta corrente por cliente - débitos e créditos com origem.
  seedCollectionIfEmpty('conta_corrente', [
    { clienteId: cli(0), tipo: 'debito', origem: 'pre-fatura', valor: 885.6, data: seedDate(-12), notas: 'Pré-fatura de honorários (estudo + PI).' },
    { clienteId: cli(0), tipo: 'credito', origem: 'pagamento', valor: 500, data: seedDate(-7), refExterna: 'TRF-2026-00311', notas: 'Transferência bancária parcial.' },
    { clienteId: cli(1), tipo: 'debito', origem: 'pre-fatura', valor: 442.8, data: seedDate(-10) },
    { clienteId: cli(2), tipo: 'credito', origem: 'pagamento', valor: 615, data: seedDate(-4), refExterna: 'TRF-2026-00340', notas: 'Avença mensal.' },
  ]),

  // 18) Provisões (fundos pedidos ao cliente).
  seedCollectionIfEmpty('provisoes', [
    { clienteId: cli(3), processoId: prc(3), valor: 750, dataPedido: seedDate(-15), estado: 'recebida', saldo: 480 },
    { clienteId: cli(0), processoId: prc(0), valor: 300, dataPedido: seedDate(-2), estado: 'pedida', saldo: 0 },
  ]),

  // 19) Cobranças - aging variado; a vencida alimenta a demo da sequência.
  seedCollectionIfEmpty('cobrancas', [
    { clienteId: cli(1), processoId: prc(1), descricao: 'Fatura FT 2026/18 - honorários laboral', valor: 442.8, dataVencimento: seedDate(-22), estado: 'pendente', metodo: 'ifthenpay-mb', sequenciaId: seq(0) },
    { clienteId: cli(3), descricao: 'Fatura FT 2026/21 - consulta e parecer', valor: 184.5, dataVencimento: seedDate(-4), estado: 'pendente', metodo: 'stripe', sequenciaId: seq(0) },
    { clienteId: cli(2), descricao: 'Fatura FT 2026/15 - avença de maio', valor: 615, dataVencimento: seedDate(-35), estado: 'paga', metodo: 'transferencia' },
  ]),

  // 20) Lembretes já enviados (histórico da cobrança vencida).
  seedCollectionIfEmpty('lembretes_enviados', [
    { cobrancaDescricao: 'Fatura FT 2026/18 - honorários laboral', passoIndex: 0, canal: 'email', enviadoEm: seedStamp(-22), estado: 'enviado', destinatario: 'geral@padariacentral.pt' },
    { cobrancaDescricao: 'Fatura FT 2026/18 - honorários laboral', passoIndex: 1, canal: 'email', enviadoEm: seedStamp(-15), estado: 'enviado', destinatario: 'geral@padariacentral.pt' },
  ]),

  // 21) Registos de tempo - um em curso, dois parados, um já transferido.
  seedCollectionIfEmpty('registos_tempo', [
    { processoId: prc(0), clienteId: cli(0), pessoaId: pes(0), descricao: 'Análise da contestação da Ré', inicio: `${seedDate(-1)}T09:30:00`, fim: `${seedDate(-1)}T11:00:00`, minutos: 90, faturavel: true, tarifaHora: 120, estado: 'parado' },
    { processoId: prc(2), clienteId: cli(2), pessoaId: pes(1), descricao: 'Preparação da reclamação de créditos', inicio: `${seedDate(-2)}T14:00:00`, fim: `${seedDate(-2)}T16:15:00`, minutos: 135, faturavel: true, tarifaHora: 110, estado: 'parado' },
    { processoId: prc(1), clienteId: cli(1), pessoaId: pes(2), descricao: 'Chamada com o cliente', inicio: `${seedDate(-5)}T10:00:00`, fim: `${seedDate(-5)}T10:20:00`, minutos: 20, faturavel: false, estado: 'transferido' },
  ]),

  // 22) Verificações de conflitos - 1 histórica, decidida e assinada.
  seedCollectionIfEmpty('conflitos_check', [
    { termo: 'Transportes Peninsular, S.A.', nif: '509887210', executadoEm: seedStamp(-30), resultado: [], decisao: 'sem_conflito', decididoPor: 'Dra. Marília', notas: 'Sem correspondências na base de clientes e contrapartes.' },
  ]),

  // 23) Fichas KYC - 1 aprovada (risco baixo) com arquivo de 7 anos.
  seedCollectionIfEmpty('kyc_fichas', [
    { clienteId: cli(1), tipoCliente: 'empresa', risco: 'baixo', riscoBreakdown: [{ fator: 'Tipo de cliente', peso: 1, nota: 'Sociedade nacional com actividade estável.' }, { fator: 'PEP', peso: 0, nota: 'Sem exposição política.' }], pep: false, estado: 'aprovada', rcbe: { estado: 'consultado', dataConsulta: seedDate(-40), notas: 'Beneficiários confirmados no RCBE.' }, arquivarAte: seedDate(2555) },
  ]),

  // 24) Pesquisas jurídicas - 1 guardada com citações verificáveis.
  seedCollectionIfEmpty('pesquisas', [
    { pergunta: 'Prazo de contestação em acção declarativa comum', executadaEm: seedStamp(-8), resposta: 'O prazo geral de contestação é de 30 dias (art. 569.º CPC), contado da citação.', citacoes: [{ fonte: 'DRE', titulo: 'Código de Processo Civil - artigo 569.º', url: 'https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2013-34580575', excerto: 'O réu pode contestar no prazo de 30 dias a contar da citação.' }], estado: 'concluida', processoId: prc(0) },
  ]),

  // 25) Precedentes da firma + 1 peça em rascunho.
  seedCollectionIfEmpty('precedentes', [
    { tipo: 'contestacao', area: 'Cível', titulo: 'Contestação-tipo em responsabilidade civil', corpo: 'I - Por impugnação\n1. Impugnam-se os factos alegados nos artigos 1.º a 12.º da petição inicial...\nII - Por excepção\n...', notas: 'Estrutura-base validada pela equipa de contencioso.' },
  ]),
  seedCollectionIfEmpty('pecas', [
    { processoId: prc(0), tipo: 'requerimento', titulo: 'Requerimento de junção de documentos', corpo: 'Exmo. Senhor Doutor Juiz de Direito,\n\nMarília Costa, Autora nos autos à margem referenciados, vem requerer a junção de dois documentos...', estado: 'rascunho', versao: 1, fundamentacao: [] },
  ]),

  // 26) Correio registado - 1 entregue com comprovativo por anexar.
  seedCollectionIfEmpty('correio', [
    { tipo: 'registado_ar', destinatario: { nome: 'Tribunal Judicial da Comarca de Lisboa', morada: 'Praça do Município, 1100-365 Lisboa' }, processoId: prc(0), clienteId: cli(0), conteudoDescricao: 'Original da procuração forense', estado: 'entregue', registoRef: 'RR123456785PT', custoEstimado: 5.85, datas: { expedido: seedDate(-10), entregue: seedDate(-7) } },
    { tipo: 'registado', destinatario: { nome: 'Construções Horizonte, S.A.', morada: 'Zona Industrial da Maia, Lote 12, 4470-605 Maia' }, clienteId: cli(3), conteudoDescricao: 'Notificação extrajudicial para pagamento', estado: 'expedido', registoRef: 'RR223344556PT', custoEstimado: 4.3, datas: { expedido: seedDate(-2) } },
  ]),

  // 27) Apoio judiciário - 1 nomeação em preparação.
  seedCollectionIfEmpty('apoio_judiciario', [
    { clienteId: cli(4), tipoPedido: 'nomeacao', estado: 'preparacao', datas: { pedido: seedDate(-6) }, prazosGerados: [], honorarios: { fase: 'inicial', despesas: [] } },
  ]),

  // 28) Quadros kanban - o quadro por omissão (colunas mapeadas ao estado).
  seedCollectionIfEmpty('kanban_boards', [
    { nome: 'Quadro geral', colunas: [
      { id: 'aberta', nome: 'Por fazer', cor: 'neutral', estadoMap: 'aberta' },
      { id: 'em_curso', nome: 'Em curso', cor: 'accent', estadoMap: 'em_curso' },
      { id: 'revisao', nome: 'Em revisão', cor: 'warn', estadoMap: null },
      { id: 'concluida', nome: 'Concluído', cor: 'ok', estadoMap: 'concluida' },
    ] },
  ]),

  // 29) Tabelas de taxas - snapshot mínimo das constantes com prazo de validade
  //     (juros comerciais recentes, juros civis, UC e retenção na fonte). A fonte
  //     canónica e histórica completa é ekoa-data/legal-engines/tabelas-taxas.json,
  //     de onde o crawler de Avisos DGTF sara e completa esta colecção; aqui fica
  //     só o arranque para o legal-calculos não abrir vazio. `nota: 'confirmar'`
  //     marca os troços por validar contra o DRE.
  seedCollectionIfEmpty('tabelas_taxas', [
    { tipo: 'juros_comerciais', semestre: '2026-S1', taxa: 10.15, aviso: 'confirmar', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-06-30', nota: 'confirmar' },
    { tipo: 'juros_comerciais', semestre: '2025-S2', taxa: 10.25, aviso: 'confirmar', vigenciaInicio: '2025-07-01', vigenciaFim: '2025-12-31', nota: 'confirmar' },
    { tipo: 'juros_civis', taxa: 4, base: 'Portaria n.º 291/2003 (art. 559.º do Código Civil)', vigenciaInicio: '2003-05-01' },
    { tipo: 'uc', ano: 2026, valor: 102, base: 'Regulamento das Custas Processuais; UC mantida pela Lei do OE', nota: 'confirmar' },
    { tipo: 'retencao_irs', taxa: 23, base: 'Lei n.º 45-A/2024 (art. 101.º do CIRS)' },
  ]),
  ]);
}

/*
 * Corre a sementeira em EXCLUSÃO entre abas do mesmo browser (Web Locks API):
 * a segunda aba espera pelo lock e, ao entrar, relê `clientes` já semeados,
 * tornando a sua passagem um no-op. Entre máquinas/browsers diferentes não há
 * primitiva de atomicidade na API partilhada; essa corrida residual é aceite
 * (o custo é duplicados, nunca órfãos).
 */
function runSeedExclusive() {
  if (
    typeof navigator !== 'undefined' &&
    navigator.locks &&
    typeof navigator.locks.request === 'function'
  ) {
    return navigator.locks.request('legal-spine-seed', () => doSeedSpine());
  }
  return doSeedSpine();
}

export function seedSpine() {
  if (!seedPromise) {
    seedPromise = runSeedExclusive().catch(() => {
      // Falha não fatal - a app renderiza na mesma.
    });
  }
  return seedPromise;
}

/* ---------------------------------------------------------------------------
 * Helpers de formatação e navegação - partilhados por todos os apps.
 * --------------------------------------------------------------------------- */

/* URL de um app da suite: appHref('legal-prazos') -> '/apps/legal-prazos/'. */
export function appHref(appId, path = '') {
  const clean = String(path || '').replace(/^\/+/, '');
  return `/apps/${appId}/${clean}`;
}

/*
 * Guarda única de datas: devolve um Date válido ou null. Usada pelos
 * formatadores de data/hora para não repetirem o try/new Date/isNaN.
 */
export function parseValidDate(value) {
  if (!value) return null;
  try {
    // Datas SÓ-DE-DIA ('YYYY-MM-DD') interpretam-se no CALENDÁRIO LOCAL.
    // `new Date('YYYY-MM-DD')` seria meia-noite UTC, que a oeste de UTC
    // renderiza o dia ANTERIOR - inaceitável num radar de prazos.
    const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/* Formatação de datas em PT-PT - "03/07/2026". */
export function formatDate(value) {
  const d = parseValidDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* Data + hora em PT-PT - "03/07/2026, 14:32". */
export function formatDateTime(value) {
  const d = parseValidDate(value);
  if (!d) return '—';
  return d.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* Formatação de valores monetários (EUR) em PT-PT - "1 234,56 €". */
export function formatEur(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  try {
    return Number(value).toLocaleString('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${Number(value).toFixed(2)} €`;
  }
}

/*
 * Dias inteiros que faltam até `dateStr` (negativo = vencido). Comparação só por
 * data (meia-noite local), segura para Europe/Lisbon - aceita 'YYYY-MM-DD' ou
 * ISO completo. Devolve NaN se a data for inválida.
 */
export function diasRestantes(dateStr) {
  if (!dateStr) return NaN;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  let target;
  if (m) {
    target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return NaN;
    target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/* Cria uma notificação na espinha partilhada (por ler, com carimbo agora). */
export function notify(row) {
  return createShared('notificacoes', { lida: false, data: new Date().toISOString(), ...row });
}

/* Marca uma notificação como lida. */
export function markLida(id) {
  return updateShared('notificacoes', id, { lida: true });
}

/*
 * Evento de proveniência (colecção `registo_eventos`) - o controlo compensatório
 * dos fluxos assistidos sem API oficial (BNI/Citius, RCBE, Portal da Justiça).
 * Cada passo assistido regista QUEM fez O QUÊ, PORQUÊ e COM QUE PROVENIÊNCIA.
 * `demo: true` marca eventos produzidos em modo demonstração (remoção atómica).
 * NUNCA lança - nem sequer sem argumento: um falhanço de registo não pode
 * travar o fluxo que o origina.
 *
 * Atribuição do ator, por ordem: `ator` explícito do chamador (os fluxos que
 * sabem quem age DEVEM passá-lo, p. ex. o mandatário responsável) → identidade
 * app-SSO do visitante (whoami(), só existe no portal/apps públicas; cache de
 * módulo) → 'utilizador'. Limitação honesta: a identidade do utilizador da
 * firma NÃO é injetada nas apps servidas hoje; até a plataforma a expor, os
 * fluxos internos devem passar `ator` explicitamente.
 */
let _whoamiCache;
async function atorPorOmissao() {
  try {
    if (_whoamiCache !== undefined) return _whoamiCache;
    const api = (typeof window !== 'undefined' && window.__ekoa) || null;
    if (api && typeof api.whoami === 'function') {
      const quem = await api.whoami();
      _whoamiCache = (quem && (quem.name || quem.username || quem.email)) || null;
    } else {
      _whoamiCache = null;
    }
  } catch {
    _whoamiCache = null;
  }
  return _whoamiCache;
}

export async function registarEvento(evento = {}) {
  try {
    const { app, acao, fundamentacao = '', proveniencia = '', demo = false, ator, extra = {} } = evento || {};
    const atorFinal = (typeof ator === 'string' && ator.trim()) || (await atorPorOmissao()) || 'utilizador';
    // `extra` primeiro: os campos canónicos do envelope (incl. o marcador demo
    // normalizado) NUNCA podem ser clobberados por um payload copiado de outra
    // linha - a remoção atómica da demonstração depende de `demo` ser fiável.
    return await createShared('registo_eventos', {
      ...extra,
      ator: atorFinal,
      app,
      acao,
      fundamentacao,
      proveniencia,
      demo: Boolean(demo),
      data: new Date().toISOString(),
    });
  } catch {
    return null;
  }
}
