'use client';

/**
 * Workspace switcher: pills for each workspace (a workspace = name + item ids
 * + saved window layout, contract 4.3), a create button, and per-pill
 * rename/delete through the shared ActionMenu.
 */

import React, { useRef, useState } from 'react';
import { Plus, TextCursorInput, Trash2 } from 'lucide-react';
import { OS_STRINGS } from '@/lib/os/strings';
import type { ActionDef, Workspace } from '@/lib/os/types';
import { useOsStore } from '@/stores/os';
import { ActionMenu, type ActionMenuPosition } from '@/components/ui/action-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Button, IconButton } from '@/components/ui/button';
import { useTranslation } from '@/stores/i18n';
import { useLongPress } from '@/hooks/useLongPress';

export function WorkspaceSwitcher() {
  const workspaces = useOsStore((s) => s.workspaces);
  const activeId = useOsStore((s) => s.activeWorkspaceId);
  const setActive = useOsStore((s) => s.setActiveWorkspace);
  const create = useOsStore((s) => s.createWorkspace);
  const rename = useOsStore((s) => s.renameWorkspace);
  const remove = useOsStore((s) => s.removeWorkspace);
  const { common } = useTranslation();

  const [menu, setMenu] = useState<{ ws: Workspace; pos: ActionMenuPosition } | null>(null);
  const [renaming, setRenaming] = useState<Workspace | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);

  const items: ActionDef<Workspace>[] = [
    {
      id: 'rename',
      label: OS_STRINGS.workspace.rename,
      icon: TextCursorInput,
      run: (ws) => setRenaming(ws),
    },
    {
      id: 'delete',
      label: OS_STRINGS.workspace.remove,
      icon: Trash2,
      destructive: true,
      available: () => workspaces.length > 1,
      run: (ws) => setDeleting(ws),
    },
  ];

  return (
    <div
      className="flex items-center gap-1"
      role="tablist"
      aria-label={OS_STRINGS.workspace.switcher}
      data-testid="os-workspace-switcher"
    >
      {workspaces.map((ws) => (
        <WorkspacePill
          key={ws.id}
          workspace={ws}
          active={ws.id === activeId}
          onActivate={() => setActive(ws.id)}
          onMenu={(pos) => setMenu({ ws, pos })}
        />
      ))}
      <IconButton
        icon={Plus}
        label={OS_STRINGS.workspace.create}
        size="sm"
        onClick={() => create()}
      />

      <ActionMenu
        items={items}
        ctx={menu?.ws as Workspace}
        position={menu?.pos ?? null}
        onClose={() => setMenu(null)}
      />

      {renaming && (
        <RenameWorkspaceDialog
          workspace={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            rename(renaming.id, name);
            setRenaming(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            remove(deleting.id);
            setDeleting(null);
          }}
          title={OS_STRINGS.workspace.removeConfirmTitle}
          description={OS_STRINGS.workspace.removeConfirmBody}
          confirmLabel={common.delete}
          cancelLabel={common.cancel}
          tone="danger"
        />
      )}
    </div>
  );
}

function WorkspacePill({
  workspace,
  active,
  onActivate,
  onMenu,
}: {
  workspace: Workspace;
  active: boolean;
  onActivate: () => void;
  onMenu: (pos: ActionMenuPosition) => void;
}) {
  const { onContextMenu: _lp, ...longPress } = useLongPress(onMenu);
  void _lp;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      {...longPress}
      data-testid={`os-workspace-${workspace.id}`}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-ring ${
        active
          ? 'bg-neutral-900 text-white'
          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
      }`}
    >
      {workspace.name}
    </button>
  );
}

function RenameWorkspaceDialog({
  workspace,
  onClose,
  onSave,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const { common } = useTranslation();
  const [name, setName] = useState(workspace.name);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.select(), 80);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={OS_STRINGS.workspace.rename}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={() => onSave(name.trim())}
          >
            {common.save}
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            e.preventDefault();
            onSave(name.trim());
          }
        }}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 outline-none transition-colors focus:border-teal-600 focus:ring-1 focus:ring-teal-600/20"
      />
    </Dialog>
  );
}
