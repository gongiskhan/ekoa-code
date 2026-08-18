/**
 * i18n/pt.ts — ALL user-facing strings for the Ekoa Bridge CLI, in Portuguese (PT-PT), formal
 * register ("o seu", "por omissão", no em-dashes; the middle dot is allowed). This is the first
 * user-facing surface in the repo, so it owns the string table (conventions.md "Strings / UX").
 *
 * The product name lives in ONE constant so a rebrand is a single-sweep rename. Every command,
 * prompt, and error the CLI emits routes through this module — no inline copy anywhere else.
 *
 * Values are either plain strings or small formatting functions; the object is intentionally flat
 * (single level) so call sites read as `pt.someKey` / `pt.someKey(arg)`.
 */

/** The product name, referenced everywhere so a rebrand is one edit. */
export const PRODUCT_NAME = 'Ekoa Bridge';

/** The CLI binary name, as invoked by the user. */
const BIN = 'ekoa-bridge';

export const pt = {
  // Generic
  errPrefix: 'Erro:',

  cliUsage: [
    `${PRODUCT_NAME} - ponte local que liga os seus ficheiros ao Cortex.`,
    '',
    `Utilização: ${BIN} <comando> [opções]`,
    '',
    'Comandos:',
    '  pair    Emparelhar este dispositivo com o seu Cortex',
    '  status  Mostrar o estado do emparelhamento e das credenciais',
    '  serve   Iniciar o daemon e ligar ao Cortex',
    '  unpair  Remover o emparelhamento e as credenciais locais',
    '  grant   Autorizar o acesso a uma pasta',
    '  autostart  Ligar a ponte automaticamente ao iniciar o computador (on|off|status)',
  ].join('\n'),

  unknownCommand: (cmd: string): string =>
    `Comando desconhecido: ${cmd}. Execute "${BIN}" sem argumentos para ver a ajuda.`,

  // pair
  pairUsage: `Utilização: ${BIN} pair --url <cortex> [--pairing-id <id>]`,
  pairUrlRequired: 'Indique o URL do Cortex com --url.',
  pairPrompt: (userCode: string, url: string): string =>
    [
      'Para autorizar este dispositivo, abra o seu navegador em:',
      `  ${url}`,
      'e introduza o seguinte código:',
      `  ${userCode}`,
    ].join('\n'),
  pairWaiting: 'A aguardar a aprovação no navegador...',
  pairSuccess: (username?: string): string =>
    username
      ? `Dispositivo emparelhado com sucesso (utilizador: ${username}).`
      : 'Dispositivo emparelhado com sucesso.',
  pairStored: (path: string): string => `Configuração guardada em ${path}.`,

  // Device login (thrown error messages)
  deviceStartFailed: (status: number): string =>
    status === 0
      ? 'Não foi possível contactar o Cortex para iniciar a autenticação. Verifique a ligação e o endereço.'
      : `Não foi possível iniciar a autenticação junto do Cortex (HTTP ${status}).`,
  devicePollFailed: (status: number): string =>
    `Não foi possível consultar o estado da autenticação (HTTP ${status}).`,
  deviceDenied: 'A autorização foi recusada no navegador.',
  deviceExpired: 'O código de autorização expirou antes de ser aprovado.',
  deviceTimeout: 'O tempo de espera pela autorização esgotou-se.',
  deviceAborted: 'A autenticação foi cancelada.',

  // Bridge token / credentials
  tokenNoCredentials: `Sem credenciais. Emparelhe primeiro com "${BIN} pair --url <cortex>".`,
  tokenRefreshFailed:
    `Não foi possível renovar a credencial da plataforma. Emparelhe novamente com "${BIN} pair".`,
  tokenMintFailed: (status: number): string =>
    `Não foi possível obter o token da ponte junto do Cortex (HTTP ${status}).`,

  // status
  statusNotPaired: `Estado: não emparelhado. Execute "${BIN} pair --url <cortex>".`,
  statusPairing: (pairingId: string, url: string): string =>
    `Emparelhamento: ${pairingId} (Cortex: ${url}).`,
  statusCredValid: (whenIso: string): string => `Credencial: válida (expira em ${whenIso}).`,
  statusCredExpired: (whenIso: string): string =>
    `Credencial: expirada (expirou em ${whenIso}). Emparelhe novamente.`,
  statusCredNone: 'Credencial: ausente.',
  statusServeRunning: (pid: number): string => `Daemon: em execução (PID ${pid}).`,
  statusServeStopped: 'Daemon: parado.',

  // serve
  serveStarting: (url: string): string => `A ligar ao Cortex em ${url}...`,
  serveState: (state: string): string => `Estado da ligação: ${state}.`,
  serveFrame: (frameType: string): string => `Trama recebida do Cortex: ${frameType}.`,
  serveAdvertised: (capabilities: string[]): string =>
    `Capacidades anunciadas: ${capabilities.join(', ') || 'nenhuma'}.`,
  serveRevoked:
    'O emparelhamento foi revogado pelo Cortex. Emparelhe novamente com um novo identificador.',
  // Reports THAT the binding changed, never its contents: the chave de assinatura is credential
  // material and this line ends up in logs an operator may share.
  serveBindingUpdated: 'Credenciais de assinatura atualizadas a partir do Cortex.',
  serveStopping: 'A encerrar o daemon...',
  serveStopped: 'Daemon encerrado.',
  serveSurface: (port: number): string => `Interface local disponível em http://127.0.0.1:${port} (apenas nesta máquina).`,
  serveSurfaceFailed: (port: number, message: string): string =>
    `A interface local não arrancou na porta ${port} (${message}). O painel web não conseguirá ligar-se; o daemon continua a servir delegações.`,
  serveAlreadyRunning: (pid: number): string =>
    `Já existe um daemon em execução para este dispositivo (PID ${pid}). Encerre-o antes de iniciar outro.`,

  // autostart
  autostartUsage: `Utilização: ${BIN} autostart <on|off|status>`,
  autostartUnsupported:
    'O arranque automático ainda não é suportado neste sistema. Use "ekoa-bridge serve" numa janela.',
  autostartUnpaired: `este dispositivo não está emparelhado. Execute "${BIN} pair --url <cortex>" primeiro.`,
  autostartEnabled: (path: string): string =>
    `Arranque automático ativado (${path}). A ponte liga-se sozinha ao iniciar o computador; registo em ~/.ekoa-bridge/logs/serve.log.`,
  autostartDisabled: 'Arranque automático desativado. A ponte deixa de se ligar sozinha.',
  autostartInstalled: (path: string): string => `Arranque automático: ativo (${path}).`,
  autostartNotInstalled: 'Arranque automático: inativo.',

  // unpair
  unpairNothing: 'Nada para remover: este dispositivo não está emparelhado.',
  unpairWillLose: (pairingId: string, url: string, hasCreds: boolean): string =>
    [
      `Vai remover o emparelhamento "${pairingId}" com ${url}.`,
      hasCreds ? 'As credenciais locais associadas serão apagadas.' : 'Não existem credenciais locais guardadas.',
    ].join('\n'),
  unpairDone: 'Emparelhamento e credenciais removidos.',

  // grant
  grantUsage: `Utilização: ${BIN} grant add --path <pasta> [--session <id>]`,
  grantPickPrompt: 'Escolha a pasta a autorizar',
  grantNoPath:
    'Indique uma pasta com --path. O seletor gráfico não está disponível neste ambiente.',
  grantPickerCancelled: 'Seleção de pasta cancelada.',
  grantNotADir: (path: string): string => `O caminho indicado não é uma pasta: ${path}`,
  grantAdded: (grantRef: string, root: string, session: string): string =>
    `Acesso autorizado (${grantRef}) a ${root} para a sessão ${session}.`,
} as const;

export type PtStrings = typeof pt;
