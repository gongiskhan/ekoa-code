'use client';

/**
 * Classic-mode global chat dock (surface contract 5, brief 2.1): the
 * conversation, available on every dashboard page, docked to the right edge.
 * Collapsed by default to an always-visible edge tab; expanded it is a real
 * resizable panel (left-edge drag handle). Hidden entirely on /chat - the page
 * IS the chat there (single-instance rule, which also avoids double-mount
 * races). Hidden on mobile: chat stays reachable via the /chat nav entry, and
 * a docked panel has no room on a phone.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, Plus, ExternalLink, ChevronsRight, ChevronDown } from 'lucide-react';
import ChatPanel from '@/components/builder/chat-panel';
import { useChatRuntime } from '@/components/chat/chat-runtime';
import { ActionMenu, type ActionMenuPosition } from '@/components/ui/action-menu';
import { IconButton } from '@/components/ui/button';
import { useOrchestrationStore } from '@/stores/orchestration';
import { useOsStore, clampChatDockWidth } from '@/stores/os';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTranslation } from '@/stores/i18n';
import type { ActionDef } from '@/lib/os/types';

export function GlobalChatDock() {
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useIsMobile();
  const runtime = useChatRuntime();
  const { chatDock } = useTranslation();

  const activeSessionId = useOrchestrationStore((s) => s.activeSessionId);
  const sessions = useOrchestrationStore((s) => s.sessions);
  const isExecuting = useOrchestrationStore((s) => s.isExecuting);
  const setActiveSession = useOrchestrationStore((s) => s.setActiveSession);
  const activateOrCreateEmptySession = useOrchestrationStore((s) => s.activateOrCreateEmptySession);

  const prefs = useOsStore((s) => s.chatDock.classic);
  const setCollapsed = useOsStore((s) => s.setChatDockCollapsed);
  const setWidth = useOsStore((s) => s.setChatDockWidth);

  // Live width during a resize drag; committed to the store on pointerup so
  // the persist middleware doesn't serialize on every pointermove. The ref
  // mirrors the state so pointerup can commit without a side effect inside a
  // setState updater (React forbids updates during render).
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragWidthRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);

  const [sessionMenuPos, setSessionMenuPos] = useState<ActionMenuPosition | null>(null);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragStartRef.current = { x: e.clientX, width: prefs.width };
      dragWidthRef.current = prefs.width;
      setDragWidth(prefs.width);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [prefs.width],
  );

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    // The dock sits on the right, so dragging left grows it.
    const next = clampChatDockWidth(start.width + (start.x - e.clientX));
    dragWidthRef.current = next;
    setDragWidth(next);
  }, []);

  const onHandlePointerUp = useCallback(() => {
    if (dragStartRef.current === null) return;
    dragStartRef.current = null;
    if (dragWidthRef.current != null) setWidth('classic', dragWidthRef.current);
    dragWidthRef.current = null;
    setDragWidth(null);
  }, [setWidth]);

  // The dock never renders on /chat or on mobile. All hooks are above this
  // point so the hook order is stable across route changes.
  if (isMobile || pathname.startsWith('/chat')) return null;

  if (prefs.collapsed) {
    return (
      <button
        data-testid="global-chat-dock-tab"
        onClick={() => setCollapsed('classic', false)}
        title={chatDock.expand}
        aria-label={chatDock.expand}
        className="absolute right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-lg border border-r-0 border-neutral-200 bg-white px-1.5 py-3 text-neutral-500 shadow-card transition-colors hover:bg-neutral-50 hover:text-teal-700 focus-ring"
      >
        <MessageSquare size={16} aria-hidden />
      </button>
    );
  }

  const width = dragWidth ?? prefs.width;
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const sessionLabel = activeSession?.name || chatDock.title;

  // Session switcher rendered through the one menu primitive (contract 3.2).
  const sessionActions: ActionDef<null>[] = [
    {
      id: 'new-session',
      label: chatDock.newSession,
      icon: Plus,
      run: () => void activateOrCreateEmptySession(),
    },
    ...sessions.slice(0, 10).map((s): ActionDef<null> => ({
      id: `session-${s.id}`,
      label: s.name || chatDock.title,
      run: () => setActiveSession(s.id),
    })),
  ];

  return (
    <aside
      data-testid="global-chat-dock"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-neutral-200 bg-white"
    >
      {/* Left-edge resize handle. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={chatDock.resize}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-teal-600/30"
      />

      {/* Header: session switcher + actions. */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-200 pl-3 pr-1.5">
        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setSessionMenuPos({ x: rect.left, y: rect.bottom + 4 });
          }}
          title={chatDock.sessions}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-ring"
        >
          <MessageSquare size={13} className="shrink-0 text-teal-700" aria-hidden />
          <span className="truncate">{sessionLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-neutral-400" aria-hidden />
        </button>
        <div className="flex items-center">
          <IconButton
            icon={Plus}
            label={chatDock.newSession}
            size="sm"
            onClick={() => void activateOrCreateEmptySession()}
          />
          <IconButton
            icon={ExternalLink}
            label={chatDock.openChatPage}
            size="sm"
            onClick={() => router.push(activeSessionId ? `/chat/${activeSessionId}` : '/chat')}
          />
          <IconButton
            icon={ChevronsRight}
            label={chatDock.collapse}
            size="sm"
            onClick={() => setCollapsed('classic', true)}
          />
        </div>
      </div>

      <ActionMenu
        items={sessionActions}
        ctx={null}
        position={sessionMenuPos}
        onClose={() => setSessionMenuPos(null)}
      />

      {/* The conversation - the same dumb view the /chat page renders. */}
      <ChatPanel
        sessionId={activeSessionId}
        isExecuting={isExecuting}
        isBuildSession={runtime.isBuildSession}
        onSendMessage={runtime.sendMessage}
        onCancel={runtime.cancelActive}
        onFirstMessage={runtime.sendMessage}
        onResend={runtime.retryActive}
        onEdit={runtime.editLastUserMessage}
      />
    </aside>
  );
}
