import { redirect } from 'next/navigation';

/**
 * FC-404 (RESOLVED Q-07): the old orphan `/settings/bridge` page is absorbed into
 * the new "Privacidade e ponte local" surface - its approved-commands UI is unified
 * there with bridge status, grants, and the ledger. The route is retained and
 * re-homed: it redirects so any existing link keeps working.
 */
export default function BridgeSettingsRedirect() {
  redirect('/settings/privacy');
}
