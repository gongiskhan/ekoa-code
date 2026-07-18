/*
 * Lógica LOCAL do Apoio Judiciário - determinística, sem I/O. Deriva vistas e
 * calcula os prazos SinOA a partir do motor de prazos vendorizado
 * (engine/prazo.mjs, cópia byte-a-byte do canónico). Nunca escreve; a escrita é
 * responsabilidade das páginas (createShared/updateShared).
 */

import { computePrazo } from '../engine/prazo.mjs';

/* ---------- Rótulos e tons ---------- */

export const TIPO_PEDIDO_LABEL = {
  proteccao_juridica: 'Protecção jurídica',
  nomeacao: 'Nomeação',
  escusa: 'Escusa',
};
export const TIPO_PEDIDO_TONE = {
  proteccao_juridica: 'info',
  nomeacao: 'accent',
  escusa: 'neutral',
};
export const TIPO_PEDIDO_OPTIONS = [
  { value: 'proteccao_juridica', label: 'Protecção jurídica' },
  { value: 'nomeacao', label: 'Nomeação (patrono)' },
  { value: 'escusa', label: 'Escusa' },
];

export const ESTADO_LABEL = {
  preparacao: 'Em preparação',
  submetido_manual: 'Submetido (manual)',
  deferido: 'Deferido',
  indeferido: 'Indeferido',
};
export const ESTADO_TONE = {
  preparacao: 'neutral',
  submetido_manual: 'info',
  deferido: 'ok',
  indeferido: 'alta',
};

/*
 * Fases de honorários do apoio judiciário. A tabela de honorários paga por fase
 * processual concluída; aqui só escolhemos a fase a que o pedido de honorários
 * respeita. Descritivo, não normativo (a compensação é fixada pela Portaria).
 */
export const FASE_OPTIONS = [
  { value: 'inicial', label: 'Diligências iniciais' },
  { value: 'instrucao', label: 'Instrução' },
  { value: 'julgamento', label: 'Audiência e julgamento' },
  { value: 'recurso', label: 'Recurso' },
];
export const FASE_LABEL = FASE_OPTIONS.reduce((acc, o) => { acc[o.value] = o.label; return acc; }, {});

/* ---------- Prazos SinOA ---------- */

/*
 * As DUAS balizas do SinOA que uma notificação de decisão desencadeia. O motor
 * de prazos mostra o seu trabalho (passos) e devolve a data-limite:
 *  - registo do pedido: 5 dias ÚTEIS (suspende em férias judiciais);
 *  - documentação: 30 dias CORRIDOS.
 * As descrições são fixas (o teste ancora-se nelas).
 */
export const SINOA_PRAZOS = [
  { descricao: 'SinOA: registo do pedido (5 dias úteis)', dias: 5, contagem: 'uteis' },
  { descricao: 'SinOA: documentação (30 dias)', dias: 30, contagem: 'corridos' },
];

/*
 * Corre o motor para as duas balizas a partir de `dataNotificacao` ('YYYY-MM-DD').
 * Devolve [{ descricao, dias, contagem, resultado }] onde `resultado` é a saída
 * completa de computePrazo (dataLimite + passos). Lança se a data for inválida
 * (prefere falhar a devolver um prazo silenciosamente errado).
 */
export function gerarPrazosSinOA(dataNotificacao) {
  return SINOA_PRAZOS.map((spec) => ({
    descricao: spec.descricao,
    dias: spec.dias,
    contagem: spec.contagem,
    resultado: computePrazo({
      dataNotificacao: String(dataNotificacao || '').trim(),
      dias: spec.dias,
      contagem: spec.contagem,
    }),
  }));
}

/*
 * Prazos ADICIONAIS por tipo de pedido, para além das duas balizas SinOA -
 * SEMPRE acrescentados DEPOIS delas (as posições 0/1 dos painéis são contrato
 * de teste). Cada um cita a norma da Lei n.º 34/2004, de 29 de julho:
 *  - nomeação: o patrono nomeado deve intentar a ação nos 30 dias seguintes à
 *    notificação da nomeação (art. 33.º; prorrogável a pedido fundamentado).
 *  - escusa: a Ordem dos Advogados decide o pedido de escusa no prazo de 15
 *    dias (art. 34.º; o pedido interrompe o prazo que estiver em curso).
 * Contagem em dias corridos - a leitura conservadora: o lembrete dispara mais
 * cedo, nunca mais tarde do que o prazo real.
 */
export const PRAZOS_TIPO_PEDIDO = {
  nomeacao: [
    {
      descricao: 'Nomeação: propositura da ação pelo patrono (30 dias)',
      dias: 30,
      contagem: 'corridos',
      fonte: 'Lei n.º 34/2004, art. 33.º - 30 dias seguintes à notificação da nomeação (prorrogável a pedido fundamentado)',
    },
  ],
  escusa: [
    {
      descricao: 'Escusa: decisão da Ordem dos Advogados (15 dias)',
      dias: 15,
      contagem: 'corridos',
      fonte: 'Lei n.º 34/2004, art. 34.º - a OA aprecia e decide a escusa em 15 dias; o pedido interrompe o prazo em curso',
    },
  ],
};

/*
 * Todos os prazos que uma notificação de decisão desencadeia para um pedido:
 * as duas balizas SinOA e, DEPOIS delas, os prazos específicos do tipo
 * (nomeação/escusa). Para protecção jurídica devolve exactamente o mesmo que
 * gerarPrazosSinOA - comportamento histórico intacto.
 */
export function gerarPrazosPedido(tipoPedido, dataNotificacao) {
  const extras = PRAZOS_TIPO_PEDIDO[tipoPedido] || [];
  const data = String(dataNotificacao || '').trim();
  return [
    ...gerarPrazosSinOA(data),
    ...extras.map((spec) => ({
      descricao: spec.descricao,
      dias: spec.dias,
      contagem: spec.contagem,
      fonte: spec.fonte,
      resultado: computePrazo({ dataNotificacao: data, dias: spec.dias, contagem: spec.contagem }),
    })),
  ];
}

/*
 * Condensa a lista de passos do motor para leitura. Cada passo é um dia: úteis
 * com `dia` (número contado), não úteis com `motivo`, notas avulsas. Mantém os
 * dias úteis um a um (o que o advogado valida) mas agrupa corridas consecutivas
 * do MESMO motivo não-útil (sobretudo as longas férias judiciais) numa só linha.
 */
export function condensarPassos(passos) {
  const out = [];
  let run = null; // { motivo, count, from, to }

  const flush = () => {
    if (!run) return;
    out.push({ kind: 'skip', motivo: run.motivo, count: run.count, from: run.from, to: run.to });
    run = null;
  };

  for (const p of passos || []) {
    if (p.nota !== undefined) {
      flush();
      out.push({ kind: 'nota', data: p.data, nota: p.nota });
      continue;
    }
    if (p.util) {
      flush();
      out.push({ kind: 'util', data: p.data, dia: p.dia });
      continue;
    }
    if (run && run.motivo === p.motivo) {
      run.count += 1;
      run.to = p.data;
    } else {
      flush();
      run = { motivo: p.motivo, count: 1, from: p.data, to: p.data };
    }
  }
  flush();
  return out;
}

/* Soma das despesas de um pedido de honorários (números; ignora inválidos). */
export function somaDespesas(despesas) {
  return (Array.isArray(despesas) ? despesas : []).reduce((acc, d) => {
    const v = Number(d && d.valor);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}
