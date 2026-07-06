/*
 * Motor determinístico das Cobranças — puro, sem React nem I/O.
 *
 * É a ÚNICA fonte de verdade de:
 *   - envelhecimento (aging) da dívida por escalões de dias de atraso;
 *   - próximo passo devido de uma sequência de lembrete;
 *   - referência Multibanco de DEMONSTRAÇÃO (determinística, a partir do id);
 *   - RECONCILIAÇÃO de um pagamento na cobrança + conta corrente;
 *   - deontologia dos lembretes por WhatsApp (opção de saída obrigatória).
 *
 * É importado por DUAS espinhas que têm de concordar ao cêntimo:
 *   - o frontend (a simulação de callback em modo ?dev=1, e as vistas);
 *   - o backend `onWebhook` (o ponto de reconciliação REAL, que recebe o
 *     callback GET assinado da Ifthenpay/Stripe e credita a conta corrente).
 * Por isso NÃO importa `shared.js` (que puxa React) — mantém-se independente.
 */

/* Entidade Multibanco fixa da referência de demonstração. A confirmação real
 * chega pelo callback do fornecedor, activado com as credenciais Ifthenpay. */
export const MB_ENTIDADE = '11249';

/* Deontologia dos lembretes por WhatsApp (RGPD + Estatuto da OA): consentimento
 * prévio e opção de saída em TODAS as mensagens. */
export const WHATSAPP_CONSENT_NOTICE =
  'Mensagens WhatsApp requerem consentimento prévio do destinatário e incluem sempre a opção de deixar de receber avisos.';
export const WHATSAPP_OPTOUT_LINE =
  'Para deixar de receber estes avisos, responda REMOVER.';

/* Arredonda ao cêntimo — um pagamento é dinheiro, não uma fracção. */
export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/* Normaliza uma referência de pagamento para comparação: sem espaços, string. */
export function normalizarRef(ref) {
  return String(ref == null ? '' : ref).replace(/\s+/g, '');
}

/*
 * Dias inteiros de ATRASO de `dataVencimento` face a `hoje` (positivo = vencido
 * há N dias; <= 0 = ainda por vencer). Comparação só por data (meia-noite
 * local), segura para Europe/Lisbon; aceita 'YYYY-MM-DD' ou ISO completo.
 * `hoje` é injectado (nunca lido do topo do módulo) para o motor ser puro.
 */
export function diasAtraso(dataVencimento, hoje = new Date()) {
  const venc = parseDia(dataVencimento);
  if (!venc) return NaN;
  const ref = hoje instanceof Date ? new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()) : parseDia(hoje);
  if (!ref) return NaN;
  return Math.round((ref.getTime() - venc.getTime()) / 86400000);
}

/* Parse local de uma data (só-de-dia interpreta-se no calendário local). */
function parseDia(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* Adiciona `dias` a uma data 'YYYY-MM-DD' e devolve 'YYYY-MM-DD' local. */
export function addDias(dataStr, dias) {
  const d = parseDia(dataStr);
  if (!d) return null;
  d.setDate(d.getDate() + Number(dias || 0));
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/*
 * Escalões de envelhecimento (aging), por dias de atraso. A ordem é a de
 * apresentação; `bucketId` casa com computeAging. Um item por vencer (atraso
 * <= 0) cai no primeiro escalão, tal como um vencido há poucos dias.
 */
export const AGING_BUCKETS = [
  { id: '0-30', label: '0–30 dias', min: -Infinity, max: 30 },
  { id: '31-60', label: '31–60 dias', min: 31, max: 60 },
  { id: '61+', label: '61+ dias', min: 61, max: Infinity },
];

/* Escalão de um número de dias de atraso. */
export function agingBucket(dias) {
  if (!Number.isFinite(dias)) return null;
  for (const b of AGING_BUCKETS) {
    if (dias >= b.min && dias <= b.max) return b.id;
  }
  return null;
}

/* Uma cobrança conta para o envelhecimento? Só as EM ABERTO (por receber). */
export function emAberto(cobranca) {
  const e = cobranca && cobranca.estado;
  return e === 'pendente' || e === 'parcial';
}

/*
 * Envelhecimento da carteira: soma contagem e valor por escalão, apenas das
 * cobranças em aberto com data de vencimento válida. Devolve um mapa
 * { '0-30': { count, total }, '31-60': {...}, '61+': {...} } com todos os
 * escalões presentes (mesmo a zero) para as cartas nunca sumirem.
 */
export function computeAging(cobrancas, hoje = new Date()) {
  const acc = {};
  for (const b of AGING_BUCKETS) acc[b.id] = { count: 0, total: 0 };
  for (const c of Array.isArray(cobrancas) ? cobrancas : []) {
    if (!emAberto(c)) continue;
    const dias = diasAtraso(c.dataVencimento, hoje);
    const bucket = agingBucket(dias);
    if (!bucket) continue;
    acc[bucket].count += 1;
    acc[bucket].total = round2(acc[bucket].total + Number(c.valor || 0));
  }
  return acc;
}

/*
 * Próximo passo DEVIDO de uma sequência para uma cobrança: o primeiro passo (por
 * offsetDias crescente) cuja data agendada (vencimento + offset) seja HOJE ou no
 * futuro. Passos já ultrapassados não voltam a ser propostos. Devolve o passo
 * enriquecido com { index, dataAgendada, diasAte } ou null se todos já passaram.
 */
export function proximoPasso(passos, dataVencimento, hoje = new Date()) {
  const lista = (Array.isArray(passos) ? passos : [])
    .map((p, index) => ({ ...p, index }))
    .sort((a, b) => Number(a.offsetDias || 0) - Number(b.offsetDias || 0));
  for (const p of lista) {
    const dataAgendada = addDias(dataVencimento, p.offsetDias || 0);
    if (!dataAgendada) continue;
    const diasAte = -diasAtraso(dataAgendada, hoje); // >= 0 => hoje ou futuro
    if (diasAte >= 0) return { ...p, dataAgendada, diasAte };
  }
  return null;
}

/* Substitui as variáveis {{nome}} {{descricao}} {{valor}} num template. */
export function renderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave) => {
    const v = vars[chave];
    return v == null ? '' : String(v);
  });
}

/*
 * Pré-visualização deontológica de um passo: renderiza o template e, para o
 * canal WhatsApp, garante SEMPRE a linha de opção de saída no fim (nunca a
 * duplica). É esta a função que o editor de sequências mostra e que a app usa
 * para recusar guardar um lembrete WhatsApp sem opção de saída — porque aqui ela
 * é sempre acrescentada.
 */
export function previewTemplate(passo, vars = {}) {
  const base = renderTemplate(passo && passo.template, vars);
  if (passo && passo.canal === 'whatsapp') {
    if (normalizarTexto(base).includes(normalizarTexto(WHATSAPP_OPTOUT_LINE))) return base;
    const corpo = base.replace(/\s+$/, '');
    return `${corpo}${corpo ? '\n\n' : ''}${WHATSAPP_OPTOUT_LINE}`;
  }
  return base;
}

function normalizarTexto(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/* Um passo WhatsApp respeita a deontologia? (opção de saída garantida.) */
export function passoRespeitaOptout(passo, vars = {}) {
  if (!passo || passo.canal !== 'whatsapp') return true;
  return normalizarTexto(previewTemplate(passo, vars)).includes(normalizarTexto(WHATSAPP_OPTOUT_LINE));
}

/*
 * Referência Multibanco de DEMONSTRAÇÃO, determinística a partir do id da
 * cobrança: 8 dígitos derivados de um hash estável + 1 dígito de controlo
 * (soma dos dígitos mod 10), formatada 'XXX XXX XXX'. Não é uma referência
 * bancária real — a real é gerada pela Ifthenpay no ponto de checkpoint.
 */
export function mockReferencia(cobrancaId) {
  const s = String(cobrancaId == null ? '' : cobrancaId);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const base = String(h % 100000000).padStart(8, '0');
  let soma = 0;
  for (const ch of base) soma += Number(ch);
  const controlo = String(soma % 10);
  const ref = base + controlo; // 9 dígitos
  return `${ref.slice(0, 3)} ${ref.slice(3, 6)} ${ref.slice(6, 9)}`;
}

/* Bloco de referência de demonstração completo para gravar em refPagamento. */
export function gerarReferenciaDemo(cobranca) {
  return { entidade: MB_ENTIDADE, referencia: mockReferencia(cobranca && cobranca.id), demo: true };
}

/*
 * RECONCILIAÇÃO de um pagamento — o coração partilhado pelo dev-sim e pelo
 * backend onWebhook. Dado a cobrança encontrada (por referência), o valor pago
 * e o estado ACTUAL da conta corrente, devolve um plano determinístico:
 *
 *   { matched, motivo?, alreadyReconciled, estado, atualizarEstado, credito? }
 *
 * Regras (§3.3):
 *   - a referência do callback tem de casar com refPagamento.referencia
 *     (comparação sem espaços);
 *   - valor dentro de 0,01 do devido => 'paga'; valor menor => 'parcial';
 *   - escreve um crédito {clienteId, origem:'cobranca', valor, refExterna} —
 *     uma cobrança paga SEM o seu crédito é um erro;
 *   - IDEMPOTENTE por PAGAMENTO: nunca cria um segundo crédito com a mesma
 *     (refExterna + datahorapag); uma prestação NOVA na mesma referência é
 *     creditada e o estado deriva do total cumulativo.
 */
export function reconcileCobranca({ cobranca, referencia, valor, dataHoraPag, contaCorrente = [], agora } = {}) {
  if (!cobranca) return { matched: false, motivo: 'cobranca-inexistente' };

  const refCallback = normalizarRef(referencia);
  const refCobranca = normalizarRef(cobranca.refPagamento && cobranca.refPagamento.referencia);
  if (!refCallback || !refCobranca || refCallback !== refCobranca) {
    return { matched: false, motivo: 'referencia-nao-corresponde' };
  }

  const valorDevido = Number(cobranca.valor);
  const valorPago = valor == null ? valorDevido : Number(valor);
  const pagoValido = Number.isFinite(valorPago);

  /*
   * A identidade de UM pagamento é (referência + datahorapag): uma referência
   * Multibanco é repagável, pelo que um segundo pagamento na MESMA referência
   * (datahorapag diferente) é um pagamento NOVO e tem de ser creditado; só um
   * callback com a MESMA datahorapag é uma repetição (replay) e é um no-op.
   * Sem datahorapag (simulação/legado), degrada para "a referência já foi
   * creditada" — o comportamento antigo, seguro para o dev-sim.
   */
  const creditosDaRef = (Array.isArray(contaCorrente) ? contaCorrente : []).filter(
    (c) => c && c.origem === 'cobranca' && normalizarRef(c.refExterna) === refCallback,
  );
  const chavePagamento = normalizarRef(dataHoraPag);
  const replay = chavePagamento
    ? creditosDaRef.some((c) => normalizarRef(c.dataHoraPag) === chavePagamento)
    : creditosDaRef.length > 0;

  const totalJaCreditado = round2(creditosDaRef.reduce((s, c) => s + (Number(c.valor) || 0), 0));
  const valorEsteCredito = replay ? 0 : round2(pagoValido ? valorPago : valorDevido);
  const totalAposCallback = round2(totalJaCreditado + valorEsteCredito);

  // O estado deriva do TOTAL creditado (cumulativo), nunca só deste callback:
  // prestações sucessivas na mesma referência somam até 'paga'.
  const estado = Number.isFinite(valorDevido) && totalAposCallback >= valorDevido - 0.01
    ? 'paga'
    : 'parcial';

  const credito = replay
    ? null
    : {
      clienteId: cobranca.clienteId,
      tipo: 'credito',
      origem: 'cobranca',
      valor: valorEsteCredito,
      refExterna: cobranca.refPagamento.referencia,
      dataHoraPag: dataHoraPag || null,
      data: agora || new Date().toISOString(),
      notas: `Pagamento da cobrança ${cobranca.descricao || ''}`.trim(),
    };

  return {
    matched: true,
    alreadyReconciled: replay,
    estado,
    atualizarEstado: cobranca.estado !== estado,
    credito,
  };
}
