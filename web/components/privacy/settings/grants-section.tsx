'use client';

import { FolderKey } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { useBridgePresence } from '@/hooks/use-bridge-presence';

/**
 * FC-406 active grants with revoke. The grants list is served LIVE by the daemon
 * (§18.2) - there is no hosted endpoint, so this renders the correct state rather
 * than a fabricated list: offline when the bridge is not connected (the hosted
 * default), empty when connected with no grants, and the list + revoke controls
 * when the daemon serves grants. Revoke takes effect on the next tool call, not
 * retroactively (§12.6.3).
 */
export function GrantsSection() {
  const { connected } = useBridgePresence();

  return (
    <section data-testid="privacy-grants">
      <CardTitle icon={FolderKey}>{PRIVACY_COPY.grantsSectionTitle}</CardTitle>
      <CardDescription>{PRIVACY_COPY.grantsSectionDesc}</CardDescription>

      <Card className="mt-3">
        {connected ? (
          // Connected with no daemon-served grants yet.
          <p className="text-sm text-neutral-500">{PRIVACY_COPY.grantsEmptyConnected}</p>
        ) : (
          <p className="text-sm text-neutral-500">{PRIVACY_COPY.grantsOffline}</p>
        )}
      </Card>
    </section>
  );
}
