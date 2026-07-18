import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DesktopItemRef, Rect, Workspace, WindowState } from '@/lib/os/types';
import { containsLeaf, insertEdge, removeLeaf, setRatio, splitLeaf, type Quadrant, type TilePath } from '@/lib/os/tiling';

/**
 * OS-mode client state (surface contract 4.3): workspaces (name + desktop/
 * pinned item ids + saved window layout - nothing more), the window layout
 * ops, and chat-dock preferences. Persisted to localStorage under `ekoa_os`
 * (the i18n/orchestration persist precedent; no server-side layout sync in
 * run 1). Pure tiling math lives in lib/os/tiling.ts; this store only applies
 * it to the ACTIVE workspace immutably.
 */

export type ChatDockMode = 'classic' | 'os';

export interface ChatDockPrefs {
  collapsed: boolean;
  width: number;
}

export const CHAT_DOCK_MIN_WIDTH = 320;
export const CHAT_DOCK_MAX_WIDTH = 560;

export function clampChatDockWidth(width: number): number {
  return Math.min(CHAT_DOCK_MAX_WIDTH, Math.max(CHAT_DOCK_MIN_WIDTH, Math.round(width)));
}

export function sameRef(a: DesktopItemRef, b: DesktopItemRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

interface OpenWindowOpts {
  surfaceId: string;
  props?: Record<string, unknown>;
  title?: string;
  /** Windows sharing a dedupeKey are one instance: reopen focuses/restores. */
  dedupeKey: string;
  rect: Rect;
}

interface OsState {
  chatDock: Record<ChatDockMode, ChatDockPrefs>;
  setChatDockCollapsed: (mode: ChatDockMode, collapsed: boolean) => void;
  setChatDockWidth: (mode: ChatDockMode, width: number) => void;

  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  /** First OS entry seeds "Ecrã 1"; later calls append artifacts not yet on any desktop. */
  seedDesktop: (refs: DesktopItemRef[]) => void;
  createWorkspace: () => void;
  renameWorkspace: (id: string, name: string) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;

  addDesktopItem: (ref: DesktopItemRef) => void;
  removeDesktopItem: (ref: DesktopItemRef) => void;
  pinItem: (ref: DesktopItemRef) => void;
  unpinItem: (ref: DesktopItemRef) => void;

  openWindow: (opts: OpenWindowOpts) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  setWindowRect: (id: string, rect: Rect) => void;
  /** Drag-to-edge: the window takes the left/right half of the tiled region. */
  snapEdge: (id: string, side: 'left' | 'right') => void;
  /** Drop-onto-window: split the target's region with the dropped window. */
  dropSplit: (targetId: string, id: string, quadrant: Quadrant) => void;
  /** Back to floating (rect was preserved while tiled). */
  untile: (id: string) => void;
  setTileRatio: (path: TilePath, ratio: number) => void;
}

/** Windows carry their dedupe key piggybacked on props (internal). */
const DEDUPE = '__dedupeKey';

function updateActive(state: OsState, fn: (ws: Workspace) => Workspace): Partial<OsState> {
  const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (!active) return {};
  const next = fn(active);
  return {
    workspaces: state.workspaces.map((w) => (w.id === next.id ? next : w)),
  };
}

/** Removing a window from the tile tree; floats keep mode/rect. */
function detach(ws: Workspace, id: string): Workspace {
  return {
    ...ws,
    tiling: removeLeaf(ws.tiling, id),
    windows: ws.windows.map((w) => (w.id === id ? { ...w, mode: 'float' as const } : w)),
  };
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

      workspaces: [],
      activeWorkspaceId: null,

      seedDesktop: (refs) =>
        set((s) => {
          if (s.workspaces.length === 0) {
            const ws: Workspace = {
              id: newId(),
              name: 'Ecrã 1',
              desktopItems: refs,
              pinnedIds: [{ kind: 'surface', id: 'artifacts' }],
              windows: [],
              tiling: null,
            };
            return { workspaces: [ws], activeWorkspaceId: ws.id };
          }
          // Artifacts created since last visit auto-add to the ACTIVE workspace
          // (contract 4.3); anything already on some desktop stays where it is.
          const known = new Set(
            s.workspaces.flatMap((w) => w.desktopItems.map((r) => `${r.kind}:${r.id}`)),
          );
          const fresh = refs.filter((r) => !known.has(`${r.kind}:${r.id}`));
          if (fresh.length === 0) return {};
          return updateActive(s as OsState, (ws) => ({
            ...ws,
            desktopItems: [...ws.desktopItems, ...fresh],
          }));
        }),

      createWorkspace: () =>
        set((s) => {
          const ws: Workspace = {
            id: newId(),
            name: `Ecrã ${s.workspaces.length + 1}`,
            desktopItems: [{ kind: 'surface', id: 'artifacts' }],
            pinnedIds: [{ kind: 'surface', id: 'artifacts' }],
            windows: [],
            tiling: null,
          };
          return { workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id };
        }),

      renameWorkspace: (id, name) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
        })),

      removeWorkspace: (id) =>
        set((s) => {
          if (s.workspaces.length <= 1) return {};
          const workspaces = s.workspaces.filter((w) => w.id !== id);
          return {
            workspaces,
            activeWorkspaceId:
              s.activeWorkspaceId === id ? workspaces[0].id : s.activeWorkspaceId,
          };
        }),

      setActiveWorkspace: (id) => set(() => ({ activeWorkspaceId: id })),

      addDesktopItem: (ref) =>
        set((s) =>
          updateActive(s as OsState, (ws) =>
            ws.desktopItems.some((r) => sameRef(r, ref))
              ? ws
              : { ...ws, desktopItems: [...ws.desktopItems, ref] },
          ),
        ),

      removeDesktopItem: (ref) =>
        set((s) =>
          updateActive(s as OsState, (ws) => ({
            ...ws,
            desktopItems: ws.desktopItems.filter((r) => !sameRef(r, ref)),
          })),
        ),

      pinItem: (ref) =>
        set((s) =>
          updateActive(s as OsState, (ws) =>
            ws.pinnedIds.some((r) => sameRef(r, ref))
              ? ws
              : { ...ws, pinnedIds: [...ws.pinnedIds, ref] },
          ),
        ),

      unpinItem: (ref) =>
        set((s) =>
          updateActive(s as OsState, (ws) => ({
            ...ws,
            pinnedIds: ws.pinnedIds.filter((r) => !sameRef(r, ref)),
          })),
        ),

      openWindow: ({ surfaceId, props = {}, title, dedupeKey, rect }) =>
        set((s) =>
          updateActive(s as OsState, (ws) => {
            const existing = ws.windows.find((w) => w.props[DEDUPE] === dedupeKey);
            if (existing) {
              // Focus + restore the one instance.
              return {
                ...ws,
                windows: [
                  ...ws.windows.filter((w) => w.id !== existing.id),
                  { ...existing, minimized: false },
                ],
              };
            }
            const win: WindowState = {
              id: newId(),
              surfaceId,
              props: { ...props, [DEDUPE]: dedupeKey },
              title,
              mode: 'float',
              rect,
              minimized: false,
            };
            return { ...ws, windows: [...ws.windows, win] };
          }),
        ),

      closeWindow: (id) =>
        set((s) =>
          updateActive(s as OsState, (ws) => ({
            ...detach(ws, id),
            windows: ws.windows.filter((w) => w.id !== id),
            tiling: removeLeaf(ws.tiling, id),
          })),
        ),

      focusWindow: (id) =>
        set((s) =>
          updateActive(s as OsState, (ws) => {
            const win = ws.windows.find((w) => w.id === id);
            if (!win) return ws;
            return { ...ws, windows: [...ws.windows.filter((w) => w.id !== id), win] };
          }),
        ),

      minimizeWindow: (id) =>
        set((s) =>
          updateActive(s as OsState, (ws) => ({
            ...ws,
            windows: ws.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
          })),
        ),

      restoreWindow: (id) =>
        set((s) =>
          updateActive(s as OsState, (ws) => {
            const win = ws.windows.find((w) => w.id === id);
            if (!win) return ws;
            return {
              ...ws,
              windows: [
                ...ws.windows.filter((w) => w.id !== id),
                { ...win, minimized: false },
              ],
            };
          }),
        ),

      setWindowRect: (id, rect) =>
        set((s) =>
          updateActive(s as OsState, (ws) => ({
            ...ws,
            windows: ws.windows.map((w) => (w.id === id ? { ...w, rect } : w)),
          })),
        ),

      snapEdge: (id, side) =>
        set((s) =>
          updateActive(s as OsState, (ws) => {
            const cleared = removeLeaf(ws.tiling, id);
            return {
              ...ws,
              tiling: insertEdge(cleared, id, side),
              windows: ws.windows.map((w) =>
                w.id === id ? { ...w, mode: 'tile', minimized: false } : w,
              ),
            };
          }),
        ),

      dropSplit: (targetId, id, quadrant) =>
        set((s) =>
          updateActive(s as OsState, (ws) => {
            if (targetId === id) return ws;
            let tiling = removeLeaf(ws.tiling, id);
            // Dropping onto a floating window adopts it into the tiled region
            // first (it becomes the region being split).
            const targetTiled = containsLeaf(tiling, targetId);
            if (!tiling || !targetTiled) {
              tiling = tiling === null ? { leaf: targetId } : tiling;
            }
            if (!containsLeaf(tiling, targetId)) return ws;
            return {
              ...ws,
              tiling: splitLeaf(tiling, targetId, id, quadrant),
              windows: ws.windows.map((w) =>
                w.id === id || w.id === targetId
                  ? { ...w, mode: 'tile', minimized: false }
                  : w,
              ),
            };
          }),
        ),

      untile: (id) =>
        set((s) => updateActive(s as OsState, (ws) => detach(ws, id))),

      setTileRatio: (path, ratio) =>
        set((s) =>
          updateActive(s as OsState, (ws) =>
            ws.tiling ? { ...ws, tiling: setRatio(ws.tiling, path, ratio) } : ws,
          ),
        ),
    }),
    {
      name: 'ekoa_os',
      version: 1,
      partialize: (s) => ({
        chatDock: s.chatDock,
        workspaces: s.workspaces,
        activeWorkspaceId: s.activeWorkspaceId,
      }),
    },
  ),
);

/** The active workspace (or null before seeding). */
export function useActiveWorkspace(): Workspace | null {
  return useOsStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null,
  );
}
