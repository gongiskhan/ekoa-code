'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderKey, FolderOpen, File } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/stores/toast';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { useBridgePresence } from '@/hooks/use-bridge-presence';
import { fetchDaemonGrants, revokeDaemonGrant, type DaemonGrant } from '@/lib/bridge-local';

/**
 * FC-406 active grants with revoke. The grants list is served LIVE by the daemon over
 * its loopback surface (§18.2; run D2) and rendered straight from it — grant paths never
 * transit or persist hosted-side. Revoke takes effect on the next tool call, not
 * retroactively (§12.6.3). States, all honest: offline (bridge not connected), the live
 * list (with revoke), empty (connected, no grants), unavailable (connected but the
 * daemon predates the C1-C3 loopback contract — docs/bridge-counterpart-changes.md).
 */
export function GrantsSection() {
  const { connected } = useBridgePresence();
  const [grants, setGrants] = useState<DaemonGrant[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGrants(await fetchDaemonGrants());
      setUnavailable(false);
    } catch {
      setGrants(null);
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    if (!connected) {
      setGrants(null);
      setUnavailable(false);
      return;
    }
    void load();
  }, [connected, load]);

  async function revoke(grantRef: string) {
    setRevoking(grantRef);
    try {
      await revokeDaemonGrant(grantRef);
      await load();
    } catch {
      toast.error(PRIVACY_COPY.grantRevokeError);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section data-testid="privacy-grants">
      <CardTitle icon={FolderKey}>{PRIVACY_COPY.grantsSectionTitle}</CardTitle>
      <CardDescription>{PRIVACY_COPY.grantsSectionDesc}</CardDescription>

      <Card className="mt-3">
        {!connected ? (
          <p className="text-sm text-neutral-500">{PRIVACY_COPY.grantsOffline}</p>
        ) : unavailable ? (
          <p className="text-sm text-neutral-500" data-testid="grants-unavailable">
            {PRIVACY_COPY.grantsUnavailable}
          </p>
        ) : grants === null ? null : grants.length === 0 ? (
          <p className="text-sm text-neutral-500">{PRIVACY_COPY.grantsEmptyConnected}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="grants-list">
            {grants.map((g) => {
              const Icon = g.scope === 'file' ? File : FolderOpen;
              return (
                <li key={g.grantRef} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon size={14} className="shrink-0 text-neutral-400" aria-hidden />
                    <span className="truncate font-mono text-xs text-neutral-700" title={g.path ?? g.label}>
                      {g.label ?? g.path ?? g.grantRef}
                    </span>
                  </div>
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    loading={revoking === g.grantRef}
                    onClick={() => void revoke(g.grantRef)}
                    data-testid={`grant-revoke-${g.grantRef}`}
                  >
                    {revoking === g.grantRef ? PRIVACY_COPY.grantRevoking : PRIVACY_COPY.grantRevoke}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
