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
import * as client from '@/lib/api/client';

function renderPanel(ui: ReactElement) {
  return render(<ConfirmProvider>{ui}</ConfirmProvider>);
}

vi.mock('@/lib/api/client', () => ({
  getBackupStatus: vi.fn(),
  downloadAppDataDump: vi.fn(),
  previewBackupPoint: vi.fn(),
  createBackupSnapshot: vi.fn(),
  restoreBackupPoint: vi.fn(),
}));

const mocked = client as unknown as {
  getBackupStatus: ReturnType<typeof vi.fn>;
  downloadAppDataDump: ReturnType<typeof vi.fn>;
  createBackupSnapshot: ReturnType<typeof vi.fn>;
};

function statusWith(points: Array<Partial<client.BackupRestorePoint>>): client.BackupStatus {
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
    mocked.getBackupStatus.mockResolvedValue({
      success: true,
      data: statusWith([{ label: 'hoje, 09:14', at: '2026-06-08T09:14:00Z' }, { id: 'p2', label: 'ontem, 18:00', kind: 'nightly' }]),
    });
    renderPanel(<DataBackupsPanel appId="app1" appName="Conexão" />);

    await waitFor(() => expect(screen.getByTestId('backup-reassurance')).toHaveTextContent(/última cópia de segurança/i));
    const list = await screen.findByTestId('restore-point-list');
    expect(list).toHaveTextContent('hoje, 09:14');
    expect(list).toHaveTextContent('ontem, 18:00');
    expect(screen.getAllByTestId('restore-point-restore')).toHaveLength(2);
  });

  it('renders the empty state when there are no restore points', async () => {
    mocked.getBackupStatus.mockResolvedValue({ success: true, data: statusWith([]) });
    renderPanel(<DataBackupsPanel appId="app1" />);
    expect(await screen.findByTestId('no-restore-points')).toBeInTheDocument();
    expect(screen.getByTestId('backup-reassurance')).toHaveTextContent(/primeira cópia de segurança/i);
  });

  it('creates a snapshot then refreshes', async () => {
    mocked.getBackupStatus
      .mockResolvedValueOnce({ success: true, data: statusWith([]) })
      .mockResolvedValueOnce({ success: true, data: statusWith([{ label: 'hoje, 10:00' }]) });
    mocked.createBackupSnapshot.mockResolvedValue({ success: true, data: { id: 'p1', at: '2026-06-08T10:00:00Z', kind: 'manual', source: 'local', label: 'hoje, 10:00' } });

    renderPanel(<DataBackupsPanel appId="app1" />);
    await screen.findByTestId('no-restore-points');
    await userEvent.click(screen.getByTestId('backup-snapshot-btn'));

    await waitFor(() => expect(mocked.createBackupSnapshot).toHaveBeenCalledWith('app1'));
    await waitFor(() => expect(screen.getByTestId('restore-point-list')).toHaveTextContent('hoje, 10:00'));
  });

  it('downloads the current data as a JSON blob', async () => {
    mocked.getBackupStatus.mockResolvedValue({ success: true, data: statusWith([]) });
    mocked.downloadAppDataDump.mockResolvedValue({
      success: true,
      data: { appId: 'app1', exportedAt: '2026-06-08T10:00:00Z', collections: { clientes: [] }, counts: { clientes: 0 }, totalItems: 0 },
    });
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPanel(<DataBackupsPanel appId="app1" appName="Conexão" />);
    await screen.findByTestId('no-restore-points');
    await userEvent.click(screen.getByTestId('backup-download-btn'));

    await waitFor(() => expect(mocked.downloadAppDataDump).toHaveBeenCalledWith('app1'));
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
