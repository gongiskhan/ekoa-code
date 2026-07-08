'use client';

/**
 * WebhooksSection — the "Webhooks" block at the bottom of the integrations
 * page. Lists the workspace's `ekoa.triggers` webhook rows and lets the owner
 * create/delete them. A webhook binds an integration event (WhatsApp / Stripe /
 * Ifthenpay, …) to an artifact backend handler; the row surfaces the callback
 * URL `<cortex-origin>/hooks/<triggerId>` that goes into the provider backoffice.
 *
 * PT-PT formal, no emoji. Uses the shared dashboard primitives.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Webhook, Plus, Trash2, Copy, Check } from 'lucide-react';
import { useWebhooksStore } from '@/stores/webhooks';
import { useIntegrationsStore, type IntegrationSkillScoped } from '@/stores/integrations';
import { useTranslation } from '@/stores/i18n';
import { api, tryCall } from '@/lib/api';
import { Button, IconButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/stores/toast';

const INPUT_CLASS =
  'w-full bg-neutral-50 border border-neutral-200 rounded-md py-2 px-2.5 text-sm text-neutral-800 placeholder-neutral-400 focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-1 focus-visible:ring-teal-500/20 transition-colors';

interface ArtifactOption {
  id: string;
  name: string;
}

function CopyUrlButton({ url, label, copiedLabel }: { url: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(copiedLabel);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Não foi possível copiar');
    }
  }
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={label}
      size="sm"
      variant="ghost"
      onClick={handleCopy}
      data-testid="webhook-copy"
    />
  );
}

export function WebhooksSection() {
  const { pages, common } = useTranslation();
  const t = pages.webhooks;
  const confirm = useConfirm();

  const triggers = useWebhooksStore((s) => s.triggers);
  const fetchTriggers = useWebhooksStore((s) => s.fetchTriggers);
  const createTrigger = useWebhooksStore((s) => s.createTrigger);
  const deleteTrigger = useWebhooksStore((s) => s.deleteTrigger);
  const isSaving = useWebhooksStore((s) => s.isSaving);

  const skills = useIntegrationsStore((s) => s.skills);

  const [artifacts, setArtifacts] = useState<ArtifactOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Integrations that can publish webhook events (declare webhookConfig).
  const webhookSkills = useMemo(
    () => skills.filter((s) => s.webhookConfig),
    [skills],
  );

  const skillByKey = useCallback(
    (key: string): IntegrationSkillScoped | undefined => skills.find((s) => s.integrationKey === key),
    [skills],
  );
  const artifactById = useCallback(
    (id?: string) => (id ? artifacts.find((a) => a.id === id) : undefined),
    [artifacts],
  );

  useEffect(() => {
    fetchTriggers();
  }, [fetchTriggers]);

  // Artifacts drive the target picker. Own + featured instances can overlap, so
  // de-dup by id and keep a light {id,name}. Guarded against unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await tryCall(() => api.artifacts.list());
      if (cancelled || !res.ok) return;
      const merged = [...res.data.items, ...res.data.featured];
      const seen = new Set<string>();
      const opts: ArtifactOption[] = [];
      for (const a of merged) {
        if (!a?.id || seen.has(a.id)) continue;
        seen.add(a.id);
        opts.push({ id: a.id, name: a.name || a.id });
      }
      setArtifacts(opts);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t.deleteWebhook,
      description: t.deleteConfirm,
      confirmLabel: common.delete,
      tone: 'danger',
    });
    if (!ok) return;
    const res = await deleteTrigger(id);
    if (res.success) toast.success(t.deleted);
    else toast.error(res.error || t.createFailed);
  }

  return (
    <section data-testid="webhooks-section">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-2">
            <Webhook size={15} className="text-neutral-500" aria-hidden />
            {t.title}
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">{t.subtitle}</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => setDialogOpen(true)}
          data-testid="webhook-create-btn"
        >
          {t.create}
        </Button>
      </div>

      {triggers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200">
          <EmptyState icon={Webhook} title={t.empty} />
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-200 overflow-hidden">
          {/* Header row (hidden on mobile) */}
          <div className="hidden md:grid grid-cols-[1.2fr_1.2fr_1.6fr_2.4fr_auto] gap-3 px-4 py-2 bg-neutral-50 border-b border-neutral-100 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            <span>{t.colIntegration}</span>
            <span>{t.colEvent}</span>
            <span>{t.colTarget}</span>
            <span>{t.colUrl}</span>
            <span className="text-right">{t.colStatus}</span>
          </div>
          <ul className="divide-y divide-neutral-100">
            {triggers.map((trigger) => {
              const skill = skillByKey(trigger.integrationKey);
              const eventLabel =
                skill?.webhookConfig?.events?.find((e) => e.name === trigger.eventName)?.labelPt ??
                trigger.eventName;
              const artifact = artifactById(trigger.target?.artifactId ?? trigger.artifactId);
              // FC-055: GET /triggers now returns the authoritative server publicUrl;
              // no client-side hook-URL reconstruction.
              const url = (trigger as { publicUrl?: string }).publicUrl ?? '';
              const enabled = !trigger.disabled;
              return (
                <li
                  key={trigger.id}
                  data-testid="webhook-row"
                  className="grid grid-cols-1 md:grid-cols-[1.2fr_1.2fr_1.6fr_2.4fr_auto] gap-2 md:gap-3 px-4 py-3 items-center"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-neutral-800 truncate block">
                      {skill?.displayName ?? trigger.integrationKey}
                    </span>
                    <span className="md:hidden text-[11px] text-neutral-400">{eventLabel}</span>
                  </div>
                  <span className="hidden md:block text-xs text-neutral-600 truncate">{eventLabel}</span>
                  <div className="min-w-0 text-xs text-neutral-600">
                    <span className="truncate block">{artifact?.name ?? trigger.target?.artifactId ?? '—'}</span>
                    {trigger.target?.entrypoint && (
                      <span className="font-mono text-[11px] text-neutral-400 truncate block">
                        {trigger.target.entrypoint}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <code
                      data-testid="webhook-url"
                      className="flex-1 min-w-0 truncate rounded bg-neutral-50 border border-neutral-100 px-2 py-1 font-mono text-[11px] text-neutral-600"
                      title={url}
                    >
                      {url}
                    </code>
                    <CopyUrlButton url={url} label={t.copyUrl} copiedLabel={t.copied} />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Badge tone={enabled ? 'success' : 'neutral'} dot>
                      {enabled ? t.statusEnabled : t.statusDisabled}
                    </Badge>
                    <IconButton
                      icon={Trash2}
                      label={t.deleteWebhook}
                      size="sm"
                      variant="danger-ghost"
                      onClick={() => handleDelete(trigger.id)}
                      data-testid="webhook-delete"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dialogOpen && (
        <WebhookCreateDialog
          webhookSkills={webhookSkills}
          artifacts={artifacts}
          isSaving={isSaving}
          onClose={() => setDialogOpen(false)}
          onCreate={async (input) => {
            const res = await createTrigger(input);
            if (res.success) {
              toast.success(t.created);
              setDialogOpen(false);
            } else {
              toast.error(res.error || t.createFailed);
            }
          }}
        />
      )}
    </section>
  );
}

/* ---------- Create dialog ---------- */

function WebhookCreateDialog({
  webhookSkills,
  artifacts,
  isSaving,
  onClose,
  onCreate,
}: {
  webhookSkills: IntegrationSkillScoped[];
  artifacts: ArtifactOption[];
  isSaving: boolean;
  onClose: () => void;
  onCreate: (input: {
    integrationKey: string;
    eventName: string;
    artifactId: string;
    entrypoint: string;
  }) => Promise<void>;
}) {
  const { pages, common } = useTranslation();
  const t = pages.webhooks;

  const [integrationKey, setIntegrationKey] = useState('');
  const [eventName, setEventName] = useState('');
  const [artifactId, setArtifactId] = useState('');
  const [entrypoint, setEntrypoint] = useState('onMessage');

  const selectedSkill = webhookSkills.find((s) => s.integrationKey === integrationKey);
  const events = selectedSkill?.webhookConfig?.events ?? [];

  function handleIntegrationChange(key: string) {
    setIntegrationKey(key);
    const skill = webhookSkills.find((s) => s.integrationKey === key);
    const firstEvent = skill?.webhookConfig?.events?.[0]?.name ?? '';
    setEventName(firstEvent);
  }

  const canSubmit =
    integrationKey.trim() !== '' &&
    eventName.trim() !== '' &&
    artifactId.trim() !== '' &&
    entrypoint.trim() !== '' &&
    !isSaving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await onCreate({ integrationKey, eventName: eventName.trim(), artifactId, entrypoint: entrypoint.trim() });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t.dialogTitle}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={isSaving}
            onClick={handleSubmit}
            data-testid="webhook-submit"
          >
            {t.submit}
          </Button>
        </div>
      }
    >
      {webhookSkills.length === 0 ? (
        <p className="text-sm text-neutral-500" data-testid="webhook-no-integrations">
          {t.noWebhookIntegrations}
        </p>
      ) : artifacts.length === 0 ? (
        <p className="text-sm text-neutral-500" data-testid="webhook-no-artifacts">
          {t.noArtifacts}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="wh-integration" className="block text-xs font-medium text-neutral-600 mb-1">
              {t.fieldIntegration}
            </label>
            <select
              id="wh-integration"
              data-testid="webhook-integration-select"
              className={`${INPUT_CLASS} appearance-none cursor-pointer`}
              value={integrationKey}
              onChange={(e) => handleIntegrationChange(e.target.value)}
              required
            >
              <option value="" disabled>
                {t.selectIntegration}
              </option>
              {webhookSkills.map((s) => (
                <option key={s.integrationKey} value={s.integrationKey}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="wh-event" className="block text-xs font-medium text-neutral-600 mb-1">
              {t.fieldEvent}
            </label>
            {events.length > 0 ? (
              <select
                id="wh-event"
                data-testid="webhook-event-select"
                className={`${INPUT_CLASS} appearance-none cursor-pointer`}
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                required
                disabled={!integrationKey}
              >
                <option value="" disabled>
                  {t.selectEvent}
                </option>
                {events.map((ev) => (
                  <option key={ev.name} value={ev.name}>
                    {ev.labelPt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="wh-event"
                data-testid="webhook-event-input"
                className={INPUT_CLASS}
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="event.name"
                required
                disabled={!integrationKey}
              />
            )}
          </div>

          <div>
            <label htmlFor="wh-artifact" className="block text-xs font-medium text-neutral-600 mb-1">
              {t.fieldArtifact}
            </label>
            <select
              id="wh-artifact"
              data-testid="webhook-artifact-select"
              className={`${INPUT_CLASS} appearance-none cursor-pointer`}
              value={artifactId}
              onChange={(e) => setArtifactId(e.target.value)}
              required
            >
              <option value="" disabled>
                {t.selectArtifact}
              </option>
              {artifacts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="wh-entrypoint" className="block text-xs font-medium text-neutral-600 mb-1">
              {t.fieldEntrypoint}
            </label>
            <input
              id="wh-entrypoint"
              data-testid="webhook-entrypoint-input"
              className={`${INPUT_CLASS} font-mono`}
              value={entrypoint}
              onChange={(e) => setEntrypoint(e.target.value)}
              placeholder="onMessage"
              required
            />
            <p className="text-[11px] text-neutral-400 mt-1">{t.entrypointHint}</p>
          </div>
        </form>
      )}
    </Dialog>
  );
}
