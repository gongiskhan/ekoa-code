'use client';

import { useEffect, useState } from 'react';
import { Terminal, AlertCircle } from 'lucide-react';
import { api, tryCall } from '@/lib/api';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PRIVACY_COPY } from '@/lib/privacy-claims';

/** Local view row for an approved command. Timestamps + note ride the endpoint's
 *  passthrough contract, so they are read off this row shape, not the typed schema. */
interface ApprovedLocalCommand {
  shape: string;
  approvedAt?: string;
  lastUsedAt?: string;
  note?: string;
}

/**
 * FC-409 approved-commands list, unified into the privacy surface from the old
 * orphan `/settings/bridge` page (§12.6.3; RESOLVED Q-07). Functional: the
 * endpoints are unchanged (`GET /automations/approved-commands`,
 * `POST .../revoke`, §3.8.18). Copy ported to PT-PT.
 */
export function ApprovedCommandsSection() {
  const [approved, setApproved] = useState<ApprovedLocalCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingShape, setRevokingShape] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // State is only written after the awaited fetch resolves (never synchronously in
  // the effect body), so `loading` starts true and refresh does not re-flip it.
  async function refresh() {
    const res = await tryCall(() => api.automations.approvedCommands());
    if (res.ok) {
      setApproved((res.data.items ?? []) as unknown as ApprovedLocalCommand[]);
      setErr(null);
    } else {
      setErr(res.error.message ?? PRIVACY_COPY.commandsLoadError);
    }
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
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
    <section data-testid="privacy-approved-commands">
      <CardTitle icon={Terminal}>{PRIVACY_COPY.commandsSectionTitle}</CardTitle>
      <CardDescription>{PRIVACY_COPY.commandsSectionDesc}</CardDescription>

      <Card className="mt-3" padding="none">
        <div className="p-4">
          {loading ? (
            <div className="text-sm text-neutral-500">A carregar...</div>
          ) : err ? (
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle size={14} aria-hidden /> {err}
            </div>
          ) : approved.length === 0 ? (
            <div className="text-sm italic text-neutral-500">{PRIVACY_COPY.commandsEmpty}</div>
          ) : (
            <ul className="divide-y divide-line">
              {approved.map((a) => (
                <li key={a.shape} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <code className="break-all font-mono text-sm text-neutral-800">{a.shape}</code>
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      {a.approvedAt && <>{PRIVACY_COPY.commandApprovedAt} {new Date(a.approvedAt).toLocaleString('pt-PT')}</>}
                      {a.lastUsedAt && <> · {PRIVACY_COPY.commandLastUsedAt} {new Date(a.lastUsedAt).toLocaleString('pt-PT')}</>}
                      {a.note && <> · <em>{a.note}</em></>}
                    </div>
                  </div>
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    loading={revokingShape === a.shape}
                    onClick={() => revoke(a.shape)}
                  >
                    {revokingShape === a.shape ? PRIVACY_COPY.commandRevoking : PRIVACY_COPY.commandRevoke}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}
