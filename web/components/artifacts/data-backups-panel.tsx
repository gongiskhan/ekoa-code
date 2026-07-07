'use client';

/**
 * "Dados e cópias de segurança" — the per-app data-safety panel.
 *
 * Gives non-technical users confidence their data is safe: a passive
 * reassurance line, restore points as human labels, preview-before-restore,
 * restore with an automatic safety-net snapshot, and a JSON download. The user
 * never sees the backend (Firestore/GCS). All copy is PT-PT.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, Clock, Download, RotateCcw, Eye, Save, AlertTriangle, Loader2, X,
} from 'lucide-react';
import {
  getBackupStatus, downloadAppDataDump, previewBackupPoint, createBackupSnapshot,
  restoreBackupPoint, type BackupStatus, type BackupRestorePoint, type AppDataDump,
} from '@/lib/api/client';
import { useConfirm } from '@/components/ui/confirm-dialog';

function reassurance(status: BackupStatus | null): string {
  if (!status) return 'A verificar as suas cópias de segurança…';
  if (status.lastBackupAt) {
    const d = new Date(status.lastBackupAt);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const pts = status.restorePoints.filter((p) => p.source === 'local');
    const when = pts[0]?.label ?? `às ${hh}:${mm}`;
    return `Os seus dados são guardados automaticamente — última cópia de segurança ${when}.`;
  }
  return 'Os seus dados estão seguros. Crie a sua primeira cópia de segurança quando quiser.';
}

export function DataBackupsPanel({ appId, appName }: { appId: string; appName?: string }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ point: BackupRestorePoint; dump: AppDataDump } | null>(null);
  const confirm = useConfirm();

  // Manual re-fetch (from event handlers — fine to setState synchronously here).
  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await getBackupStatus(appId);
    if (res.success && res.data) { setStatus(res.data); setError(null); }
    else setError(res.error?.message ?? 'Não foi possível carregar as cópias de segurança.');
    setLoading(false);
  }, [appId]);

  // Initial load: setState only AFTER the await, so the effect never sets state
  // synchronously (avoids cascading renders).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getBackupStatus(appId);
      if (cancelled) return;
      if (res.success && res.data) { setStatus(res.data); setError(null); }
      else setError(res.error?.message ?? 'Não foi possível carregar as cópias de segurança.');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [appId]);

  const onSnapshot = useCallback(async () => {
    setBusy('snapshot'); setError(null); setNotice(null);
    const res = await createBackupSnapshot(appId);
    if (res.success) { setNotice('Cópia de segurança criada.'); await refresh(); }
    else setError(res.error?.message ?? 'Não foi possível criar a cópia.');
    setBusy(null);
  }, [appId, refresh]);

  const onDownload = useCallback(async () => {
    setBusy('download'); setError(null);
    const res = await downloadAppDataDump(appId);
    if (res.success && res.data) {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${appName || appId}-dados.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } else setError(res.error?.message ?? 'Não foi possível descarregar os dados.');
    setBusy(null);
  }, [appId, appName]);

  const onPreview = useCallback(async (point: BackupRestorePoint) => {
    setBusy(`preview:${point.id}`); setError(null);
    const res = await previewBackupPoint(appId, point);
    if (res.success && res.data) setPreview({ point, dump: res.data });
    else setError(res.error?.message ?? 'Não foi possível pré-visualizar este ponto.');
    setBusy(null);
  }, [appId]);

  const onRestore = useCallback(async (point: BackupRestorePoint) => {
    const ok = await confirm({
      title: `Restaurar os dados para "${point.label}"?`,
      description:
        'Antes de restaurar, guardamos automaticamente uma cópia do estado atual, ' +
        'para que possa desfazer esta ação.',
    });
    if (!ok) return;
    setBusy(`restore:${point.id}`); setError(null); setNotice(null);
    const res = await restoreBackupPoint(appId, point);
    if (res.success) {
      setNotice(`Dados restaurados para "${point.label}". O estado anterior foi guardado, pode desfazer.`);
      setPreview(null);
      await refresh();
    } else setError(res.error?.message ?? 'Não foi possível restaurar.');
    setBusy(null);
  }, [appId, refresh, confirm]);

  return (
    <section data-testid="data-backups-panel" className="rounded-xl border border-neutral-200 bg-white p-5">
      <header className="flex items-center gap-2 mb-3">
        <ShieldCheck className="h-5 w-5 text-teal-600" aria-hidden />
        <h3 className="text-base font-semibold text-neutral-900">Dados e cópias de segurança</h3>
      </header>

      {/* Passive reassurance line — half the comfort */}
      <p data-testid="backup-reassurance" className="flex items-center gap-2 text-sm text-neutral-600 mb-4">
        <Clock className="h-4 w-4 text-neutral-400" aria-hidden />
        {reassurance(status)}
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-lg bg-teal-50 border border-teal-200 p-3 text-sm text-teal-800">{notice}</div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        <button
          data-testid="backup-snapshot-btn" onClick={onSnapshot} disabled={busy === 'snapshot'}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy === 'snapshot' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Criar cópia agora
        </button>
        <button
          data-testid="backup-download-btn" onClick={onDownload} disabled={busy === 'download'}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Descarregar os meus dados (JSON)
        </button>
      </div>

      {/* Restore points — seeing the list goes back is the other half of the comfort */}
      <h4 className="text-sm font-medium text-neutral-700 mb-2">Pontos para restaurar</h4>
      {loading ? (
        <p className="text-sm text-neutral-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> A carregar…</p>
      ) : status && status.restorePoints.length > 0 ? (
        <ul data-testid="restore-point-list" className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {status.restorePoints.map((p) => (
            <li key={`${p.source}:${p.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800 truncate">{p.label}</p>
                <p className="text-xs text-neutral-400">{p.kind === 'safety-net' ? 'antes de um restauro' : p.source === 'pitr' ? 'automático' : 'cópia guardada'}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  data-testid="restore-point-preview" onClick={() => onPreview(p)} disabled={!!busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                >
                  {busy === `preview:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  Pré-visualizar
                </button>
                <button
                  data-testid="restore-point-restore" onClick={() => onRestore(p)} disabled={!!busy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="no-restore-points" className="text-sm text-neutral-400">
          Ainda não há cópias guardadas. Use “Criar cópia agora” para guardar o estado atual.
        </p>
      )}

      {/* Preview-before-restore overlay */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="backup-preview-modal">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
              <p className="text-sm font-medium text-neutral-800">
                Aqui estão os seus dados tal como estavam {preview.point.label}.
              </p>
              <button onClick={() => setPreview(null)} className="text-neutral-400 hover:text-neutral-700" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[55vh] overflow-auto px-5 py-4">
              {Object.keys(preview.dump.collections).length === 0 ? (
                <p className="text-sm text-neutral-400">Sem dados neste ponto.</p>
              ) : (
                Object.entries(preview.dump.collections).map(([name, items]) => (
                  <div key={name} className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                      {name} <span className="text-neutral-400">({items.length})</span>
                    </p>
                    <pre className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-xs text-neutral-700 overflow-x-auto">
                      {JSON.stringify(items, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
              <button onClick={() => setPreview(null)} className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
                Fechar
              </button>
              <button
                data-testid="preview-restore-btn" onClick={() => onRestore(preview.point)} disabled={!!busy}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> Restaurar para este ponto
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
