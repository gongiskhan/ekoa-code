'use client';

/**
 * The OS chat dock's lower sections (surface contract 5 / D8): the classic
 * side panel's tabs become shell-expressible pieces - Files and Output are
 * collapsible sections under the conversation, Preview opens as a real
 * artifact-app WINDOW, and an active integration build replaces the sections
 * (the same short-circuit the classic side panel does).
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useOrchestrationStore, type FileNode } from '@/stores/orchestration';
import { FileTreeView } from '@/components/builder/side-panel';
import OutputPanel from '@/components/builder/output-panel';
import FileEditorDialog from '@/components/builder/file-editor-dialog';
import IntegrationBuildPanel from '@/components/builder/integration-build-panel';
import { isTextFile } from '@/lib/file-utils';
import { OS_STRINGS } from '@/lib/os/strings';

const EMPTY_TREE: FileNode[] = [];

export function OsDockSections() {
  const activeSessionId = useOrchestrationStore((s) => s.activeSessionId);
  const sidePanelState = useOrchestrationStore((s) => s.sidePanelState);
  const activeIntegrationBuild = useOrchestrationStore((s) =>
    s.activeSessionId ? s.activeIntegrationBuilds[s.activeSessionId] : null,
  );
  const fileTree = useOrchestrationStore((s) =>
    s.activeSessionId ? s.sessionFiles[s.activeSessionId] ?? EMPTY_TREE : EMPTY_TREE,
  );
  const artifactInstanceId = useOrchestrationStore((s) =>
    s.activeSessionId ? s.sessionJobs[s.activeSessionId]?.artifactInstanceId ?? null : null,
  );

  const [filesOpen, setFilesOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<string | null>(null);

  if (!activeSessionId) return null;

  // Integration build replaces the sections while active.
  if (sidePanelState === 'integrate' && activeIntegrationBuild) {
    return (
      <div className="h-80 shrink-0 overflow-hidden border-t border-neutral-200">
        <IntegrationBuildPanel sessionId={activeSessionId} />
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-neutral-200" data-testid="os-dock-sections">
      <Section
        label={OS_STRINGS.chatDock.files}
        open={filesOpen}
        onToggle={() => setFilesOpen((o) => !o)}
        testId="os-dock-section-files"
      >
        <FileTreeView
          nodes={fileTree}
          onFileClick={(path) => {
            if (isTextFile(path)) setEditingFile(path);
          }}
        />
      </Section>
      <Section
        label={OS_STRINGS.chatDock.output}
        open={outputOpen}
        onToggle={() => setOutputOpen((o) => !o)}
        testId="os-dock-section-output"
      >
        <div className="flex h-full min-h-0 flex-col">
          <OutputPanel sessionId={activeSessionId} />
        </div>
      </Section>

      {editingFile && artifactInstanceId && (
        <FileEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingFile(null);
          }}
          artifactId={artifactInstanceId}
          filePath={editingFile}
        />
      )}
    </div>
  );
}

function Section({
  label,
  open,
  onToggle,
  children,
  testId,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="border-b border-neutral-100 last:border-b-0" data-testid={testId}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 focus-ring"
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        {label}
      </button>
      {open && <div className="max-h-56 overflow-y-auto scrollbar-light">{children}</div>}
    </div>
  );
}
