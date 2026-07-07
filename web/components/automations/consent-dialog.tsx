"use client";

import { useState } from 'react';
import { useTranslation } from '@/stores/i18n';

interface ConsentDialogProps {
  shape: string;
  argv: string[];
  description: string;
  onDecision: (decision: 'once' | 'always' | 'stop') => void;
}

/**
 * First-time consent dialog for local_command shapes. Plain English at
 * the top; the "what exactly will run?" toggle shows the raw argv for
 * users who want to verify before approving.
 */
export default function ConsentDialog({ shape, argv, description, onDecision }: ConsentDialogProps) {
  const [showArgv, setShowArgv] = useState(false);
  const { automations } = useTranslation();
  const t = automations.consent;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold text-neutral-900">{t.title}</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t.subtitle}
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-neutral-800">
            {t.wantsPrefix}<strong>{description}</strong>{t.wantsSuffix}
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded px-3 py-2 font-mono text-xs text-neutral-700">
            {shape}
          </div>

          <button
            type="button"
            onClick={() => setShowArgv((v) => !v)}
            className="text-xs text-neutral-500 hover:text-neutral-700 underline-offset-2 hover:underline"
          >
            {t.toggleArgv(showArgv)}
          </button>

          {showArgv && (
            <pre className="bg-neutral-900 text-neutral-100 rounded p-3 text-xs overflow-x-auto">
              {argv.map((a) => JSON.stringify(a)).join(' ')}
            </pre>
          )}

          <p className="text-xs text-neutral-500">
            {t.revokablePrefix}<code className="text-neutral-700">{t.revokableLocation}</code>.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-neutral-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={() => onDecision('stop')}
            className="text-sm px-3 py-1.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
          >
            {t.stop}
          </button>
          <button
            type="button"
            onClick={() => onDecision('once')}
            className="text-sm px-3 py-1.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
          >
            {t.approveOnce}
          </button>
          <button
            type="button"
            onClick={() => onDecision('always')}
            className="text-sm px-3 py-1.5 rounded bg-orange-600 text-white hover:bg-orange-700"
          >
            {t.approveAlways}
          </button>
        </div>
      </div>
    </div>
  );
}
