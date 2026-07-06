/**
 * Motor de agenda e marcações - DETERMINÍSTICO, sem relógio interno (o `agora`
 * é sempre passado pelo chamador, como em prazo.mjs). Gera os intervalos livres
 * ("slots") de um tipo de sessão a partir das disponibilidades de TODOS os
 * participantes necessários, subtraindo eventos, ausências e reservas activas; e
 * decide, no momento do pagamento, se uma reserva ainda pode ser confirmada
 * (guarda anti-duplicação). NÃO decide regras de negócio de preço/pagamento -
 * recebe os dados e calcula.
 *
 * Convenções de tempo (todas WALL-CLOCK, sem fuso):
 *  - Datas só-de-dia: 'YYYY-MM-DD'.
 *  - Instantes: 'YYYY-MM-DDTHH:mm:ss' (as reservas e os slots usam este formato).
 *  - Janelas de disponibilidade: { horaInicio:'HH:MM', horaFim:'HH:MM' }.
 *  - `agora`: um instante ISO. É comparado com os slots/reservas como RELÓGIO DE
 *    PAREDE (os componentes Y/M/D/h/m são lidos e comparados directamente,
 *    ignorando o fuso). O chamador deve passar `agora`, os slots e as reservas
 *    no MESMO referencial - o frontend passa o `agora` local; um backend passa o
 *    instante do callback. Esta escolha mantém o motor determinístico e livre de
 *    surpresas de fuso, à custa de exigir coerência ao chamador (documentado).
 *
 * `diaSemana` segue a convenção JS: 0=Domingo, 1=Segunda, ... 6=Sábado.
 */

const MIN_DIA = 1440;

/** Estados de reserva que OCUPAM um slot (bloqueiam nova marcação). */
export const ESTADOS_OCUPAM = Object.freeze(['hold', 'pendente_pagamento', 'confirmada']);

/* ----------------------------- utilitários ------------------------------- */

function pad2(n) { return String(n).padStart(2, '0'); }

/** 'HH:MM' -> minutos desde a meia-noite. Rejeita formatos inválidos. */
export function hhmmParaMin(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) throw new Error(`hora deve ser 'HH:MM': ${s}`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new Error(`hora impossível: ${s}`);
  return h * 60 + mi;
}

/** minutos desde a meia-noite -> 'HH:MM'. */
export function minParaHhmm(min) {
  const m = ((min % MIN_DIA) + MIN_DIA) % MIN_DIA;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Lê 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm[:ss]' e devolve um número de MINUTOS
 * comparável (relógio de parede, fuso ignorado): dias-desde-época * 1440 +
 * minutos-do-dia. Determinístico e monótono para comparações de instantes.
 * Devolve NaN se não reconhecer a cadeia.
 */
export function instanteParaMin(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || '').trim());
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = m[4] === undefined ? 0 : Number(m[4]);
  const mi = m[5] === undefined ? 0 : Number(m[5]);
  // Date.UTC dá-nos os dias-desde-época de forma determinística e independente
  // do fuso da máquina; convertemos a minutos e somamos os minutos-do-dia.
  const diasMin = Math.floor(Date.UTC(y, mo - 1, d) / 60000);
  return diasMin + h * 60 + mi;
}

/** Data ('YYYY-MM-DD') -> dia da semana (0=Dom..6=Sáb), fuso-independente. */
export function diaDaSemana(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) throw new Error(`data deve ser 'YYYY-MM-DD': ${dateStr}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** Itera os dias de `deDate` a `ateDate` (inclusive). Cap de segurança de 366. */
export function diasNoIntervalo(deDate, ateDate) {
  const ini = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(deDate || '').trim());
  const fim = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ateDate || '').trim());
  if (!ini || !fim) throw new Error('deDate/ateDate devem ser \'YYYY-MM-DD\'');
  let cur = Date.UTC(Number(ini[1]), Number(ini[2]) - 1, Number(ini[3]));
  const end = Date.UTC(Number(fim[1]), Number(fim[2]) - 1, Number(fim[3]));
  const out = [];
  let guarda = 0;
  while (cur <= end && guarda < 366) {
    const d = new Date(cur);
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
    cur += MIN_DIA * 60000;
    guarda += 1;
  }
  return out;
}

/* Normaliza um array de janelas para pares de minutos [inicio,fim), ordenado. */
function janelasParaMin(janelas) {
  return (Array.isArray(janelas) ? janelas : [])
    .map((w) => {
      try {
        const a = hhmmParaMin(w.horaInicio ?? w.inicio);
        const b = hhmmParaMin(w.horaFim ?? w.fim);
        return b > a ? [a, b] : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((x, y) => x[0] - y[0]);
}

function minParaJanelas(pares) {
  return pares.map(([a, b]) => ({ inicio: minParaHhmm(a), fim: minParaHhmm(b) }));
}

/**
 * Interseção de dois conjuntos de janelas diárias. Cada argumento é um array de
 * { inicio:'HH:MM', fim:'HH:MM' } (ou { horaInicio, horaFim }); devolve os
 * intervalos onde AMBOS têm cobertura, no mesmo formato { inicio, fim } 'HH:MM'.
 */
export function intersectWindows(janelasA, janelasB) {
  const a = janelasParaMin(janelasA);
  const b = janelasParaMin(janelasB);
  const out = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi > lo) out.push([lo, hi]);
    }
  }
  out.sort((x, y) => x[0] - y[0]);
  return minParaJanelas(out);
}

/** Interseção de N conjuntos de janelas. Vazio se a lista for vazia. */
function intersectManyWindows(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return [];
  let acc = minParaJanelas(janelasParaMin(lista[0]));
  for (let i = 1; i < lista.length; i += 1) {
    acc = intersectWindows(acc, lista[i]);
    if (acc.length === 0) break;
  }
  return acc;
}

/* Uma ausência APROVADA cobre o dia `dateStr` para `pessoaId`? */
function ausenciaCobre(ausencias, pessoaId, dateStr) {
  const dia = instanteParaMin(dateStr);
  return (Array.isArray(ausencias) ? ausencias : []).some((a) => {
    if (!a || a.pessoaId !== pessoaId || a.estado !== 'aprovada') return false;
    const ini = instanteParaMin(a.dataInicio);
    const fim = instanteParaMin(a.dataFim);
    return Number.isFinite(ini) && Number.isFinite(fim) && dia >= ini && dia <= fim;
  });
}

/* Uma audiência (evento tipo 'audiencia' com pessoaIds) ocupa o dia todo de `pessoaId`? */
function audienciaBloqueia(eventos, pessoaId, dateStr) {
  return (Array.isArray(eventos) ? eventos : []).some((e) => {
    if (!e || e.tipo !== 'audiencia' || e.data !== dateStr) return false;
    return Array.isArray(e.pessoaIds) && e.pessoaIds.includes(pessoaId);
  });
}

/**
 * Um slot { inicio, fim } (ISO) está LIVRE de reservas activas?
 * `exceptId` exclui uma reserva da verificação (a própria, ao confirmar).
 */
export function slotLivre(slot, reservas, exceptId) {
  const s = instanteParaMin(slot && slot.inicio);
  const e = instanteParaMin(slot && slot.fim);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return !(Array.isArray(reservas) ? reservas : []).some((r) => {
    if (!r || (exceptId != null && r.id === exceptId)) return false;
    if (!ESTADOS_OCUPAM.includes(r.estado)) return false;
    const rs = instanteParaMin(r.inicio);
    const re = instanteParaMin(r.fim);
    if (!Number.isFinite(rs) || !Number.isFinite(re)) return false;
    return s < re && rs < e; // sobreposição de intervalos
  });
}

/**
 * Recheck do momento de confirmação: a reserva `exceptId` ainda pode ser
 * confirmada no seu slot, ou outra reserva activa entretanto ocupou-o?
 * Devolve true se o slot continua livre (excluindo a própria).
 */
export function confirmarPossivel({ slot, reservas, exceptId } = {}) {
  return slotLivre(slot, reservas, exceptId);
}

/**
 * Gera os slots livres de um tipo de sessão num intervalo de dias.
 *
 * @param {object} input
 *  - sessaoTipo: { duracaoMin, bufferMin?, participantesNecessarios:[pessoaId] }
 *  - disponibilidades: [{ pessoaId, diaSemana 0-6, horaInicio, horaFim }]
 *  - eventos: [{ data 'YYYY-MM-DD', tipo, pessoaIds? }] (só 'audiencia' com
 *    pessoaIds bloqueia o dia; os restantes ignoram-se - documentado)
 *  - ausencias: [{ pessoaId, dataInicio, dataFim, estado }] (só 'aprovada' conta)
 *  - reservas: [{ inicio, fim, estado }] (activas ocupam o slot)
 *  - deDate, ateDate: 'YYYY-MM-DD' inclusive
 *  - agora: instante ISO - slots que começam ANTES são descartados
 * @returns {{inicio:string, fim:string}[]} slots 'YYYY-MM-DDTHH:mm:ss', ordenados
 */
export function gerarSlots(input) {
  const {
    sessaoTipo, disponibilidades = [], eventos = [], ausencias = [], reservas = [],
    deDate, ateDate, agora,
  } = input || {};

  if (!sessaoTipo || typeof sessaoTipo !== 'object') return [];
  const duracao = Number(sessaoTipo.duracaoMin);
  if (!Number.isInteger(duracao) || duracao <= 0) return [];
  const buffer = Number.isInteger(Number(sessaoTipo.bufferMin)) ? Number(sessaoTipo.bufferMin) : 0;
  const passo = duracao + Math.max(0, buffer);

  const participantes = (Array.isArray(sessaoTipo.participantesNecessarios)
    ? sessaoTipo.participantesNecessarios
    : []).filter(Boolean);
  // Sem participantes obrigatórios não há como garantir presença - sem slots.
  if (participantes.length === 0) return [];

  const agoraMin = instanteParaMin(agora);
  const dias = diasNoIntervalo(deDate, ateDate);
  const slots = [];

  for (const dateStr of dias) {
    const dow = diaDaSemana(dateStr);

    // Janelas de cada participante nesse dia da semana, subtraindo ausências
    // aprovadas e audiências (dia todo). Se algum participante não tiver
    // qualquer janela, o dia não produz slots (a interseção seria vazia).
    let diaViavel = true;
    const janelasPorParticipante = [];
    for (const p of participantes) {
      if (ausenciaCobre(ausencias, p, dateStr) || audienciaBloqueia(eventos, p, dateStr)) {
        diaViavel = false;
        break;
      }
      const janelas = disponibilidades
        .filter((d) => d && d.pessoaId === p && Number(d.diaSemana) === dow)
        .map((d) => ({ horaInicio: d.horaInicio, horaFim: d.horaFim }));
      if (janelas.length === 0) { diaViavel = false; break; }
      janelasPorParticipante.push(janelas);
    }
    if (!diaViavel) continue;

    const intersecao = intersectManyWindows(janelasPorParticipante);
    for (const janela of intersecao) {
      const wIni = hhmmParaMin(janela.inicio);
      const wFim = hhmmParaMin(janela.fim);
      for (let start = wIni; start + duracao <= wFim; start += passo) {
        const slot = {
          inicio: `${dateStr}T${minParaHhmm(start)}:00`,
          fim: `${dateStr}T${minParaHhmm(start + duracao)}:00`,
        };
        // Descarta slots já passados (relógio de parede) e slots ocupados.
        if (Number.isFinite(agoraMin) && instanteParaMin(slot.inicio) < agoraMin) continue;
        if (!slotLivre(slot, reservas)) continue;
        slots.push(slot);
      }
    }
  }

  slots.sort((a, b) => instanteParaMin(a.inicio) - instanteParaMin(b.inicio));
  return slots;
}

/* ----------------------- decisão de pagamento (pura) --------------------- */

/**
 * Decide o que fazer quando chega um callback de pagamento (ou uma simulação de
 * dev): localiza a reserva por `ref` (pagamento.ref) OU `orderId` (id), verifica
 * que está 'pendente_pagamento' e re-verifica a disponibilidade do slot.
 *
 * PURA: não escreve nada - devolve a decisão para o chamador (backend ou botão
 * de simulação) aplicar de forma idêntica. É a ÚNICA fonte da regra de
 * confirmação, testada em vitest e partilhada pelos dois caminhos.
 *
 * @returns {{ encontrada:boolean, reservaId?:string, decisao:'confirmar'|'cancelar_sobreposicao'|'ignorar', motivo:string }}
 */
export function decidirConfirmacao({ reservas, ref, orderId } = {}) {
  const lista = Array.isArray(reservas) ? reservas : [];
  const alvo = lista.find(
    (r) => r && ((ref != null && r.pagamento && r.pagamento.ref === ref) || (orderId != null && r.id === orderId)),
  );
  if (!alvo) return { encontrada: false, decisao: 'ignorar', motivo: 'reserva não encontrada' };
  // Um hold que expirou ANTES de o callback chegar ainda é confirmável: o
  // pagamento aconteceu de facto; se o horário continuar livre, confirma-se.
  // (Um callback repetido sobre uma reserva já confirmada continua a ser no-op.)
  if (alvo.estado !== 'pendente_pagamento' && alvo.estado !== 'expirada') {
    return { encontrada: true, reservaId: alvo.id, decisao: 'ignorar', motivo: `estado ${alvo.estado} - não aguarda pagamento` };
  }
  const livre = confirmarPossivel({ slot: { inicio: alvo.inicio, fim: alvo.fim }, reservas: lista, exceptId: alvo.id });
  if (!livre) {
    return { encontrada: true, reservaId: alvo.id, decisao: 'cancelar_sobreposicao', motivo: 'outra reserva ocupou o horário entretanto' };
  }
  return { encontrada: true, reservaId: alvo.id, decisao: 'confirmar', motivo: 'pagamento confirmado; horário livre' };
}

/**
 * Constrói o evento de agenda a criar quando uma reserva é confirmada. Determinístico
 * para que backend e simulação escrevam a MESMA linha.
 */
export function construirEventoDeReserva(reserva, sessaoTipo) {
  const data = String((reserva && reserva.inicio) || '').slice(0, 10);
  const nome = (reserva && reserva.nome) || 'Cliente';
  const nomeTipo = (sessaoTipo && sessaoTipo.nome) || 'Sessão';
  return {
    data,
    inicio: reserva && reserva.inicio,
    fim: reserva && reserva.fim,
    titulo: `Reserva: ${nomeTipo} - ${nome}`,
    tipo: 'reserva',
    sessaoTipoId: reserva && reserva.sessaoTipoId,
    reservaId: reserva && reserva.id,
    pessoaIds: Array.isArray(sessaoTipo && sessaoTipo.participantesNecessarios)
      ? sessaoTipo.participantesNecessarios.filter(Boolean)
      : [],
  };
}

/**
 * Constrói o crédito de conta-corrente de um pagamento confirmado, ou null se a
 * reserva não trouxer valor.
 */
export function construirCreditoDeReserva(reserva, { clienteId } = {}) {
  const valor = reserva && reserva.pagamento && Number(reserva.pagamento.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return {
    // Sem clienteId o crédito ficaria invisível na conta corrente das Finanças
    // (que filtra por cliente): o chamador resolve-o (reserva.clienteId ou
    // correspondência por email nos clientes) e as Finanças mostram os
    // movimentos por associar num grupo próprio.
    clienteId: clienteId || (reserva && reserva.clienteId) || null,
    tipo: 'credito',
    origem: 'pagamento',
    valor,
    refExterna: (reserva.pagamento && reserva.pagamento.ref) || null,
    reservaId: reserva.id,
    nomeReserva: (reserva && reserva.nome) || null,
    data: (reserva.inicio ? String(reserva.inicio).slice(0, 10) : null),
  };
}

/**
 * Varredura barata de holds expirados: reservas 'hold'/'pendente_pagamento' cujo
 * `expiraEm` já passou (relativamente a `agora`). Devolve os ids a marcar
 * 'expirada'. Uma reserva sem `expiraEm` nunca expira por aqui.
 */
export function holdsExpirados(reservas, agora) {
  const agoraMin = instanteParaMin(agora);
  if (!Number.isFinite(agoraMin)) return [];
  return (Array.isArray(reservas) ? reservas : [])
    .filter((r) => {
      if (!r || (r.estado !== 'hold' && r.estado !== 'pendente_pagamento')) return false;
      const exp = instanteParaMin(r.expiraEm);
      return Number.isFinite(exp) && exp < agoraMin;
    })
    .map((r) => r.id)
    .filter((id) => id != null);
}

/**
 * AGENDA PÚBLICA (privacidade): a página pública de reservas NUNCA pode ler as
 * colecções privadas (reservas de outros clientes, eventos, disponibilidades,
 * ausências) - os dados chegariam ao browser de qualquer visitante anónimo.
 * Em alternativa, a app de equipa (e o backend, em cada invocação) publicam
 * uma colecção SANEADA `agenda_publica` com apenas {sessaoTipoId, inicio, fim}
 * dos horários LIVRES dos tipos públicos. Esta função constrói essas linhas.
 */
export function construirAgendaPublica({ sessaoTipos, disponibilidades, eventos, ausencias, reservas, deDate, ateDate, agora } = {}) {
  const tipos = (Array.isArray(sessaoTipos) ? sessaoTipos : []).filter((t) => t && t.publico);
  const linhas = [];
  for (const sessaoTipo of tipos) {
    const slots = gerarSlots({ sessaoTipo, disponibilidades, eventos, ausencias, reservas, deDate, ateDate, agora });
    for (const slot of slots) {
      linhas.push({ sessaoTipoId: sessaoTipo.id, inicio: slot.inicio, fim: slot.fim });
    }
  }
  return linhas;
}
