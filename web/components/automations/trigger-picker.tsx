"use client";

/**
 * "Gatilho" card on the Automation detail page. User picks one of:
 *   - Manual (executar quando pedido) — no trigger; default
 *   - Quando algo acontece            — pick an integration event
 *
 * Strict copy contract (PT-PT formal): the strings "webhook", "listener",
 * "processo" must NEVER appear in user-visible text. Only "gatilho" and
 * "Quando … acontecer".
 *
 * The picker lists events from skills that declare `webhookConfig.events`
 * or `listenerConfig.events`. After creating a trigger:
 *   - registrationState === 'auto' → green "Esta automação executa-se automaticamente"
 *   - registrationState === 'manual' | 'failed' → shows URL + secret for copy-paste
 */

import { useEffect, useMemo, useState } from 'react';
import { api, tryCall } from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTranslation } from '@/stores/i18n';
import type { Translations } from '@/locales/types';

interface SkillEventDescriptor {
  name: string;
  labelPt: string;
}

interface IntegrationSkillWithEvents {
  integrationKey: string;
  displayName: string;
  webhookEvents?: SkillEventDescriptor[];
  listenerEvents?: SkillEventDescriptor[];
}

interface TriggerSummary {
  id: string;
  automationId: string;
  artifactId?: string;
  kind: 'webhook' | 'listener';
  integrationKey: string;
  eventName: string;
  registrationState: 'auto' | 'manual' | 'pending' | 'failed';
  createdAt: string;
}

interface TriggerPickerProps {
  automationId: string;
  artifactId?: string;
  initialTrigger?: TriggerSummary | null;
}

export function TriggerPicker({ automationId, artifactId, initialTrigger }: TriggerPickerProps) {
  const [mode, setMode] = useState<'manual' | 'event'>(initialTrigger ? 'event' : 'manual');
  const [skills, setSkills] = useState<IntegrationSkillWithEvents[]>([]);
  const [skillKey, setSkillKey] = useState<string>('');
  const [eventName, setEventName] = useState<string>('');
  const [trigger, setTrigger] = useState<TriggerSummary | null>(initialTrigger ?? null);
  const [manualSetup, setManualSetup] = useState<{ url: string; secret: string } | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const { automations } = useTranslation();
  const t = automations.triggerPicker;

  // Pull the list of integrations with trigger-capable events.
  useEffect(() => {
    void (async () => {
      const r = await tryCall(() => api.integrations.listActive());
      if (!r.ok) return;
      // Shared `ActiveIntegration` keys the integration by `key`; the
      // event descriptors ride as untyped passthrough records.
      const mapped: IntegrationSkillWithEvents[] = r.data.items.map((item) => {
        const it = item as { key: string; integrationKey?: string; displayName?: string; webhookEvents?: unknown; listenerEvents?: unknown };
        return {
          integrationKey: it.integrationKey ?? it.key,
          displayName: it.displayName ?? it.key,
          webhookEvents: it.webhookEvents as SkillEventDescriptor[] | undefined,
          listenerEvents: it.listenerEvents as SkillEventDescriptor[] | undefined,
        };
      });
      const withEvents = mapped.filter(
        (s) => (s.webhookEvents?.length ?? 0) + (s.listenerEvents?.length ?? 0) > 0,
      );
      setSkills(withEvents);
    })();
  }, []);

  const availableEvents = useMemo(() => {
    const skill = skills.find((s) => s.integrationKey === skillKey);
    if (!skill) return [] as SkillEventDescriptor[];
    return [...(skill.webhookEvents ?? []), ...(skill.listenerEvents ?? [])];
  }, [skills, skillKey]);

  async function handleCreate() {
    if (!skillKey || !eventName) return;
    setBusy(true);
    setError(null);
    try {
      const r = await tryCall(() =>
        api.triggers.create({
          automationId,
          integrationKey: skillKey,
          eventName,
          artifactId,
        }),
      );
      if (!r.ok) {
        setError(r.error.message || t.createError);
        return;
      }
      setTrigger(r.data.trigger as unknown as TriggerSummary);
      setRegistrationError(r.data.registrationError ?? null);
      if (r.data.secret) {
        setManualSetup({ url: r.data.publicUrl, secret: r.data.secret });
      } else {
        setManualSetup(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!trigger) return;
    if (!(await confirm({ title: t.removeConfirm, tone: 'danger' }))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await tryCall(() => api.triggers.delete({ id: trigger.id }));
      if (!r.ok) {
        setError(r.error.message || t.removeError);
        return;
      }
      setTrigger(null);
      setManualSetup(null);
      setRegistrationError(null);
      setMode('manual');
      setSkillKey('');
      setEventName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Triggered automation: confirmation card.
  if (trigger) {
    const labelPt = lookupLabel(skills, trigger.integrationKey, trigger.eventName);
    const displayName = skills.find((s) => s.integrationKey === trigger.integrationKey)?.displayName
      ?? trigger.integrationKey;
    return (
      <div className="border border-teal-200 bg-teal-50 rounded-md p-4 space-y-3">
        <h3 className="text-sm font-semibold text-teal-900">{t.title}</h3>
        <div>
          <div className="text-sm text-teal-900 font-medium">
            {t.autoRuns}
          </div>
          <div className="text-sm text-teal-800 mt-1">
            {labelPt} ({displayName})
          </div>
          <div className="text-xs text-teal-700 mt-2">
            {t.statePrefix}{stateLabel(trigger.registrationState, t)}
          </div>
        </div>

        {registrationError && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            {t.registrationWarningPrefix}{registrationError}
          </div>
        )}

        {manualSetup && (
          <ManualSetupBlock url={manualSetup.url} secret={manualSetup.secret} />
        )}

        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          className="text-xs text-teal-900 underline hover:text-teal-700 disabled:opacity-50"
        >
          {busy ? t.removing : t.remove}
        </button>
      </div>
    );
  }

  // No trigger yet — picker.
  return (
    <div className="border border-neutral-200 bg-white rounded-md p-4 space-y-3">
      <h3 className="text-sm font-semibold text-neutral-900">{t.title}</h3>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-neutral-800 cursor-pointer">
          <input
            type="radio"
            name="trigger-mode"
            value="manual"
            checked={mode === 'manual'}
            onChange={() => setMode('manual')}
          />
          {t.manual}
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-800 cursor-pointer">
          <input
            type="radio"
            name="trigger-mode"
            value="event"
            checked={mode === 'event'}
            onChange={() => setMode('event')}
          />
          {t.whenSomething}
        </label>
      </div>

      {mode === 'event' && (
        <div className="space-y-2 pl-6">
          <div>
            <label className="block text-xs text-neutral-600 mb-1">{t.integration}</label>
            <select
              value={skillKey}
              onChange={(e) => { setSkillKey(e.target.value); setEventName(''); }}
              className="w-full text-sm rounded border border-neutral-300 bg-white px-2 py-1.5"
            >
              <option value="">{t.pickIntegration}</option>
              {skills.map((s) => (
                <option key={s.integrationKey} value={s.integrationKey}>{s.displayName}</option>
              ))}
            </select>
          </div>
          {skillKey && (
            <div>
              <label className="block text-xs text-neutral-600 mb-1">{t.whenHappens}</label>
              <select
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className="w-full text-sm rounded border border-neutral-300 bg-white px-2 py-1.5"
              >
                <option value="">{t.pickTrigger}</option>
                {availableEvents.map((ev) => (
                  <option key={ev.name} value={ev.name}>{ev.labelPt}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !skillKey || !eventName}
            className="text-sm rounded bg-teal-600 text-white px-3 py-1.5 disabled:opacity-50 hover:bg-teal-700"
          >
            {busy ? t.creating : t.create}
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}
    </div>
  );
}

function stateLabel(
  state: TriggerSummary['registrationState'],
  t: Translations['automations']['triggerPicker'],
): string {
  return t.state[state];
}

function lookupLabel(
  skills: IntegrationSkillWithEvents[],
  integrationKey: string,
  eventName: string,
): string {
  const skill = skills.find((s) => s.integrationKey === integrationKey);
  if (!skill) return eventName;
  const all = [...(skill.webhookEvents ?? []), ...(skill.listenerEvents ?? [])];
  return all.find((e) => e.name === eventName)?.labelPt ?? eventName;
}

function ManualSetupBlock({ url, secret }: { url: string; secret: string }) {
  const { automations } = useTranslation();
  const t = automations.triggerPicker;
  return (
    <div className="rounded border border-neutral-300 bg-white p-3 space-y-2">
      <div className="text-xs font-medium text-neutral-800">
        {t.manualSetupTitle}
      </div>
      <div className="text-xs text-neutral-700">
        {t.manualSetupHint}
      </div>
      <FieldRow label={t.address} value={url} />
      <FieldRow label={t.secret} value={secret} secret />
    </div>
  );
}

function FieldRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const { automations } = useTranslation();
  const t = automations.triggerPicker;
  const display = secret && !revealed ? '•'.repeat(Math.min(value.length, 32)) : value;
  return (
    <div className="flex items-center gap-2">
      <div className="text-xs text-neutral-500 w-28 shrink-0">{label}</div>
      <code className="text-xs bg-neutral-100 px-2 py-1 rounded flex-1 overflow-x-auto whitespace-nowrap">
        {display}
      </code>
      {secret && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="text-xs text-teal-700 underline hover:text-teal-900"
        >
          {revealed ? t.hide : t.show}
        </button>
      )}
      <button
        type="button"
        onClick={() => { void navigator.clipboard?.writeText(value); }}
        className="text-xs text-teal-700 underline hover:text-teal-900"
      >
        {t.copy}
      </button>
    </div>
  );
}
