/**
 * Motor de FÉRIAS (Código do Trabalho português) - DETERMINÍSTICO, zero
 * retrieval, datas explícitas (sem relógio interno: o `ano` e os `feriados`
 * entram como argumento). Mostra o seu trabalho (`passos`) para o gestor de RH
 * validar. NÃO decide regras de forma opaca: aplica o artigo correcto ao caso e
 * devolve-o em `regra`. Em caso de dúvida, prefere falhar (datas impossíveis
 * lançam erro) a devolver um número silenciosamente errado.
 *
 * Regras implementadas (Portugal, Código do Trabalho):
 *  - Ano da admissão (art. 239.º n.º 1): 2 dias úteis de férias por cada mês
 *    COMPLETO de duração do contrato no ano civil, até ao máximo de 20 dias;
 *    gozáveis após 6 meses de execução do contrato.
 *  - Anos seguintes (art. 238.º n.º 1): 22 dias úteis de férias.
 *
 * O gozo conta-se em DIAS ÚTEIS (2.ª a 6.ª feira), excluindo os feriados que o
 * chamador passa. Este motor NÃO tem tabela de feriados embutida, com uma única
 * excepção documentada: exporta `FERIADOS_NACIONAIS_FIXOS`, os 10 feriados
 * nacionais de DATA FIXA. Os feriados MÓVEIS (Sexta-feira Santa, Páscoa, Corpo
 * de Deus) dependem da Páscoa e são responsabilidade do chamador - se os quiser
 * excluir, acrescenta-os ao array `feriados`. Feriados municipais idem.
 */

const MS_DIA = 86400000;

function pad(n) { return String(n).padStart(2, '0'); }

/** Date UTC -> 'YYYY-MM-DD'. */
export function iso(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

/**
 * Parse de 'YYYY-MM-DD' para Date UTC, REJEITANDO datas impossíveis. Date.UTC
 * normaliza silenciosamente 2026-02-31 -> 2026-03-03; validamos por round-trip.
 */
export function parseData(s) {
  if (typeof s !== 'string') throw new Error(`data inválida: ${JSON.stringify(s)}`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`data deve ser 'YYYY-MM-DD': ${s}`);
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) {
    throw new Error(`data impossível: ${s}`);
  }
  return d;
}

function assertAno(ano) {
  if (!Number.isInteger(ano)) throw new Error(`ano deve ser um inteiro: ${JSON.stringify(ano)}`);
  if (ano < 1900 || ano > 3000) throw new Error(`ano fora do intervalo razoável: ${ano}`);
  return ano;
}

function addDias(d, n) { return new Date(d.getTime() + n * MS_DIA); }

function isFimDeSemana(d) { const w = d.getUTCDay(); return w === 0 || w === 6; }

/**
 * Os 10 feriados nacionais de DATA FIXA (obrigatórios), como 'MM-DD'. Os feriados
 * MÓVEIS (Sexta-feira Santa, Domingo de Páscoa, Corpo de Deus) NÃO constam desta
 * lista de propósito - dependem da Páscoa e são passados pelo chamador quando
 * relevantes. Ordem cronológica.
 */
export const FERIADOS_NACIONAIS_FIXOS = [
  '01-01', // Ano Novo
  '04-25', // Dia da Liberdade
  '05-01', // Dia do Trabalhador
  '06-10', // Dia de Portugal
  '08-15', // Assunção de Nossa Senhora
  '10-05', // Implantação da República
  '11-01', // Todos os Santos
  '12-01', // Restauração da Independência
  '12-08', // Imaculada Conceição
  '12-25', // Natal
];

/**
 * Expande `FERIADOS_NACIONAIS_FIXOS` para um ano concreto: 2026 -> ['2026-01-01',
 * ...]. Conveniência para o chamador que só quer os feriados de data fixa de um
 * ano (os móveis continuam por sua conta). NÃO valida o ano - devolve strings.
 */
export function expandirFeriadosFixos(ano) {
  assertAno(ano);
  return FERIADOS_NACIONAIS_FIXOS.map((mmdd) => `${ano}-${mmdd}`);
}

/**
 * Conta os DIAS ÚTEIS (2.ª a 6.ª feira) entre `inicio` e `fim`, INCLUSIVE em
 * ambos os extremos, excluindo os feriados dados (array de 'YYYY-MM-DD'). Um
 * intervalo invertido (fim < inicio) conta 0. As datas interpretam-se em UTC, o
 * que torna a contagem independente do fuso do chamador.
 *
 * @param {string} inicio 'YYYY-MM-DD'
 * @param {string} fim 'YYYY-MM-DD'
 * @param {string[]} [feriados] datas 'YYYY-MM-DD' a excluir (fins-de-semana já saltam)
 * @returns {number}
 */
export function diasUteisEntre(inicio, fim, feriados = []) {
  const ini = parseData(inicio);
  const end = parseData(fim);
  if (end.getTime() < ini.getTime()) return 0;
  const feriadoSet = new Set(Array.isArray(feriados) ? feriados : []);
  let count = 0;
  for (let cur = ini; cur.getTime() <= end.getTime(); cur = addDias(cur, 1)) {
    if (isFimDeSemana(cur)) continue;
    if (feriadoSet.has(iso(cur))) continue;
    count += 1;
  }
  return count;
}

/**
 * Número de meses COMPLETOS do contrato dentro do ano civil da admissão. Um mês
 * civil `m` conta como completo se o contrato já vigora no seu primeiro dia, ou
 * seja se a data de admissão for <= 1.º dia do mês `m`. Assim uma admissão a
 * 1 do mês inclui esse mês; a meio do mês só conta a partir do mês seguinte.
 */
function mesesCompletosNoAnoAdmissao(admissao, ano) {
  let meses = 0;
  for (let m = 0; m < 12; m += 1) {
    const primeiroDoMes = new Date(Date.UTC(ano, m, 1));
    if (admissao.getTime() <= primeiroDoMes.getTime()) meses += 1;
  }
  return meses;
}

/**
 * Direito a férias de uma pessoa num ano civil, à luz do Código do Trabalho.
 *
 *  - Ano da admissão (art. 239.º n.º 1): 2 dias úteis por mês COMPLETO de
 *    contrato no ano, até 20; gozáveis após 6 meses de execução.
 *  - Anos seguintes (art. 238.º n.º 1): 22 dias úteis.
 *  - Anos anteriores à admissão: sem direito (0) - o contrato ainda não existia.
 *
 * @param {{ dataAdmissao: string, ano: number }} input
 * @returns {{ dias: number, regra: string, ano: number, dataAdmissao: string, passos: string[] }}
 */
export function direitoFerias(input = {}) {
  const admissao = parseData(input && input.dataAdmissao);
  const ano = assertAno(input && input.ano);
  const anoAdmissao = admissao.getUTCFullYear();
  const passos = [];

  if (ano < anoAdmissao) {
    passos.push(`Ano ${ano} é anterior à admissão (${iso(admissao)}): o contrato ainda não vigorava.`);
    passos.push('Sem direito a férias neste ano: 0 dias úteis.');
    return { dias: 0, regra: 'sem direito (anterior à admissão)', ano, dataAdmissao: iso(admissao), passos };
  }

  if (ano === anoAdmissao) {
    const meses = mesesCompletosNoAnoAdmissao(admissao, ano);
    const bruto = meses * 2;
    const dias = Math.min(20, bruto);
    passos.push(`Ano da admissão (${anoAdmissao}): aplica-se o art. 239.º n.º 1.`);
    passos.push(`Meses completos de contrato no ano (admissão ${iso(admissao)}): ${meses}.`);
    passos.push(`2 dias úteis por mês completo: ${meses} x 2 = ${bruto} dias úteis.`);
    passos.push(
      bruto > 20
        ? `Limite legal de 20 dias no ano da admissão: ${bruto} -> 20 dias úteis.`
        : `Abaixo do limite de 20 dias: ${dias} dias úteis.`,
    );
    passos.push('O gozo só pode ter lugar após 6 meses de execução do contrato.');
    return { dias, regra: 'art. 239.º n.º 1', ano, dataAdmissao: iso(admissao), passos };
  }

  // Anos seguintes ao da admissão.
  passos.push(`Ano posterior ao da admissão (admissão em ${anoAdmissao}): aplica-se o art. 238.º n.º 1.`);
  passos.push('Direito anual completo: 22 dias úteis.');
  return { dias: 22, regra: 'art. 238.º n.º 1', ano, dataAdmissao: iso(admissao), passos };
}

/**
 * A parte de uma ausência que cai DENTRO do ano civil `ano`, em dias úteis. A
 * ausência é aparada (clip) às fronteiras do ano antes de contar, para que uma
 * ausência a cavalo de dois anos só desconte a fatia do ano em causa. Devolve
 * também as datas aparadas, para os `passos`.
 */
function uteisNoAno(ausencia, ano, feriados) {
  const iniAno = `${ano}-01-01`;
  const fimAno = `${ano}-12-31`;
  const ini = String(ausencia.dataInicio) < iniAno ? iniAno : String(ausencia.dataInicio);
  const fim = String(ausencia.dataFim) > fimAno ? fimAno : String(ausencia.dataFim);
  // Fora do ano por completo -> intervalo invertido -> 0.
  const dias = diasUteisEntre(ini, fim, feriados);
  return { ini, fim, dias };
}

/**
 * Saldo de férias de uma pessoa num ano: quanto já gozou (ausências de férias
 * APROVADAS, aparadas ao ano) e quanto lhe resta face ao `direito`.
 *
 * Filtra defensivamente: só contam as ausências `tipo === 'ferias'` e
 * `estado === 'aprovada'`. As restantes (pedidas, baixas, formações) são
 * ignoradas. As ausências a cavalo do ano são aparadas às fronteiras do ano.
 *
 * @param {{ direito: number, ausenciasAprovadas: Array<{tipo?:string,estado?:string,dataInicio:string,dataFim:string}>, ano: number, feriados?: string[] }} input
 * @returns {{ gozados: number, saldo: number, direito: number, ano: number, passos: string[] }}
 */
export function saldoFerias(input = {}) {
  const ano = assertAno(input && input.ano);
  const direito = input && input.direito;
  if (typeof direito !== 'number' || !Number.isFinite(direito) || direito < 0) {
    throw new Error(`direito inválido (dias úteis, >= 0): ${JSON.stringify(direito)}`);
  }
  const feriados = Array.isArray(input && input.feriados) ? input.feriados : [];
  const ausencias = Array.isArray(input && input.ausenciasAprovadas) ? input.ausenciasAprovadas : [];

  const relevantes = ausencias.filter((a) => a && a.tipo === 'ferias' && a.estado === 'aprovada');

  const passos = [`Direito no ano ${ano}: ${direito} dias úteis.`];
  let gozados = 0;
  if (relevantes.length === 0) {
    passos.push('Sem férias aprovadas a descontar neste ano.');
  } else {
    for (const a of relevantes) {
      const { ini, fim, dias } = uteisNoAno(a, ano, feriados);
      gozados += dias;
      if (dias > 0) {
        passos.push(`Férias aprovadas ${ini} a ${fim}: ${dias} dias úteis.`);
      } else {
        passos.push(`Férias aprovadas ${String(a.dataInicio)} a ${String(a.dataFim)}: 0 dias úteis no ano ${ano}.`);
      }
    }
    passos.push(`Total gozado no ano: ${gozados} dias úteis.`);
  }
  const saldo = direito - gozados;
  passos.push(`Saldo (direito - gozado): ${direito} - ${gozados} = ${saldo} dias úteis.`);

  return { gozados, saldo, direito, ano, passos };
}
