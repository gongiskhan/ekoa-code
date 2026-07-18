import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * OS-mode client state (surface contract 4.3): workspaces + window layouts +
 * chat-dock preferences, persisted to localStorage under `ekoa_os` (the
 * i18n/orchestration persist precedent; no server-side layout sync in run 1).
 *
 * The chat-dock slice lands first (classic global panel); the workspace and
 * window slices land with the OS shell.
 */

export type ChatDockMode = 'classic' | 'os';

export interface ChatDockPrefs {
  collapsed: boolean;
  width: number;
}

export const CHAT_DOCK_MIN_WIDTH = 320;
export const CHAT_DOCK_MAX_WIDTH = 560;

interface OsState {
  chatDock: Record<ChatDockMode, ChatDockPrefs>;
  setChatDockCollapsed: (mode: ChatDockMode, collapsed: boolean) => void;
  setChatDockWidth: (mode: ChatDockMode, width: number) => void;
}

export function clampChatDockWidth(width: number): number {
  return Math.min(CHAT_DOCK_MAX_WIDTH, Math.max(CHAT_DOCK_MIN_WIDTH, Math.round(width)));
}

export const useOsStore = create<OsState>()(
  persist(
    (set) => ({
      chatDock: {
        // Classic: collapsed by default - the dock is a pure addition and must
        // not shift existing pages until the user opens it.
        classic: { collapsed: true, width: 400 },
        // OS mode: open by default (the assistant is always present).
        os: { collapsed: false, width: 420 },
      },

      setChatDockCollapsed: (mode, collapsed) =>
        set((s) => ({
          chatDock: { ...s.chatDock, [mode]: { ...s.chatDock[mode], collapsed } },
        })),

      setChatDockWidth: (mode, width) =>
        set((s) => ({
          chatDock: {
            ...s.chatDock,
            [mode]: { ...s.chatDock[mode], width: clampChatDockWidth(width) },
          },
        })),
    }),
    {
      name: 'ekoa_os',
      version: 1,
      partialize: (s) => ({ chatDock: s.chatDock }),
    },
  ),
);
