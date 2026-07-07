"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Plus,
  Search,
  MessageSquare,
  Clock,
  MoreVertical,
  Trash2,
  Pencil,
} from "lucide-react";
import { useOrchestrationStore } from "@/stores/orchestration";
import { useTranslation } from "@/stores/i18n";

interface MobileSessionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileSessionsDrawer({
  isOpen,
  onClose,
}: MobileSessionsDrawerProps) {
  const { sessionsPanel: sp, common } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const sessions = useOrchestrationStore((s) => s.sessions);
  const activeSessionId = useOrchestrationStore((s) => s.activeSessionId);
  const setActiveSession = useOrchestrationStore((s) => s.setActiveSession);
  const deleteSession = useOrchestrationStore((s) => s.deleteSession);
  const renameSession = useOrchestrationStore((s) => s.renameSession);
  const activateOrCreateEmptySession = useOrchestrationStore(
    (s) => s.activateOrCreateEmptySession
  );

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuSessionId(null);
      }
    }
    if (menuSessionId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuSessionId]);

  const handleCreateSession = useCallback(async () => {
    await activateOrCreateEmptySession();
    onClose();
  }, [activateOrCreateEmptySession, onClose]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      onClose();
    },
    [setActiveSession, onClose]
  );

  const handleDelete = useCallback(
    async (sessionId: string) => {
      setMenuSessionId(null);
      await deleteSession(sessionId);
    },
    [deleteSession]
  );

  const handleStartRename = useCallback(
    (sessionId: string, currentName: string) => {
      setMenuSessionId(null);
      setRenamingId(sessionId);
      setRenameValue(currentName);
    },
    []
  );

  const handleConfirmRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameSession(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  }, [renamingId, renameValue, renameSession]);

  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const filteredSessions = sortedSessions.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function formatTime(ts: string): string {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      if (diff < 60000) return sp.justNow;
      if (diff < 3600000) return sp.minutesAgo(Math.floor(diff / 60000));
      if (diff < 86400000) return sp.hoursAgo(Math.floor(diff / 3600000));
      return sp.daysAgo(Math.floor(diff / 86400000));
    } catch {
      return "";
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-0 top-0 bottom-0 z-50 w-[85vw] max-w-[320px] bg-white flex flex-col shadow-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-100">
              <span className="text-sm font-bold text-neutral-700 tracking-wide">
                {sp.sessions}
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCreateSession}
                  className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
                  title={sp.newSession}
                >
                  <Plus size={18} />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-neutral-100">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-2.5 text-neutral-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={sp.searchSessions}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-2 pl-8 pr-3 text-sm focus:outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-200 transition-shadow"
                />
              </div>
            </div>

            {/* Sessions list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredSessions.length === 0 ? (
                <div className="text-center py-8 text-neutral-400 text-xs">
                  {sessions.length === 0
                    ? sp.noSessionsYet
                    : sp.noMatchingSessions}
                </div>
              ) : (
                filteredSessions.map((session, idx) => {
                  const isActive = session.id === activeSessionId;
                  const isRenaming = renamingId === session.id;

                  return (
                    <div
                      key={`${session.id}-${idx}`}
                      onClick={() =>
                        !isRenaming && handleSelectSession(session.id)
                      }
                      className={`p-3 rounded-lg border cursor-pointer transition-all relative ${
                        isActive
                          ? "bg-neutral-900 border-neutral-900 shadow-sm"
                          : "bg-white border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                          )}
                          {isRenaming ? (
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={handleConfirmRename}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleConfirmRename();
                                if (e.key === "Escape") {
                                  setRenamingId(null);
                                  setRenameValue("");
                                }
                              }}
                              autoFocus
                              className="text-sm font-medium bg-neutral-800 border border-neutral-600 rounded px-1.5 py-0.5 outline-none w-full text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span
                              className={`text-sm font-medium truncate ${
                                isActive ? "text-white" : "text-neutral-700"
                              }`}
                            >
                              {session.name}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuSessionId(
                              menuSessionId === session.id ? null : session.id
                            );
                          }}
                          className={`p-0.5 rounded ${
                            isActive
                              ? "text-neutral-500 hover:text-neutral-300"
                              : "text-neutral-400 hover:text-neutral-600"
                          }`}
                        >
                          <MoreVertical size={14} />
                        </button>
                      </div>
                      <div
                        className={`flex items-center justify-between mt-2 text-xs ${
                          isActive ? "text-neutral-400" : "text-neutral-500"
                        }`}
                      >
                        <span className="flex items-center">
                          <MessageSquare size={12} className="mr-1" />
                          {session.messageCount}
                        </span>
                        <span className="flex items-center">
                          <Clock size={12} className="mr-1" />
                          {formatTime(session.updatedAt)}
                        </span>
                      </div>

                      {/* Context menu */}
                      {menuSessionId === session.id && (
                        <div
                          ref={menuRef}
                          className="absolute right-2 z-20 bg-white border border-neutral-200 rounded-lg shadow-xl py-1 w-36"
                          style={{ top: "calc(100% - 4px)" }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartRename(session.id, session.name);
                            }}
                            className="w-full flex items-center px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors"
                          >
                            <Pencil size={12} className="mr-2" />
                            {sp.rename}
                          </button>
                          <div className="mx-2 h-px bg-neutral-100" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(session.id);
                            }}
                            className="w-full flex items-center px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={12} className="mr-2" />
                            {common.delete}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
