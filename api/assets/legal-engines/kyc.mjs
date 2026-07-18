/**
 * Motor de KYC e diligência de clientes (Lei n.º 83/2017) - DETERMINÍSTICO, zero
 * retrieval, sem relógio interno (as datas entram explícitas). Mostra o seu
 * trabalho (`passos` + `fatores`) para o advogado validar. NÃO decide sozinho se
 * um cliente é aceite: pontua o risco a partir de fatores objetivos e orienta a
 * aplicabilidade dos deveres; a decisão final é sempre humana.
 *
 * Quatro funções puras:
 *  - avaliarRisco(...)   -> pontuação de risco + banda + fatores + passos.
 *  - bandaDeScore(score) -> classifica um score na banda baixo/medio/alto.
 *  - prazoArquivo(data)  -> +7 anos (art. 51.º), à prova de ano bissexto.
 *  - aplicabilidade(...) -> se o serviço está sujeito aos deveres (art. 4.º).
 *
 * Em caso de dúvida, prefere FALHAR (entradas inválidas lançam erro) a devolver
 * um resultado silenciosamente errado - um risco mal pontuado é um risco de
 * conformidade.
 */

/* Valor-base de qualquer relação de negócio, antes de agravamentos. */
const PESO_BASE = 10;

/* Agravamentos de risco (pontos somados à base). Fonte única da tabela. */
const PESO_PEP = 40; // pessoa politicamente exposta (art. 2.º/al. cc))
const PESO_PAIS_MEDIO = 15;
const PESO_PAIS_ALTO = 30; // país terceiro de risco elevado (art. 37.º)
const PESO_ENTIDADE_ESTRANGEIRA = 20;
const PESO_NATUREZA_SENSIVEL = 15; // imobiliário / societário / financeiro
const PESO_NAO_PRESENCIAL = 10; // relação estabelecida à distância

const TIPOS_CLIENTE = ['particular', 'empresa', 'entidade_estrangeira'];
const PAISES_RISCO = ['baixo', 'medio', 'alto'];
const NATUREZAS = ['imobiliario', 'societario', 'financeiro', 'contencioso', 'outro'];
const NATUREZAS_SENSIVEIS = ['imobiliario', 'societario', 'financeiro'];

const TIPO_CLIENTE_LABEL = {
  particular: 'Pessoa singular',
  empresa: 'Sociedade nacional',
  entidade_estrangeira: 'Entidade estrangeira',
};
const PAIS_RISCO_LABEL = { baixo: 'baixo', medio: 'médio', alto: 'elevado' };
const NATUREZA_LABEL = {
  imobiliario: 'Transação imobiliária',
  societario: 'Constituição ou gestão de sociedade',
  financeiro: 'Movimentação de fundos ou ativos',
  contencioso: 'Contencioso judicial',
  outro: 'Outra natureza',
};

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} inválido: ${JSON.stringify(value)} (esperado: ${allowed.join(', ')}).`);
  }
  return value;
}

/**
 * Classifica um score de risco na banda correspondente.
 *  - < 30       -> baixo
 *  - 30 a 59    -> medio
 *  - >= 60      -> alto
 * O valor tem de ser um número finito e não-negativo (recusa em vez de adivinhar).
 */
export function bandaDeScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    throw new Error(`score inválido (número finito >= 0): ${JSON.stringify(score)}`);
  }
  if (score < 30) return 'baixo';
  if (score < 60) return 'medio';
  return 'alto';
}

/**
 * Avalia o risco de branqueamento de um cliente/operação.
 *
 * @param {object} input
 *  - tipoCliente: 'particular' | 'empresa' | 'entidade_estrangeira'
 *  - pep: boolean (pessoa politicamente exposta)
 *  - paisRisco: 'baixo' | 'medio' | 'alto' (por omissão 'baixo')
 *  - naturezaOperacao: 'imobiliario'|'societario'|'financeiro'|'contencioso'|'outro'
 *    (por omissão 'outro')
 *  - relacaoPresencial: boolean - false (à distância) agrava; por omissão true
 * @returns {{ score:number, banda:'baixo'|'medio'|'alto',
 *   fatores: Array<{fator:string, peso:number, nota:string}>, passos:string[] }}
 *
 * Cada fator emite SEMPRE uma linha em `fatores`, mesmo quando o seu peso é 0 -
 * a `nota` explica porquê. Assim a diligência fica auditável na íntegra.
 */
export function avaliarRisco(input = {}) {
  const tipoCliente = assertEnum(input.tipoCliente, TIPOS_CLIENTE, 'tipoCliente');
  const pep = Boolean(input.pep);
  const paisRisco = assertEnum(input.paisRisco == null ? 'baixo' : input.paisRisco, PAISES_RISCO, 'paisRisco');
  const naturezaOperacao = assertEnum(
    input.naturezaOperacao == null ? 'outro' : input.naturezaOperacao,
    NATUREZAS,
    'naturezaOperacao',
  );
  // Só false (relação à distância) agrava; undefined trata-se como presencial.
  const relacaoPresencial = input.relacaoPresencial !== false;

  const fatores = [];
  const passos = [];
  passos.push(`Valor-base da avaliação: ${PESO_BASE} pontos.`);

  // 1) Tipo de cliente - só a entidade estrangeira agrava.
  const pesoTipo = tipoCliente === 'entidade_estrangeira' ? PESO_ENTIDADE_ESTRANGEIRA : 0;
  fatores.push({
    fator: 'Tipo de cliente',
    peso: pesoTipo,
    nota: tipoCliente === 'entidade_estrangeira'
      ? 'Entidade estrangeira: risco geográfico e de identificação do beneficiário acrescido.'
      : `${TIPO_CLIENTE_LABEL[tipoCliente]}: sem agravamento por este fator.`,
  });
  passos.push(
    pesoTipo > 0
      ? `Tipo de cliente (entidade estrangeira): +${pesoTipo}.`
      : `Tipo de cliente (${TIPO_CLIENTE_LABEL[tipoCliente].toLowerCase()}): +0.`,
  );

  // 2) PEP - pessoa politicamente exposta.
  const pesoPep = pep ? PESO_PEP : 0;
  fatores.push({
    fator: 'Pessoa politicamente exposta (PEP)',
    peso: pesoPep,
    nota: pep
      ? 'Cliente com exposição política: diligência reforçada obrigatória (art. 19.º).'
      : 'Sem exposição política declarada.',
  });
  passos.push(pep ? `PEP: exposição política declarada: +${pesoPep}.` : 'PEP: sem exposição política: +0.');

  // 3) País de risco.
  const pesoPais = paisRisco === 'alto' ? PESO_PAIS_ALTO : paisRisco === 'medio' ? PESO_PAIS_MEDIO : 0;
  fatores.push({
    fator: 'País de risco',
    peso: pesoPais,
    nota: paisRisco === 'baixo'
      ? 'Jurisdição de risco baixo.'
      : `Jurisdição de risco ${PAIS_RISCO_LABEL[paisRisco]}: fator geográfico agravante.`,
  });
  passos.push(
    pesoPais > 0
      ? `País de risco ${PAIS_RISCO_LABEL[paisRisco]}: +${pesoPais}.`
      : 'País de risco baixo: +0.',
  );

  // 4) Natureza da operação - imobiliário/societário/financeiro agravam.
  const naturezaSensivel = NATUREZAS_SENSIVEIS.includes(naturezaOperacao);
  const pesoNatureza = naturezaSensivel ? PESO_NATUREZA_SENSIVEL : 0;
  fatores.push({
    fator: 'Natureza da operação',
    peso: pesoNatureza,
    nota: naturezaSensivel
      ? `${NATUREZA_LABEL[naturezaOperacao]}: operação sensível ao branqueamento.`
      : `${NATUREZA_LABEL[naturezaOperacao]}: sem agravamento por este fator.`,
  });
  passos.push(
    pesoNatureza > 0
      ? `Natureza da operação (${NATUREZA_LABEL[naturezaOperacao].toLowerCase()}): +${pesoNatureza}.`
      : `Natureza da operação (${NATUREZA_LABEL[naturezaOperacao].toLowerCase()}): +0.`,
  );

  // 5) Relação presencial - a relação à distância agrava.
  const pesoPresencial = relacaoPresencial ? 0 : PESO_NAO_PRESENCIAL;
  fatores.push({
    fator: 'Relação presencial',
    peso: pesoPresencial,
    nota: relacaoPresencial
      ? 'Cliente identificado presencialmente.'
      : 'Relação estabelecida à distância: identificação sem presença física agrava o risco.',
  });
  passos.push(
    relacaoPresencial
      ? 'Relação presencial: +0.'
      : `Relação à distância: +${pesoPresencial}.`,
  );

  const score = PESO_BASE + fatores.reduce((acc, f) => acc + f.peso, 0);
  const banda = bandaDeScore(score);
  passos.push(`Score total: ${score} -> banda ${banda} (${banda === 'baixo' ? '< 30' : banda === 'medio' ? '30 a 59' : '>= 60'}).`);

  return { score, banda, fatores, passos };
}

/* ---------------------------------------------------------------------------
 * Prazo de conservação - art. 51.º da Lei n.º 83/2017 (7 anos).
 * ------------------------------------------------------------------------- */

function pad2(n) { return String(n).padStart(2, '0'); }

function isBissexto(ano) {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/*
 * Faz parse de 'YYYY-MM-DD' REJEITANDO datas impossíveis (Date.UTC normaliza
 * 2026-02-29 -> 2026-03-01 silenciosamente; validamos por round-trip).
 */
function parseYmd(s) {
  if (typeof s !== 'string') throw new Error(`data inválida: ${JSON.stringify(s)}`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`data deve ser 'YYYY-MM-DD': ${s}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) {
    throw new Error(`data impossível: ${s}`);
  }
  return { y, mo, da };
}

/**
 * Data-limite de conservação: 7 anos após a aprovação (art. 51.º da Lei
 * n.º 83/2017). À prova de ano bissexto - 29 de fevereiro de um ano bissexto
 * projeta-se em 28 de fevereiro quando o ano-alvo (aprovação + 7) não é
 * bissexto (regra documentada: preserva-se o mês, ajusta-se o dia possível).
 *
 * @param {string} dataAprovacao 'YYYY-MM-DD'
 * @returns {string} 'YYYY-MM-DD' exatamente 7 anos depois.
 */
export function prazoArquivo(dataAprovacao) {
  const { y, mo, da } = parseYmd(dataAprovacao);
  const anoAlvo = y + 7;
  // O único dia que pode não existir no ano-alvo é 29 de fevereiro (bissexto).
  const dia = mo === 2 && da === 29 && !isBissexto(anoAlvo) ? 28 : da;
  return `${anoAlvo}-${pad2(mo)}-${pad2(dia)}`;
}

/* ---------------------------------------------------------------------------
 * Aplicabilidade dos deveres - art. 4.º da Lei n.º 83/2017.
 * ------------------------------------------------------------------------- */

const APLICABILIDADE = {
  consulta_juridica: {
    aplica: false,
    fundamento:
      'A consulta jurídica não constitui, por si só, atividade sujeita aos deveres de '
      + 'branqueamento (art. 4.º da Lei n.º 83/2017). O advogado só é entidade obrigada '
      + 'quando participa em operações concretas por conta do cliente.',
  },
  patrocinio: {
    aplica: false,
    fundamento:
      'O patrocínio judiciário está fora do âmbito dos deveres (art. 4.º da Lei n.º 83/2017): '
      + 'a representação em juízo não é uma operação sujeita a diligência.',
  },
  imobiliario: {
    aplica: true,
    fundamento:
      'Participação em transação imobiliária por conta do cliente - operação sujeita aos '
      + 'deveres de identificação e diligência (art. 4.º da Lei n.º 83/2017).',
  },
  societario: {
    aplica: true,
    fundamento:
      'Constituição, gestão ou alienação de sociedades por conta do cliente - operação '
      + 'sujeita aos deveres (art. 4.º da Lei n.º 83/2017).',
  },
  financeiro: {
    aplica: true,
    fundamento:
      'Movimentação de fundos, valores ou ativos por conta do cliente - operação sujeita '
      + 'aos deveres (art. 4.º da Lei n.º 83/2017).',
  },
  fiducias: {
    aplica: true,
    fundamento:
      'Serviços fiduciários e de gestão de patrimónios de terceiros - operação sujeita aos '
      + 'deveres (art. 4.º da Lei n.º 83/2017).',
  },
};

/**
 * Diz se um tipo de serviço está sujeito aos deveres de diligência (art. 4.º).
 * ORIENTA, nunca força: os deveres NÃO se aplicam à consulta jurídica nem ao
 * patrocínio judiciário; aplicam-se às operações imobiliárias, societárias,
 * financeiras e fiduciárias praticadas por conta do cliente.
 *
 * @param {string} tipoServico
 * @returns {{ aplica: boolean, fundamento: string }}
 */
export function aplicabilidade(tipoServico) {
  const entry = APLICABILIDADE[tipoServico];
  if (!entry) {
    throw new Error(
      `tipoServico inválido: ${JSON.stringify(tipoServico)} (esperado: ${Object.keys(APLICABILIDADE).join(', ')}).`,
    );
  }
  return { aplica: entry.aplica, fundamento: entry.fundamento };
}

/* ---------------------------------------------------------------------------
 * Validação do dígito de controlo do NIF/NIPC (algoritmo módulo 11).
 *
 * O identificador fiscal português tem 9 dígitos; o último é um dígito de
 * controlo. Cálculo: os 8 primeiros dígitos são multiplicados pelos pesos
 * 9, 8, 7, 6, 5, 4, 3, 2 (da esquerda para a direita); soma-se; o resto da
 * divisão da soma por 11 determina o dígito esperado - resto 0 ou 1 -> dígito
 * 0, caso contrário -> 11 menos o resto. O primeiro dígito indica a natureza
 * do titular (1/2/3 singular; 5 pessoa coletiva; 6 organismo público; 8
 * empresário em nome individual; 9 pessoa coletiva/entidade equiparada, etc.).
 *
 * Estas funções são PURAS e não têm efeitos: recusam (devolvem inválido) em vez
 * de adivinhar. São usadas para rejeitar identificadores mal transcritos; NÃO
 * substituem a consulta às bases oficiais (AT, RNPC) - um NIF pode ter dígito
 * de controlo válido e mesmo assim não corresponder a nenhum titular real.
 * ------------------------------------------------------------------------- */

/* Primeiros dígitos válidos de um identificador fiscal português. Fonte única. */
const PRIMEIROS_DIGITOS_VALIDOS = ['1', '2', '3', '5', '6', '7', '8', '9'];

/* Só os dígitos (remove espaços, pontos e o prefixo 'PT' de um NIF intracomunitário). */
function digitosFiscais(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

/*
 * Dígito de controlo esperado para os 8 primeiros dígitos (string de 8 dígitos).
 * Devolve 0-9. Não valida comprimento - é responsabilidade do chamador.
 */
function digitoControlo(oito) {
  let soma = 0;
  for (let i = 0; i < 8; i += 1) {
    soma += Number(oito[i]) * (9 - i);
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Valida o dígito de controlo de um número fiscal português (NIF ou NIPC).
 * Aceita espaços, pontos e o prefixo 'PT'; valida sobre os 9 dígitos.
 *
 * @param {string} valor
 * @returns {{ valido: boolean, digitos: string, motivo: string }}
 *  - valido: o número tem 9 dígitos, primeiro dígito admissível e check-digit correto.
 *  - digitos: os dígitos normalizados (para exibir/persistir de forma limpa).
 *  - motivo: explicação legível quando inválido ('' quando válido).
 */
export function validaNumeroFiscal(valor) {
  const digitos = digitosFiscais(valor);
  if (digitos.length === 0) {
    return { valido: false, digitos, motivo: 'Sem dígitos: indique um número fiscal.' };
  }
  if (digitos.length !== 9) {
    return { valido: false, digitos, motivo: `O número fiscal tem 9 dígitos (tem ${digitos.length}).` };
  }
  if (!PRIMEIROS_DIGITOS_VALIDOS.includes(digitos[0])) {
    return { valido: false, digitos, motivo: `Primeiro dígito inválido (${digitos[0]}): não corresponde a nenhuma natureza de titular.` };
  }
  const esperado = digitoControlo(digitos);
  if (esperado !== Number(digitos[8])) {
    return { valido: false, digitos, motivo: `Dígito de controlo inválido: esperado ${esperado}, obtido ${digitos[8]}.` };
  }
  return { valido: true, digitos, motivo: '' };
}

/**
 * Valida um NIF de pessoa singular (primeiro dígito 1, 2 ou 3, além do
 * check-digit). Um número com check-digit válido mas primeiro dígito de pessoa
 * coletiva (5/9) é recusado como NIF singular.
 * @param {string} valor
 * @returns {{ valido: boolean, digitos: string, motivo: string }}
 */
export function validaNif(valor) {
  const base = validaNumeroFiscal(valor);
  if (!base.valido) return base;
  if (!['1', '2', '3'].includes(base.digitos[0])) {
    return { valido: false, digitos: base.digitos, motivo: `NIF de pessoa singular começa por 1, 2 ou 3 (começa por ${base.digitos[0]}).` };
  }
  return base;
}

/**
 * Valida um NIPC de pessoa coletiva (primeiro dígito 5, 6, 7, 8 ou 9, além do
 * check-digit). Um número de pessoa singular (1/2/3) é recusado como NIPC.
 * @param {string} valor
 * @returns {{ valido: boolean, digitos: string, motivo: string }}
 */
export function validaNipc(valor) {
  const base = validaNumeroFiscal(valor);
  if (!base.valido) return base;
  if (!['5', '6', '7', '8', '9'].includes(base.digitos[0])) {
    return { valido: false, digitos: base.digitos, motivo: `NIPC de pessoa coletiva começa por 5, 6, 7, 8 ou 9 (começa por ${base.digitos[0]}).` };
  }
  return base;
}
