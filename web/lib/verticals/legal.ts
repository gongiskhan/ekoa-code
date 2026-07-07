import type { VerticalProfile } from './index';

/**
 * Legal (escritório de advogados) presentation skin. This is pure copy +
 * ordering — no legal business logic. The legal *capabilities* are ARTIFACTS
 * (the `legal-*` apps), not platform code; this profile only changes how the
 * generic surfaces greet a law firm.
 *
 * The six example prompts from the spec are split across build/chat so the
 * empty-state's build-first and interleaved (chat) renders both surface the
 * "prazos processuais" and "Citius" prompts near the top; every prompt text is
 * verbatim from the spec.
 */
export const legal: VerticalProfile = {
  welcomeMessage:
    'Olá! O Ekoa é o espaço de trabalho com IA do seu escritório — acompanha prazos processuais, prepara minutas e dossiês, organiza clientes e processos, e responde com base no que o seu escritório sabe. Se consegue descrever, o Ekoa trata. O que tornaria o seu dia mais fácil?',
  examplePrompts: {
    build: [
      'Que prazos processuais vencem esta semana nos meus processos?',
      'Há novas notificações do Citius por triar? Mostra-me as que precisam de revisão.',
      'Prepara uma minuta de contrato de prestação de serviços com base na nossa biblioteca de cláusulas.',
      'Dá-me o dossiê completo do processo 1234/26.5T8LSB, com a cronologia de eventos.',
    ],
    chat: [
      'Pesquisa na base de conhecimento jurisprudência sobre responsabilidade contratual e cita as fontes.',
      'Regista duas horas de trabalho no processo da TechCorp e mostra-me os honorários acumulados este mês.',
    ],
  },
  onboardingChips: [
    'Sou advogado(a) num escritório',
    'Trabalho como advogado(a) independente',
  ],
  modeTaglines: {
    build: 'O que pretende preparar hoje?',
  },
  loginTagline: 'Ekoa · O espaço de trabalho com IA para escritórios de advogados',
  metadataDescription: 'Ekoa — plataforma de trabalho com IA para escritórios de advogados',
  startingPointsFirst: (slug) => slug.startsWith('legal-'),
};
