'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Copy, Check, ShieldOff } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { resolveUrl } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { useGatewayKeysStore } from '@/stores/gateway-keys';
import { useTranslation } from '@/stores/i18n';

/**
 * Per-user gateway API keys page (S4b, run 20260717). Self-service mint (the secret is shown
 * EXACTLY ONCE, with the client env config), list (label + tail hint + created/last-used +
 * status), and revoke with an inline confirm. No AdminGate: keys are per-user and bill their
 * owner (the server scopes everything to the caller).
 */
export default function ApiKeysSettingsPage() {
  const t = useTranslation().pages_gatewayKeys;
  const { keys, isLoading, error, mintedKey, fetchKeys, mint, revoke, clearMinted } = useGatewayKeysStore();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const gatewayBase = resolveUrl('/api/v1/llm');

  async function submitMint() {
    if (!label.trim() || busy) return;
    setBusy(true);
    const res = await mint(label.trim());
    setBusy(false);
    if (res.success) setLabel('');
  }

  // The show-once secret is the ONE irreversible moment of the flow: a silent copy failure
  // (http over LAN/Tailscale has no Clipboard API; NotAllowedError on an unfocused document)
  // must be VISIBLE while the secret is still on screen - hence the guarded helper, never a
  // bare navigator.clipboard call (S4b fresh-review finding 1).
  async function copyKey() {
    if (!mintedKey) return;
    const ok = await copyToClipboard(mintedKey.key);
    setCopyState(ok ? 'copied' : 'failed');
    if (ok) setTimeout(() => setCopyState('idle'), 2000);
  }

  async function submitRevoke(id: string) {
    if (revokingId) return; // in-flight guard: never double-fire a revoke
    setConfirmingId(null);
    setRevokingId(id);
    await revoke(id);
    setRevokingId(null);
  }

  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : t.neverUsed);

  return (
    <PageShell testId="settings-api-keys-page">
      <PageHeader icon={KeyRound} title={t.title} description={t.subtitle} />

      <Card className="max-w-2xl">
        <div className="flex items-end gap-2">
          <Input
            label={t.mintLabel}
            placeholder={t.mintPlaceholder}
            value={label}
            maxLength={64}
            onChange={(e) => setLabel(e.target.value)}
            data-testid="gateway-key-label-input"
          />
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || !label.trim()}
            onClick={() => void submitMint()}
            data-testid="gateway-key-mint"
          >
            {busy ? t.minting : t.mintButton}
          </Button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert" data-testid="gateway-key-error">
            {error}
          </p>
        )}
      </Card>

      {mintedKey && (
        <Card className="mt-4 max-w-2xl border-teal-600" role="status" data-testid="gateway-key-show-once">
          <h3 className="text-base font-semibold">{t.showOnceTitle}</h3>
          <p className="mt-1 text-sm text-amber-700" data-testid="gateway-key-show-once-warning">
            {t.showOnceWarning}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-neutral-100 px-3 py-2 font-mono text-sm" data-testid="gateway-key-secret">
              {mintedKey.key}
            </code>
            <Button variant="secondary" icon={copyState === 'copied' ? Check : Copy} onClick={() => void copyKey()} data-testid="gateway-key-copy">
              {copyState === 'copied' ? t.copied : t.copyKey}
            </Button>
          </div>
          {copyState === 'failed' && (
            <p className="mt-2 text-sm text-red-600" role="alert" data-testid="gateway-key-copy-failed">
              {t.copyFailed}
            </p>
          )}
          <h4 className="mt-4 text-sm font-semibold">{t.configTitle}</h4>
          <p className="mt-1 text-sm text-neutral-600">{t.configHint}</p>
          <pre className="mt-2 overflow-x-auto rounded bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100" data-testid="gateway-key-config">
            {`ANTHROPIC_BASE_URL=${gatewayBase}\nANTHROPIC_AUTH_TOKEN=${mintedKey.key}`}
          </pre>
          <div className="mt-4">
            <Button variant="secondary" onClick={clearMinted} data-testid="gateway-key-dismiss">
              {t.dismiss}
            </Button>
          </div>
        </Card>
      )}

      <Card className="mt-4 max-w-2xl" data-testid="gateway-key-list">
        <h3 className="text-base font-semibold">{t.listTitle}</h3>
        {isLoading && keys.length === 0 ? null : keys.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600" data-testid="gateway-key-empty">
            {t.listEmpty}
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-3 font-medium">{t.colLabel}</th>
                <th className="py-1 pr-3 font-medium">{t.colKey}</th>
                <th className="py-1 pr-3 font-medium">{t.colCreated}</th>
                <th className="py-1 pr-3 font-medium">{t.colLastUsed}</th>
                <th className="py-1 pr-3 font-medium">{t.colStatus}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-neutral-200" data-testid={`gateway-key-row-${k.id}`}>
                  <td className="py-2 pr-3">{k.label}</td>
                  <td className="py-2 pr-3 font-mono text-xs">ekoa_gk_...{k.secretHint}</td>
                  <td className="py-2 pr-3">{fmt(k.createdAt)}</td>
                  <td className="py-2 pr-3">{fmt(k.lastUsedAt)}</td>
                  <td className="py-2 pr-3">
                    {k.revokedAt ? (
                      <span className="text-red-600" data-testid="gateway-key-status-revoked">{t.statusRevoked}</span>
                    ) : (
                      <span className="text-teal-700" data-testid="gateway-key-status-active">{t.statusActive}</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!k.revokedAt &&
                      (confirmingId === k.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-neutral-600">{t.revokeConfirm}</span>
                          <Button
                            variant="danger-ghost"
                            icon={ShieldOff}
                            loading={revokingId === k.id}
                            disabled={revokingId !== null}
                            onClick={() => void submitRevoke(k.id)}
                            data-testid="gateway-key-revoke-confirm"
                          >
                            {t.revoke}
                          </Button>
                          <Button variant="secondary" onClick={() => setConfirmingId(null)} data-testid="gateway-key-revoke-cancel">
                            {t.cancel}
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="danger-ghost"
                          icon={ShieldOff}
                          disabled={revokingId !== null}
                          onClick={() => setConfirmingId(k.id)}
                          data-testid="gateway-key-revoke"
                        >
                          {t.revoke}
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageShell>
  );
}
