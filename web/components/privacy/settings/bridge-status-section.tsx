'use client';

import { useState } from 'react';
import { Radio, KeyRound } from 'lucide-react';
import { api, tryCall } from '@/lib/api';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/stores/toast';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { useBridgePresence } from '@/hooks/use-bridge-presence';

interface PairingCode {
  token: string;
  expiresIn: number;
}

const STATUS_LABEL: Record<string, { label: string; desc: string; tone: BadgeTone }> = {
  'not-installed': {
    label: PRIVACY_COPY.bridgeStatusNotPaired,
    desc: PRIVACY_COPY.bridgeStatusNotPairedDesc,
    tone: 'neutral',
  },
  offline: {
    label: PRIVACY_COPY.bridgeStatusOffline,
    desc: PRIVACY_COPY.bridgeStatusOfflineDesc,
    tone: 'warning',
  },
  connected: {
    label: PRIVACY_COPY.bridgeStatusConnected,
    desc: '',
    tone: 'success',
  },
};

/**
 * FC-405 bridge status + pairing. Presence is the daemon heartbeat (hosted default:
 * not paired - `useBridgePresence`, no invented endpoint). Pairing IS functional:
 * `api.ekoaLocal.bridgeToken` mints a short-TTL pairing code (§3.8; ch18 §18.3) the
 * user enters into the daemon. The revoke-pairing kill switch is surfaced here; a
 * server-side revoke is daemon-served (no hosted endpoint), so in this build it
 * clears the locally-shown code - the seam for a server revoke lands with the daemon.
 */
export function BridgeStatusSection() {
  const { status } = useBridgePresence();
  const confirm = useConfirm();
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [generating, setGenerating] = useState(false);

  const state = STATUS_LABEL[status] ?? STATUS_LABEL['not-installed'];

  async function generate() {
    setGenerating(true);
    const res = await tryCall(() => api.ekoaLocal.bridgeToken());
    setGenerating(false);
    if (res.ok) {
      setPairing({ token: res.data.token, expiresIn: res.data.expiresIn });
    } else {
      toast.error(PRIVACY_COPY.bridgePairError);
    }
  }

  async function revoke() {
    const ok = await confirm({
      title: PRIVACY_COPY.bridgeRevokePairingConfirmTitle,
      description: PRIVACY_COPY.bridgeRevokePairingConfirmDesc,
      confirmLabel: PRIVACY_COPY.bridgeRevokePairing,
      tone: 'danger',
    });
    if (!ok) return;
    setPairing(null);
  }

  return (
    <section data-testid="privacy-bridge-status">
      <CardTitle icon={Radio}>{PRIVACY_COPY.bridgeSectionTitle}</CardTitle>
      <CardDescription>{PRIVACY_COPY.bridgeSectionDesc}</CardDescription>

      <Card className="mt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
            {state.desc && <p className="mt-2 text-sm text-neutral-500">{state.desc}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pairing && (
              <Button variant="danger-ghost" size="sm" onClick={revoke}>
                {PRIVACY_COPY.bridgeRevokePairing}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={KeyRound}
              loading={generating}
              onClick={generate}
            >
              {generating ? PRIVACY_COPY.bridgePairGenerating : PRIVACY_COPY.bridgePairGenerate}
            </Button>
          </div>
        </div>

        {pairing && (
          <div className="mt-4 rounded-lg border border-line bg-neutral-50 p-3" data-testid="pairing-code">
            <div className="text-xs font-medium text-neutral-500">
              {PRIVACY_COPY.bridgePairCodeLabel}
            </div>
            <code className="mt-1 block break-all font-mono text-sm font-semibold text-neutral-900">
              {pairing.token}
            </code>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              {PRIVACY_COPY.bridgePairExpiresIn(pairing.expiresIn)}
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}
