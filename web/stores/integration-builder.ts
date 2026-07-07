'use client';

/**
 * Integration Builder Store
 *
 * Manages the AI-powered integration builder UI state:
 * - Chat session with streaming
 * - Generated integration package
 * - Test credentials and results
 * - Side panel tab state
 */

import { create } from 'zustand';
import * as api from '@/lib/api/client';
import { getConnection } from '@/lib/cortex/connection';
import { useI18nStore } from '@/stores/i18n';
import type {
  IntegrationBuilderOutput,
  BuilderChatMessage,
  IntegrationTestResult,
} from '@/lib/api/client';

export type BuilderTab = 'skill' | 'config' | 'actions' | 'tests';

/** Strip skill-md and config-json code blocks from chat text (they populate the side panel) */
function stripCodeBlocks(text: string): string {
  return text
    .replace(/```skill-md\s*\n[\s\S]*?```/g, '')
    .replace(/```config-json\s*\n[\s\S]*?```/g, '')
    .replace(/```[\w-]*\s*\n[\s\S]*?```/g, '')  // catch any remaining fenced blocks
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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

      // Add assistant placeholder
      const assistantMessage: BuilderChatMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, userMessage, assistantMessage],
        isGenerating: true,
        error: null,
        lastSentMessage: message,
      }));

      // Subscribe to stream events before sending
      const conn = getConnection();
      let streamUnsubscribe: (() => void) | null = null;

      // We need to intercept the action_stream events for this request
      // The connection.sendAction will handle the request_id correlation
      // But we need to listen for action_stream events with the same request_id
      // This is a bit tricky since sendAction generates the request_id internally

      // Instead, we'll use the onStream handler which catches all action_stream events
      // and filter by checking the sessionId in the stream data
      const currentSessionId = sessionId;

      streamUnsubscribe = conn.onStream((event) => {
        if (event.type !== 'action_stream') return;
        const streamData = event as Record<string, unknown>;
        if (streamData.streamType === 'builder_text') {
          const chunk = streamData.content as string;
          set((state) => {
            const messages = [...state.messages];
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              messages[messages.length - 1] = {
                ...lastMsg,
                content: lastMsg.content + chunk,
              };
            }
            return { messages };
          });
        }
      });

      try {
        const language = useI18nStore.getState().language;
        const response = await api.integrationBuilderChat(message, sessionId || undefined, language);

        if (response.success && response.data) {
          const { sessionId: newSessionId, generatedPackage, validationErrors } = response.data;

          set((state) => {
            const updates: Partial<IntegrationBuilderState> = {
              sessionId: newSessionId,
              isGenerating: false,
              // lastSentMessage intentionally kept — powers the Resend button on the latest user msg.
              error: null,
            };

            if (generatedPackage) {
              updates.currentPackage = generatedPackage;
              updates.validationErrors = validationErrors;
              updates.sidePanelTab = 'config';
              updates.isSidePanelOpen = true;

              // Strip code blocks from last assistant message
              const messages = [...state.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
                messages[messages.length - 1] = {
                  ...lastMsg,
                  content: stripCodeBlocks(lastMsg.content),
                };
              }
              updates.messages = messages;
            }

            return updates as IntegrationBuilderState;
          });
        } else {
          const errorMsg = response.error?.message || 'Failed to get response from builder';
          set((state) => {
            // Update the assistant message with error
            const messages = [...state.messages];
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
              messages[messages.length - 1] = {
                ...lastMsg,
                content: `Error: ${errorMsg}`,
              };
            }
            return { messages, isGenerating: false, error: errorMsg };
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        set({ isGenerating: false, error: errorMsg });
      } finally {
        streamUnsubscribe?.();
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
      try {
        const response = await api.integrationBuilderLoad(integrationKey);
        if (response.success && response.data) {
          set({
            sessionId: response.data.sessionId,
            selectedIntegrationKey: integrationKey,
            messages: response.data.messages || [],
            currentPackage: response.data.generatedPackage,
            validationErrors: response.data.validationErrors || [],
            isLoading: false,
            sidePanelTab: 'config',
            isSidePanelOpen: true,
          });
        } else {
          set({
            error: response.error?.message || 'Failed to load integration',
            isLoading: false,
          });
        }
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to load integration',
          isLoading: false,
        });
      }
    },

    saveIntegration: async () => {
      const { sessionId, currentPackage, testCredentials, hasSuccessfulTest } = get();
      if (!currentPackage) {
        return { success: false, error: 'No integration to save' };
      }

      set({ isSaving: true, error: null });
      try {
        // Pass test credentials so the backend auto-configures the integration
        const credsToSave = hasSuccessfulTest && Object.keys(testCredentials).length > 0
          ? testCredentials
          : undefined;
        const response = await api.integrationBuilderSave(
          sessionId || '',
          currentPackage,
          credsToSave,
        );
        if (response.success && response.data) {
          set({
            isSaving: false,
            selectedIntegrationKey: response.data.integrationKey,
          });
          return { success: true };
        } else {
          const errorMsg = response.error?.message || 'Failed to save integration';
          set({ isSaving: false, error: errorMsg });
          return { success: false, error: errorMsg };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to save integration';
        set({ isSaving: false, error: errorMsg });
        return { success: false, error: errorMsg };
      }
    },

    testAction: async (actionKey: string, testInput?: Record<string, unknown>) => {
      const { sessionId, testCredentials } = get();
      if (!sessionId) return;

      set({ isTesting: true, error: null });
      try {
        const response = await api.integrationBuilderTest(
          sessionId,
          actionKey,
          testCredentials,
          testInput,
        );

        const result: IntegrationTestResult = {
          actionKey,
          success: response.data?.success || false,
          statusCode: response.data?.statusCode,
          response: response.data?.response,
          error: response.data?.error,
          timestamp: new Date().toISOString(),
        };

        set((state) => ({
          testResults: [result, ...state.testResults],
          isTesting: false,
          hasSuccessfulTest: state.hasSuccessfulTest || result.success,
        }));
      } catch (error) {
        const result: IntegrationTestResult = {
          actionKey,
          success: false,
          error: error instanceof Error ? error.message : 'Test failed',
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
