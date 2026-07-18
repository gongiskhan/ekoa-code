/**
 * OS-mode-only strings, raw PT-PT (surface contract 6.1.5 - the NAV_ITEMS
 * raw-label precedent for beta surfaces). Classic-visible strings live in
 * web/locales/ instead; these migrate there when the beta graduates.
 * Conventions: "o seu / a sua", "ecrã" (never "tela"), "por omissão"
 * (never "por padrão"), no travessões, no Brazilian gerunds.
 */
export const OS_STRINGS = {
  shell: {
    title: 'Modo OS',
    beta: 'Beta',
    backToClassic: 'Voltar ao modo clássico',
    emptyDesktop: 'O seu ecrã está vazio. Abra uma aplicação a partir da Dock.',
  },
  window: {
    minimize: 'Minimizar',
    close: 'Fechar',
    moreActions: 'Mais ações',
    restore: 'Restaurar',
  },
  dock: {
    pinned: 'Afixado na Dock',
    running: 'Janelas abertas',
    open: 'Abrir',
    unpin: 'Desafixar da Dock',
  },
  workspace: {
    switcher: 'Ecrãs de trabalho',
    create: 'Novo ecrã',
    rename: 'Mudar o nome',
    remove: 'Eliminar',
    removeConfirmTitle: 'Eliminar este ecrã?',
    removeConfirmBody:
      'As janelas e os itens afixados deste ecrã são esquecidos. Os seus artefactos não são afetados.',
    defaultName: (n: number) => `Ecrã ${n}`,
  },
  desktop: {
    open: 'Abrir',
    removeFromDesktop: 'Remover do ecrã',
    pinToDock: 'Afixar na Dock',
  },
  chatDock: {
    title: 'Assistente',
    collapse: 'Ocultar painel de conversa',
    expand: 'Mostrar painel de conversa',
    files: 'Ficheiros',
    output: 'Resultado',
    openInWindow: 'Abrir em janela',
    openChatPage: 'Abrir na página de conversa',
    sessions: 'Sessões',
  },
  switcherBar: {
    openSurfaces: 'Superfícies abertas',
    noOpenSurfaces: 'Sem superfícies abertas',
  },
  artifactApp: {
    notReady: 'Esta aplicação ainda não está pronta para abrir.',
    loadFailed: 'Não foi possível carregar a aplicação.',
    retry: 'Tentar novamente',
  },
} as const;
