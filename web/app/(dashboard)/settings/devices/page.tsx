'use client';

import { useState } from 'react';
import { MonitorSmartphone, Check, X } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, tryCall } from '@/lib/api';
import { normalizeUserCode } from '@/lib/device-code';
import { useTranslation } from '@/stores/i18n';
import { PairedMachinesSection } from '@/components/settings/paired-machines-section';

/**
 * Devices: approving one, and authorising what the approved ones may do.
 *
 * The first half is the RFC-8628-style device flow's approval (ch03 §3.8.1; run s3, D5): a device
 * (the ekoa-bridge CLI's `pair` command) starts the flow, shows a short `XXXX-XXXX` code and points
 * the user HERE; the authenticated user types the code and approves (or denies). Approval binds the
 * APPROVER's identity to the device token, so the page is authed.
 *
 * The second half is the I-3 capability grants for the machines that pairing produced, admin-only
 * and rendered only for admins. The two belong on one page because they are the two halves of one
 * act: approving a computer, and saying what the org's work may be routed through it for. Pairing
 * alone grants NOTHING - the daemon step seam is default-deny - so a page that stopped at approval
 * left every administrator believing they had finished.
 */

type Outcome = { kind: 'approved' | 'denied' | 'error'; message: string } | null;

export default function DevicesSettingsPage() {
  const { pages } = useTranslation();
  const t = pages.devices;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const complete = code.replace(/-/g, '').length === 8;

  async function submit(deny: boolean) {
    if (!complete) {
      setOutcome({ kind: 'error', message: t.incomplete });
      return;
    }
    setBusy(deny ? 'deny' : 'approve');
    setOutcome(null);
    const res = await tryCall(() => api.auth.deviceApprove(deny ? { userCode: code, deny: true } : { userCode: code }));
    setBusy(null);
    if (!res.ok) {
      setOutcome({ kind: 'error', message: t.invalid });
      return;
    }
    setOutcome(deny ? { kind: 'denied', message: t.denied } : { kind: 'approved', message: t.approved });
    setCode('');
  }

  return (
    <PageShell testId="settings-devices-page">
      <PageHeader icon={MonitorSmartphone} title={t.title} description={t.description} />

      <Card className="max-w-lg">
        <Input
          label={t.codeLabel}
          hint={t.codeHint}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => {
            setCode(normalizeUserCode(e.target.value));
            setOutcome(null);
          }}
          className="font-mono tracking-widest"
          data-testid="device-code-input"
        />

        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="primary"
            icon={Check}
            loading={busy === 'approve'}
            disabled={busy !== null || !complete}
            onClick={() => void submit(false)}
            data-testid="device-approve"
          >
            {busy === 'approve' ? t.approving : t.approve}
          </Button>
          <Button
            variant="danger-ghost"
            icon={X}
            loading={busy === 'deny'}
            disabled={busy !== null || !complete}
            onClick={() => void submit(true)}
            data-testid="device-deny"
          >
            {busy === 'deny' ? t.denying : t.deny}
          </Button>
        </div>

        {outcome && (
          <p
            className={`mt-4 text-sm ${outcome.kind === 'error' ? 'text-red-600' : 'text-teal-700'}`}
            data-testid={`device-outcome-${outcome.kind}`}
            role="status"
          >
            {outcome.message}
          </p>
        )}
      </Card>

      <PairedMachinesSection />
    </PageShell>
  );
}
