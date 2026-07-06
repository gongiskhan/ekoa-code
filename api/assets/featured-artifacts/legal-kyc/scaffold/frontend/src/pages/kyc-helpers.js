/*
 * Utilitários locais do módulo KYC (não sincronizados). Rótulos PT-PT, mapeamento
 * de tons de badge e opções dos seletores do assistente. São puros - sem estado,
 * sem I/O. A lógica de risco/prazo/aplicabilidade vive no motor `../engine/kyc.mjs`.
 */

/* Banda de risco -> tom do badge (baixo=verde, médio=âmbar, alto=vermelho). */
export const RISCO_TONE = { baixo: 'ok', medio: 'media', alto: 'alta' };
export const RISCO_LABEL = { baixo: 'Risco baixo', medio: 'Risco médio', alto: 'Risco elevado' };

/* Estado da ficha -> rótulo e tom. */
export const ESTADO_LABEL = { em_analise: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada' };
export const ESTADO_TONE = { em_analise: 'info', aprovada: 'ok', recusada: 'neutral' };

/* Estado da consulta RCBE. */
export const RCBE_ESTADO_LABEL = { pendente: 'Pendente', consultado: 'Consultado' };
export const RCBE_ESTADO_TONE = { pendente: 'media', consultado: 'ok' };

/* Opções dos seletores do assistente. */
export const TIPO_CLIENTE_OPCOES = [
  { value: 'particular', label: 'Pessoa singular' },
  { value: 'empresa', label: 'Sociedade nacional' },
  { value: 'entidade_estrangeira', label: 'Entidade estrangeira' },
];

export const PAIS_RISCO_OPCOES = [
  { value: 'baixo', label: 'Baixo' },
  { value: 'medio', label: 'Médio' },
  { value: 'alto', label: 'Elevado' },
];

export const NATUREZA_OPCOES = [
  { value: 'imobiliario', label: 'Transação imobiliária' },
  { value: 'societario', label: 'Constituição ou gestão de sociedade' },
  { value: 'financeiro', label: 'Movimentação de fundos ou ativos' },
  { value: 'contencioso', label: 'Contencioso judicial' },
  { value: 'outro', label: 'Outra natureza' },
];

export const SERVICO_OPCOES = [
  { value: 'imobiliario', label: 'Transação imobiliária' },
  { value: 'societario', label: 'Constituição ou gestão de sociedade' },
  { value: 'financeiro', label: 'Movimentação de fundos ou ativos' },
  { value: 'fiducias', label: 'Serviços fiduciários / gestão de património' },
  { value: 'consulta_juridica', label: 'Consulta jurídica' },
  { value: 'patrocinio', label: 'Patrocínio judiciário' },
];

const LABEL_BY_VALUE = (opcoes) => Object.fromEntries(opcoes.map((o) => [o.value, o.label]));
export const TIPO_CLIENTE_LABEL = LABEL_BY_VALUE(TIPO_CLIENTE_OPCOES);
export const PAIS_RISCO_LABEL = LABEL_BY_VALUE(PAIS_RISCO_OPCOES);
export const NATUREZA_LABEL = LABEL_BY_VALUE(NATUREZA_OPCOES);
export const SERVICO_LABEL = LABEL_BY_VALUE(SERVICO_OPCOES);

/* Tipo de cliente da ficha a partir do `tipo` do cliente da espinha
 * (particular|empresa). Entidade estrangeira é uma escolha explícita do
 * advogado, por isso a inferência nunca a devolve. */
export function tipoClienteDoCliente(cliente) {
  if (cliente && cliente.tipo === 'empresa') return 'empresa';
  return 'particular';
}

/* 'YYYY-MM-DD' de hoje (local) - calculado na chamada, nunca no topo do módulo. */
export function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Carimbo ISO completo de agora (para eventos de auditoria). */
export function nowIso() {
  return new Date().toISOString();
}

/* Só entidades coletivas (empresa / entidade estrangeira) têm RCBE. */
export function temRcbe(tipoCliente) {
  return tipoCliente === 'empresa' || tipoCliente === 'entidade_estrangeira';
}
