/**
 * Privacy / custody copy and the claims ship-gate.
 *
 * Amendment 2026-07-06 (§12.6 local file access and privacy surfaces) plus the
 * §17.9 claims discipline. TWO kinds of string live here, kept strictly apart:
 *
 *  - OPERATIONAL copy (`PRIVACY_COPY`): UX / mechanism labels that carry NO legal
 *    claim - the Upload-vs-Reference distinction, install CTA, state labels, the
 *    first-grant dialog, settings section headings. These SHIP ENABLED.
 *
 *  - CLAIMS copy (`PRIVACY_CLAIMS`): privacy / custody assertions bounded by the
 *    §17.9 A1 / §12.6.3 A6 ceiling. They are DRAFTED here but SHIP-GATED: while
 *    `CLAIMS_SHIP_GATED` is true every claims-bearing string renders through
 *    `<GatedClaim>` as a "verificação em curso" placeholder, never as asserted
 *    fact (§12.6 ship-gate; §17.9 A7.4 - "never ship claims ahead of enforcement").
 *    Flip the flag to false only once the mechanism each string describes has
 *    passed its chapter 14 / §17.9 gate (the ledger scenario, the audit-join, the
 *    detector payload-capture harness).
 *
 * INVARIANT: no string here - enabled OR drafted - may contain a §17.9 forbidden
 * phrase. The claimable ceiling texts (which speak of "os ficheiros", the files,
 * never "os seus dados", your data) are the tightest we may draft; a component may
 * render LESS, never MORE. When in doubt, say less.
 */

/**
 * The single ship-gate for every claims-bearing string in the privacy surfaces.
 * `true` = the anonymisation / ledger / audit-join mechanisms have NOT yet passed
 * their gates, so claims render as a visibly-pending placeholder. This is the only
 * switch: no claims string is asserted anywhere while it is true.
 */
export const CLAIMS_SHIP_GATED = true;

/** Per-turn local-file activity feeding the trust chip (FC-402). Joined hosted-side
 *  from the daemon egress ledger (bytes-out) and the anonymisation audit (masked
 *  counts) on the correlation id (§12.6.2; §17.6; ch18 §18.6). Absent on hosted
 *  turns that never touched local files, and may arrive bytes-only before the
 *  audit-join lands (§12.6.2 cut-line). */
export interface LocalFileActivity {
  /** File(s) and the range the agent actually read. */
  files: Array<{ path: string; range?: string }>;
  /** Bytes that transited off the machine, from the local egress ledger. */
  bytesOut?: number;
  /** Masked-entity counts by class, from the hosted anonymisation audit. */
  maskedCounts?: Record<string, number>;
  /** The per-request correlation id the ledger and audit join on. */
  correlationId?: string;
}

/** Route of the settings privacy surface (FC-404); linked from every "saiba mais". */
export const PRIVACY_SETTINGS_HREF = '/settings/privacy';

/* ==========================================================================
   OPERATIONAL copy - ships enabled (no legal claim).
   ========================================================================== */

export const PRIVACY_COPY = {
  // -- FC-400 attach affordance: Upload vs Reference --
  /** UX distinction between the two attach actions (v2 A7.2, verbatim; owner's
   *  em-dash convention). Not a legal claim, so it needs no citation and ships. */
  attachMicroCopy:
    'Enviar guarda uma cópia nos nossos servidores. Referenciar mantém o ficheiro apenas no seu computador - recomendado para documentos sensíveis.',
  uploadGroupLabel: 'Enviar',
  uploadFile: 'Carregar ficheiro',
  uploadFolder: 'Carregar pasta',
  referenceGroupLabel: 'Referenciar (local)',
  referenceAction: 'Referenciar ficheiro/pasta local',

  // -- FC-401 Reference states --
  /** Install-CTA primary copy (v2 A7.2, verbatim). Operational: it describes what
   *  Reference does, not a custody guarantee. */
  installCtaPrimary:
    'Os documentos dos seus clientes ficam no seu computador; o agente lê apenas o que precisa e cada leitura fica registada.',
  installCtaButton: 'Instalar a ponte local',
  saibaMais: 'saiba mais',
  bridgeNotInstalledBadge: 'Ponte não instalada',
  bridgeOfflineBadge: 'Ponte offline',
  bridgeConnectedBadge: 'Ponte ligada',
  bridgeNotInstalledHint:
    'A ponte local ainda não está instalada neste computador. Instale-a para referenciar ficheiros sem os carregar.',
  bridgeOfflineHint:
    'A ponte local está instalada mas não responde. Verifique se está a correr e tente novamente - o ficheiro nunca é carregado em alternativa.',
  bridgeOfflineRetry: 'Tentar novamente',
  referenceChoose: 'Escolher ficheiro ou pasta local',

  // -- FC-411 first-time grant dialog --
  firstGrantTitle: 'Autorizar leitura local',
  firstGrantConfirm: 'Autorizar',
  firstGrantCancel: 'Cancelar',

  // -- FC-402 trust chip (mechanism labels; the masked-count CLAIM is gated) --
  chipReadPrefix: 'Leu',
  chipBytesSuffix: 'saíram desta máquina de forma transitória',
  chipInfoLabel: 'Detalhes de custódia',
  chipSeparator: ' · ',

  // -- Settings surface "Privacidade e ponte local" (FC-404) --
  settingsTitle: 'Privacidade e ponte local',
  settingsSubtitle:
    'A ponte local, as autorizações de leitura e o registo de tudo o que sai deste computador.',
  navLabel: 'Privacidade e ponte local',

  // FC-405 bridge status + pairing
  bridgeSectionTitle: 'Estado da ponte e emparelhamento',
  bridgeSectionDesc:
    'A ponte local liga este computador ao agente para que ele leia ficheiros no próprio local, sem os carregar.',
  bridgeStatusNotPaired: 'Ponte não emparelhada',
  bridgeStatusOffline: 'Ponte offline',
  bridgeStatusConnected: 'Ponte ligada',
  bridgeStatusNotPairedDesc:
    'Nenhuma ponte está emparelhada com esta conta. Gere um código de emparelhamento e introduza-o na aplicação da ponte.',
  bridgeStatusOfflineDesc:
    'A ponte está emparelhada mas não responde neste momento.',
  bridgePairGenerate: 'Gerar código de emparelhamento',
  bridgePairGenerating: 'A gerar...',
  bridgePairCodeLabel: 'Código de emparelhamento',
  bridgePairExpiresIn: (seconds: number) =>
    `Válido durante ${Math.round(seconds / 60)} minutos. Introduza-o na aplicação da ponte.`,
  bridgeRevokePairing: 'Revogar emparelhamento',
  bridgeRevokePairingConfirmTitle: 'Revogar emparelhamento da ponte',
  bridgeRevokePairingConfirmDesc:
    'A ponte deixa de poder ligar-se a esta conta até voltar a emparelhar. As leituras em curso são interrompidas.',
  bridgePairError: 'Não foi possível gerar o código. Tente novamente.',

  // FC-406 active grants
  grantsSectionTitle: 'Autorizações de leitura ativas',
  grantsSectionDesc:
    'Pastas e ficheiros que o agente pode ler nesta sessão. Revogar tem efeito na leitura seguinte.',
  grantsEmptyConnected: 'Não há autorizações ativas nesta sessão.',
  grantsOffline:
    'A lista de autorizações é servida pela ponte local. Ligue a ponte para a ver.',
  grantRevoke: 'Revogar',
  grantRevoking: 'A revogar...',

  // FC-407 ledger viewer
  ledgerSectionTitle: 'Registo de leituras locais',
  ledgerSectionDesc:
    'O que saiu deste computador: ficheiro, intervalo lido, dimensão e momento. Servido pela ponte local; não guardamos este registo nos nossos servidores.',
  ledgerOffline:
    'O registo é mantido e servido pela ponte local. Ligue a ponte para o consultar.',
  ledgerEmpty: 'Ainda não há leituras registadas nesta sessão.',
  ledgerColTime: 'Momento',
  ledgerColPath: 'Ficheiro',
  ledgerColRange: 'Intervalo',
  ledgerColBytes: 'Dimensão',

  // FC-408 masking summary
  maskingSectionTitle: 'Atividade de mascaramento',
  maskingSectionDesc:
    'Quantas entidades sensíveis foram mascaradas antes de cada pedido chegar ao fornecedor de IA, por classe. Apenas contagens - nunca os valores.',
  maskingPending:
    'O resumo de mascaramento fica disponível quando a auditoria de anonimização estiver ativa nesta conta.',

  // FC-409 approved commands (unified from /settings/bridge)
  commandsSectionTitle: 'Comandos locais aprovados',
  commandsSectionDesc:
    'A primeira utilização de cada novo comando local exige a sua aprovação. As aprovações são desta conta e podem ser revogadas aqui.',
  commandsEmpty:
    'Ainda não aprovou nenhum comando. Na primeira vez que uma automação tentar correr um comando local, verá aqui o pedido de consentimento.',
  commandsLoadError: 'Não foi possível carregar as aprovações.',
  commandRevoke: 'Revogar',
  commandRevoking: 'A revogar...',
  commandApprovedAt: 'Aprovado',
  commandLastUsedAt: 'Última utilização',

  // FC-410 grounded sections
  groundedSectionTitle: 'Enquadramento e garantias',
  groundedSaibaMais: 'saiba mais',
  groundedLegalDisclaimer: 'Isto não é aconselhamento jurídico.',
  groundedSegredoTitle:
    'Como isto se relaciona com o seu dever de segredo profissional',
  groundedAuthorityTitle:
    'O que acontece se recebermos um pedido de uma autoridade',
  groundedDataLocationTitle: 'Onde ficam os seus dados',

  // FC-412 onboarding card (neutral framing ships; the custody claim is gated)
  onboardingTitle: 'A sua privacidade na Ekoa',
  onboardingIntro:
    'Entenda o percurso dos documentos do seu escritório e os dois limites que o definem.',
  onboardingBoundary1Label: 'O seu computador',
  onboardingBoundary2Label: 'O fornecedor de IA',
  onboardingDismiss: 'Compreendi',
  onboardingLearnMore: 'Ver privacidade e ponte local',

  // Shared placeholder for gated claims
  claimPending: 'Verificação em curso',
} as const;

/** FC-411 body, verbatim (v2 A7.2), with the chosen target filled in. The arrow
 *  and dash are part of the verbatim string. */
export function firstGrantDialogBody(target: string): string {
  return `Esta autorização permite ao agente ler ${target} durante esta sessão. Pode revogar a qualquer momento em Definições → Privacidade e ponte local.`;
}

/* ==========================================================================
   CLAIMS copy - DRAFTED, ship-gated (§17.9 A1 / §12.6.3 A6 ceiling, verbatim).
   Never rendered as asserted fact while CLAIMS_SHIP_GATED is true; surfaced only
   through <GatedClaim>. Contains ceiling texts only, never a forbidden phrase.
   ========================================================================== */

export const PRIVACY_CLAIMS = {
  /** §17.9 A1 PT-PT claimable ceiling (two-boundary honest). The onboarding card
   *  and the chip custody panel draft from this. */
  ceiling:
    'Os ficheiros nunca saem da sua máquina: não há upload nem cópia guardada fora dela; o agente trabalha sobre eles no próprio local. Apenas os excertos que o agente lê transitam, de forma transitória e auditável, dentro dos pedidos ao modelo. Nenhum dado sensível detetado chega ao fornecedor de IA em claro: identificadores estruturados (NIF, NISS, IBAN, referências de processo) e as partes conhecidas do escritório com certeza; restantes entidades com cobertura automática elevada.',

  // FC-410 grounded section claims (§12.6.3 A6 verbatim ceiling).
  custodySegredo:
    'Os ficheiros do escritório nunca saem da esfera física do advogado; a premissa de facto em que assentam as proteções dos arts. 75.º e 76.º do EOA e 177.º, n.º 5, e 180.º do CPP mantém-se para o arquivo.',
  custodyLedger:
    'Cada leitura fica registada num livro de custódia guardado no próprio escritório: o advogado sabe sempre o que saiu da máquina, quando e em que dimensão.',
  jurisdiction:
    'A Ekoa é uma sociedade portuguesa, subcontratante ao abrigo do RGPD com DPA; qualquer pedido de acesso é tratado ao abrigo do direito da UE, com sinalização do segredo profissional na revisão do pedido e notificação ao escritório salvo proibição legal; pedidos de países terceiros sem base em acordo internacional colidem com o art. 48.º do RGPD.',
  minimizacao:
    'Não podemos entregar o que não guardamos: não existem ficheiros de clientes em repouso nos nossos servidores e o mapa de reidentificação é efémero, deixando de existir no fim da sessão.',
  /** Asserted alongside the claims, never omitted (§12.6.3 "Limites"). */
  limites:
    'a camada de raciocínio é SaaS na taxonomia CCBE; excertos transitam de forma transitória; a deteção tem cobertura elevada, não perfeita; os subprocessadores de matriz norte-americana implicam risco residual de processo de país terceiro, razão de ser da minimização e do futuro escalão edge para a matéria mais sensível.',
} as const;

/** Citations for the FC-410 grounded expansions. Live in the "saiba mais" body,
 *  never in the primary one-line copy (§12.6.3). */
export const PRIVACY_CITATIONS = {
  segredo: 'EOA art. 92.º; arts. 75.º e 76.º do EOA; arts. 177.º, n.º 5, e 180.º do CPP.',
  authority: 'Regulamento (UE) 2023/1543; RGPD art. 48.º.',
  dataLocation: 'RGPD (minimização; ausência de dados em repouso).',
} as const;

/** FC-402 masked-count claim clause (Boundary 2). Ship-gated. Built from the audit
 *  join; "antes do fornecedor de IA" names Boundary 2 and never implies masking
 *  happened before Boundary 1. */
export function maskedCountsClaim(counts: Record<string, number>): string | null {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([cls, n]) => `${n} ${cls}`);
  if (parts.length === 0) return null;
  return `${parts.join(', ')} mascarados antes do fornecedor de IA`;
}
