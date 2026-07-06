/*
 * Motor de injunções - DETERMINÍSTICO, canónico, vendorizado APENAS em
 * legal-injuncoes. Máquina de estados do procedimento de injunção (DL 269/98,
 * anexo; formatos do requerimento: Portaria n.º 220-A/2008, alterada pela
 * Portaria n.º 267/2018) e verificação de elegibilidade.
 *
 * FRONTEIRA (P2-001): este motor NÃO calcula juros nem custas - recebe as
 * referências dos cálculos feitos pelo serviço legal-calculos. Os limiares
 * legais de elegibilidade são constantes CITADAS deste regime (P2-008), não
 * fórmulas monetárias.
 *
 * Elegibilidade (verificarElegibilidade):
 *  - Obrigações pecuniárias emergentes de contrato até €15.000,00
 *    (DL 269/98, art. 1.º, na redação vigente), OU
 *  - SEM limite de valor quando a dívida emerge de TRANSAÇÃO COMERCIAL
 *    (DL 62/2013, art. 10.º) - empresas/entidades públicas entre si;
 *    EXCLUI contratos com consumidores no regime sem limite.
 *
 * Estados: preparada -> submetida -> notificada -> { oposicao | pagamento |
 * formula_executoria }. A oposição tem prazo de 15 DIAS (DL 269/98, anexo,
 * art. 12.º e segs.) - o prazo é criado no radar (legal-prazos) pela app.
 * Em caso de oposição, os autos são distribuídos como ação (fim do
 * procedimento de injunção enquanto tal).
 */

export const LIMITE_INJUNCAO_EUR = 15000; // DL 269/98, art. 1.º (constante citada)
export const PRAZO_OPOSICAO_DIAS = 15; // DL 269/98, anexo (constante citada)

export const ESTADOS = ['preparada', 'submetida', 'notificada', 'oposicao', 'pagamento', 'formula_executoria'];

const TRANSICOES = {
  preparada: ['submetida'],
  submetida: ['notificada'],
  notificada: ['oposicao', 'pagamento', 'formula_executoria'],
  oposicao: [],
  pagamento: [],
  formula_executoria: [],
};

/**
 * Verifica a elegibilidade do crédito para injunção.
 * @param {{ valor:number, transacaoComercial?:boolean, devedorConsumidor?:boolean }} input
 * @returns {{ elegivel:boolean, fundamento:string, via:('dl269/98'|'dl62/2013'|null) }}
 */
export function verificarElegibilidade(input = {}) {
  const valor = Number(input.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`valor inválido para elegibilidade: ${JSON.stringify(input.valor)}`);
  }
  const comercial = input.transacaoComercial === true;
  const consumidor = input.devedorConsumidor === true;

  if (comercial && !consumidor) {
    return {
      elegivel: true,
      via: 'dl62/2013',
      fundamento: 'Transação comercial (DL 62/2013, art. 10.º) - injunção sem limite de valor.',
    };
  }
  if (comercial && consumidor) {
    // O regime sem limite não cobre contratos com consumidores.
    if (valor <= LIMITE_INJUNCAO_EUR) {
      return {
        elegivel: true,
        via: 'dl269/98',
        fundamento: `Contrato com consumidor: só o regime geral se aplica - valor até €${LIMITE_INJUNCAO_EUR.toLocaleString('pt-PT')} (DL 269/98, art. 1.º).`,
      };
    }
    return {
      elegivel: false,
      via: null,
      fundamento: `Contrato com consumidor acima de €${LIMITE_INJUNCAO_EUR.toLocaleString('pt-PT')}: o regime sem limite (DL 62/2013) não cobre consumidores - segue ação declarativa.`,
    };
  }
  if (valor <= LIMITE_INJUNCAO_EUR) {
    return {
      elegivel: true,
      via: 'dl269/98',
      fundamento: `Obrigação pecuniária emergente de contrato até €${LIMITE_INJUNCAO_EUR.toLocaleString('pt-PT')} (DL 269/98, art. 1.º).`,
    };
  }
  return {
    elegivel: false,
    via: null,
    fundamento: `Valor acima de €${LIMITE_INJUNCAO_EUR.toLocaleString('pt-PT')} sem transação comercial - injunção indisponível; segue ação declarativa.`,
  };
}

/** Transição de estado validada RUIDOSAMENTE. Devolve o registo de trilho. */
export function transitar(estadoAtual, estadoNovo) {
  if (!ESTADOS.includes(estadoNovo)) {
    throw new Error(`Estado desconhecido: ${JSON.stringify(estadoNovo)}`);
  }
  const permitidos = TRANSICOES[estadoAtual] || [];
  if (!permitidos.includes(estadoNovo)) {
    throw new Error(`Transição inválida: ${estadoAtual} -> ${estadoNovo}`);
  }
  return { de: estadoAtual, para: estadoNovo, quando: null };
}

/**
 * Carta de interpelação formal (modelo PT-PT, registo formal). Os montantes de
 * juros vêm CALCULADOS do serviço (memória citada) - este texto só os insere.
 */
export function cartaInterpelacao({ credor, devedor, descricao, valor, jurosTexto, prazoPagamentoDias = 10 } = {}) {
  const linhas = [
    `Exmos. Senhores ${devedor || '(devedor)'},`,
    '',
    `Vimos, na qualidade de mandatários de ${credor || '(credor)'}, interpelar V. Exas. para o pagamento da quantia em dívida referente a ${descricao || '(descrição do crédito)'}, no valor de capital de ${typeof valor === 'number' ? valor.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }) : '(valor)'}.`,
    '',
  ];
  if (jurosTexto) {
    linhas.push(`Acrescem juros de mora, calculados nos termos legais: ${jurosTexto}`, '');
  }
  linhas.push(
    `Solicitamos que procedam à regularização integral no prazo de ${prazoPagamentoDias} dias, findo o qual, sem pagamento, recorreremos sem outro aviso aos meios judiciais ao dispor, designadamente ao procedimento de injunção.`,
    '',
    'Com os melhores cumprimentos,',
  );
  return linhas.join('\n');
}

/**
 * Estrutura do requerimento de injunção (campos da Portaria 220-A/2008, na
 * redação da Portaria 267/2018) - preparação para a submissão ASSISTIDA no
 * BNI/Citius (sem API oficial: a plataforma prepara, o advogado confirma).
 */
export function prepararRequerimento({ credor, devedor, descricao, capital, jurosCalculoId, jurosValor, taxaJusticaValor, taxaJusticaCalculoId } = {}) {
  const capitalNum = Number(capital);
  if (!Number.isFinite(capitalNum) || capitalNum <= 0) throw new Error('capital inválido no requerimento.');
  const juros = Number(jurosValor) || 0;
  const taxa = Number(taxaJusticaValor) || 0;
  return {
    formato: 'Portaria n.º 220-A/2008 (red. Portaria n.º 267/2018)',
    credor: credor || null,
    devedor: devedor || null,
    pedido: {
      capital: capitalNum,
      juros,
      jurosCalculoId: jurosCalculoId || null,
      taxaJustica: taxa,
      taxaJusticaCalculoId: taxaJusticaCalculoId || null,
      total: Math.round((capitalNum + juros + taxa) * 100) / 100,
    },
    exposicaoFactos: descricao || '',
  };
}
