/**
 * i18n Translation Types
 *
 * Defines the complete structure for all translated strings in ekoa.
 * This provides TypeScript type safety for translation access.
 */

export interface Translations {
  // ============================================
  // COMMON - Reusable UI elements
  // ============================================

  common: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    add: string;
    search: string;
    loading: string;
    error: string;
    success: string;
    confirm: string;
    yes: string;
    no: string;
    close: string;
    open: string;
    select: string;
    upload: string;
    remove: string;
    clear: string;
    reset: string;
    enabled: string;
    disabled: string;
    active: string;
    inactive: string;
    preview: string;
    visit: string;
    retry: string;
    optional: string;
    refresh: string;
    back: string;
    continue: string;
    dismiss: string;
    copy: string;
    copied: string;
    download: string;
    send: string;
    sendMessage: string;
    cancelBuild: string;
  };

  // ============================================
  // LOGIN & AUTH
  // ============================================

  pages: {
    login: {
      title: string;
      subtitle: string;
      username: string;
      usernamePlaceholder: string;
      password: string;
      passwordPlaceholder: string;
      rememberMe: string;
      signIn: string;
      signingIn: string;
      forgotPassword: string;
      version: string;
      showPassword: string;
      hidePassword: string;
    };

    changePassword: {
      title: string;
      subtitle: string;
      requiredSubtitle: string;
      currentPassword: string;
      currentPasswordPlaceholder: string;
      newPassword: string;
      newPasswordPlaceholder: string;
      confirmPassword: string;
      confirmPasswordPlaceholder: string;
      passwordRequirements: string;
      changePassword: string;
      changingPassword: string;
      strengthWeak: string;
      strengthFair: string;
      strengthGood: string;
      strengthStrong: string;
      atLeast8Chars: string;
      oneUppercase: string;
      oneLowercase: string;
      oneNumber: string;
      passwordsMismatch: string;
      passwordMustDiffer: string;
      passwordChanged: string;
      updatePassword: string;
      updatingPassword: string;
      logOutInstead: string;
      backToDashboard: string;
    };

    // ============================================
    // BUILDER
    // ============================================

    builder: {
      title: string;
      whatToBuild: string;
      describeYourApp: string;
      chooseExample: string;
      buildingInProgress: string;
      buildInProgress: string;
      thinkingInProgress: string;
    };

    // ============================================
    // INTEGRATIONS
    // ============================================

    integrations: {
      title: string;
      subtitle: string;
      available: string;
      enabled: string;
      configured: string;
      configureIntegration: string;
      addIntegration: string;
      testConnection: string;
      connecting: string;
      disconnectIntegration: string;
      authTypeApiKey: string;
      authTypeOAuth: string;
      authTypeServiceAccount: string;
      authTypeNoAuth: string;
      authTypeBrowserSession: string;
      successfullyConfigured: string;
      connectionFailed: string;
      requiredField: string;
      optional: string;
      newIntegration: string;
      editIntegration: string;
      importIntegration: string;
      exportIntegration: string;
      importFromFile: string;
      identity: string;
      identityHint: string;
      configFields: string;
      configFieldsHint: string;
      skillFile: string;
      skillFileHint: string;
      actions: string;
      actionsHint: string;
      testing: string;
      testingHint: string;
      integrationKey: string;
      integrationKeyHint: string;
      displayName: string;
      provider: string;
      category: string;
      authType: string;
      description: string;
      fieldKey: string;
      fieldLabel: string;
      fieldType: string;
      helpText: string;
      secret: string;
      actionName: string;
      actionDescription: string;
      httpMethod: string;
      baseUrl: string;
      urlPath: string;
      headers: string;
      queryParams: string;
      bodyTemplate: string;
      mutates: string;
      httpConfig: string;
      addField: string;
      addAction: string;
      removeField: string;
      removeAction: string;
      runTest: string;
      testingAction: string;
      yourCredentials: string;
      credentialsHint: string;
      tryAnAction: string;
      chooseAction: string;
      testResults: string;
      testSuccess: string;
      testFailed: string;
      showDetails: string;
      hideDetails: string;
      autoSaveHint: string;
      noIntegrationsYet: string;
      noIntegrationsMatch: string;
      noConfigFields: string;
      noActions: string;
      noSkillFile: string;
      addFirstIntegration: string;
      clearFilters: string;
      actionsCount: string;
      configFieldsCount: string;
      howToConnect: string;
      viewCredentialGuide: string;
      credentialGuideTitle: (name: string) => string;
      deleteIntegration: string;
      deleteConfirmation: (name: string) => string;
      cannotBeUndone: string;
      saving: string;
      saved: string;
      saveFailed: string;
      securityNotice: string;
      invalidImportFile: string;
      importSuccess: string;
      exportAll: string;
      importFile: string;
      useInChat: string;
      buildInChat: string;
      exportAllSuccess: string;
      noIntegrationsToExport: string;
      exporting: string;
      editCredentials: string;
      credentialsConfigured: string;
      maskedValue: string;
      cancelEdit: string;
      saveCredentials: string;
      showPassword: string;
      hidePassword: string;
      setupCredentialsBanner: string;
      all: string;
      integrationsCount: string;
      searchPlaceholder: string;
      showMore: string;
      showLess: string;
      systemSectionTitle: string;
      systemSectionSubtitle: string;
      systemSkillsTitle: string;
      mySectionTitle: string;
      mySectionSubtitle: string;
      tabPlatform: string;
      tabMine: string;
      tabWebhooks: string;
      sessionChecking: string;
      sessionConnectDefaultGuide: string;
      sessionOpenLogin: string;
      sessionWaiting: string;
      sessionCancelWait: string;
      sessionActiveSince: (date: string) => string;
      sessionRenew: string;
      sessionRetry: string;
      sessionFailedDefault: string;
      actionAutomationTag: string;
      actionAutomationPending: string;
      actionRefineSteps: string;
      createAutomations: string;
    };

    // ============================================
    // PLATFORM INTEGRATIONS (Google/Microsoft)
    // ============================================

    platformIntegrations: {
      title: string;
      subtitle: string;
      connect: string;
      disconnect: string;
      connected: string;
      notConnected: string;
      connecting: string;
      disconnectConfirm: (provider: string) => string;
      disconnectWarning: (provider: string) => string;
      connectionSuccess: string;
      connectionFailed: string;
      google: string;
      googleDescription: string;
      microsoft: string;
      microsoftDescription: string;
    };

    // ============================================
    // PIPEDREAM (extended external connections)
    // ============================================

    pipedream: {
      title: string;
      subtitle: string;
      enableLabel: string;
      disabledExplainer: string;
      pendingConfig: string;
      pendingConfigHint: string;
      connectedTitle: string;
      noAccounts: string;
      connectService: string;
      disconnect: string;
      connecting: string;
      nativeFirstNote: string;
      configHint: string;
      configureProject: string;
      clientIdLabel: string;
      clientSecretLabel: string;
      projectIdLabel: string;
      environmentLabel: string;
      envDevelopment: string;
      envProduction: string;
      configSecurityNotice: string;
      saveConfig: string;
      configSaved: string;
      configSaveFailed: string;
      configuredSummary: string;
      changeConfig: string;
      removeConfig: string;
      removeConfigTitle: string;
      removeConfigConfirm: string;
      configRemoved: string;
      configRemoveFailed: string;
      showSecret: string;
      hideSecret: string;
      cardTitle: string;
      cardBadge: string;
      cardTeaser: string;
      explore: string;
      collapse: string;
      catalogTitle: string;
      catalogSubtitle: string;
      searchPlaceholder: string;
      searchEmpty: string;
      connectApp: string;
      networkSettings: string;
      poweredBy: string;
      configureFirst: string;
      configRequired: string;
      disconnectConfirmTitle: string;
      disconnectConfirmBody: string;
      cancel: string;
    };

    // ============================================
    // WEBHOOKS (triggers)
    // ============================================

    webhooks: {
      title: string;
      subtitle: string;
      create: string;
      empty: string;
      colIntegration: string;
      colEvent: string;
      colTarget: string;
      colUrl: string;
      colStatus: string;
      copyUrl: string;
      copied: string;
      deleteWebhook: string;
      deleteConfirm: string;
      deleted: string;
      created: string;
      createFailed: string;
      dialogTitle: string;
      fieldIntegration: string;
      fieldEvent: string;
      fieldArtifact: string;
      fieldEntrypoint: string;
      entrypointHint: string;
      submit: string;
      noWebhookIntegrations: string;
      noArtifacts: string;
      selectIntegration: string;
      selectEvent: string;
      selectArtifact: string;
      statusEnabled: string;
      statusDisabled: string;
    };

    // ============================================
    // USERS & TEAMS
    // ============================================

    users: {
      title: string;
      users: string;
      teams: string;
      addUser: string;
      addTeam: string;
      resetPassword: string;
      deleteUser: string;
      deleteTeam: string;
      username: string;
      email: string;
      role: string;
      roleAdmin: string;
      roleUser: string;
      action: string;
      createdBy: string;
      on: string;
      teamName: string;
      teamDescription: string;
      members: string;
      noMembers: string;
      addMember: string;
      removeMember: string;
      confirmDelete: string;
      deleteConfirmation: string;
      deleted: string;
      subtitle: string;
      overview: string;
      noUsersMatch: string;
      noUsersYet: string;
      noTeamsYet: string;
      resetPasswordFor: string;
      created: string;
      lastLogin: string;
      leaveEmptyForDefault: string;
      whatDoesTeamDo: string;
      passwordDefaultHint: string;
      roleSuperAdmin: string;
      tokensUsed: string;
      customLimit: string;
      customLimitHint: string;
      resetToDefault: string;
      setTokenLimit: string;
      setTokenLimitFor: string;
      limitInMillions: string;
      mTokens: string;
      resetUsageAction: string;
      resetUsageFor: string;
      resetUsageHint: string;
      usernamePlaceholder: string;
      teamNamePlaceholder: string;
    };

    // ============================================
    // RESOURCES & MONITORING
    // ============================================

    resources: {
      title: string;
      subtitle: string;
      activeUsers: string;
      runningApps: string;
      diskUsage: string;
      systemHealth: string;
      usage: string;
      of: string;
      healthHealthy: string;
      healthWarning: string;
      healthDegraded: string;
      activityLog: string;
      recentActivity: string;
      logs: string;
      category: string;
      all: string;
      buildStarted: string;
      buildCompleted: string;
      appLaunched: string;
      appTerminated: string;
      integrationConfigured: string;
    };

    // ============================================
    // BRANDING & COMPANY SETTINGS
    // ============================================

    branding: {
      title: string;
      branding: string;
      instructions: string;
      knowledge: string;
      companyName: string;
      companyLogo: string;
      uploadLogo: string;
      logoUpdated: string;
      colorScheme: string;
      primaryColor: string;
      accentColor: string;
      colorNotSet: string;
      typography: string;
      fontSize: string;
      fontFamily: string;
      companyInstructions: string;
      instructionsPlaceholder: string;
      knowledgeBase: string;
      addFiles: string;
      fileSize: string;
      uploadedFiles: string;
      saved: string;
      saving: string;
      unsavedChanges: string;
      research: string;
      researchDescription: string;
      websiteUrl: string;
      websiteUrlPlaceholder: string;
      researchBrand: string;
      researching: string;
      researchComplete: string;
      researchNoColors: string;
      researchFailed: string;
      researchRunning: string;
      analyzingWebsite: string;
      extractingBrand: string;
      researchStep: string;
      researchWarningTitle: string;
      researchWarningDesc: string;
      memoryWarningTitle: string;
      memoryWarningDesc: string;
      designSystem: string;
      designSystemDescription: string;
      palette: string;
      cssVariables: string;
      spacing: string;
      borderRadius: string;
      shapeLanguage: string;
      shadows: string;
      primaryButton: string;
      frameworks: string;
      visualVibe: string;
      mood: string;
      shape: string;
      density: string;
      texture: string;
      hero: string;
      noDesignSystem: string;
      designNotes: string;
      designNotesPlaceholder: string;
    };
  };

  // ============================================
  // QUICK ACTIONS (Builder)
  // ============================================

  quickActions: {
    test: string;
    testDesc: string;
    landingPage: string;
    landingPageDesc: string;
    analyticsDashboard: string;
    analyticsDashboardDesc: string;
    presentation: string;
    presentationDesc: string;
    portfolio: string;
    portfolioDesc: string;
  };
  // ============================================
  // FRIENDLY MESSAGES (Phase descriptions)
  // ============================================

  messages: {
    preparing: string;
    planning: string;
    coding: string;
    building: string;
    testing: string;
    fixing: string;
    uiPolish: string;
    deploying: string;
    reviewing: string;
    finalizing: string;
    successMessage: string;
    successWithArtifacts: (count: number) => string;
    failureMessage: (reason: string) => string;
  };

  // ============================================
  // SIDE PANEL
  // ============================================

  sidePanel: {
    files: string;
    output: string;
    preview: string;
    desktop: string;
    tablet: string;
    mobile: string;
    noOutput: string;
    noFiles: string;
    runningPreview: string;
    previewUnavailable: string;
    previewWillAppear: string;
    buildingApp: string;
    startingApp: string;
    previewFailed: string;
    thisMayTakeAMoment: string;
    appRunning: string;
    appStopped: string;
    refreshPreview: string;
    openInNewTab: string;
    stopApp: string;
    previewExpired: string;
    previewExpiredMessage: string;
    restartPreview: string;
    restartingPreview: string;
    loadingPreview: string;
    previewNotReady: string;
    previewNotReadyMessage: string;
    buildPhase1: string;
    buildPhase2: string;
    buildPhase3: string;
    buildPhase4: string;
    buildPhase5: string;
  };

  // ============================================
  // CHAT PANEL
  // ============================================

  chatPanel: {
    describeYourApp: string;
    attachFile: string;
    cancelBuild: string;
    sendMessage: string;
    ekoaAgent: string;
    justNow: string;
    minutesAgo: (n: number) => string;
    buildInitiated: string;
    outputAvailable: string;
    loadingMessages: string;
    placeholder: string;
    placeholderBuild: string;
    shiftEnterHint: string;
    stop: string;
    thinking: string;
    thinkingLive: string;
    thoughtForSeconds: (n: number) => string;
    showThinking: string;
    hideThinking: string;
  };

  // ============================================
  // ATTACHMENTS
  // ============================================

  attachments: {
    attachFile: string;
    supportedFormats: string;
    maxSize: string;
    removeFile: string;
  };

  // ============================================
  // STATUS MESSAGES
  // ============================================

  status: {
    buildInitiated: string;
    outputAvailable: string;
    buildInProgress: string;
    buildComplete: string;
    buildFailed: string;
    appRunning: string;
    appStopped: string;
    noOutput: string;
  };

  // ============================================
  // PLACEHOLDER PAGE
  // ============================================

  placeholder: {
    comingSoon: string;
    underDevelopment: string;
  };

  // ============================================
  // HEADER
  // ============================================

  header: {
    changeLanguage: string;
    logout: string;
    newSession: string;
    toggleSidebar: string;
    userMenu: string;
    tokens: string;
    tokensUsed: string;
    tokensRemaining: string;
    creditBalance: string;
  };

  // ============================================
  // BILLING & USAGE
  // ============================================

  pages_billing: {
    title: string;
    subtitle: string;
    // Current period
    currentPeriod: string;
    tokensUsedOf: string;
    periodResetsOn: string;
    // Credit balance
    creditBalance: string;
    creditBalanceLabel: string;
    overageEnabled: string;
    overageDisabled: string;
    toggleOverage: string;
    toggleOverageDesc: string;
    creditsNeverExpire: string;
    // Buy credits
    buyCredits: string;
    priceInfo: string;
    blocks: string;
    totalCost: string;
    buy: string;
    purchasing: string;
    purchaseSuccess: string;
    purchaseError: string;
    stripePending: string;
    // Usage breakdown
    usageBreakdown: string;
    agentType: string;
    tokensLabel: string;
    percentage: string;
    noUsageYet: string;
    // Usage history
    usageHistory: string;
    date: string;
    tokensUsedColumn: string;
    costUsd: string;
    noHistoryYet: string;
    page: string;
    of: string;
    previous: string;
    next: string;
    // Admin
    globalOverageControl: string;
    globalOverageDesc: string;
    globalOverageWarning: string;
    globalOverageEnabled: string;
    globalOverageDisabled: string;
    // Warning banner
    warningBannerText: (pct: number) => string;
    manageBilling: string;
  };

  // ============================================
  // NOT FOUND
  // ============================================

  notFound: {
    title: string;
    message: string;
    goToBuilder: string;
  };

  // ============================================
  // OUTPUT PANEL
  // ============================================

  outputPanel: {
    copyOutput: string;
    copied: string;
    waitingForOutput: string;
    noOutputYet: string;
    scrollToBottom: string;
  };

  // ============================================
  // SESSIONS PANEL
  // ============================================

  sessionsPanel: {
    sessions: string;
    collapseSessions: string;
    newSession: string;
    expandSessions: string;
    searchSessions: string;
    noSessionsYet: string;
    noMatchingSessions: string;
    rename: string;
    justNow: string;
    minutesAgo: (n: number) => string;
    hoursAgo: (n: number) => string;
    daysAgo: (n: number) => string;
  };

  // ============================================
  // PLATFORM SETTINGS
  // ============================================

  pages_gatewayKeys: {
    title: string;
    subtitle: string;
    mintLabel: string;
    mintPlaceholder: string;
    mintButton: string;
    minting: string;
    showOnceTitle: string;
    showOnceWarning: string;
    copyKey: string;
    copied: string;
    copyFailed: string;
    dismiss: string;
    configTitle: string;
    configHint: string;
    listTitle: string;
    listEmpty: string;
    colLabel: string;
    colKey: string;
    colCreated: string;
    colLastUsed: string;
    colStatus: string;
    statusActive: string;
    statusRevoked: string;
    neverUsed: string;
    revoke: string;
    revokeConfirm: string;
    cancel: string;
  };
  pages_platform: {
    title: string;
    subtitle: string;
    loadingSettings: string;
    tryAgain: string;
    language: string;
    languageDesc: string;
    english: string;
    portuguesePt: string;
    guardRails: string;
    guardRailsDesc: string;
    enforceBranding: string;
    enforceBrandingDesc: string;
    allowPreviews: string;
    allowPreviewsDesc: string;
    enableUIPolish: string;
    enableUIPolishDesc: string;
    brandingNotEnforced: string;
    brandingNotEnforcedDesc: string;
    saveChanges: string;
    settingsSaved: string;
    headerSubtitle: string;
    sectionGeneral: string;
    sectionGeneralDesc: string;
    sectionChat: string;
    sectionChatDesc: string;
    sectionAdvanced: string;
    sectionAdvancedDesc: string;
    platformName: string;
    platformNameDesc: string;
    timezone: string;
    timezoneDesc: string;
    guidedMode: string;
    guidedModeDesc: string;
    showExampleCards: string;
    showExampleCardsDesc: string;
    dataDirectory: string;
    dataDirectoryDesc: string;
    resetAll: string;
    resetAllDesc: string;
    reset: string;
    confirmReset: string;
    saved: string;
  };

  // ============================================
  // MY ARTIFACTS
  // ============================================

  pages_artifacts: {
    title: string;
    subtitle: (count: number) => string;
    refreshArtifacts: string;
    searchPlaceholder: string;
    untitledArtifact: string;
    deleteArtifact: string;
    deleteArtifactAriaLabel: string;
    deleteConfirmation: (name: string) => string;
    cannotBeUndone: string;
    backToArtifacts: string;
    details: string;
    detailId: string;
    detailStatus: string;
    detailType: string;
    detailCreated: string;
    detailUpdated: string;
    unknownType: string;
    createdOn: string;
    updatedOn: string;
    noArtifactsTitle: string;
    noArtifactsDesc: string;
    goToBuilder: string;
    noMatchingFilters: string;
    clearFilters: string;
    failedToLoad: string;
    failedToDelete: string;
    filterAll: string;
    filterRunning: string;
    filterReady: string;
    filterBuilding: string;
    filterDraft: string;
    filterFailed: string;
    filterShared: string;
    sortRecent: string;
    sortName: string;
    sortStatus: string;
    statusDraft: string;
    statusQueued: string;
    statusInstalling: string;
    statusBuilding: string;
    statusStarting: string;
    statusRunning: string;
    statusHealthy: string;
    statusReady: string;
    statusCompleted: string;
    statusFailed: string;
    statusStopped: string;
    startApp: string;
    stopApp: string;
    share: string;
    unshare: string;
    shared: string;
    viewLogs: string;
    port: string;
    yes: string;
    no: string;
    preview: string;
    openInNewTab: string;
    openApp: string;
    notRunning: string;
    continueWorking: string;
    copyRunLink: string;
    copyBuildLink: string;
    copied: string;
    downloadCode: string;
    updateFromFile: string;
    updating: string;
    importArtifact: string;
    importing: string;
    versionHistory: string;
    brokenTitle: string;
    brokenAria: string;
    logsTitle: string;
    loadingLogs: string;
    yesterday: string;
    daysAgo: (count: number) => string;
    use: string;
    appsSection: {
      title: string;
      subtitle: string;
    };
    startingPoints: {
      title: string;
      subtitle: string;
      show: (count: number) => string;
      hide: string;
      empty: string;
      useThis: string;
      useFailed: string;
      openAppAria: string;
      customizeInChat: string;
      updateAvailable: string;
      updateDialogTitle: string;
      updateDialogBody: (version: string) => string;
      updateNow: string;
      keepMine: string;
      updateApplied: string;
      updateFailed: string;
      keptVersion: string;
      filterAll: string;
      filterWebApps: string;
      filterAgents: string;
      filterLandings: string;
      filterPresentations: string;
    };
    continueWhereYouLeftOff: {
      title: string;
      viewAll: string;
      scrollPrev: string;
      scrollNext: string;
    };
  };

  // ============================================
  // MEMORY
  // ============================================

  pages_memory: {
    title: string;
    subtitle: string;
    addMemory: string;
    editMemory: string;
    deleteMemory: string;
    deleteConfirm: string;
    deleteConfirmBulk: string;
    noMemories: string;
    noMemoriesDesc: string;
    pagination: {
      previous: string;
      next: string;
    };
    form: {
      title: string;
      type: string;
      content: string;
      tags: string;
      tagsHint: string;
      visibility: string;
      scope: string;
      save: string;
      cancel: string;
    };
    types: {
      lesson: string;
      workflow: string;
      fact: string;
      preference: string;
      context: string;
      pattern: string;
    };
    scopes: {
      company: string;
      individual: string;
      operational: string;
      marketing: string;
      technical: string;
      branding: string;
    };
    visibility: {
      shared: string;
      private: string;
    };
    stats: {
      total: string;
      verified: string;
      recent: string;
      topTags: string;
    };
    filters: {
      allTypes: string;
      allScopes: string;
      allVisibility: string;
      search: string;
      clearFilters: string;
    };
    actions: {
      edit: string;
      delete: string;
      verify: string;
      unverify: string;
      makeShared: string;
      makePrivate: string;
      deleteSelected: string;
      selected: string;
    };
    source: {
      agent: string;
      manual: string;
      job: string;
      usageCount: string;
    };
    // Tabs
    tabs: {
      overview: string;
      alwaysActive: string;
      guardrails: string;
      recentPatterns: string;
      settings: string;
    };
    // Tiers
    tiers: {
      core: string;
      active: string;
      archive: string;
      promote: string;
      demote: string;
      archiveAction: string;
      restore: string;
    };
    // Origins
    origins: {
      manual: string;
      agentBlock: string;
      autoExtraction: string;
      signalAggregation: string;
      consolidation: string;
    };
    // Core tier
    coreTier: {
      slotsUsed: string;
      slotsAvailable: string;
      full: string;
      fullDesc: string;
      addToCore: string;
      removeFromCore: string;
      promoteCandidates: string;
    };
    // Recent
    recent: {
      lastUsed: string;
      neverUsed: string;
      timeFilter: {
        week: string;
        month: string;
        all: string;
      };
    };
    // Explainer
    explainer: {
      title: string;
      coreDesc: string;
      activeDesc: string;
      archiveDesc: string;
      autoDesc: string;
    };
    // Settings
    memorySettings: {
      title: string;
      autoExtract: string;
      autoExtractDesc: string;
      maxCore: string;
      maxCoreDesc: string;
    };
    // Usage
    usage: {
      usedTimes: (n: number) => string;
      lastUsedAgo: string;
      neverUsed: string;
    };
    // Guardrails
    guardrails: {
      title: string;
      subtitle: string;
      addPlaceholder: string;
      add: string;
      empty: string;
      emptyDesc: string;
    };
  };

  // ============================================
  // SIDEBAR
  // ============================================

  sidebar: {
    chat: string;
    settings: string;
    artifacts: string;
    integrations: string;
    automations: string;
    users: string;
    memory: string;
    knowledge: string;
    platform: string;
    chatSettings: string;
    branding: string;
    footer: string;
    newConversation: string;
    toggleSidebar: string;
  };

  // ============================================
  // EMPTY STATE
  // ============================================

  emptyState: {
    greeting: string;
    subtitle: string;
    welcomeMessage: string;
    examplePrompts: {
      build: string[];
      chat: string[];
      integrate: string[];
    };
    modeTaglines: {
      build: string;
      chat: string;
      integrate: string;
      branding: string;
    };
    modeSubtitles: {
      build: string;
      chat: string;
      integrate: string;
      branding: string;
    };
    categoryLabels: {
      chat: string;
      build: string;
      explore: string;
      manage: string;
      integrate: string;
      branding: string;
    };
    viewAll: string;
    showLess: string;
    suggestionsLabel: string;
    turnOffGuidedMode: string;
    enableGuidedMode: string;
    loadingMessages: string[];
    questionTagline: string;
    taglinePrefix: string;
    taglineVerbs: string[];
    shortcuts: {
      close: string;
      history: string;
      shortcuts: string;
    };
    shortcutsModal: {
      title: string;
      send: string;
      newLine: string;
      closeButton: string;
    };
    composeControls: {
      attach: string;
      capture: string;
      pasteUrl: string;
      pasteUrlPlaceholder: string;
      pasteUrlConfirm: string;
      file: string;
      folder: string;
    };
  };

  // ============================================
  // GUIDED ONBOARDING
  // ============================================

  onboarding: {
    /** Session name given to the persistent onboarding session. */
    sessionName: string;
    /** Entry card shown in the empty chat state (fresh + resume variants). */
    card: {
      title: string;
      description: string;
      cta: string;
      resumeTitle: string;
      resumeDescription: string;
      resumeCta: string;
      /** Inline error when the session could not be created server-side. */
      error: string;
    };
    /** First-turn welcome bubble + quick-reply chips for the onboarding session. */
    welcome: {
      greeting: string;
      question: string;
      /** Quick replies that SEND their text through the composer. */
      chips: string[];
      /** Quick reply that only focuses the composer (answer in own words). */
      freeformChip: string;
    };
  };

  // ============================================
  // BACKEND ERRORS
  // ============================================

  backendErrors: {
    unknownError: string;
    networkError: string;
    unauthorized: string;
    forbidden: string;
    notFound: string;
    timeout: string;
    serverError: string;
    rateLimited: string;
    invalidRequest: string;
    sessionExpired: string;
    connectionLost: string;
    buildFailed: string;
    compilationError: string;
    artifactNotFound: string;
    integrationFailed: string;
    credentialExpired: string;
    quotaExceeded: string;
    fileTooLarge: string;
    unsupportedFormat: string;
  };

  // ============================================
  // FRIENDLY MESSAGES (non-React utility)
  // ============================================

  friendlyMessages: {
    // Phase messages
    phases: {
      preparing: string;
      planning: string;
      coding: string;
      testing: string;
      fixing: string;
      reviewing: string;
      deploying: string;
      verifying: string;
      complete: string;
    };
    phaseDefault: (phase: string) => string;

    // Tool activity messages
    tools: {
      write_file: string;
      read_file: string;
      edit_file: string;
      bash: string;
      web_search: string;
      list_files: string;
    };
    toolDefault: (name: string) => string;

    // Summary
    buildSuccess: string;
    buildFailed: string;

    // Rotating filler messages
    fillers: string[];

    // Skill messages
    usingSkill: (name: string) => string;

    // Brief tool activity
    writingPath: (path: string) => string;
    writingFile: string;
    editingPath: (path: string) => string;
    editingFile: string;
    readingPath: (path: string) => string;
    readingFile: string;
    runningCmd: (cmd: string) => string;
    runningCommand: string;
    searchingFor: (pattern: string) => string;
    searchingCode: string;
    findingPattern: (pattern: string) => string;
    findingFiles: string;
    listingPath: (path: string) => string;
    listingFiles: string;
    deletingPath: (path: string) => string;
    deleting: string;
    usingTool: (name: string) => string;
  };

  // ============================================
  // VERSIONS PANEL
  // ============================================

  versions: {
    tab: string;
    appearAfterBuild: string;
    historyTitle: string;
    refresh: string;
    loading: string;
    failedToLoad: string;
    failedToRestore: string;
    noVersionsYet: string;
    current: string;
    buildFailed: string;
    buildFailedTitle: string;
    restored: string;
    noMessage: string;
    restoreThisVersion: string;
    restoreToTitle: (sha: string) => string;
    restoreExplain: string;
    cancel: string;
    restoreVersion: string;
    showHistory: string;
  };

  // ============================================
  // AUTOMATIONS
  // ============================================

  automations: {
    list: {
      title: string;
      loading: string;
      total: (n: number) => string;
      newAutomation: string;
      noDescription: string;
      stepCount: (n: number) => string;
      open: string;
      deleteAria: string;
      deleteConfirm: (name: string) => string;
      managedBy: (integrationKey: string) => string;
    };
    emptyState: {
      title: string;
      description: string;
      create: string;
    };
    editor: {
      loading: string;
      namePlaceholder: string;
      saving: string;
      save: string;
      saved: string;
      deleteAria: string;
      deleteConfirm: (name: string) => string;
      tabEditor: string;
      tabHistory: string;
      managedBanner: (integrationKey: string) => string;
      managedBannerLink: string;
    };
    newPage: {
      title: string;
      subtitle: string;
      goalLabel: string;
      goalPlaceholder: string;
      nameLabel: string;
      namePlaceholder: string;
      drafting: string;
      connectFirst: (service: string) => string;
      openIntegrations: string;
      somethingWrong: string;
      cancel: string;
      draftingBtn: string;
      draftSteps: string;
      hint1: string;
      hint2: string;
      hint3: string;
      hint4: string;
    };
    goalEditor: {
      label: string;
      placeholder: string;
      hint: string;
      regenerating: string;
      regenerate: string;
    };
    steps: {
      editAria: string;
      clickToEdit: string;
      dragStep: string;
      deleteStep: string;
      stepLabel: (n: number) => string;
      fixingTitle: string;
      fixingBadge: string;
      insertedTitle: string;
      insertedBadge: string;
      rewrittenTitle: string;
      rewrittenBadge: string;
      descriptionPlaceholder: string;
      descriptionLabel: string;
      urlPlaceholder: string;
      durationLabel: string;
      expectedOutcome: string;
      requiredParen: string;
      optionalParen: string;
      expectedOutcomePlaceholder: string;
      expectedOutcomeLabel: string;
      status: {
        pending: string;
        running: string;
        completed: string;
        failed: string;
        skipped: string;
      };
    };
    stepList: {
      addFirst: string;
      insertHere: string;
      addStep: string;
    };
    stepTypes: {
      browser: { label: string; hint: string };
      verify: { label: string; hint: string };
      integration: { label: string; hint: string };
      sub_automation: { label: string; hint: string };
      navigate: { label: string; hint: string };
      wait: { label: string; hint: string };
      local_command: { label: string; hint: string };
      api_call: { label: string; hint: string };
      ekoa_action: { label: string; hint: string };
    };
    forms: {
      commandLabel: string;
      cwd: string;
      homePlaceholder: string;
      timeoutMs: string;
      headers: string;
      headerKeyPlaceholder: string;
      headerValuePlaceholder: string;
      addHeader: string;
      bodyKind: string;
      authIntegration: string;
      authPlaceholder: string;
      timeout: string;
      body: string;
      artifactSlug: string;
      capability: string;
      inputsJson: string;
      invalidJson: string;
    };
    integrationPicker: {
      none: string;
      placeholder: string;
    };
    subAutomationPicker: {
      none: string;
      placeholder: string;
    };
    consent: {
      title: string;
      subtitle: string;
      wantsPrefix: string;
      wantsSuffix: string;
      toggleArgv: (shown: boolean) => string;
      revokablePrefix: string;
      revokableLocation: string;
      stop: string;
      approveOnce: string;
      approveAlways: string;
    };
    runViewer: {
      title: string;
      cancel: string;
      runAction: string;
      rerun: string;
      inputsHelp: string;
      requiredHint: string;
      autoExtractPlaceholder: string;
      fieldsBlank: (n: number) => string;
      awaitingPrefix: string;
      awaitingSuffix: string;
      daemonPrefix: string;
      daemonRunCommand: string;
      daemonDriveBrowser: string;
      daemonSuffix: string;
      errorPrefix: string;
      stepLabel: (n: number) => string;
      correctionPlaceholder: string;
      save: string;
      thumbsUp: string;
      thumbsDown: string;
      suggestCorrection: string;
      addStepsHint: string;
      needsHelpOnStep: (n: number) => string;
      browserOpenHint: string;
      continue: string;
      stopRun: string;
      pausedAlt: string;
      stepScreenshotAlt: (n: number) => string;
      status: {
        idle: string;
        running: string;
        completed: string;
        failed: string;
        cancelled: string;
        awaiting_integration: string;
        paused_for_user: string;
        awaiting_consent: string;
        awaiting_daemon: string;
      };
      tier: {
        cached: string;
        vision: string;
        recovered: string;
      };
      toggleReqRes: (shown: boolean) => string;
      networkSuffix: string;
      section: {
        request: string;
        response: string;
        transportError: string;
      };
      labelHeaders: string;
      labelBody: string;
      empty: string;
      fixingStep: string;
      attemptSuffix: (n: number) => string;
      failurePrefix: string;
      patchVerb: {
        insertedBefore: string;
        rewrote: string;
        skipped: string;
        patched: string;
      };
      newPrefix: string;
      fixerAborted: string;
    };
    runHistory: {
      loading: string;
      empty: string;
      stepCount: (n: number) => string;
      failedCount: (n: number) => string;
      stepLabel: (n: number) => string;
      screenshotAlt: (n: number) => string;
      noSteps: string;
      status: {
        completed: string;
        failed: string;
        cancelled: string;
        running: string;
        awaiting_integration: string;
      };
    };
    runActivityBar: {
      fixingStepLabel: (n: number) => string;
      attemptSuffix: (n: number) => string;
      fixingAsking: string;
      whatFailed: (msg: string) => string;
      cancel: string;
      stepLabel: (n: number) => string;
      waitingPrefix: string;
      waitingSuffix: string;
      integrationFallback: string;
      runComplete: string;
      runFailed: string;
      runCancelled: string;
      fixerAbortedOnStep: (n: number) => string;
      verbInsertedBefore: string;
      verbRewrote: string;
      verbSkipped: string;
      verbPatched: string;
      verbStep: (verb: string, n: number) => string;
      needsYouOnStep: (n: number) => string;
      continue: string;
      stopRun: string;
    };
    pauseOverlay: {
      needsYou: string;
      stepTitle: (n: number) => string;
      livePageLabel: string;
      screenshotLabel: string;
      screenshotAlt: string;
      stopConfirm: string;
      stopRun: string;
      continue: string;
      enterHint: string;
      runOnAutomationPrefix: string;
      badge: {
        live: string;
        connecting: string;
        reconnecting: string;
        offline: string;
        idle: string;
      };
      footnote: {
        connected: string;
        connecting: string;
        disconnected: string;
        failed: string;
        screenshot: string;
        waiting: string;
      };
    };
    triggerPicker: {
      title: string;
      autoRuns: string;
      statePrefix: string;
      registrationWarningPrefix: string;
      removing: string;
      remove: string;
      manual: string;
      whenSomething: string;
      integration: string;
      pickIntegration: string;
      whenHappens: string;
      pickTrigger: string;
      creating: string;
      create: string;
      createError: string;
      removeError: string;
      removeConfirm: string;
      state: {
        auto: string;
        pending: string;
        manual: string;
        failed: string;
      };
      manualSetupTitle: string;
      manualSetupHint: string;
      address: string;
      secret: string;
      hide: string;
      show: string;
      copy: string;
    };
  };
}
