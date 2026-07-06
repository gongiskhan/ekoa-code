/**
 * Motor de prazos (CPC/CIRE portugueses) — DETERMINÍSTICO, zero retrieval, datas
 * explícitas (sem relógio interno). Mostra o seu trabalho (`passos`) para o
 * advogado validar, e oferece `parallelRun` para comparar com uma contagem
 * manual. NÃO decide regras jurídicas: recebe (dias, contagem, suspendeFerias,
 * regime) e calcula. Em caso de dúvida, prefere falhar (datas impossíveis lançam
 * erro) a devolver um prazo silenciosamente errado.
 *
 * Regras implementadas (Portugal):
 *  - O prazo começa a correr no dia SEGUINTE à notificação (art. 138.º CPC).
 *  - Dias úteis: saltam sábados, domingos, feriados nacionais e — se
 *    suspendeFerias — as férias judiciais. Dias corridos: dias de calendário.
 *  - Se o termo cair em dia não útil, transfere para o 1.º dia útil seguinte
 *    (regra geral do termo — Código Civil art. 279.º al. e)).
 *  - Janela de multa (art. 139.º n.º 5): o acto ainda pode praticar-se nos
 *    PRIMEIROS 3 DIAS ÚTEIS seguintes ao termo (sempre úteis, independentemente
 *    da contagem do prazo principal).
 *
 * Regime (`regime`): 'cpc' (por omissão) mantém o comportamento acima. 'cire'
 * (processos de insolvência) NÃO suspende os prazos em férias judiciais — o
 * processo é urgente e corre em férias (CIRE art. 9.º n.º 1); os fins-de-semana
 * e feriados no termo continuam a transferir para o 1.º dia útil seguinte pela
 * regra geral (Código Civil art. 279.º al. e)).
 */

const MS_DIA = 86400000;

function pad(n) { return String(n).padStart(2, '0'); }
export function iso(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

/**
 * Faz parse de 'YYYY-MM-DD' para Date UTC, REJEITANDO datas impossíveis. Date.UTC
 * normaliza silenciosamente 2026-02-31 -> 2026-03-03; validamos por round-trip.
 */
export function parseData(s) {
  if (typeof s !== 'string') throw new Error(`data inválida: ${s}`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`data deve ser 'YYYY-MM-DD': ${s}`);
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) {
    throw new Error(`data impossível: ${s}`);
  }
  return d;
}

function addDias(d, n) { return new Date(d.getTime() + n * MS_DIA); }

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) — Date UTC. */
export function domingoPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mth = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * mth + 114) / 31);
  const dia = ((h + l - 7 * mth + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Feriados nacionais obrigatórios de um ano (Set de 'YYYY-MM-DD'). Fixos + móveis. */
export function feriadosNacionais(ano) {
  const pascoa = domingoPascoa(ano);
  const set = new Set([
    `${ano}-01-01`, // Ano Novo
    `${ano}-04-25`, // Dia da Liberdade
    `${ano}-05-01`, // Dia do Trabalhador
    `${ano}-06-10`, // Dia de Portugal
    `${ano}-08-15`, // Assunção de Nossa Senhora
    `${ano}-10-05`, // Implantação da República
    `${ano}-11-01`, // Todos os Santos
    `${ano}-12-01`, // Restauração da Independência
    `${ano}-12-08`, // Imaculada Conceição
    `${ano}-12-25`, // Natal
    iso(addDias(pascoa, -2)), // Sexta-feira Santa
    iso(pascoa), // Domingo de Páscoa
    iso(addDias(pascoa, 60)), // Corpo de Deus (Páscoa + 60)
  ]);
  return set;
}

/**
 * Férias judiciais (Lei da Organização do Sistema Judiciário, art. 28.º):
 *  22 Dez – 3 Jan, Domingo de Ramos – 2.ª-feira de Páscoa, 16 Jul – 31 Ago.
 */
export function isFeriasJudiciais(d) {
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  // 16 Jul – 31 Ago
  if ((mes === 7 && dia >= 16) || mes === 8) return true;
  // 22 Dez – 31 Dez e 1 Jan – 3 Jan
  if (mes === 12 && dia >= 22) return true;
  if (mes === 1 && dia <= 3) return true;
  // Domingo de Ramos (Páscoa - 7) a 2.ª-feira de Páscoa (Páscoa + 1)
  const pascoa = domingoPascoa(ano);
  const ramos = addDias(pascoa, -7);
  const segPascoa = addDias(pascoa, 1);
  if (d.getTime() >= ramos.getTime() && d.getTime() <= segPascoa.getTime()) return true;
  return false;
}

export function isFimDeSemana(d) { const w = d.getUTCDay(); return w === 0 || w === 6; }
export function isFeriado(d) { return feriadosNacionais(d.getUTCFullYear()).has(iso(d)); }
/** Dia útil = não é fim-de-semana nem feriado nacional. */
export function isDiaUtil(d) { return !isFimDeSemana(d) && !isFeriado(d); }

function motivoNaoUtil(d, considerarFerias) {
  if (isFimDeSemana(d)) return d.getUTCDay() === 6 ? 'sábado' : 'domingo';
  if (isFeriado(d)) return 'feriado nacional';
  if (considerarFerias && isFeriasJudiciais(d)) return 'férias judiciais';
  return null;
}

/** Próximo dia útil (>= d se inclusivo, senão > d). Salta férias se considerarFerias. */
function proximoDiaUtil(d, considerarFerias, inclusivo) {
  let cur = inclusivo ? d : addDias(d, 1);
  while (isFimDeSemana(cur) || isFeriado(cur) || (considerarFerias && isFeriasJudiciais(cur))) {
    cur = addDias(cur, 1);
  }
  return cur;
}

/**
 * Calcula um prazo.
 * @param {object} input
 *  - dataNotificacao: 'YYYY-MM-DD' (a notificação)
 *  - dias: número de dias do prazo
 *  - regime: 'cpc' (por omissão) | 'cire'. Regimes de contagem por diploma:
 *    'cpc' mantém EXACTAMENTE o comportamento histórico deste motor;
 *    'cire' aplica o art. 9.º n.º 1 do CIRE - os prazos são contínuos e NÃO
 *    se suspendem durante as férias judiciais (contagem corrida); o termo em
 *    dia não útil transfere-se para o 1.º dia útil seguinte (art. 279.º
 *    al. e) do Código Civil, ex vi art. 9.º do CIRE). Entradas explícitas
 *    (`contagem`/`suspendeFerias`) prevalecem sobre o preset do regime.
 *  - contagem: 'uteis' (por omissão no regime cpc) | 'corridos'
 *  - suspendeFerias: por omissão true para 'uteis' (os prazos processuais
 *    suspendem-se em férias judiciais), false para 'corridos'
 * @returns { dataLimite, multaAte, contagem, dias, suspendeFerias, regime, passos }
 */
export function computePrazo(input) {
  const { dataNotificacao, dias } = input;
  // Fail-fast (contrato do motor): um regime desconhecido NUNCA cai
  // silenciosamente no CPC - um 'CIRE' mal escrito devolveria um prazo
  // semanas depois do real.
  if (input.regime !== undefined && input.regime !== null && input.regime !== 'cpc' && input.regime !== 'cire') {
    throw new Error(`regime desconhecido: ${String(input.regime)} (use 'cpc' ou 'cire')`);
  }
  const regime = input.regime === 'cire' ? 'cire' : 'cpc';
  // `contagem` é validada com a mesma disciplina: null/'' contam como AUSENTE
  // (formularios serializados enviam null); qualquer outro valor fora do enum
  // lança, para nunca derrotar o preset do regime em silêncio.
  const contagemRaw = input.contagem === null || input.contagem === '' ? undefined : input.contagem;
  if (contagemRaw !== undefined && contagemRaw !== 'uteis' && contagemRaw !== 'corridos') {
    throw new Error(`contagem inválida: ${String(input.contagem)} (use 'uteis' ou 'corridos')`);
  }
  const presetContagem = regime === 'cire' ? 'corridos' : undefined;
  const presetSuspende = regime === 'cire' ? false : undefined;
  const contagemInput = contagemRaw === undefined ? presetContagem : contagemRaw;
  const suspendeInput = input.suspendeFerias === undefined || input.suspendeFerias === null ? presetSuspende : input.suspendeFerias;
  const contagem = contagemInput === 'corridos' ? 'corridos' : 'uteis';
  const suspendeFerias = suspendeInput === undefined ? contagem === 'uteis' : Boolean(suspendeInput);

  if (!Number.isInteger(dias) || dias <= 0) throw new Error(`dias deve ser um inteiro positivo: ${dias}`);
  const notif = parseData(dataNotificacao);

  const passos = [];
  passos.push({ data: iso(notif), nota: 'notificação (não conta; o prazo começa no dia seguinte)' });

  let dataLimite;
  if (contagem === 'uteis') {
    // Conta `dias` dias úteis a partir do dia seguinte à notificação.
    let cur = notif;
    let contados = 0;
    while (contados < dias) {
      cur = addDias(cur, 1);
      const motivo = motivoNaoUtil(cur, suspendeFerias);
      if (motivo) { passos.push({ data: iso(cur), util: false, motivo }); continue; }
      contados += 1;
      passos.push({ data: iso(cur), util: true, dia: contados });
    }
    dataLimite = cur;
  } else {
    // Dias corridos: `dias` dias de calendário a partir do dia seguinte.
    let cur = addDias(notif, dias);
    passos.push({ data: iso(cur), nota: `${dias} dias corridos a contar do dia seguinte` });
    // Termo em dia não útil transfere para o 1.º dia útil seguinte. O termo NÃO
    // pode cair em férias judiciais quando o prazo se suspende nelas (art. 138.º
    // n.º 2) — por isso a transferência respeita `suspendeFerias`.
    const motivo = motivoNaoUtil(cur, suspendeFerias);
    if (motivo) {
      const transferido = proximoDiaUtil(cur, suspendeFerias, false);
      passos.push({ data: iso(transferido), nota: `termo em ${motivo} -> transfere para o 1.º dia útil seguinte` });
      cur = transferido;
    }
    dataLimite = cur;
  }

  // Para 'uteis' o termo já é, por construção, um dia válido. Backstop: garantir
  // que um termo em dia não útil (incl. férias, se suspende) transferiu.
  if (motivoNaoUtil(dataLimite, suspendeFerias)) {
    dataLimite = proximoDiaUtil(dataLimite, suspendeFerias, false);
  }

  // Janela de multa (art. 139.º n.º 5): os 3 PRIMEIROS DIAS ÚTEIS após o termo —
  // sempre em dias úteis (independentemente de o prazo ser corridos), e
  // respeitando férias de forma coerente com o prazo (`suspendeFerias`).
  let multa = dataLimite;
  const multaPassos = [];
  for (let i = 0; i < 3; i += 1) {
    multa = proximoDiaUtil(multa, suspendeFerias, false);
    multaPassos.push(iso(multa));
  }

  return {
    dataNotificacao: iso(notif),
    contagem,
    dias,
    suspendeFerias,
    regime,
    dataLimite: iso(dataLimite),
    multaAte: iso(multa),
    multaDias: multaPassos,
    passos,
  };
}

/**
 * Parallel-run: corre o motor e compara com uma data-limite contada à mão.
 * Devolve { ...resultado, manual, concorda } — para o advogado validar.
 */
export function parallelRun(input, dataLimiteManual) {
  const r = computePrazo(input);
  return { ...r, manual: dataLimiteManual, concorda: r.dataLimite === dataLimiteManual };
}
