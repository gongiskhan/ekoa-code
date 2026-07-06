/*
 * Lógica determinística do módulo de Finanças - pura, sem rede nem persistência.
 * As páginas importam estes helpers; a persistência é sempre pela espinha
 * partilhada (window.__ekoa.shared) através de shared.js.
 */

/* Arredondamento a 2 casas, estável para cêntimos (evita a deriva do float). */
export function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* Soma de euros a 2 casas, arredondando o total (não linha-a-linha). */
export function somaEuros(values) {
  const total = (Array.isArray(values) ? values : []).reduce((acc, v) => acc + (Number(v) || 0), 0);
  return round2(total);
}

/* 'YYYY-MM-DD' de hoje, no calendário local. */
export function hojeISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/*
 * Conta corrente do cliente. Convenção de sinais: um DÉBITO é o que o escritório
 * imputa ao cliente (aumenta a dívida); um CRÉDITO é o que o cliente paga ou lhe
 * é devolvido (reduz a dívida). O saldo em dívida = Σ débitos − Σ créditos:
 * positivo = o cliente deve ao escritório, negativo = há saldo a favor do cliente.
 */
export function contaSaldo(movimentos) {
  const rows = Array.isArray(movimentos) ? movimentos : [];
  let debitos = 0;
  let creditos = 0;
  for (const r of rows) {
    const v = Number(r && r.valor) || 0;
    if (r && r.tipo === 'credito') creditos += v;
    else debitos += v;
  }
  return {
    debitos: round2(debitos),
    creditos: round2(creditos),
    saldo: round2(debitos - creditos),
  };
}

/*
 * Extrato ordenado por data (ascendente, empatando por createdAt) com o saldo
 * corrente acumulado linha-a-linha. Cada entrada devolvida traz `saldoCorrente`.
 */
export function contaExtrato(movimentos) {
  const rows = (Array.isArray(movimentos) ? movimentos : []).slice();
  rows.sort((a, b) => {
    const ka = String(a.data || '') + String(a.createdAt || '');
    const kb = String(b.data || '') + String(b.createdAt || '');
    return ka.localeCompare(kb);
  });
  let corrente = 0;
  return rows.map((r) => {
    const v = Number(r.valor) || 0;
    corrente = round2(corrente + (r.tipo === 'credito' ? -v : v));
    return { ...r, saldoCorrente: corrente };
  });
}

/* Rótulos PT-PT das categorias de despesa. */
export const CATEGORIAS = [
  { value: 'taxas', label: 'Taxas de justiça' },
  { value: 'certidoes', label: 'Certidões e registos' },
  { value: 'deslocacoes', label: 'Deslocações' },
  { value: 'peritagens', label: 'Peritagens' },
  { value: 'outras', label: 'Outras' },
];

export function categoriaLabel(value) {
  const hit = CATEGORIAS.find((c) => c.value === value);
  return hit ? hit.label : (value || '—');
}

/* Estados da despesa e a sua ordem/tom de distintivo. */
export const DESPESA_ESTADO_LABEL = {
  registada: 'Registada',
  aprovada: 'Aprovada',
  faturada: 'Faturada',
};
export const DESPESA_ESTADO_TONE = {
  registada: 'neutral',
  aprovada: 'info',
  faturada: 'ok',
};

/* Estados da provisão. */
export const PROVISAO_ESTADO_LABEL = {
  pedida: 'Pedida',
  recebida: 'Recebida',
  consumida: 'Consumida',
};
export const PROVISAO_ESTADO_TONE = {
  pedida: 'media',
  recebida: 'ok',
  consumida: 'neutral',
};

/* Origens de um movimento de conta corrente (distintivo). */
export const ORIGEM_LABEL = {
  'pre-fatura': 'Pré-fatura',
  pagamento: 'Pagamento',
  despesa: 'Despesa',
  ajuste: 'Ajuste',
  cobranca: 'Cobrança',
};
export function origemLabel(value) {
  return ORIGEM_LABEL[value] || (value || '—');
}

/*
 * Estados de um pedido de emissão certificada (faturacao_pedidos). A emissão em
 * si NUNCA acontece localmente - estes estados descrevem o pedido enquanto
 * aguarda a integração InvoiceXpress (AT).
 */
export const PEDIDO_ESTADO_LABEL = {
  emissao_pendente: 'Emissão pendente',
  aguarda_configuracao: 'Aguarda configuração InvoiceXpress',
  emitida: 'Emitida (InvoiceXpress)',
};
export const PEDIDO_ESTADO_TONE = {
  emissao_pendente: 'media',
  aguarda_configuracao: 'alta',
  emitida: 'ok',
};

/*
 * REGRA REGULATÓRIA §3.2.1 - a Ekoa NÃO emite faturas nativamente. A emissão
 * certificada (número, ATCUD, QR, comunicação à AT) passa EXCLUSIVAMENTE pela
 * integração InvoiceXpress. Estas cópias são a fonte única do texto mostrado.
 */
export const REGRA_EMISSAO = 'A Ekoa não emite faturas nativamente. A emissão certificada passa exclusivamente pela integração InvoiceXpress (Autoridade Tributária).';
export const EMISSAO_BLOQUEADA = 'A emissão certificada requer a integração InvoiceXpress configurada (AT). A Ekoa não emite faturas nativamente.';
