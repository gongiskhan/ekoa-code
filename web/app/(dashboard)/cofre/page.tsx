'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, LockOpen, ShieldCheck, Loader2 } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useCofreStore, UNLOCK_DURATIONS, offersDurationControl } from '@/stores/cofre';
import type { CofreItem, GrantDuration } from '@ekoa/shared';

/**
 * O Cofre (WS-D) — the user's credentials, and the state each one is in right now.
 *
 * The four states are visually DISTINCT on purpose: an indefinite unlock ("Desbloqueada até
 * bloquear") must never look like a timed one, because the whole point of the timed option is that
 * the user knows it ends. "Em utilização" is live while an automation holds the item.
 *
 * A signature identity renders NO duration control at all — every signature is a fresh ceremony
 * (I7). That rule is enforced in the shared schema and again in the service, so this is the third
 * layer, not the only one.
 */

/** Human labels for the four item states, plus the visual weight each one carries. */
const STATE_META: Record<CofreItem['state'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'info' }> = {
  locked: { label: 'Bloqueada', tone: 'neutral' },
  unlocked: { label: 'Desbloqueada', tone: 'success' },
  unlocked_until_locked: { label: 'Desbloqueada até bloquear', tone: 'warning' },
  in_use: { label: 'Em utilização', tone: 'info' },
};

const TYPE_LABELS: Record<CofreItem['type'], string> = {
  password: 'Palavra-passe',
  api_key: 'Chave de API',
  oauth_token: 'Token OAuth',
  totp_seed: 'Semente TOTP',
  session: 'Sessão',
  software_certificate: 'Certificado',
  certificate_identity: 'Identidade (cartão)',
};

/** Live countdown to `iso`, or null once it has passed. */
function useCountdown(iso: string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [iso]);
  return useMemo(() => {
    if (!iso) return null;
    const ms = Date.parse(iso) - now;
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  }, [iso, now]);
}

function ItemRow({ item }: { item: CofreItem }) {
  const { unlock, lock } = useCofreStore();
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState<GrantDuration>('40_minutes');
  const countdown = useCountdown(item.state === 'unlocked' ? item.unlockedUntil : undefined);
  const meta = STATE_META[item.state];
  const isLocked = item.state === 'locked';

  async function doUnlock() {
    setBusy(true);
    await unlock(item.id, duration);
    setBusy(false);
  }
  async function doLock() {
    setBusy(true);
    await lock(item.id);
    setBusy(false);
  }

  return (
    <TR>
      <TD>
        <span className="font-medium">{item.label}</span>
        <div className="text-xs text-muted-foreground">{TYPE_LABELS[item.type]}</div>
        {item.identityPointer ? (
          <div className="text-xs text-muted-foreground">{item.identityPointer}</div>
        ) : null}
      </TD>
      <TD>
        <div className="text-xs text-muted-foreground">{item.boundOrigins.join(', ') || '—'}</div>
      </TD>
      <TD>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {countdown ? <div className="text-xs text-muted-foreground">termina em {countdown}</div> : null}
      </TD>
      <TD>
        <span className="text-xs text-muted-foreground">
          {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString('pt-PT') : 'nunca'}
          {item.lastUsedBy ? ` · ${item.lastUsedBy}` : ''}
        </span>
      </TD>
      <TD>
        <div className="flex items-center gap-2">
          {isLocked && offersDurationControl(item) ? (
            <>
              <select
                aria-label={`Duração para ${item.label}`}
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={duration}
                onChange={(e) => setDuration(e.target.value as GrantDuration)}
                disabled={busy}
              >
                {UNLOCK_DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.labelKey}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={doUnlock} disabled={busy}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LockOpen className="h-3 w-3" />}
                Desbloquear
              </Button>
            </>
          ) : null}
          {isLocked && !offersDurationControl(item) ? (
            // I7: no duration control for a signature identity. Stated, not silently omitted.
            <span className="text-xs text-muted-foreground">Cada utilização é uma cerimónia</span>
          ) : null}
          {!isLocked ? (
            <Button size="sm" variant="secondary" onClick={doLock} disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
              Bloquear agora
            </Button>
          ) : null}
        </div>
      </TD>
    </TR>
  );
}

export default function CofrePage() {
  const { items, isLoading, error, fetchItems, lockAll } = useCofreStore();
  const confirm = useConfirm();
  const [lockingAll, setLockingAll] = useState(false);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const anyUnlocked = items.some((i) => i.state !== 'locked');

  async function doLockAll() {
    const ok = await confirm({
      title: 'Bloquear tudo?',
      description: 'Todas as credenciais desbloqueadas voltam a ficar bloqueadas. Automações em curso que dependam delas vão falhar.',
      confirmLabel: 'Bloquear tudo',
    });
    if (!ok) return;
    setLockingAll(true);
    await lockAll();
    setLockingAll(false);
  }

  return (
    <PageShell>
      <PageHeader
        icon={Lock}
        title="Cofre"
        description="As suas credenciais são cifradas com chaves guardadas em hardware dedicado. Nenhum modelo de IA vê as suas palavras-passe. Cada utilização fica registada no seu Registo."
        actions={
          anyUnlocked ? (
            <Button variant="secondary" onClick={doLockAll} disabled={lockingAll}>
              {lockingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Bloquear tudo
            </Button>
          ) : null
        }
      />
      {error ? (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">{error}</Card>
      ) : null}
      <Card className="p-0">
        {isLoading && items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">A carregar…</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Lock}
            title="Ainda não há credenciais no cofre."
            description="Ligue uma integração ou capture uma sessão para começar - as credenciais capturadas aparecem aqui, cifradas."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Credencial</TH>
                <TH>Origens permitidas</TH>
                <TH>Estado</TH>
                <TH>Última utilização</TH>
                <TH>Ações</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </PageShell>
  );
}
