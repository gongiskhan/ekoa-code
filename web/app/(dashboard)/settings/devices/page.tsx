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

/**
 * Device approval page (run s3; D5). The RFC-8628-style device flow's approval half
 * (ch03 §3.8.1): a device (the ekoa-bridge CLI's `pair` command) starts the flow,
 * shows a short `XXXX-XXXX` code and points the user HERE; the authenticated user
 * types the code and approves (or denies). Approval binds the APPROVER's identity to
 * the device token, so the page is authed. The endpoints are carried F1 surfaces
 * (`POST /api/v1/auth/device/approve`); this page is their first in-app consumer.
 */

const COPY = {
  title: 'Aprovação de dispositivos',
  description:
    'Autorize a ligação de um novo dispositivo, por exemplo a ponte local, introduzindo o código apresentado nesse dispositivo.',
  codeLabel: 'Código do dispositivo',
  codeHint: 'O código tem o formato XXXX-XXXX e é válido durante 10 minutos.',
  approve: 'Aprovar',
  approving: 'A aprovar...',
  deny: 'Recusar',
  denying: 'A recusar...',
  approved: 'Dispositivo aprovado. Pode regressar ao dispositivo para continuar.',
  denied: 'Pedido recusado. O dispositivo não recebeu qualquer acesso.',
  invalid: 'Código de dispositivo inválido ou expirado.',
  incomplete: 'Introduza o código completo (8 caracteres).',
} as const;

type Outcome = { kind: 'approved' | 'denied' | 'error'; message: string } | null;

export default function DevicesSettingsPage() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const complete = code.replace(/-/g, '').length === 8;

  async function submit(deny: boolean) {
    if (!complete) {
      setOutcome({ kind: 'error', message: COPY.incomplete });
      return;
    }
    setBusy(deny ? 'deny' : 'approve');
    setOutcome(null);
    const res = await tryCall(() => api.auth.deviceApprove(deny ? { userCode: code, deny: true } : { userCode: code }));
    setBusy(null);
    if (!res.ok) {
      setOutcome({ kind: 'error', message: COPY.invalid });
      return;
    }
    setOutcome(deny ? { kind: 'denied', message: COPY.denied } : { kind: 'approved', message: COPY.approved });
    setCode('');
  }

  return (
    <PageShell testId="settings-devices-page">
      <PageHeader icon={MonitorSmartphone} title={COPY.title} description={COPY.description} />

      <Card className="max-w-lg">
        <Input
          label={COPY.codeLabel}
          hint={COPY.codeHint}
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
            {busy === 'approve' ? COPY.approving : COPY.approve}
          </Button>
          <Button
            variant="danger-ghost"
            icon={X}
            loading={busy === 'deny'}
            disabled={busy !== null || !complete}
            onClick={() => void submit(true)}
            data-testid="device-deny"
          >
            {busy === 'deny' ? COPY.denying : COPY.deny}
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
    </PageShell>
  );
}
