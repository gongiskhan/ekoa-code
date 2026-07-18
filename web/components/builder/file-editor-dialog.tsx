'use client';

// ============================================
// FILE EDITOR DIALOG
// Modal with Monaco editor for editing artifact files
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import {
  X,
  Minimize2,
  Maximize2,
  FileCode,
  Loader2,
  AlertCircle,
  Save,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getMonacoLanguage, getSandboxDisplayPath } from '@/lib/file-utils';
import { useTranslation } from '@/stores/i18n';

// Self-hosted Monaco: the loader's default CDN (cdn.jsdelivr.net) is blocked by the
// dashboard CSP (script-src 'self', next.config.ts ch09 D1). The AMD tree is copied to
// public/monaco/vs by web/scripts/copy-monaco.mjs (predev/prebuild), so every asset -
// loader.js, editor chunks, CSS, codicon font, workers - is same-origin.
loader.config({ paths: { vs: '/monaco/vs' } });

// ============================================
// TYPES
// ============================================

interface FileEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Artifact whose file is edited; the file endpoints are keyed by artifact id. */
  artifactId: string;
  filePath: string;
  onSave?: () => void;
}

interface DialogSize {
  width: number;
  height: number;
}

// ============================================
// CONSTANTS
// ============================================

const MIN_WIDTH = 500;
const MIN_HEIGHT = 400;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const STORAGE_KEY = 'ekoa_file_editor_size';

const LIGHT_THEME = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0891b2' },
    { token: 'string', foreground: '059669' },
    { token: 'number', foreground: 'd97706' },
    { token: 'type', foreground: 'd97706' },
    { token: 'function', foreground: '0891b2' },
    { token: 'variable', foreground: '1f2937' },
    { token: 'constant', foreground: 'd97706' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2937',
    'editor.lineHighlightBackground': '#f8f9fa',
    'editor.selectionBackground': '#ccfbf1',
    'editor.selectionHighlightBackground': '#ccfbf180',
    'editorCursor.foreground': '#0f766e',
    'editorLineNumber.foreground': '#9ca3af',
    'editorLineNumber.activeForeground': '#0f766e',
    'editorIndentGuide.background': '#e5e7eb',
    'editorIndentGuide.activeBackground': '#d1d5db',
    'editor.findMatchBackground': '#ccfbf1',
    'editor.findMatchHighlightBackground': '#ccfbf180',
    'editorBracketMatch.background': '#ccfbf1',
    'editorBracketMatch.border': '#0f766e',
    'scrollbarSlider.background': '#e5e7eb',
    'scrollbarSlider.hoverBackground': '#d1d5db',
    'scrollbarSlider.activeBackground': '#0f766e40',
    'minimap.background': '#f8f9fa',
  },
};

// ============================================
// HELPERS
// ============================================

function getFilename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function loadSavedSize(): DialogSize {
  if (typeof window === 'undefined') {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        width: Math.max(MIN_WIDTH, parsed.width || DEFAULT_WIDTH),
        height: Math.max(MIN_HEIGHT, parsed.height || DEFAULT_HEIGHT),
      };
    }
  } catch {
    // Ignore
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

function saveSize(size: DialogSize): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Ignore
  }
}

// ============================================
// COMPONENT
// ============================================

export function FileEditorDialog({
  open,
  onOpenChange,
  artifactId,
  filePath,
  onSave,
}: FileEditorDialogProps) {
  const { common } = useTranslation();
  const filename = getFilename(filePath);
  const displayPath = getSandboxDisplayPath(filePath);
  const language = getMonacoLanguage(filename);

  const [originalContent, setOriginalContent] = useState('');
  const [currentContent, setCurrentContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [size, setSize] = useState<DialogSize>(loadSavedSize);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const themeDefinedRef = useRef(false);

  const hasUnsavedChanges = originalContent !== currentContent;

  // Load file content when dialog opens
  useEffect(() => {
    if (open && filePath) {
      setIsLoading(true);
      setError(null);
      setIsEditorReady(false);

      api.artifacts
        .readFile({ id: artifactId, path: displayPath })
        .then((result) => {
          setOriginalContent(result.content);
          setCurrentContent(result.content);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to load file');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, filePath, artifactId, displayPath]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!hasUnsavedChanges || isSaving) return;

    setIsSaving(true);
    try {
      await api.artifacts.writeFile({ id: artifactId, path: displayPath, content: currentContent });
      setOriginalContent(currentContent);
      onSave?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setIsSaving(false);
    }
  }, [artifactId, displayPath, currentContent, hasUnsavedChanges, isSaving, onOpenChange]);

  // Keyboard shortcut: Cmd/Ctrl+S, Escape
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleSave]);

  // Handle close with unsaved changes check
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowCloseConfirm(true);
    } else {
      onOpenChange(false);
    }
  }, [hasUnsavedChanges, onOpenChange]);

  // Handle Monaco editor mount
  const handleEditorDidMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    if (!themeDefinedRef.current) {
      monaco.editor.defineTheme('ekoa-light', LIGHT_THEME);
      themeDefinedRef.current = true;
    }
    monaco.editor.setTheme('ekoa-light');

    setIsEditorReady(true);
    editor.focus();
  }, []);

  // Handle resize persistence
  const handleResize = useCallback((newSize: DialogSize) => {
    setSize(newSize);
    saveSize(newSize);
  }, []);

  const toggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  const currentWidth = isMaximized ? 'calc(100vw - 48px)' : `${size.width}px`;
  const currentHeight = isMaximized ? 'calc(100vh - 48px)' : `${size.height}px`;

  if (!open) return null;

  return (
    <>
      {/* Main editor dialog */}
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={handleClose}
            />

            {/* Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              style={{
                width: currentWidth,
                height: currentHeight,
                maxWidth: 'calc(100vw - 48px)',
                maxHeight: 'calc(100vh - 48px)',
              }}
              className={`relative flex flex-col bg-white border border-neutral-200 rounded-xl shadow-2xl overflow-hidden ${
                !isMaximized ? 'resize' : ''
              }`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                if (isMaximized) return;
                const target = e.currentTarget;
                const observer = new ResizeObserver((entries) => {
                  const entry = entries[0];
                  if (entry) {
                    const { width, height } = entry.contentRect;
                    if (width >= MIN_WIDTH && height >= MIN_HEIGHT) {
                      handleResize({ width, height });
                    }
                  }
                });
                observer.observe(target);
                const cleanup = () => {
                  observer.disconnect();
                  window.removeEventListener('pointerup', cleanup);
                };
                window.addEventListener('pointerup', cleanup);
              }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 bg-neutral-50 shrink-0">
                <FileCode className="w-4 h-4 text-teal-600" />
                <span className="flex-1 text-sm font-medium text-neutral-900 truncate">
                  {displayPath}
                  {hasUnsavedChanges && (
                    <span className="ml-2 inline-block w-2 h-2 rounded-full bg-amber-500" />
                  )}
                </span>
                {hasUnsavedChanges && (
                  <span className="text-xs text-amber-600 font-medium">
                    Unsaved
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <button
                    onClick={toggleMaximize}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                    title={isMaximized ? 'Restore' : 'Maximize'}
                  >
                    {isMaximized ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={handleClose}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Editor area */}
              <div className="flex-1 min-h-0 relative">
                {isLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white">
                    <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
                  </div>
                ) : error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white p-8">
                    <AlertCircle className="w-12 h-12 text-red-500" />
                    <p className="text-sm text-neutral-500 text-center">{error}</p>
                    <button
                      onClick={() => onOpenChange(false)}
                      className="px-4 py-2 text-sm font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
                    >
                      {common.close}
                    </button>
                  </div>
                ) : (
                  <>
                    {!isEditorReady && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
                      </div>
                    )}
                    <Editor
                      height="100%"
                      language={language}
                      value={currentContent}
                      theme="vs"
                      onMount={handleEditorDidMount}
                      onChange={(value) => setCurrentContent(value || '')}
                      options={{
                        readOnly: false,
                        minimap: { enabled: true },
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
                        fontLigatures: true,
                        renderLineHighlight: 'line',
                        cursorBlinking: 'smooth',
                        cursorSmoothCaretAnimation: 'on',
                        smoothScrolling: true,
                        padding: { top: 16, bottom: 16 },
                        automaticLayout: true,
                        wordWrap: 'on',
                        bracketPairColorization: { enabled: true },
                        guides: {
                          indentation: true,
                          bracketPairs: true,
                        },
                      }}
                    />
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-neutral-200 bg-neutral-50 shrink-0">
                <span className="text-xs text-neutral-500">
                  {language}
                  {hasUnsavedChanges ? ' | Cmd/Ctrl+S to save' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClose}
                    disabled={isSaving}
                    className="px-3 py-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {common.cancel}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!hasUnsavedChanges || isSaving}
                    className="flex items-center px-3 py-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    ) : (
                      <Save className="w-4 h-4 mr-1.5" />
                    )}
                    {common.save}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Unsaved changes confirmation */}
      <AnimatePresence>
        {showCloseConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowCloseConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm p-6 bg-white border border-neutral-200 rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-neutral-900 mb-2">
                Unsaved Changes
              </h3>
              <p className="text-sm text-neutral-500 mb-6">
                You have unsaved changes. Are you sure you want to close?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowCloseConfirm(false)}
                  className="px-3 py-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg transition-colors"
                >
                  {common.cancel}
                </button>
                <button
                  onClick={() => {
                    setShowCloseConfirm(false);
                    onOpenChange(false);
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                >
                  Discard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

export default FileEditorDialog;
