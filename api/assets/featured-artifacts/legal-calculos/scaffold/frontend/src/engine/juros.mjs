/**
 * Motor determinístico de JUROS DE MORA (Portugal). Zero retrieval, mostra o seu
 * trabalho, cita a fonte de CADA troço. Calcula os juros vencidos sobre um
 * capital entre a data de vencimento e uma data final, dividindo o período em
 * TROÇOS nos limites de semestre (juros comerciais/ao Estado, taxa supletiva
 * semestral) ou num único troço à taxa civil de 4 %.
 *
 * PUREZA: o motor NÃO lê ficheiros nem importa a tabela de taxas. Recebe as
 * linhas da tabela como ARGUMENTO (`input.tabela`) - a fonte única
 * `ekoa-data/legal-engines/tabelas-taxas.json` é carregada pelo serviço da
 * plataforma e injectada aqui. Assim o motor é testável, determinístico e
 * nenhuma constante de taxa vive no código.
 *
 * Base legal:
 *  - Juros civis: 4 % ao ano (art. 559.º do Código Civil; Portaria n.º 291/2003,
 *    de 8 de abril).
 *  - Juros comerciais: art. 102.º, §§ 3.º a 5.º do Código Comercial e Decreto-Lei
 *    n.º 62/2013 (atrasos de pagamento em transações comerciais). A taxa
 *    supletiva é fixada SEMESTRALMENTE por aviso da DGTF - cada troço cita o seu.
 *  - Dívidas de/entidade pública em transação comercial: mesma taxa comercial
 *    semestral (Decreto-Lei n.º 62/2013, art. 3.º).
 *
 * Toda a aritmética é feita em CÊNTIMOS (inteiros) para não acumular erro de
 * vírgula flutuante; contagem de dias em actual/365 (dias corridos, ano de 365
 * dias), calculada por troço e SOMADA - cada período à sua taxa, como manda a lei.
 */

/** Limite acima do qual a aritmética em cêntimos deixaria de ser exacta (IEEE-754). */
const MAX_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 100);

/** Base legal (referência a diploma, não a um valor) por tipo de juro. */
const BASE_LEGAL = {
  civil: 'Art. 559.º do Código Civil; Portaria n.º 291/2003, de 8 de abril.',
  comercial: 'Art. 102.º, §§ 3.º a 5.º do Código Comercial; Decreto-Lei n.º 62/2013. Taxa supletiva semestral fixada por aviso da DGTF.',
  estado: 'Transação comercial com entidade pública - Decreto-Lei n.º 62/2013, art. 3.º. Taxa comercial semestral fixada por aviso da DGTF.',
};

/**
 * Capital VÁLIDO em cêntimos: inteiro finito >= 0 dentro do limite seguro.
 * Recusa em vez de produzir um total silenciosamente errado.
 */
function assertCents(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${label} inválido (tem de ser um número finito): ${JSON.stringify(v)}`);
  }
  if (!Number.isInteger(v)) throw new Error(`${label} tem de ser um inteiro em cêntimos: ${v}`);
  if (v < 0) throw new Error(`${label} não pode ser negativo: ${v}`);
  if (v > MAX_CENTS) throw new Error(`${label} excede o limite seguro: ${v}`);
  return v;
}

/**
 * Valor em euros VÁLIDO: number finito >= 0 com precisão ao cêntimo (máx. 2 casas
 * decimais). O chamador arredonda ao cêntimo ANTES - um capital é dinheiro, não
 * uma fracção sub-cêntimo.
 */
function assertEuros(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${label} inválido (tem de ser um número finito): ${JSON.stringify(v)}`);
  }
  if (v < 0) throw new Error(`${label} não pode ser negativo: ${v}`);
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) {
    throw new Error(`${label} tem mais de 2 casas decimais (precisão ao cêntimo): ${v}`);
  }
  const cents = Math.round(v * 100);
  if (cents > MAX_CENTS) throw new Error(`${label} excede o limite seguro: ${v}`);
  return cents;
}

/** Taxa VÁLIDA: number finito no intervalo 0–100 (pode ter decimais, ex.: 10.5). */
function assertTaxa(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
    throw new Error(`${label} fora do intervalo 0–100: ${JSON.stringify(v)}`);
  }
  return v;
}

/** Data 'YYYY-MM-DD' -> milissegundos UTC à meia-noite. Recusa formatos inválidos. */
function parseDay(value, label) {
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`${label} inválida (formato esperado AAAA-MM-DD): ${JSON.stringify(value)}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Rejeita datas impossíveis (ex.: 2023-02-30 que o Date "normaliza").
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`${label} não é uma data de calendário válida: ${value}`);
  }
  return ms;
}

/** Dia seguinte (ms UTC) - para transformar a vigência inclusiva num limite meio-aberto. */
function nextDay(ms) {
  return ms + 86_400_000;
}

/** Dias corridos entre dois instantes UTC de meia-noite (inteiro). */
function daysBetween(aMs, bMs) {
  return Math.round((bMs - aMs) / 86_400_000);
}

/** 'YYYY-MM-DD' a partir de ms UTC. */
function fmtDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Formata cêntimos como "1 230,00 €" (pt-PT) para os passos. */
function eur(cents) {
  const v = (Math.round(cents) / 100).toFixed(2).replace('.', ',');
  return `${v} €`;
}

/** Cêntimos -> euros (number com 2 casas). */
function centsToEuros(c) {
  return Math.round(c) / 100;
}

/**
 * Juros de um troço em cêntimos: capital × taxa% × dias / 365, arredondado ao
 * cêntimo. Cada troço é calculado e arredondado INDEPENDENTEMENTE (é a memória de
 * cálculo que o advogado valida) e os troços são somados.
 */
function jurosTrocoCents(capitalCents, taxa, dias) {
  return Math.round((capitalCents * taxa * dias) / (100 * 365));
}

/**
 * Constrói os troços comerciais/ao Estado percorrendo o período [inicio, fim) e
 * atribuindo a cada sub-intervalo a linha de semestre cuja vigência o contém. A
 * vigência das linhas é INCLUSIVA (vigenciaFim = último dia do semestre), aqui
 * tratada como meio-aberta [vigenciaInicio, vigenciaFim+1dia) para que os troços
 * fiquem contíguos e a soma dos dias iguale exactamente o total.
 *
 * Um sub-período sem linha de taxa (buraco na tabela, ou futuro por publicar)
 * gera um troço com `taxa: null`, `semTaxa: true` e `nota: 'confirmar'`, juros 0,
 * e marca o resultado global `incompleto: true` - NUNCA calcula com uma taxa
 * inventada.
 */
function trocosSemestrais(capitalCents, inicioMs, fimMs, linhas, baseLegal) {
  // Ordena por início de vigência e valida o formato mínimo de cada linha.
  const rows = (Array.isArray(linhas) ? linhas : [])
    .map((r) => ({
      taxa: r && typeof r.taxa === 'number' ? r.taxa : null,
      semestre: r && r.semestre ? String(r.semestre) : '',
      aviso: r && r.aviso ? String(r.aviso) : '',
      nota: r && r.nota ? String(r.nota) : null,
      iniMs: parseDay(r && r.vigenciaInicio, 'vigenciaInicio'),
      fimMs: parseDay(r && r.vigenciaFim, 'vigenciaFim'),
    }))
    .sort((a, b) => a.iniMs - b.iniMs);

  const trocos = [];
  let incompleto = false;
  let cursor = inicioMs;

  while (cursor < fimMs) {
    const row = rows.find((r) => cursor >= r.iniMs && cursor <= r.fimMs);
    if (!row) {
      // Sem taxa para o período - avança até ao próximo início de vigência
      // conhecido (ou até ao fim) e regista o troço como por-confirmar.
      const nextStart = rows
        .map((r) => r.iniMs)
        .filter((ms) => ms > cursor)
        .reduce((min, ms) => (ms < min ? ms : min), fimMs);
      const boundary = Math.min(fimMs, nextStart);
      const dias = daysBetween(cursor, boundary);
      trocos.push({
        inicio: fmtDay(cursor),
        fim: fmtDay(boundary),
        dias,
        taxa: null,
        semestre: '',
        aviso: 'Sem aviso publicado para o período - a confirmar no DRE.',
        base: baseLegal,
        nota: 'confirmar',
        semTaxa: true,
        jurosCentavos: 0,
        juros: 0,
      });
      incompleto = true;
      cursor = boundary;
      continue;
    }
    const boundary = Math.min(fimMs, nextDay(row.fimMs));
    const dias = daysBetween(cursor, boundary);
    const jc = jurosTrocoCents(capitalCents, row.taxa, dias);
    const troco = {
      inicio: fmtDay(cursor),
      fim: fmtDay(boundary),
      dias,
      taxa: row.taxa,
      semestre: row.semestre,
      aviso: row.aviso,
      base: baseLegal,
      jurosCentavos: jc,
      juros: centsToEuros(jc),
    };
    if (row.nota) {
      troco.nota = row.nota;
      if (row.nota === 'confirmar') incompleto = true;
    }
    trocos.push(troco);
    cursor = boundary;
  }
  return { trocos, incompleto };
}

/**
 * @param {{ capitalCentavos?: number, valor?: number, dataVencimento: string,
 *   dataFim: string, tipo?: 'civil'|'comercial'|'estado', tabela: object }} input
 *   `tabela` são as linhas de tabelas-taxas.json (jurosCivis + jurosComerciais).
 * @returns {{ moeda:'EUR', tipo:string, capital:number, dataVencimento:string,
 *   dataFim:string, diasTotais:number, trocos:Array, totalJuros:number,
 *   total:number, incompleto:boolean, showWork:{passos:string[]} }}
 */
export function computeJuros(input = {}) {
  const tipo = input.tipo == null ? 'comercial' : String(input.tipo);
  if (!Object.prototype.hasOwnProperty.call(BASE_LEGAL, tipo)) {
    throw new Error(`tipo de juro inválido (civil|comercial|estado): ${JSON.stringify(input.tipo)}`);
  }
  if (!input.tabela || typeof input.tabela !== 'object') {
    throw new Error('tabela de taxas em falta (o motor recebe as linhas como argumento).');
  }

  // Capital: aceita cêntimos inteiros OU euros (exactamente um).
  let capitalCents;
  if (input.capitalCentavos != null) {
    capitalCents = assertCents(input.capitalCentavos, 'capitalCentavos');
  } else if (input.valor != null) {
    capitalCents = assertEuros(input.valor, 'valor');
  } else {
    throw new Error('capital em falta: indique capitalCentavos (inteiro) ou valor (euros).');
  }

  const inicioMs = parseDay(input.dataVencimento, 'dataVencimento');
  const fimMs = parseDay(input.dataFim, 'dataFim');
  if (fimMs < inicioMs) {
    throw new Error('A data final não pode ser anterior à data de vencimento.');
  }

  const baseLegal = BASE_LEGAL[tipo];
  const diasTotais = daysBetween(inicioMs, fimMs);

  let trocos = [];
  let incompleto = false;

  if (fimMs === inicioMs) {
    // Sem dias corridos - juros zero, sem troços.
    trocos = [];
  } else if (tipo === 'civil') {
    const jc = input.tabela.jurosCivis || {};
    const taxa = assertTaxa(typeof jc.taxa === 'number' ? jc.taxa : NaN, 'jurosCivis.taxa');
    const dias = daysBetween(inicioMs, fimMs);
    const cents = jurosTrocoCents(capitalCents, taxa, dias);
    trocos = [{
      inicio: fmtDay(inicioMs),
      fim: fmtDay(fimMs),
      dias,
      taxa,
      semestre: '',
      aviso: jc.base ? String(jc.base) : 'Portaria n.º 291/2003, de 8 de abril',
      base: baseLegal,
      jurosCentavos: cents,
      juros: centsToEuros(cents),
    }];
  } else {
    const built = trocosSemestrais(capitalCents, inicioMs, fimMs, input.tabela.jurosComerciais, baseLegal);
    trocos = built.trocos;
    incompleto = built.incompleto;
  }

  const totalCents = trocos.reduce((sum, t) => sum + (t.jurosCentavos || 0), 0);

  const passos = [
    `Capital: ${eur(capitalCents)}`,
    `Período de mora: ${fmtDay(inicioMs)} a ${fmtDay(fimMs)} (${diasTotais} dias, actual/365)`,
    `Base legal: ${baseLegal}`,
    ...trocos.map((t) => (
      t.taxa == null
        ? `Troço ${t.inicio} a ${t.fim} (${t.dias} dias): taxa por confirmar - ${t.aviso}`
        : `Troço ${t.inicio} a ${t.fim} (${t.dias} dias) à taxa de ${t.taxa}% [${t.semestre || 'civil'} · ${t.aviso}]: ${eur(t.jurosCentavos)}`
    )),
    `Total de juros de mora: ${eur(totalCents)}`,
  ];
  if (incompleto) {
    passos.push('Atenção: parte do período não tem taxa publicada na tabela - valor a confirmar no DRE.');
  }

  return {
    moeda: 'EUR',
    tipo,
    capital: centsToEuros(capitalCents),
    dataVencimento: fmtDay(inicioMs),
    dataFim: fmtDay(fimMs),
    diasTotais,
    trocos,
    totalJurosCentavos: totalCents,
    totalJuros: centsToEuros(totalCents),
    total: centsToEuros(totalCents),
    incompleto,
    showWork: { passos },
  };
}
