'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, LockOpen, ShieldCheck, Loader2, KeyRound, Check } from 'lucide-react';
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

/**
 * THE OTHER END OF A RUN'S `needs_credentials` DEEP LINK.
 *
 * A run that walked into a sign-in wall on a site nobody declared halts and sends the person here
 * with `?origin=<host>` (`portalDeepLink`, api/src/automation/credential-gate.ts). Without this card
 * they would arrive at a list of credentials none of which is the one they were sent to create, and
 * the halted run would sit there with no way for anyone to answer it.
 *
 * IT OPENS A WINDOW ON THEIR OWN MACHINE, not here. The session has to be established from the
 * vantage point it will be replayed from, and the Ponte Ekoa is what has one - so this button only
 * ever ASKS, and the outcome shows up as the run continuing, minutes later, on its own page.
 */
function EstablishSessionCard({ origin }: { origin: string }) {
  const { establishSession, captureSession } = useCofreStore();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ started: boolean; message: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [capture, setCapture] = useState<{ requested: boolean; captured: boolean; message: string } | null>(null);
  /** The Done button exists only once a window has actually been opened FROM HERE. Offering it
   *  before that would ask someone to finish something that was never started, and the server would
   *  have to answer with a refusal that reads like a fault. */
  const windowOpen = outcome?.started === true;

  async function doEstablish() {
    setBusy(true);
    setCapture(null);
    setOutcome(await establishSession(origin));
    setBusy(false);
  }

  async function doCapture() {
    setCapturing(true);
    setCapture(null);
    setCapture(await captureSession(origin));
    setCapturing(false);
  }

  return (
    <Card className="border-primary/40 p-4" data-testid="cofre-establish-session">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2 shrink-0">
          <KeyRound className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="text-sm font-semibold">Iniciar sessão em {origin}</h2>
            <p className="text-sm text-muted-foreground">
              Uma execução parou porque este site pediu autenticação. Abrimos uma janela na sua máquina para
              iniciar sessão; a sessão fica cifrada no cofre e a execução continua sozinha.
            </p>
          </div>
          {/*
            Said BEFORE they go, not diagnosed after they come back. Google refuses OAuth from the
            browser this ceremony runs in (findings: `google-sso-refuses-the-automated-ceremony-browser`),
            and on most sites the button people reach for first is the one that cannot work.
          */}
          <p className="text-sm text-muted-foreground">
            Se o site oferecer início de sessão com a Google, use o email ou o telemóvel - a Google bloqueia
            navegadores automatizados.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={doEstablish} disabled={busy || capturing}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
              Abrir janela de autenticação
            </Button>
            {/*
              THE CAPTURE SIGNAL, MOVED OFF THE WINDOW (D-CEREMONY-DONE). It used to be the window
              CLOSING, and that is unusable for the flow this rail exists for: the headed browser is
              raised by the OS on every navigation, so a person reading an OTP out of another app
              fights it for focus, and nothing on screen said that closing is what captures. Live,
              the operator logged in and the ceremony expired having captured nothing.
            */}
            {windowOpen ? (
              <Button size="sm" variant="primary" onClick={doCapture} disabled={capturing} data-testid="cofre-capture-now">
                {capturing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Concluir e capturar
              </Button>
            ) : null}
            {/*
              The server states the FACT ("a window opened", or the refusal); the hint under this row
              states what to DO with it. Split that way on purpose - said in both places, it is the
              card explaining itself twice, and the half that matters (you do not have to close the
              window) is the half a reader skips.
            */}
            {outcome && !capture && !capturing ? (
              <span
                className={`text-xs ${outcome.started ? 'text-muted-foreground' : 'text-destructive'}`}
                data-testid="cofre-establish-outcome"
              >
                {outcome.message}
              </span>
            ) : null}
            {capturing ? (
              <span className="text-xs text-muted-foreground" data-testid="cofre-capture-progress">
                A capturar a sessão...
              </span>
            ) : null}
            {capture && !capturing ? (
              <span
                className={`text-xs ${capture.captured ? 'text-muted-foreground' : 'text-destructive'}`}
                data-testid="cofre-capture-outcome"
              >
                {captureMessage(capture)}
              </span>
            ) : null}
          </div>
          {windowOpen ? (
            <p className="text-sm text-muted-foreground" data-testid="cofre-capture-hint">
              Inicie sessão na janela, depois clique aqui - não precisa de fechar a janela.
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * What the person is told after pressing Done, and each branch says only what is known.
 *
 * "Ainda não recebemos" is NOT reported as a failure, because it is not one: the window is still
 * open and the login may simply not be finished. Saying "failed" here would send someone to start
 * over on a ceremony that is alive.
 *
 * IT NAMES CLOSING THE WINDOW, which is the review round's correction (2026-08-25, F2). The rest of
 * this card exists to say that closing is no longer necessary - true of the happy path, and the
 * whole point of the feature - but this branch is reached exactly when the Done signal did NOT
 * produce a session, and in every remaining cause of that (a Ponte too old to understand the frame,
 * a login that is not finished, a daemon holding a ceremony this request could not reach) closing is
 * the one route that still captures. Copy that only ever said "try again" would leave the person
 * pressing a button in the single state where pressing it may never work.
 */
function captureMessage(capture: { requested: boolean; captured: boolean; message: string }): string {
  if (!capture.requested) return capture.message;
  return capture.captured
    ? 'Sessão capturada e guardada no cofre. A execução continua sozinha.'
    : 'Ainda não recebemos a sessão. Confirme que a autenticação ficou concluída na janela e tente novamente - ou feche a janela, que também captura.';
}

export default function CofrePage() {
  const { items, isLoading, error, fetchItems, lockAll } = useCofreStore();
  const confirm = useConfirm();
  const [lockingAll, setLockingAll] = useState(false);
  /**
   * Read from `window.location` in an effect rather than through `useSearchParams`, which is the
   * convention this dashboard already follows (`integrations/page.tsx`): the hook forces a Suspense
   * boundary on the route, and one query parameter is not worth restructuring the page for.
   */
  const [halterOrigin, setHalterOrigin] = useState<string | null>(null);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('origin')?.trim() ?? '';
    // A HOST AND NOTHING ELSE. The parameter arrives from a link, so it is caller-supplied text that
    // gets rendered and then sent back as the ceremony's target: anything that is not a plain
    // hostname is dropped rather than cleaned up, because a "cleaned up" hostname is a guess about
    // where someone should type their password.
    setHalterOrigin(/^[a-z0-9.-]{1,253}$/i.test(raw) && raw.includes('.') ? raw.toLowerCase() : null);
  }, []);

  const anyUnlocked = items.some((i) => i.state !== 'locked');

  async function doLockAll() {
    const ok = await confirm({
      title: 'Bloquear tudo?',
      description: 'Todas as credenciais desbloqueadas voltam a ficar bloqueadas. As execuções em curso que dependam delas vão falhar.',
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
      {halterOrigin ? <EstablishSessionCard origin={halterOrigin} /> : null}
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
