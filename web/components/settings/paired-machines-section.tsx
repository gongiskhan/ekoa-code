'use client';

import { useEffect, useState } from 'react';
import { Laptop, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from '@/stores/i18n';
import { useBridgeMachinesStore } from '@/stores/bridge-machines';
import { BridgeCapability } from '@ekoa/shared';
import type { BridgeMachineSummary } from '@ekoa/shared';

/**
 * The org's paired machines and what each one is AUTHORISED for (I-3).
 *
 * A machine ADVERTISES what it can do; the org GRANTS what its work may be routed through it for,
 * and a capability is usable only where both hold. Until this surface existed nothing in the
 * product could write a grant, so the default-deny in the daemon step seam refused every browser
 * and bash step forever - the enforcement was real and the decision had nowhere to be made.
 *
 * ADMIN ONLY, and rendered rather than disabled: the list endpoint refuses a non-admin outright,
 * so drawing the section for one would mean fetching a 403 to show an empty box. The device
 * approval half of this page stays available to everyone.
 *
 * `egress.residential` takes an ADDRESS, not just a yes. The field is prefilled with what the
 * machine advertises so the person deciding sees the destination they are authorising - granting
 * the capability alone would authorise the machine and let the machine choose where the org's
 * traffic goes.
 */
export function PairedMachinesSection() {
  const { pages } = useTranslation();
  const t = pages.devices.machines;
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'org-admin' || role === 'super-admin';

  const { machines, isLoading, isLoaded, error, pending, failure, fetchMachines, grant, revoke } =
    useBridgeMachinesStore();

  useEffect(() => {
    if (isAdmin) void fetchMachines();
  }, [isAdmin, fetchMachines]);

  if (!isAdmin) return null;

  return (
    <section className="mt-10" data-testid="paired-machines">
      <CardTitle icon={Laptop}>{t.title}</CardTitle>
      <CardDescription>{t.description}</CardDescription>

      {error && (
        <Card className="mt-3">
          <p className="text-sm text-red-600" role="status" data-testid="machines-error">
            {t.loadError}
          </p>
          <Button className="mt-3" size="sm" onClick={() => void fetchMachines()}>
            {t.retry}
          </Button>
        </Card>
      )}

      {!isLoaded && isLoading && <LoadingState label={t.loading} />}

      {isLoaded && !error && machines.length === 0 && (
        <Card className="mt-3">
          <EmptyState icon={Laptop} title={t.empty} description={t.emptyDescription} />
        </Card>
      )}

      {machines.length > 0 && (
        <div className="mt-3 space-y-4">
          {machines.map((machine) => (
            <MachineCard
              key={machine.pairingId}
              machine={machine}
              pending={pending}
              failure={failure}
              onGrant={grant}
              onRevoke={revoke}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MachineCard({
  machine,
  pending,
  failure,
  onGrant,
  onRevoke,
}: {
  machine: BridgeMachineSummary;
  pending: string | null;
  failure: { pairingId: string; capability: string; message: string } | null;
  onGrant: (pairingId: string, capability: BridgeCapability, egressEndpoint?: string) => Promise<boolean>;
  onRevoke: (pairingId: string, capability: string) => Promise<boolean>;
}) {
  const { pages } = useTranslation();
  const t = pages.devices.machines;
  const confirm = useConfirm();
  // The endpoint being authorised, prefilled from what the machine advertises. Local to the card:
  // it is an input for one pending decision, not state the fleet listing carries.
  //
  // IT RE-SEEDS WHEN THE MACHINE RE-ADVERTISES. Seeded once, the field would keep showing the
  // address the card mounted with while a refetch shows a machine now advertising a DIFFERENT one,
  // and the admin would authorise a destination nobody is offering. It fails safe today (routing
  // withholds the route on mismatch, and the card warns) but it fails safe by accident: the person
  // is being asked to approve an address the surface itself has already superseded. Adjusting
  // during render rather than in an effect avoids committing the stale value to the DOM first.
  //
  // A half-typed edit is deliberately discarded when the advertisement moves. The new address is
  // the fact worth looking at, and silently keeping a manual entry over it is the exact confusion
  // this field exists to prevent.
  const [endpoint, setEndpoint] = useState(machine.egressEndpoint ?? '');
  const [seededFrom, setSeededFrom] = useState(machine.egressEndpoint);
  if (machine.egressEndpoint !== seededFrom) {
    setSeededFrom(machine.egressEndpoint);
    setEndpoint(machine.egressEndpoint ?? '');
  }

  const granted = new Set(machine.grantedCapabilities);
  const advertised = new Set(machine.advertisedCapabilities);
  // The union, so a grant for something the machine no longer advertises stays VISIBLE and
  // therefore revocable. Hiding it would leave a live grant nobody can see or turn off.
  const rows = [...new Set([...machine.advertisedCapabilities, ...machine.grantedCapabilities])].sort();

  const labels = t.capabilities as Record<string, string | undefined>;
  const egressMismatch =
    granted.has('egress.residential') &&
    machine.grantedEgressEndpoint !== undefined &&
    machine.egressEndpoint !== undefined &&
    machine.grantedEgressEndpoint !== machine.egressEndpoint;

  async function toggle(capability: string, isGranted: boolean) {
    if (isGranted) {
      const ok = await confirm({
        title: t.revoke,
        description: `${labels[capability] ?? capability}: ${t.revokeConfirm}`,
        confirmLabel: t.revoke,
        tone: 'danger',
      });
      if (!ok) return;
      await onRevoke(machine.pairingId, capability);
      return;
    }
    // The grant path is the closed vocabulary's. A machine running a newer daemon can advertise a
    // capability this server has no name for; the button for it is not rendered, and this is the
    // second half of that same rule so the two cannot drift apart.
    const known = BridgeCapability.safeParse(capability);
    if (!known.success) return;
    await onGrant(
      machine.pairingId,
      known.data,
      known.data === 'egress.residential' ? endpoint.trim() : undefined,
    );
  }

  return (
    <Card data-testid={`machine-${machine.pairingId}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium text-neutral-900" title={machine.pairingId}>
            {machine.pairingId}
          </p>
          {machine.egressEndpoint && (
            <p className="mt-1 font-mono text-xs text-neutral-500">
              {t.advertisedAddress}: {machine.egressEndpoint}
            </p>
          )}
        </div>
        <Badge tone={machine.live ? 'success' : 'neutral'} dot>
          {machine.live ? t.live : t.offline}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">{t.advertisesNothing}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((capability) => {
            const isGranted = granted.has(capability);
            const isAdvertised = advertised.has(capability);
            const busy = pending === `${machine.pairingId}::${capability}`;
            const rowFailure =
              failure && failure.pairingId === machine.pairingId && failure.capability === capability
                ? failure
                : null;
            const isKnown = BridgeCapability.safeParse(capability).success;
            const needsEndpoint = capability === 'egress.residential' && !isGranted;

            return (
              <li key={capability} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* The id always shows, because it is what the refusal on a blocked step
                          names. The human label only joins it when there IS one - a capability
                          this server has no name for would otherwise print its id twice. */}
                      {labels[capability] && (
                        <span className="text-sm font-medium text-neutral-800">{labels[capability]}</span>
                      )}
                      <code className="font-mono text-xs text-neutral-500">{capability}</code>
                      {isGranted && (
                        <Badge tone="success">
                          <ShieldCheck size={12} aria-hidden />
                          {t.granted}
                        </Badge>
                      )}
                      {isGranted && !isAdvertised && (
                        <Badge tone="warning">
                          <AlertTriangle size={12} aria-hidden />
                          {t.grantedNotAdvertised}
                        </Badge>
                      )}
                    </div>
                    {capability === 'egress.residential' && isGranted && (
                      <p className="mt-1 font-mono text-xs text-neutral-500">
                        {t.authorisedAddress}: {machine.grantedEgressEndpoint ?? t.noAddress}
                      </p>
                    )}
                    {capability === 'egress.residential' && egressMismatch && (
                      <p className="mt-1 text-xs text-amber-700" data-testid="egress-mismatch">
                        {t.egressMismatch}
                      </p>
                    )}
                  </div>

                  {isGranted || isKnown ? (
                    <Button
                      variant={isGranted ? 'danger-ghost' : 'primary'}
                      size="sm"
                      loading={busy}
                      disabled={pending !== null}
                      onClick={() => void toggle(capability, isGranted)}
                      data-testid={`capability-toggle-${machine.pairingId}-${capability}`}
                    >
                      {isGranted ? (busy ? t.revoking : t.revoke) : busy ? t.granting : t.grant}
                    </Button>
                  ) : (
                    // Advertised, but this server has no such capability - a machine on a newer
                    // daemon. Shown rather than hidden (the fleet listing must not lie about what
                    // the machine claims) and not grantable, which is the fail-closed direction.
                    <span className="shrink-0 text-xs text-neutral-500">{t.notGrantable}</span>
                  )}
                </div>

                {needsEndpoint && isKnown && (
                  <Input
                    wrapperClassName="mt-3 max-w-md"
                    label={t.egressLabel}
                    hint={t.egressHint}
                    placeholder="http://100.64.0.1:1080"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    className="font-mono text-xs"
                    data-testid={`egress-endpoint-${machine.pairingId}`}
                  />
                )}

                {rowFailure && (
                  <p className="mt-2 text-xs text-red-600" role="status" data-testid="capability-failure">
                    {rowFailure.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
