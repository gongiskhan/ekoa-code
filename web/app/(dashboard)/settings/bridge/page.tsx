"use client";

import { useEffect, useState } from 'react';
import { Terminal, AlertCircle, X } from 'lucide-react';
import { api, tryCall } from '@/lib/api';

/** Local view row for an approved command. Timestamps + note ride the endpoint's
 *  passthrough contract, so they are accessed off this row shape, not the typed schema. */
interface ApprovedLocalCommand {
  shape: string;
  approvedAt: string;
  lastUsedAt?: string;
  note?: string;
}

export default function BridgeSettingsPage() {
  const [approved, setApproved] = useState<ApprovedLocalCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingShape, setRevokingShape] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const res = await tryCall(() => api.automations.approvedCommands());
    if (res.ok) {
      setApproved((res.data.items ?? []) as unknown as ApprovedLocalCommand[]);
      setErr(null);
    } else {
      setErr(res.error.message ?? 'failed to load approvals');
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function revoke(shape: string) {
    setRevokingShape(shape);
    try {
      await tryCall(() => api.automations.revokeApprovedCommand({ shape }));
      await refresh();
    } finally {
      setRevokingShape(null);
    }
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-900">Bridge & local commands</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Manage what local commands your automations can run on this machine, and pair a cloud bridge daemon.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-medium text-neutral-900 flex items-center gap-2">
            <Terminal size={16} className="text-orange-600" />
            Approved local commands
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            First-time use of any new command shape requires your approval. Approvals are scoped to your user account and revokable below.
          </p>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="text-sm text-neutral-500">Loading…</div>
          ) : err ? (
            <div className="text-sm text-red-700 flex items-center gap-2">
              <AlertCircle size={14} /> {err}
            </div>
          ) : approved.length === 0 ? (
            <div className="text-sm text-neutral-500 italic">
              No commands approved yet. The first time an automation tries to run a local command on your machine, you'll see a consent dialog here.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {approved.map((a) => (
                <li key={a.shape} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <code className="text-sm font-mono text-neutral-800 break-all">{a.shape}</code>
                    <div className="text-[11px] text-neutral-500 mt-0.5">
                      Approved {new Date(a.approvedAt).toLocaleString()}
                      {a.lastUsedAt && <> &middot; Last used {new Date(a.lastUsedAt).toLocaleString()}</>}
                      {a.note && <> &middot; <em>{a.note}</em></>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => revoke(a.shape)}
                    disabled={revokingShape === a.shape}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <X size={12} />
                    {revokingShape === a.shape ? 'Revoking…' : 'Revoke'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-medium text-neutral-900">Bridge daemon pairing</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Required when Cortex runs in the cloud and your automations need to execute commands on your local machine.
          </p>
        </div>
        <div className="p-4 text-sm text-neutral-600">
          <p className="text-neutral-700">
            <strong>Bridge not required</strong> — Ekoa is currently running locally on your machine. Local commands execute directly inside Cortex with your user's privileges. Pairing a separate bridge daemon is only needed for cloud-hosted Ekoa deployments.
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Cloud-mode bridge daemon pairing arrives in a follow-up release.
          </p>
        </div>
      </section>
    </div>
  );
}
