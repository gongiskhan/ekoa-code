"use client";

import { useState } from 'react';
import { useTranslation } from '@/stores/i18n';

export interface ActionConsentSubject {
  integrationKey: string;
  integrationName: string;
  actionName: string;
  description: string;
  /** What will actually run, e.g. `POST https://slack.com/api/chat.postMessage`. */
  target: string;
  /** Fingerprint of the exact action being approved; echoed back so the server can refuse a
   *  version of the action the human never saw. */
  shape: string;
}

interface Props {
  subject: ActionConsentSubject;
  /** 90 — surfaced so the standing consequence is stated in the dialog, not only in a doc. */
  standingDays: number;
  onDecision: (decision: 'once' | 'always') => Promise<void> | void;
  onCancel: () => void;
  error?: string | null;
}

/**
 * The WRITE-GATE consent dialog (slice C2).
 *
 * A confirm dialog that does not say what it is confirming is not consent, so the three facts a
 * human needs to answer are stated as a labelled list rather than folded into a sentence: WHICH
 * integration, WHICH action (with its own description), and WHERE it will write. `target` is the
 * server's rendering of the action's real destination — the same string the executor's refusal
 * carries — so what is shown here and what is authorised cannot drift apart.
 *
 * The two answers are deliberately asymmetric in weight, and the consequence of each is printed
 * ABOVE the buttons rather than discoverable afterwards: "once" is consumed by the next run,
 * "always" is a standing permission with an expiry and a revoke.
 *
 * Sibling of `components/automations/consent-dialog.tsx` (the local_command first-run prompt).
 * Same modal shape and the same three-button footer grammar; a separate component because the
 * SUBJECT is different — a command shape and its argv there, an integration action and its
 * destination here — and merging them would mean a props union where half the fields are dead in
 * either mode.
 */
export default function ActionConsentDialog({ subject, standingDays, onDecision, onCancel, error }: Props) {
  const [busy, setBusy] = useState<'once' | 'always' | null>(null);
  const { pages } = useTranslation();
  const t = pages.integrations.writeGate;

  const decide = async (decision: 'once' | 'always') => {
    setBusy(decision);
    try {
      await onDecision(decision);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      data-testid="action-consent-dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold text-neutral-900">{t.title}</h2>
          <p className="text-xs text-neutral-500 mt-0.5">{t.subtitle}</p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 flex-shrink-0 text-xs uppercase tracking-wider text-neutral-400 pt-0.5">
                {t.integrationLabel}
              </dt>
              <dd className="min-w-0 flex-1 text-neutral-800" data-testid="action-consent-integration">
                {subject.integrationName}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 flex-shrink-0 text-xs uppercase tracking-wider text-neutral-400 pt-0.5">
                {t.actionLabel}
              </dt>
              <dd className="min-w-0 flex-1" data-testid="action-consent-action">
                <span className="font-mono text-xs text-neutral-800">{subject.actionName}</span>
                {subject.description && (
                  <span className="block text-xs text-neutral-500">{subject.description}</span>
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 flex-shrink-0 text-xs uppercase tracking-wider text-neutral-400 pt-0.5">
                {t.targetLabel}
              </dt>
              <dd className="min-w-0 flex-1">
                <code
                  className="block break-all rounded border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-xs text-amber-900"
                  data-testid="action-consent-target"
                >
                  {subject.target}
                </code>
              </dd>
            </div>
          </dl>

          <p className="text-xs text-neutral-500">{t.standingNote(standingDays)}</p>
          <p className="text-xs text-neutral-500">{t.onceNote}</p>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1" data-testid="action-consent-error">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            data-testid="action-consent-cancel"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => void decide('once')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            data-testid="action-consent-once"
          >
            {t.approveOnce}
          </button>
          <button
            type="button"
            onClick={() => void decide('always')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            data-testid="action-consent-always"
          >
            {t.approveAlways}
          </button>
        </div>
      </div>
    </div>
  );
}
