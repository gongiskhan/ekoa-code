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

/**
 * Local-bridge distribution (FC-405 install section). The bridge is published as GitHub Release
 * assets on `github.com/gongiskhan/ekoa-bridge` (canonical since 2026-07-11; the `latest/download`
 * URLs always resolve to the newest release): the double-click installers, a source tarball, and
 * the `curl | bash` / `install.ps1` scripts. All default to the release URLs so the download
 * buttons and install command work in every environment; override with `NEXT_PUBLIC_BRIDGE_MAC_URL`
 * / `NEXT_PUBLIC_BRIDGE_WIN_URL` / `NEXT_PUBLIC_BRIDGE_DOWNLOAD_URL` / `NEXT_PUBLIC_BRIDGE_INSTALL_URL`
 * to point elsewhere (or set download to '' for the honest "not yet published" state — we never
 * point a Download button at a dead link). (The GCS bucket `ekoa-bridge-downloads` remains as a
 * secondary mirror.)
 */
const HOSTED_BRIDGE_BASE = 'https://github.com/gongiskhan/ekoa-bridge/releases/latest/download';
/** Double-click installers (owner directive 2026-07-11: non-technical users must not touch a
 *  terminal). Mac = a zipped `.command` (double-click installs + pairs + serves via native
 *  dialogs); Windows = a `.bat` that runs the hosted install.ps1 with the same flow. */
export const BRIDGE_MAC_URL =
  process.env.NEXT_PUBLIC_BRIDGE_MAC_URL ?? `${HOSTED_BRIDGE_BASE}/Instalar-Ponte-Ekoa-Mac.zip`;
export const BRIDGE_WIN_URL =
  process.env.NEXT_PUBLIC_BRIDGE_WIN_URL ?? `${HOSTED_BRIDGE_BASE}/Instalar-Ponte-Ekoa-Windows.bat`;
/** Advanced/manual path (Node.js + terminal), kept for technical users. */
export const BRIDGE_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_BRIDGE_DOWNLOAD_URL ?? `${HOSTED_BRIDGE_BASE}/ekoa-bridge-latest.tgz`;
export const BRIDGE_INSTALL_URL =
  process.env.NEXT_PUBLIC_BRIDGE_INSTALL_URL ?? `${HOSTED_BRIDGE_BASE}/install.sh`;
export const BRIDGE_INSTALL_CMD = `curl -fsSL ${BRIDGE_INSTALL_URL} | bash`;

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
  /** Short caption reinforcing the Upload trade-off (substring of the verbatim attachMicroCopy,
   *  so no new claim): the hosted-copy half of the distinction, coloured as a caution. */
  uploadHostedNote: 'Guarda uma cópia nos nossos servidores.',
  referenceGroupLabel: 'Referenciar (local)',
  referenceAction: 'Referenciar ficheiro/pasta local',
  /** Teal "recommended" badge on the Reference block (verbatim substring of attachMicroCopy):
   *  the visual cue that sensitive documents belong on the bridge, not the upload path. */
  referenceRecommendedBadge: 'Recomendado para documentos sensíveis',

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
  /** Offline/not-installed states route to the connect+download area (FC-405 install section)
   *  so a not-connected user always has a one-tap way to the bridge page. */
  bridgeOpenSettings: 'Abrir definições da ponte',
  referenceChoose: 'Escolher ficheiro ou pasta local',

  // -- FC-411 first-time grant dialog --
  firstGrantTitle: 'Autorizar leitura local',
  firstGrantConfirm: 'Autorizar',
  firstGrantCancel: 'Cancelar',

  // -- FC-401 in-app file browser (run 20260711-111952 s5; D1/D2 — replaces the native picker
  //    and the typed-identifier fallback: the user navigates and picks, never types a path or code) --
  browserTitle: 'Escolher ficheiro ou pasta',
  browserIntro:
    'Navegue no seu computador e escolha o ficheiro ou a pasta que o agente pode ler. Nada é carregado: fica autorizada apenas a leitura, e cada leitura fica registada.',
  browserParent: 'Subir um nível',
  browserChooseFolder: 'Autorizar esta pasta',
  browserChooseHint: 'Escolher uma pasta autoriza todos os ficheiros nela.',
  browserPickFile: 'Autorizar',
  browserFilePickNote: 'Autorizar um ficheiro autoriza a pasta que o contém.',
  browserEmpty: 'Esta pasta está vazia.',
  browserTruncated: 'A mostrar os primeiros itens desta pasta.',
  browserLoading: 'A carregar...',
  browserUnavailable:
    'Não foi possível abrir o explorador de ficheiros. Verifique se a ponte local está a correr e atualizada.',
  browserCancel: 'Cancelar',
  referenceTokenRemove: 'Remover referência',
  referenceTokensLabel: 'Referências locais desta mensagem',
  /** Shown when a pending reference could not be turned into a grant at send time (D3). */
  referenceMintError:
    'Não foi possível autorizar a referência local. A mensagem foi enviada sem ela; verifique a ponte local e tente de novo.',

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

  // FC-405 install / download (owner directive 2026-07-11: the bridge page must offer a way to
  // download the bridge and clear instructions to install it). Operational onboarding copy — no
  // legal claim. The install is a hosted `curl | bash` + a downloadable tarball; steps are real
  // and runnable, never a command that fails.
  installSectionTitle: 'Descarregar e instalar a ponte local',
  installSectionDesc:
    'A ponte local é uma pequena aplicação que corre no seu computador. Instale-a uma vez para o agente poder ler ficheiros no próprio local, sem os carregar.',
  // -- Simple double-click install (primary) --
  installSimpleTitle: 'Instalação simples',
  installOsSelectLabel: 'Escolha o seu sistema',
  installOsMac: 'Mac',
  installOsWindows: 'Windows',
  installDownloadForMac: 'Descarregar para Mac',
  installDownloadForWindows: 'Descarregar para Windows',
  installMacSecurityNote:
    'Descompacte o ficheiro e faça duplo-clique. Na primeira vez, o Mac pode pedir confirmação: clique com o botão direito no ficheiro e escolha “Abrir”.',
  installWinSecurityNote:
    'Faça duplo-clique no ficheiro. Na primeira vez, o Windows pode mostrar um aviso: clique em “Mais informações” e depois “Executar mesmo assim”.',
  installSimpleStep1: 'Descarregue o instalador para o seu sistema.',
  installSimpleStep2: 'Faça duplo-clique no ficheiro descarregado — não precisa de escrever nada.',
  installSimpleStep3: 'Quando aparecer, confirme o código no navegador para ligar à sua conta.',
  installSimpleStep4: 'Pronto: a ponte fica ligada e já pode referenciar ficheiros.',
  installNodeNote:
    'O instalador precisa do Node.js (gratuito). Se não o tiver, abre a página de instalação e explica o que fazer.',
  // -- Advanced / manual install (technical users) --
  installAdvancedTitle: 'Instalação avançada (com Node.js e Terminal)',
  installCommandLabel: 'Instalar (requer o Node.js 20 ou superior)',
  installCommandHint:
    'Cole este comando no Terminal (macOS/Linux) ou no PowerShell/WSL (Windows). Verifica o Node.js, instala a ponte e mostra os próximos passos.',
  installCopyLabel: 'Copiar comando',
  installCopiedLabel: 'Copiado',
  installDownloadButton: 'Descarregar o pacote (.tgz)',
  installDownloadManualHint: 'Prefere instalar à mão? Descarregue o pacote e corra: npm install -g <ficheiro>.',
  /** Muted state when the download URL is overridden to '' — honest, never a dead link. */
  installDownloadUnavailable: 'Descarregar (brevemente)',
  installDownloadNote:
    'O instalador para o seu sistema fica disponível aqui em breve. Entretanto, siga os passos abaixo para ligar a ponte.',
  installRequirements: 'Compatível com Windows, macOS e Linux.',
  installStepsTitle: 'Como ligar a ponte, passo a passo',
  installStep1: 'Instale o Node.js 20+ (nodejs.org) e cole o comando acima no Terminal.',
  installStep2: 'Corra "ekoa-bridge pair" e introduza o código de emparelhamento (secção seguinte).',
  installStep3: 'Corra "ekoa-bridge serve" e deixe essa janela a correr.',
  installStep4: 'A ponte liga-se e o estado passa a «Ponte ligada». Já pode referenciar ficheiros.',

  // FC-406 active grants
  grantsSectionTitle: 'Autorizações de leitura ativas',
  grantsSectionDesc:
    'Pastas e ficheiros que o agente pode ler nesta sessão. Revogar tem efeito na leitura seguinte.',
  grantsEmptyConnected: 'Não há autorizações ativas nesta sessão.',
  grantsOffline:
    'A lista de autorizações é servida pela ponte local. Ligue a ponte para a ver.',
  grantsUnavailable:
    'A ponte está ligada mas a lista de autorizações não está acessível a partir do navegador. Atualize a aplicação da ponte local.',
  grantRevoke: 'Revogar',
  grantRevoking: 'A revogar...',
  grantRevokeError: 'Não foi possível revogar. Tente novamente.',

  // FC-407 ledger viewer
  ledgerSectionTitle: 'Registo de leituras locais',
  ledgerSectionDesc:
    'O que saiu deste computador: ficheiro, intervalo lido, dimensão e momento. Servido pela ponte local; não guardamos este registo nos nossos servidores.',
  ledgerOffline:
    'O registo é mantido e servido pela ponte local. Ligue a ponte para o consultar.',
  ledgerUnavailable:
    'A ponte está ligada mas o registo não está acessível a partir do navegador. Atualize a aplicação da ponte local.',
  ledgerEmpty: 'Ainda não há leituras registadas.',
  ledgerColTime: 'Momento',
  ledgerColKind: 'Tipo',
  ledgerColPath: 'Ficheiro',
  ledgerColRange: 'Intervalo',
  ledgerColBytes: 'Dimensão',
  ledgerColSession: 'Sessão',
  ledgerSessionLabel: 'Sessão',
  ledgerSessionAll: 'Todas as sessões',
  ledgerUnparseable: (n: number) =>
    n === 1 ? '1 registo não pôde ser lido.' : `${n} registos não puderam ser lidos.`,
  ledgerKindLabels: {
    read: 'Leitura',
    write: 'Escrita',
    denial: 'Recusa',
    cap_consent: 'Limite',
    automation: 'Automação',
  } as Record<string, string>,

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
