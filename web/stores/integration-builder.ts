'use client';

/**
 * Integration Builder Store
 *
 * Manages the AI-powered integration builder UI state:
 * - Chat session (request-response; no streamed prose - FC-035)
 * - Generated integration package
 * - Test credentials and results
 * - Side panel tab state
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type {
  IntegrationBuilderOutput,
  BuilderChatMessage,
  IntegrationTestResult,
} from '@/types/integration';

export type BuilderTab = 'skill' | 'config' | 'actions' | 'tests';

interface IntegrationBuilderState {
  // Session
  sessionId: string | null;
  selectedIntegrationKey: string | null;
  messages: BuilderChatMessage[];
  isGenerating: boolean;

  // Generated output
  currentPackage: IntegrationBuilderOutput | null;
  validationErrors: string[];

  // Testing
  testCredentials: Record<string, string | number | boolean>;
  testResults: IntegrationTestResult[];
  isTesting: boolean;
  hasSuccessfulTest: boolean;

  // Side panel
  sidePanelTab: BuilderTab;
  isSidePanelOpen: boolean;

  // UI state
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // Retry: last message we tried to send, kept on failure and cleared on success
  lastSentMessage: string | null;

  // Actions
  sendMessage: (message: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  loadIntegration: (integrationKey: string) => Promise<void>;
  saveIntegration: () => Promise<{ success: boolean; error?: string }>;
  testAction: (
    actionKey: string,
    testInput?: Record<string, unknown>,
  ) => Promise<void>;
  setTestCredentials: (creds: Record<string, string | number | boolean>) => void;
  setSidePanelTab: (tab: BuilderTab) => void;
  toggleSidePanel: () => void;
  clearSession: () => void;
  clearError: () => void;
  isReadyToSave: () => boolean;
}

export const useIntegrationBuilderStore = create<IntegrationBuilderState>()(
  (set, get) => ({
    // Initial state
    sessionId: null,
    selectedIntegrationKey: null,
    messages: [],
    isGenerating: false,
    currentPackage: null,
    validationErrors: [],
    testCredentials: {},
    testResults: [],
    isTesting: false,
    hasSuccessfulTest: false,
    sidePanelTab: 'skill',
    isSidePanelOpen: true,
    isLoading: false,
    isSaving: false,
    error: null,
    lastSentMessage: null,

    sendMessage: async (message: string) => {
      const { sessionId } = get();

      // Add user message immediately
      const userMessage: BuilderChatMessage = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, userMessage],
        isGenerating: true,
        error: null,
        lastSentMessage: message,
      }));

      // FC-035: the integration-builder chat is request-response (POST
      // /integration-builder/chat, 300s via the descriptor); there is NO streamed
      // prose. `isGenerating` is the busy/progress state until the reply lands.
      // Language is auto-injected by the transport for language-flagged ops.
      const res = await tryCall(() =>
        api.integrationBuilder.chat({ message, builderSessionId: sessionId || undefined }),
      );

      if (res.ok) {
        const { builderSessionId, generatedPackage, validationErrors } = res.data;
        // The passthrough GeneratedPackage carries the full { skillMd, config } view-model
        // when the agent produced one; an interim reply carries no `config`.
        const pkg = generatedPackage as unknown as IntegrationBuilderOutput | undefined;

        set(() => {
          const updates: Partial<IntegrationBuilderState> = {
            sessionId: builderSessionId,
            isGenerating: false,
            // lastSentMessage intentionally kept — powers the Resend button on the latest user msg.
            error: null,
          };

          if (pkg && pkg.config) {
            updates.currentPackage = pkg;
            updates.validationErrors = (validationErrors ?? []).map((e) => e.message);
            updates.sidePanelTab = 'config';
            updates.isSidePanelOpen = true;
          }

          return updates as IntegrationBuilderState;
        });
      } else {
        const errorMsg = res.error.message || 'Failed to get response from builder';
        set((state) => ({
          messages: [
            ...state.messages,
            { role: 'assistant', content: `Error: ${errorMsg}`, timestamp: new Date().toISOString() },
          ],
          isGenerating: false,
          error: errorMsg,
        }));
      }
    },

    retryLastMessage: async () => {
      const { lastSentMessage, isGenerating } = get();
      if (!lastSentMessage || isGenerating) return;
      // Drop the trailing user+assistant pair from the failed attempt so retry
      // appends a fresh pair rather than duplicating the user prompt.
      set((state) => {
        const messages = [...state.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user' && messages[i].content === lastSentMessage) {
            messages.length = i;
            break;
          }
        }
        return { messages };
      });
      await get().sendMessage(lastSentMessage);
    },

    loadIntegration: async (integrationKey: string) => {
      set({ isLoading: true, error: null });
      const res = await tryCall(() => api.integrationBuilder.load({ integrationKey }));
      if (res.ok) {
        set({
          sessionId: res.data.builderSessionId,
          selectedIntegrationKey: integrationKey,
          messages: (res.data.messages ?? []) as unknown as BuilderChatMessage[],
          currentPackage: res.data.generatedPackage as unknown as IntegrationBuilderOutput,
          validationErrors: (res.data.validationErrors ?? []).map((e) => e.message),
          isLoading: false,
          sidePanelTab: 'config',
          isSidePanelOpen: true,
        });
      } else {
        set({ error: res.error.message || 'Failed to load integration', isLoading: false });
      }
    },

    saveIntegration: async () => {
      const { sessionId, currentPackage, testCredentials, hasSuccessfulTest } = get();
      if (!currentPackage) {
        return { success: false, error: 'No integration to save' };
      }

      set({ isSaving: true, error: null });
      // Pass test credentials so the backend auto-configures the integration
      const credsToSave = hasSuccessfulTest && Object.keys(testCredentials).length > 0
        ? testCredentials
        : undefined;
      const res = await tryCall(() =>
        api.integrationBuilder.save({
          builderSessionId: sessionId || '',
          generatedPackage: currentPackage,
          testCredentials: credsToSave,
        }),
      );
      if (res.ok) {
        set({ isSaving: false, selectedIntegrationKey: res.data.integrationKey });
        return { success: true };
      }
      const errorMsg = res.error.message || 'Failed to save integration';
      set({ isSaving: false, error: errorMsg });
      return { success: false, error: errorMsg };
    },

    testAction: async (actionKey: string, testInput?: Record<string, unknown>) => {
      const { sessionId, testCredentials } = get();
      if (!sessionId) return;

      set({ isTesting: true, error: null });
      const res = await tryCall(() =>
        api.integrationBuilder.test({
          builderSessionId: sessionId,
          actionKey,
          testCredentials,
          testInput,
        }),
      );

      if (res.ok) {
        const result: IntegrationTestResult = {
          actionKey,
          success: res.data.success || false,
          statusCode: res.data.statusCode,
          response: res.data.response,
          error: res.data.error,
          timestamp: new Date().toISOString(),
        };
        set((state) => ({
          testResults: [result, ...state.testResults],
          isTesting: false,
          hasSuccessfulTest: state.hasSuccessfulTest || result.success,
        }));
      } else {
        const result: IntegrationTestResult = {
          actionKey,
          success: false,
          error: res.error.message || 'Test failed',
          timestamp: new Date().toISOString(),
        };
        set((state) => ({
          testResults: [result, ...state.testResults],
          isTesting: false,
        }));
      }
    },

    setTestCredentials: (creds) => set({ testCredentials: creds }),

    setSidePanelTab: (tab) => set({ sidePanelTab: tab }),

    toggleSidePanel: () =>
      set((state) => ({ isSidePanelOpen: !state.isSidePanelOpen })),

    clearSession: () =>
      set({
        sessionId: null,
        selectedIntegrationKey: null,
        messages: [],
        isGenerating: false,
        currentPackage: null,
        validationErrors: [],
        testCredentials: {},
        testResults: [],
        isTesting: false,
        hasSuccessfulTest: false,
        sidePanelTab: 'skill',
        error: null,
      }),

    clearError: () => set({ error: null }),

    isReadyToSave: () => {
      const { currentPackage } = get();
      return !!currentPackage;
    },
  }),
);
