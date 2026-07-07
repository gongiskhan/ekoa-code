"use client";

import React, { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  MessageSquare,
  Hammer,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
/**
 * Prompt category for the empty-state suggestion strip. The chat page no
 * longer renders different layouts per category; this is purely cosmetic
 * (icon + colour for the card) and informational for the send handler.
 */
type ChatMode = "chat" | "build" | "integrate";
import { useSettingsStore } from "@/stores/settings";
import { useTranslation } from "@/stores/i18n";
import { useVerticalProfile } from "@/lib/verticals";
import { Spinner } from "@/components/ui/spinner";

// ============================================
// TYPES
// ============================================

interface EmptyStateProps {
  mode: ChatMode;
  onSelectPrompt: (prompt: string, mode: ChatMode) => void;
}

export interface WelcomeStateProps {
  onSelectPrompt: (prompt: string, mode: ChatMode) => void;
}

export interface PromptSuggestionsStripProps {
  mode: ChatMode;
  onSelectPrompt: (prompt: string, mode: ChatMode) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface PromptCard {
  category: ChatMode;
  prompt: string;
}

// ============================================
// CONSTANTS
// ============================================

// CATEGORY_LABELS removed -- now sourced from emptyState.categoryLabels translations

const CATEGORY_COLORS: Record<ChatMode, string> = {
  chat: "bg-neutral-100 text-neutral-600",
  build: "bg-teal-50 text-teal-700",
  integrate: "bg-blue-50 text-blue-700",
};

const CATEGORY_BORDER_COLORS: Record<ChatMode, string> = {
  chat: "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50",
  build: "border-teal-100 hover:border-teal-200 hover:bg-teal-50/70",
  integrate: "border-blue-100 hover:border-blue-200 hover:bg-blue-50/70",
};

const HOVER_BG: Record<ChatMode, string> = {
  chat: "hover:bg-neutral-50/80",
  build: "hover:bg-teal-50/50",
  integrate: "hover:bg-blue-50/50",
};

const ICON_COLORS: Record<ChatMode, string> = {
  chat: "text-neutral-400",
  build: "text-teal-500",
  integrate: "text-blue-500",
};

const MAX_VISIBLE_CARDS = 6;
const MAX_VISIBLE_PILLS = 3;

const CATEGORY_ICONS: Record<ChatMode, typeof MessageSquare> = {
  chat: MessageSquare,
  build: Hammer,
  integrate: MessageSquare,
};

// MODE_TAGLINES and MODE_SUBTITLES removed -- now sourced from emptyState translations

// Stable module-level object prevents ReactMarkdown from re-rendering on every parent render
const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
};

// ============================================
// HELPERS
// ============================================

function buildMixed(build: string[], chat: string[]): PromptCard[] {
  const sources = [
    build.map((p) => ({ category: "build" as ChatMode, prompt: p })),
    chat.map((p) => ({ category: "chat" as ChatMode, prompt: p })),
  ];
  const mixed: PromptCard[] = [];
  const maxLen = Math.max(...sources.map((a) => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of sources) {
      if (i < arr.length) mixed.push(arr[i]);
    }
  }
  return mixed;
}

// ============================================
// SHARED CARD GRID
// ============================================

interface CardGridProps {
  cards: PromptCard[];
  isMixed: boolean;
  onSelectPrompt: (prompt: string, mode: ChatMode) => void;
}

function CardGrid({ cards, isMixed, onSelectPrompt }: CardGridProps) {
  const { emptyState } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-4xl"
    >
      {cards.map((card, idx) => {
        const Icon = CATEGORY_ICONS[card.category];
        return (
          <motion.button
            key={`${card.category}-${idx}`}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.15 }}
            onClick={() => onSelectPrompt(card.prompt, card.category)}
            className={`group flex flex-col justify-between p-4 bg-white border border-neutral-200 rounded-xl ${HOVER_BG[card.category]} hover:border-neutral-300 hover:shadow-md transition-all text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 min-h-[90px] md:min-h-[116px]`}
          >
            <div>
              {isMixed ? (
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full mb-2.5 ${CATEGORY_COLORS[card.category]}`}
                >
                  <Icon size={10} />
                  {emptyState.categoryLabels[card.category as keyof typeof emptyState.categoryLabels] ?? card.category}
                </span>
              ) : (
                <div className="mb-2.5">
                  <Icon size={16} className={ICON_COLORS[card.category]} />
                </div>
              )}

              <p className="text-[13px] text-neutral-600 leading-relaxed group-hover:text-neutral-900 transition-colors line-clamp-3">
                {card.prompt}
              </p>
            </div>

            <div className="flex justify-end mt-2">
              <ArrowRight
                size={14}
                className="text-neutral-200 group-hover:text-teal-500 group-hover:translate-x-0.5 transition-all"
              />
            </div>
          </motion.button>
        );
      })}
    </motion.div>
  );
}

// ============================================
// CHAT LOADING SCREEN
// Shown while session is initializing (minimum 600ms)
// ============================================

interface ChatLoadingScreenProps {
  visible: boolean;
}

export function ChatLoadingScreen({ visible }: ChatLoadingScreenProps) {
  const { emptyState } = useTranslation();
  const messages = emptyState.loadingMessages;
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setMessageIndex(0);
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % messages.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [visible, messages.length]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="chat-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white"
        >
          <Spinner size="md" className="mb-5 text-teal-600" />
          <AnimatePresence mode="wait">
            <motion.p
              key={messageIndex}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-neutral-400"
            >
              {messages[messageIndex]}
            </motion.p>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================
// WELCOME MESSAGE BUBBLE
// Standalone AI message bubble for use in conversation scroll area
// ============================================

export function WelcomeMessageBubble(_props: { templateId?: string } = {}) {
  const profile = useVerticalProfile();
  const message = profile.welcomeMessage;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex justify-start space-x-3 max-w-4xl"
    >
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5 overflow-hidden">
        <Image
          src="/ekoa_logo.png"
          alt="Ekoa"
          width={20}
          height={20}
          className="object-contain"
        />
      </div>
      <div className="min-w-0 max-w-2xl">
        <div className="flex items-center space-x-2 mb-1">
          <span className="text-xs font-semibold text-neutral-700">EKOA</span>
        </div>
        <div className="text-sm text-neutral-700 leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {message}
          </ReactMarkdown>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================
// PROMPT SUGGESTIONS STRIP
// Compact collapsible pill row shown above the input area
// ============================================

export function PromptSuggestionsStrip({
  mode,
  onSelectPrompt,
  collapsed,
  onToggleCollapsed,
}: PromptSuggestionsStripProps) {
  const { emptyState } = useTranslation();
  const profile = useVerticalProfile();
  const { build, chat } = profile.examplePrompts;

  const isMixed = mode === "chat";
  const pills = useMemo<PromptCard[]>(() => {
    if (isMixed) return buildMixed(build, chat).slice(0, MAX_VISIBLE_PILLS);
    return build
      .slice(0, MAX_VISIBLE_PILLS)
      .map((p) => ({ category: mode, prompt: p }));
  }, [isMixed, mode, build, chat]);

  return (
    <div>
      <button
        onClick={onToggleCollapsed}
        className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors mb-2 cursor-pointer select-none"
      >
        <span>{emptyState.suggestionsLabel}</span>
        <ChevronDown
          size={11}
          className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
        />
      </button>

      {!collapsed && (
        <div className="flex flex-wrap gap-2">
          {pills.map((card) => (
            <button
              key={`${card.category}-${card.prompt}`}
              onClick={() => onSelectPrompt(card.prompt, card.category)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs bg-white text-neutral-700 border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-all whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1"
              title={card.prompt}
            >
              <span aria-hidden className="w-2 h-2 rounded-sm bg-teal-500 flex-shrink-0" />
              <span className="max-w-[260px] truncate">{card.prompt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// WELCOME STATE (guided mode)
// ============================================

export function WelcomeState({ onSelectPrompt }: WelcomeStateProps) {
  const showExampleCards = useSettingsStore((s) => s.settings.chat.showExampleCards);
  const profile = useVerticalProfile();

  const { build, chat } = profile.examplePrompts;
  const cards = useMemo(
    () => buildMixed(build, chat).slice(0, MAX_VISIBLE_CARDS),
    [build, chat],
  );

  return (
    <div className="flex-1 flex flex-col px-4 md:px-8 py-8 overflow-y-auto">
      <div className="mb-6">
        <WelcomeMessageBubble />
      </div>

      {showExampleCards && (
        <CardGrid
          cards={cards}
          isMixed
          onSelectPrompt={onSelectPrompt}
        />
      )}
    </div>
  );
}

// ============================================
// EMPTY STATE (default, non-guided)
// ============================================

export default function EmptyState({ mode, onSelectPrompt }: EmptyStateProps) {
  const showExampleCards = useSettingsStore((s) => s.settings.chat.showExampleCards);
  const { emptyState } = useTranslation();
  const profile = useVerticalProfile();

  const { build, chat } = profile.examplePrompts;
  const isMixed = mode === "chat";
  const cards = useMemo<PromptCard[]>(
    () =>
      isMixed
        ? buildMixed(build, chat).slice(0, MAX_VISIBLE_CARDS)
        : build
            .slice(0, MAX_VISIBLE_CARDS)
            .map((p) => ({ category: mode, prompt: p })),
    [isMixed, mode, build, chat],
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 py-8 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mb-5 shrink-0"
      >
        <Image
          src="/ekoa_logo.png"
          alt="Ekoa"
          width={44}
          height={44}
          className="object-contain"
        />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
        className="text-xl font-semibold text-neutral-900 mb-1.5 text-center shrink-0"
      >
        {profile.modeTaglines[mode] ?? mode}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
        className="text-sm text-neutral-400 mb-5 md:mb-8 text-center max-w-md shrink-0"
      >
        {emptyState.modeSubtitles[mode] ?? ""}
      </motion.p>

      {showExampleCards && (
        <CardGrid
          cards={cards}
          isMixed={isMixed}
          onSelectPrompt={onSelectPrompt}
        />
      )}
    </div>
  );
}
