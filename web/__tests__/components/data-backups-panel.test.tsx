/**
 * DataBackupsPanel UI test. The live walkthrough is environment-blocked (a
 * main-dev cortex holds the shared data dir), so this committed render test is
 * the UI slice's re-runnable assertion: reassurance line, restore-points
 * rendering, snapshot + download actions, and the empty state — all against a
 * mocked api client (no cortex needed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { DataBackupsPanel } from '@/components/artifacts/data-backups-panel';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';
import type { BackupStatus, BackupRestorePoint } from '@ekoa/shared';

function renderPanel(ui: ReactElement) {
  return render(<ConfirmProvider>{ui}</ConfirmProvider>);
}

// FC-307: mock the typed client. The panel calls api.artifacts.backup* via tryCall, so the mocked
// methods resolve the RAW payload (tryCall wraps it as { ok, data }); tryCall is the real wrapper.
vi.mock('@/lib/api', () => ({
  api: {
    artifacts: {
      backupStatus: vi.fn(),
      backupExport: vi.fn(),
      backupPreview: vi.fn(),
      backupSnapshot: vi.fn(),
      backupRestore: vi.fn(),
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  },
}));

const mocked = api.artifacts as unknown as {
  backupStatus: ReturnType<typeof vi.fn>;
  backupExport: ReturnType<typeof vi.fn>;
  backupSnapshot: ReturnType<typeof vi.fn>;
};

function statusWith(points: Array<Partial<BackupRestorePoint>>): BackupStatus {
  return {
    appId: 'app1',
    lastBackupAt: points[0]?.at ?? null,
    automatic: false,
    pitrAvailable: false,
    restorePoints: points.map((p, i) => ({
      id: p.id ?? `p${i}`, at: p.at ?? '2026-06-08T09:14:00Z', kind: p.kind ?? 'manual',
      source: p.source ?? 'local', label: p.label ?? 'hoje, 09:14',
    })),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('DataBackupsPanel', () => {
  it('shows the PT-PT reassurance line and restore points from status', async () => {
    mocked.backupStatus.mockResolvedValue(
      statusWith([{ label: 'hoje, 09:14', at: '2026-06-08T09:14:00Z' }, { id: 'p2', label: 'ontem, 18:00', kind: 'nightly' }]),
    );
    renderPanel(<DataBackupsPanel appId="app1" appName="Conexão" />);

    await waitFor(() => expect(screen.getByTestId('backup-reassurance')).toHaveTextContent(/última cópia de segurança/i));
    const list = await screen.findByTestId('restore-point-list');
    expect(list).toHaveTextContent('hoje, 09:14');
    expect(list).toHaveTextContent('ontem, 18:00');
    expect(screen.getAllByTestId('restore-point-restore')).toHaveLength(2);
  });

  it('renders the empty state when there are no restore points', async () => {
    mocked.backupStatus.mockResolvedValue(statusWith([]));
    renderPanel(<DataBackupsPanel appId="app1" />);
    expect(await screen.findByTestId('no-restore-points')).toBeInTheDocument();
    expect(screen.getByTestId('backup-reassurance')).toHaveTextContent(/primeira cópia de segurança/i);
  });

  it('creates a snapshot then refreshes', async () => {
    mocked.backupStatus
      .mockResolvedValueOnce(statusWith([]))
      .mockResolvedValueOnce(statusWith([{ label: 'hoje, 10:00' }]));
    mocked.backupSnapshot.mockResolvedValue({ id: 'p1', at: '2026-06-08T10:00:00Z', kind: 'manual', source: 'local', label: 'hoje, 10:00' });

    renderPanel(<DataBackupsPanel appId="app1" />);
    await screen.findByTestId('no-restore-points');
    await userEvent.click(screen.getByTestId('backup-snapshot-btn'));

    await waitFor(() => expect(mocked.backupSnapshot).toHaveBeenCalledWith({ id: 'app1' }));
    await waitFor(() => expect(screen.getByTestId('restore-point-list')).toHaveTextContent('hoje, 10:00'));
  });

  it('downloads the current data as a JSON blob', async () => {
    mocked.backupStatus.mockResolvedValue(statusWith([]));
    mocked.backupExport.mockResolvedValue(
      { appId: 'app1', exportedAt: '2026-06-08T10:00:00Z', collections: { clientes: [] }, counts: { clientes: 0 }, totalItems: 0 },
    );
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPanel(<DataBackupsPanel appId="app1" appName="Conexão" />);
    await screen.findByTestId('no-restore-points');
    await userEvent.click(screen.getByTestId('backup-download-btn'));

    await waitFor(() => expect(mocked.backupExport).toHaveBeenCalledWith({ id: 'app1' }));
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
