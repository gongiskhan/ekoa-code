'use client';

import { useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { useSettingsStore } from '@/stores/settings';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { BridgeInstallSection } from '@/components/privacy/settings/bridge-install-section';
import { BridgeStatusSection } from '@/components/privacy/settings/bridge-status-section';
import { GrantsSection } from '@/components/privacy/settings/grants-section';
import { LedgerSection } from '@/components/privacy/settings/ledger-section';
import { MaskingSummarySection } from '@/components/privacy/settings/masking-summary-section';
import { ApprovedCommandsSection } from '@/components/privacy/settings/approved-commands-section';
import { GroundedSections } from '@/components/privacy/settings/grounded-sections';
import { LegalOnboardingCard } from '@/components/privacy/legal-onboarding-card';

/**
 * FC-404 settings surface "Privacidade e ponte local" (RESOLVED Q-07). The fullest
 * in-app real estate for the privacy story: it absorbs the old orphan
 * `/settings/bridge` approved-commands UI (FC-409) and hosts bridge status/pairing
 * (FC-405), active grants (FC-406), the daemon-served ledger viewer (FC-407), the
 * masking summary (FC-408), and the grounded, ship-gated legal sections (FC-410).
 * Also the "reachable again" home of the legal-org onboarding card (FC-412).
 *
 * Per-user surface: available to every authenticated user, not admin-gated.
 */
export default function PrivacySettingsPage() {
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const isLegal = useSettingsStore((s) => (s.isLoaded ? s.settings.general.vertical === 'legal' : false));

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <PageShell testId="settings-privacy-page">
      <PageHeader
        icon={ShieldCheck}
        title={PRIVACY_COPY.settingsTitle}
        description={PRIVACY_COPY.settingsSubtitle}
      />

      {isLegal && <LegalOnboardingCard variant="reference" />}

      <div className="space-y-8">
        <BridgeInstallSection />
        <BridgeStatusSection />
        <GrantsSection />
        <LedgerSection />
        <MaskingSummarySection />
        <ApprovedCommandsSection />
        <GroundedSections />
      </div>
    </PageShell>
  );
}
