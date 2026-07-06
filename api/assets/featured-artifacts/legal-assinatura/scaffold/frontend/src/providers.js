/*
 * Registo de FORNECEDORES de assinatura - metadados de UI SÓ do lado do cliente.
 *
 * As chamadas reais (Adobe Sign) passam pelas rotas da plataforma
 * (/api/signature/send, X-Ekoa-App-Id); os fluxos orquestrado (CMD) e simulado
 * correm inteiramente na app. Este ficheiro descreve cada via para a UI - o que
 * está disponível, o tipo de assinatura que produz, e o fluxo a apresentar - e
 * NÃO detém credenciais nem lógica de assinatura (essa é o motor + as rotas).
 *
 * Enquadramento jurídico (Portaria n.º 350-A/2025, de 09 de Outubro):
 *  - Até 31-12-2026 admite-se, para advogados, advogados estagiários e
 *    solicitadores, a assinatura eletrónica AVANÇADA em peças processuais.
 *  - A partir de 01-01-2027 é obrigatória a assinatura eletrónica QUALIFICADA
 *    para todos os intervenientes processuais (artigo 5.º, n.os 3 e 4), via SCAP
 *    (Cartão de Cidadão / Chave Móvel Digital) ou Sistema de Certificação
 *    Eletrónica do Estado. Ver a página Calendário.
 */

/**
 * tipo:        'qualificada' | 'avancada' | 'simulada'
 * disponivel:  a via está operacional nesta instalação?
 * fluxo:       'orquestrado' | 'plataforma' | 'simulado' | 'stub'
 * selecionavel: pode ser escolhida como método de um signatário num envelope novo?
 */
export const PROVIDERS = {
  'cmd-orquestrado': {
    key: 'cmd-orquestrado',
    nome: 'Chave Móvel Digital (orquestrada)',
    tipo: 'qualificada',
    disponivel: true,
    selecionavel: true,
    fluxo: 'orquestrado',
    predefinidoAdvogado: true,
    exigeAtestacaoOA: true,
    resumo: 'Assinatura qualificada. O advogado assina na app oficial Autenticação.Gov; a Ekoa prepara, arquiva e verifica em redor. Exige inscrição na Ordem dos Advogados em vigor.',
  },
  'cc-middleware': {
    key: 'cc-middleware',
    nome: 'Cartão de Cidadão (middleware)',
    tipo: 'qualificada',
    disponivel: true,
    selecionavel: true,
    fluxo: 'orquestrado',
    exigeAtestacaoOA: true,
    resumo: 'Assinatura qualificada com o Cartão de Cidadão e o middleware Autenticação.Gov instalado localmente, com leitor de cartões.',
  },
  adobe: {
    key: 'adobe',
    nome: 'Adobe Acrobat Sign',
    tipo: 'avancada',
    disponivel: true,
    selecionavel: true,
    fluxo: 'plataforma',
    resumo: 'Assinatura eletrónica avançada - NÃO qualificada. Via de recurso, através da integração Adobe Sign da plataforma. Adequada a documentos não sujeitos a assinatura qualificada.',
  },
  simulado: {
    key: 'simulado',
    nome: 'Modo simulado',
    tipo: 'simulada',
    disponivel: true,
    selecionavel: true,
    fluxo: 'simulado',
    resumo: 'Assina instantaneamente e marca a proveniência como simulada. Apenas para demonstrações e testes - nunca produz uma assinatura com valor jurídico.',
  },
  'cmd-nativo': {
    key: 'cmd-nativo',
    nome: 'CMD nativa (API oficial)',
    tipo: 'qualificada',
    disponivel: false,
    selecionavel: false,
    fluxo: 'stub',
    motivo: 'Disponível após registo AMA. A API oficial de assinatura CMD (SCAP) está documentada; o acesso requer o protocolo de prestador de serviços junto da AMA.',
  },
  digitalsign: {
    key: 'digitalsign',
    nome: 'DigitalSign',
    tipo: 'qualificada',
    disponivel: false,
    selecionavel: false,
    fluxo: 'stub',
    motivo: 'Acesso à API por confirmar. Fornecedor qualificado de recurso.',
  },
  multicert: {
    key: 'multicert',
    nome: 'MULTICERT',
    tipo: 'qualificada',
    disponivel: false,
    selecionavel: false,
    fluxo: 'stub',
    motivo: 'Acesso à API por confirmar. Fornecedor qualificado de recurso.',
  },
};

/** Ordem canónica de apresentação. */
export const PROVIDER_ORDER = ['cmd-orquestrado', 'cc-middleware', 'adobe', 'simulado', 'cmd-nativo', 'digitalsign', 'multicert'];

/** Método por omissão do advogado. */
export const METODO_PADRAO = 'cmd-orquestrado';

/** Métodos que um utilizador pode escolher ao criar um envelope. */
export function metodosSelecionaveis() {
  return PROVIDER_ORDER.filter((k) => PROVIDERS[k].selecionavel).map((k) => PROVIDERS[k]);
}

/** Metadados de um método, com um fallback seguro. */
export function providerDe(metodo) {
  return PROVIDERS[metodo] || {
    key: metodo,
    nome: metodo,
    tipo: 'avancada',
    disponivel: false,
    selecionavel: false,
    fluxo: 'stub',
    resumo: '',
  };
}

/** Rótulo curto do tipo de assinatura, para distintivos. */
export const TIPO_LABEL = {
  qualificada: 'Qualificada',
  avancada: 'Avançada',
  simulada: 'Simulada',
};
