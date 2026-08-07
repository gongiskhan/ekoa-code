'use client';

import { useEffect, useState } from 'react';
import { Download, ListChecks, Terminal, Check, Copy, Info } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { buttonClasses } from '@/components/ui/button';
import {
  PRIVACY_COPY,
  BRIDGE_DOWNLOAD_URL,
  bridgeInstallCommand,
  bridgeCortexUrl,
  type BridgeOs,
} from '@/lib/privacy-claims';

/**
 * FC-405 install section.
 *
 * WHY THIS IS A COMMAND AND NOT A DOWNLOAD BUTTON. This section used to lead with double-click
 * installers (a zipped `.command` for macOS, a `.bat` for Windows) precisely so a non-technical
 * user would never see a terminal — and that is the user it failed. A `.command` downloaded by a
 * browser carries `com.apple.quarantine`; macOS refuses to run it and its dialog offers no "open
 * anyway", so the user has to visit Definições → Privacidade e Segurança and authorise a blocked
 * item. Pasting one line is shorter, and unlike the quarantine journey it can be explained over the
 * phone. Notarisation would fix the download path properly and was declined, so the download path
 * is gone rather than left as a trap.
 *
 * WHY THERE IS NO "OPEN TERMINAL" BUTTON. A web page cannot launch a local application: the only
 * mechanism a browser offers is a registered URL scheme, and neither macOS, Windows nor Linux
 * registers one for their terminal by default. Anything that looked like such a button would either
 * do nothing or (via `ssh://`, which macOS does route to Terminal.app) open a window already running
 * the wrong program. So the button here is labelled for what it actually does — show you how — and
 * it copies the command at the same time, which is the part that genuinely saves work.
 */
export function BridgeInstallSection() {
  const [os, setOs] = useState<BridgeOs>('mac');
  const [copied, setCopied] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  // The command is built on the client so the same-origin fallback in `bridgeCortexUrl()` can see
  // `window.location`. Rendering it during SSR would bake in the empty-string branch and ship a
  // command with no address in it.
  const [command, setCommand] = useState('');

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const detected: BridgeOs = ua.includes('win') ? 'windows' : ua.includes('mac') ? 'mac' : 'linux';
    setOs(detected);
  }, []);

  useEffect(() => {
    setCommand(bridgeInstallCommand(os, bridgeCortexUrl()));
  }, [os]);

  async function copyCommand(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      // Clipboard blocked (insecure origin, or permission denied): the command stays on screen to
      // copy by hand, which is why it is rendered as selectable text and not only as a button.
      return false;
    }
  }

  const howTo =
    os === 'mac' ? PRIVACY_COPY.installHowToMac : os === 'windows' ? PRIVACY_COPY.installHowToWindows : PRIVACY_COPY.installHowToLinux;

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
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
          <Terminal className="h-4 w-4 text-teal-600" aria-hidden />
          {PRIVACY_COPY.installSimpleTitle}
        </div>

        {/* OS toggle — three now: Linux was silently unsupported before, though the script always
            ran there. */}
        <div
          className="mt-3 inline-flex rounded-lg border border-line p-0.5"
          role="tablist"
          aria-label={PRIVACY_COPY.installOsSelectLabel}
          data-testid="bridge-os-toggle"
        >
          {(['mac', 'windows', 'linux'] as BridgeOs[]).map((k) => (
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
              {k === 'mac'
                ? PRIVACY_COPY.installOsMac
                : k === 'windows'
                  ? PRIVACY_COPY.installOsWindows
                  : PRIVACY_COPY.installOsLinux}
            </button>
          ))}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-neutral-600">{PRIVACY_COPY.installCommandIntro}</p>

        <div className="mt-3 flex items-stretch gap-2" data-testid="bridge-install-command">
          <code
            className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800"
            data-testid="bridge-install-command-text"
          >
            {command || ' '}
          </code>
          <button
            type="button"
            onClick={() => void copyCommand()}
            className={`${buttonClasses('primary', 'sm')} shrink-0`}
            data-testid="bridge-install-copy"
            aria-label={PRIVACY_COPY.installCopyLabel}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden />
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

        {/* Copies first, then reveals the keystrokes — so by the time the user reaches the terminal
            the command is already on the clipboard. */}
        <button
          type="button"
          onClick={() => {
            void copyCommand();
            setShowHowTo((v) => !v);
          }}
          className={`${buttonClasses('secondary', 'sm')} mt-2`}
          data-testid="bridge-open-terminal"
          aria-expanded={showHowTo}
        >
          <Terminal className="h-3.5 w-3.5" aria-hidden />
          {PRIVACY_COPY.installOpenTerminal}
        </button>

        {showHowTo && (
          <div
            className="mt-2 rounded-lg border border-line bg-neutral-50 px-3 py-2.5"
            data-testid="bridge-terminal-howto"
            role="status"
          >
            <p className="text-sm leading-relaxed text-neutral-700">{howTo}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">{PRIVACY_COPY.installPasteHint}</p>
          </div>
        )}

        <div className="mt-4 flex gap-2 rounded-lg border border-line bg-neutral-50 px-3 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
          <p className="text-xs leading-relaxed text-neutral-500" data-testid="bridge-why-command">
            {PRIVACY_COPY.installWhyCommand}
          </p>
        </div>

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

        <details className="mt-4 border-t border-line pt-3" data-testid="bridge-advanced">
          <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-700">
            {PRIVACY_COPY.installAdvancedTitle}
          </summary>
          <div className="mt-3">
            <p className="text-xs leading-relaxed text-neutral-500">{PRIVACY_COPY.installDownloadManualHint}</p>
            <a href={BRIDGE_DOWNLOAD_URL} className={`${buttonClasses('secondary', 'sm')} mt-3`} data-testid="bridge-download">
              <Download className="h-3.5 w-3.5" aria-hidden />
              {PRIVACY_COPY.installDownloadButton}
            </a>
          </div>
        </details>
      </Card>
    </section>
  );
}
