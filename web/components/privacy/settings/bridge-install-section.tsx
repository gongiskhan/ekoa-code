'use client';

import { useEffect, useState } from 'react';
import { Download, ListChecks, Terminal, Check, Copy, MousePointerClick } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { buttonClasses } from '@/components/ui/button';
import {
  PRIVACY_COPY,
  BRIDGE_MAC_URL,
  BRIDGE_WIN_URL,
  BRIDGE_DOWNLOAD_URL,
  BRIDGE_INSTALL_CMD,
} from '@/lib/privacy-claims';

type Os = 'mac' | 'windows';

/**
 * FC-405 install/download (owner directive 2026-07-11: the bridge page must offer a way to
 * download the local bridge and clear instructions to install it, for NON-TECHNICAL users —
 * a double-click, no terminal).
 *
 * Primary path: pick your OS, download a double-click installer (mac `.command` zipped / Windows
 * `.bat`) that installs the bridge, pairs it, and starts it via native dialogs — no typing. The
 * terminal `curl | bash` / tarball route is kept in a collapsible "advanced" section for
 * technical users. Published to a public GCS bucket; honest-download discipline (§12.6): every
 * button is a real link, never a dead one. Sits above the status/pairing card.
 */
export function BridgeInstallSection() {
  const [os, setOs] = useState<Os>('mac');
  const [copied, setCopied] = useState(false);

  // Default the OS tab to the visitor's platform (best-effort; they can switch).
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) setOs('windows');
    else if (ua.includes('mac')) setOs('mac');
  }, []);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(BRIDGE_INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the command stays visible to copy by hand.
    }
  }

  const downloadUrl = os === 'mac' ? BRIDGE_MAC_URL : BRIDGE_WIN_URL;
  const downloadLabel = os === 'mac' ? PRIVACY_COPY.installDownloadForMac : PRIVACY_COPY.installDownloadForWindows;
  const securityNote = os === 'mac' ? PRIVACY_COPY.installMacSecurityNote : PRIVACY_COPY.installWinSecurityNote;
  const steps = [
    PRIVACY_COPY.installSimpleStep1,
    PRIVACY_COPY.installSimpleStep2,
    PRIVACY_COPY.installSimpleStep3,
    PRIVACY_COPY.installSimpleStep4,
  ];

  return (
    <section data-testid="privacy-bridge-install">
      <CardTitle icon={Download}>{PRIVACY_COPY.installSectionTitle}</CardTitle>
      <CardDescription>{PRIVACY_COPY.installSectionDesc}</CardDescription>

      <Card className="mt-3">
        {/* Primary: simple double-click install with an OS selector. */}
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
          <MousePointerClick className="h-4 w-4 text-teal-600" aria-hidden />
          {PRIVACY_COPY.installSimpleTitle}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* OS toggle */}
          <div
            className="inline-flex rounded-lg border border-line p-0.5"
            role="tablist"
            aria-label={PRIVACY_COPY.installOsSelectLabel}
            data-testid="bridge-os-toggle"
          >
            {(['mac', 'windows'] as Os[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={os === k}
                onClick={() => setOs(k)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  os === k ? 'bg-teal-600 text-white' : 'text-neutral-600 hover:bg-neutral-50'
                }`}
                data-testid={`bridge-os-${k}`}
              >
                {k === 'mac' ? PRIVACY_COPY.installOsMac : PRIVACY_COPY.installOsWindows}
              </button>
            ))}
          </div>

          <a
            href={downloadUrl}
            className={buttonClasses('primary', 'md')}
            data-testid={os === 'mac' ? 'bridge-download-mac' : 'bridge-download-win'}
          >
            <Download className="h-4 w-4" aria-hidden />
            {downloadLabel}
          </a>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-neutral-500" data-testid="bridge-security-note">
          {securityNote}
        </p>

        {/* The four-step simple flow. */}
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
            <ListChecks className="h-4 w-4 text-teal-600" aria-hidden />
            {PRIVACY_COPY.installStepsTitle}
          </div>
          <ol className="mt-3 space-y-2.5" data-testid="bridge-install-steps">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-semibold text-teal-700">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-neutral-600">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">{PRIVACY_COPY.installNodeNote}</p>
        </div>

        {/* Advanced: terminal install for technical users. */}
        <details className="mt-4 border-t border-line pt-3" data-testid="bridge-advanced">
          <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-700">
            {PRIVACY_COPY.installAdvancedTitle}
          </summary>
          <div className="mt-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
              <Terminal className="h-4 w-4 text-teal-600" aria-hidden />
              {PRIVACY_COPY.installCommandLabel}
            </div>
            <div className="mt-2 flex items-stretch gap-2" data-testid="bridge-install-command">
              <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800">
                {BRIDGE_INSTALL_CMD}
              </code>
              <button
                type="button"
                onClick={copyCommand}
                className={`${buttonClasses('secondary', 'sm')} shrink-0`}
                data-testid="bridge-install-copy"
                aria-label={PRIVACY_COPY.installCopyLabel}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-teal-600" aria-hidden />
                    {PRIVACY_COPY.installCopiedLabel}
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    {PRIVACY_COPY.installCopyLabel}
                  </>
                )}
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">{PRIVACY_COPY.installCommandHint}</p>
            <a
              href={BRIDGE_DOWNLOAD_URL}
              className={`${buttonClasses('secondary', 'sm')} mt-3`}
              data-testid="bridge-download"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {PRIVACY_COPY.installDownloadButton}
            </a>
          </div>
        </details>
      </Card>
    </section>
  );
}
