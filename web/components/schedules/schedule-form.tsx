"use client";

/**
 * Create / edit dialog for a schedule: WHAT it fires, WHEN it fires, and a server-computed
 * preview of the next occurrences.
 *
 * Two deliberate choices worth keeping:
 *  - The preview is the SERVER's answer (`schedules.preview`), debounced, never local date
 *    math. What the form promises and what the supervisor will do cannot drift.
 *  - "Does this action write?" follows the api's fail-closed rule (anything but a literal
 *    `mutates: false` is a write, see `api/src/integrations/action-consent.ts`). The hint is
 *    informational only - the write gate itself lives on the server, and consent is granted
 *    on the Integrations page, never here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Play, Plug, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RecurrenceRule, Schedule, ScheduleSpec, ScheduleTarget } from '@ekoa/shared';
import { useSchedulesStore } from '@/stores/schedules';
import { useAutomationsStore } from '@/stores/automations';
import { useIntegrationsStore } from '@/stores/integrations';
import { useTranslation } from '@/stores/i18n';
import { formatOccurrence, weekdayChips } from '@/lib/schedules/recurrence-text';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import { labelClasses } from '@/components/ui/field';
import type { IntegrationAction } from '@/types/integration';

type TargetKind = ScheduleTarget['kind'];
type Every = RecurrenceRule['every'];

const TARGET_ICONS: Record<TargetKind, LucideIcon> = {
  manual: ClipboardCheck,
  automation: Play,
  integration_action: Plug,
};

const EVERY_UNITS: Every[] = ['minute', 'hour', 'day', 'week', 'month'];
/** Cadences that fire at a wall-clock time of day (the contract requires `at` for these). */
const TIMED_UNITS: Every[] = ['day', 'week', 'month'];

const PREVIEW_DEBOUNCE_MS = 400;
const PREVIEW_COUNT = 3;

// ---------------------------------------------------------------------------------------
// Local <-> wire helpers
// ---------------------------------------------------------------------------------------

/** `<input type="datetime-local">` speaks local wall-clock `YYYY-MM-DDTHH:mm`. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function allTimezones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    const zones = supported?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch {
    /* fall through to the single-zone fallback */
  }
  return [browserTimezone()];
}

interface ArgField {
  name: string;
  type: 'string' | 'number';
  required: boolean;
  description?: string;
}

/**
 * How to render an action's arguments: one input per declared scalar property when the
 * schema is a flat object of strings/numbers, otherwise a raw JSON textarea. Anything
 * nested is safer typed by hand than flattened into a lossy form.
 */
function readArgFields(argsSchema: unknown): ArgField[] | null {
  const schema = argsSchema as { properties?: Record<string, unknown>; required?: unknown } | undefined;
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object') return null;
  const names = Object.keys(properties);
  if (names.length === 0) return null;
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as string[]) : []);
  const fields: ArgField[] = [];
  for (const name of names) {
    const prop = properties[name] as { type?: unknown; description?: unknown } | undefined;
    const type = typeof prop?.type === 'string' ? prop.type : undefined;
    if (type !== 'string' && type !== 'number' && type !== 'integer') return null;
    fields.push({
      name,
      type: type === 'string' ? 'string' : 'number',
      required: required.has(name),
      description: typeof prop?.description === 'string' ? prop.description : undefined,
    });
  }
  return fields;
}

// ---------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------

interface ScheduleFormProps {
  open: boolean;
  onClose: () => void;
  /** Present in edit mode; the dialog pre-fills from it and PATCHes on submit. */
  schedule?: Schedule | null;
  onSaved?: (schedule: Schedule) => void;
}

export function ScheduleForm({ open, onClose, schedule, onSaved }: ScheduleFormProps) {
  const { schedules: tr, language } = useTranslation();
  const t = tr.form;
  const editing = Boolean(schedule);

  const create = useSchedulesStore((s) => s.create);
  const update = useSchedulesStore((s) => s.update);
  const preview = useSchedulesStore((s) => s.preview);

  const automations = useAutomationsStore((s) => s.automations);
  const fetchAutomations = useAutomationsStore((s) => s.fetchAutomations);
  const skills = useIntegrationsStore((s) => s.skills);
  const configs = useIntegrationsStore((s) => s.configs);
  const fetchAll = useIntegrationsStore((s) => s.fetchAll);

  // -- What ------------------------------------------------------------------------------
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetKind, setTargetKind] = useState<TargetKind>('manual');
  const [instructions, setInstructions] = useState('');
  const [automationId, setAutomationId] = useState('');
  const [integrationKey, setIntegrationKey] = useState('');
  const [actionName, setActionName] = useState('');
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [argsJson, setArgsJson] = useState('');

  // -- When ------------------------------------------------------------------------------
  const [specKind, setSpecKind] = useState<ScheduleSpec['kind']>('recurring');
  const [onceAt, setOnceAt] = useState('');
  const [every, setEvery] = useState<Every>('day');
  const [interval, setInterval] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState(1);
  const [timezone, setTimezone] = useState(browserTimezone());
  const [zoneQuery, setZoneQuery] = useState('');

  // -- Submission / preview --------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const nowMin = useMemo(() => (open ? toLocalInputValue(new Date()) : ''), [open]);
  const zones = useMemo(() => allTimezones(), []);
  const chips = useMemo(() => weekdayChips(language), [language]);

  const connectedSkills = useMemo(
    () =>
      skills.filter((skill) =>
        configs.some((config) => config.integrationKey === skill.integrationKey && config.enabled),
      ),
    [skills, configs],
  );
  const selectedSkill = connectedSkills.find((s) => s.integrationKey === integrationKey);
  const actions: IntegrationAction[] = selectedSkill?.actions ?? [];
  const selectedAction = actions.find((a) => a.actionName === actionName);
  // Fail-closed, exactly as the api's write gate reads it: only a literal `false` is a read.
  const actionWrites = selectedAction ? selectedAction.mutates !== false : false;
  const argFields = selectedAction ? readArgFields(selectedAction.argsSchema) : null;

  // Reset / pre-fill every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setFormError(null);
    setPreviewError(null);
    setOccurrences([]);
    setZoneQuery('');

    if (!schedule) {
      setName('');
      setDescription('');
      setTargetKind('manual');
      setInstructions('');
      setAutomationId('');
      setIntegrationKey('');
      setActionName('');
      setArgValues({});
      setArgsJson('');
      setSpecKind('recurring');
      setOnceAt('');
      setEvery('day');
      setInterval(1);
      setTimeOfDay('09:00');
      setWeekdays([]);
      setMonthDay(1);
      setTimezone(browserTimezone());
      return;
    }

    setName(schedule.name);
    setDescription(schedule.description ?? '');
    setTargetKind(schedule.target.kind);
    setInstructions(schedule.target.kind === 'manual' ? (schedule.target.instructions ?? '') : '');
    setAutomationId(schedule.target.kind === 'automation' ? schedule.target.automationId : '');
    setIntegrationKey(schedule.target.kind === 'integration_action' ? schedule.target.integrationKey : '');
    setActionName(schedule.target.kind === 'integration_action' ? schedule.target.actionName : '');
    if (schedule.target.kind === 'integration_action' && schedule.target.args) {
      const flat: Record<string, string> = {};
      for (const [key, value] of Object.entries(schedule.target.args)) {
        if (typeof value === 'string' || typeof value === 'number') flat[key] = String(value);
      }
      setArgValues(flat);
      setArgsJson(JSON.stringify(schedule.target.args, null, 2));
    } else {
      setArgValues({});
      setArgsJson('');
    }

    setSpecKind(schedule.spec.kind);
    if (schedule.spec.kind === 'once') {
      const at = new Date(schedule.spec.at);
      setOnceAt(Number.isNaN(at.getTime()) ? '' : toLocalInputValue(at));
      setEvery('day');
      setInterval(1);
      setTimeOfDay('09:00');
      setWeekdays([]);
      setMonthDay(1);
      setTimezone(browserTimezone());
    } else {
      const rule = schedule.spec.rule;
      setOnceAt('');
      setEvery(rule.every);
      setInterval(rule.interval);
      setTimeOfDay(
        rule.at ? `${String(rule.at.hour).padStart(2, '0')}:${String(rule.at.minute).padStart(2, '0')}` : '09:00',
      );
      setWeekdays(rule.weekdays ?? []);
      setMonthDay(rule.monthDay ?? 1);
      setTimezone(rule.timezone);
    }
  }, [open, schedule]);

  // Pickers read the automations / integrations the user already has - fetched on open,
  // never re-derived from a raw endpoint of our own.
  useEffect(() => {
    if (!open) return;
    if (automations.length === 0) void fetchAutomations();
    if (skills.length === 0) void fetchAll();
  }, [open, automations.length, skills.length, fetchAutomations, fetchAll]);

  /** The spec as the contract wants it, or null while it is still incomplete. */
  const buildSpec = useCallback((): ScheduleSpec | null => {
    if (specKind === 'once') {
      if (!onceAt) return null;
      const at = new Date(onceAt);
      if (Number.isNaN(at.getTime())) return null;
      return { kind: 'once', at: at.toISOString() };
    }
    if (!Number.isFinite(interval) || interval < 1) return null;
    const rule: RecurrenceRule = { every, interval, timezone };
    if (TIMED_UNITS.includes(every)) {
      const [hour, minute] = timeOfDay.split(':').map((part) => Number.parseInt(part, 10));
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
      rule.at = { hour, minute };
    }
    if (every === 'week') {
      if (weekdays.length === 0) return null;
      rule.weekdays = [...weekdays].sort((a, b) => a - b);
    }
    if (every === 'month') rule.monthDay = monthDay;
    return { kind: 'recurring', rule };
  }, [specKind, onceAt, every, interval, timeOfDay, weekdays, monthDay, timezone]);

  const spec = buildSpec();
  const specKey = spec ? JSON.stringify(spec) : '';

  // Debounced server preview. The timer is cleared on every spec change and on close, so a
  // fast typist never sees an older answer land after a newer one.
  //
  // In EDIT mode the schedule's id travels with the request: a stride or week/month cadence is
  // counted from the schedule's creation, so a preview anchored on "now" would list occurrences
  // the supervisor is not going to fire. Creating, there is nothing to anchor on yet and the
  // request instant is the right anchor - which is exactly what create does on submit.
  const anchorId = schedule?.id;
  useEffect(() => {
    if (!open || !specKey) {
      setOccurrences([]);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void (async () => {
        const result = await preview({
          spec: JSON.parse(specKey) as ScheduleSpec,
          count: PREVIEW_COUNT,
          ...(anchorId ? { scheduleId: anchorId } : {}),
        });
        if (cancelled) return;
        setPreviewing(false);
        if (result.ok) {
          setOccurrences(result.occurrences ?? []);
          setPreviewError(null);
        } else {
          setOccurrences([]);
          setPreviewError(result.error ?? null);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      setPreviewing(false);
      clearTimeout(timer);
    };
    // `preview` is a zustand action - referentially stable for the store's lifetime.
  }, [open, specKey, anchorId, preview]);

  const toggleWeekday = (value: number) => {
    setWeekdays((current) =>
      current.includes(value) ? current.filter((d) => d !== value) : [...current, value],
    );
  };

  /** The target as the contract wants it, or an error key naming what is still missing. */
  const buildTarget = (): { target: ScheduleTarget } | { error: string } => {
    if (targetKind === 'manual') {
      const text = instructions.trim();
      if (!text) return { error: t.errors.instructionsRequired };
      return { target: { kind: 'manual', instructions: text } };
    }
    if (targetKind === 'automation') {
      if (!automationId) return { error: t.errors.automationRequired };
      return { target: { kind: 'automation', automationId } };
    }
    if (!integrationKey) return { error: t.errors.integrationRequired };
    if (!actionName) return { error: t.errors.actionRequired };

    let args: Record<string, unknown> | undefined;
    if (argFields) {
      const collected: Record<string, unknown> = {};
      for (const field of argFields) {
        const raw = (argValues[field.name] ?? '').trim();
        if (!raw) continue;
        collected[field.name] = field.type === 'number' ? Number(raw) : raw;
      }
      args = Object.keys(collected).length > 0 ? collected : undefined;
    } else if (argsJson.trim()) {
      try {
        const parsed = JSON.parse(argsJson) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: t.argsJsonInvalid };
        args = parsed as Record<string, unknown>;
      } catch {
        return { error: t.argsJsonInvalid };
      }
    }
    return { target: { kind: 'integration_action', integrationKey, actionName, args } };
  };

  const submit = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError(t.errors.nameRequired);
      return;
    }
    const built = buildTarget();
    if ('error' in built) {
      setFormError(built.error);
      return;
    }
    if (!spec) {
      setFormError(
        specKind === 'once'
          ? t.errors.onceRequired
          : every === 'week' && weekdays.length === 0
            ? t.errors.weekdaysRequired
            : t.errors.specIncomplete,
      );
      return;
    }

    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      target: built.target,
      spec,
    };
    const saved = schedule ? await update(schedule.id, payload) : await create(payload);
    setSaving(false);
    if (!saved) {
      setFormError(useSchedulesStore.getState().error ?? null);
      return;
    }
    onSaved?.(saved);
    onClose();
  };

  const filteredZones = useMemo(() => {
    const query = zoneQuery.trim().toLowerCase();
    const matches = query ? zones.filter((zone) => zone.toLowerCase().includes(query)) : zones;
    // The chosen zone always stays selectable, however the list is filtered.
    return matches.includes(timezone) ? matches : [timezone, ...matches];
  }, [zones, zoneQuery, timezone]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? t.editTitle : t.createTitle}
      footer={
        /*
          The validation error lives NEXT TO the button that produces it. The dialog body
          scrolls and the footer does not, so an error rendered at the end of the body could
          be off-screen at the exact moment the user pressed submit - the form would look
          like it had silently done nothing.
        */
        <>
          {formError && (
            <p
              className="mr-auto max-w-[60%] self-center text-xs text-red-600"
              role="alert"
              data-testid="schedule-form-error"
            >
              {formError}
            </p>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t.cancel}
          </Button>
          <Button variant="primary" onClick={submit} loading={saving} data-testid="schedule-form-submit">
            {editing ? t.submitSave : t.submitCreate}
          </Button>
        </>
      }
    >
      <div className="space-y-7" data-testid="schedule-form">
        <div className="space-y-3">
          <Input
            label={t.nameLabel}
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            label={t.descriptionLabel}
            placeholder={t.descriptionPlaceholder}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* -- What ------------------------------------------------------------------ */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-neutral-900">{t.sectionWhat}</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['manual', 'automation', 'integration_action'] as TargetKind[]).map((kind) => {
              const Icon = TARGET_ICONS[kind];
              const selected = targetKind === kind;
              const label =
                kind === 'manual' ? t.targetManual : kind === 'automation' ? t.targetAutomation : t.targetIntegration;
              const hint =
                kind === 'manual'
                  ? t.targetManualHint
                  : kind === 'automation'
                    ? t.targetAutomationHint
                    : t.targetIntegrationHint;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTargetKind(kind)}
                  data-testid={`schedule-target-${kind}`}
                  className={`rounded-xl border p-3 text-left transition-colors focus-ring ${
                    selected
                      ? 'border-teal-500 bg-teal-50/50 ring-1 ring-teal-600/15'
                      : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${selected ? 'text-teal-600' : 'text-neutral-400'}`} aria-hidden />
                  <span className="mt-2 block text-sm font-medium text-neutral-900">{label}</span>
                  <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
                </button>
              );
            })}
          </div>

          {targetKind === 'manual' && (
            <Textarea
              label={t.instructionsLabel}
              placeholder={t.instructionsPlaceholder}
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          )}

          {targetKind === 'automation' && (
            <Select
              label={t.automationLabel}
              value={automationId}
              onChange={(e) => setAutomationId(e.target.value)}
              hint={automations.length === 0 ? t.noAutomations : undefined}
            >
              <option value="">{t.automationPlaceholder}</option>
              {automations.map((automation) => (
                <option key={automation.id} value={automation.id}>
                  {automation.name}
                </option>
              ))}
            </Select>
          )}

          {targetKind === 'integration_action' && (
            <div className="space-y-3">
              <Select
                label={t.integrationLabel}
                value={integrationKey}
                onChange={(e) => {
                  setIntegrationKey(e.target.value);
                  setActionName('');
                  setArgValues({});
                  setArgsJson('');
                }}
                hint={connectedSkills.length === 0 ? t.noIntegrations : undefined}
              >
                <option value="">{t.integrationPlaceholder}</option>
                {connectedSkills.map((skill) => (
                  <option key={skill.integrationKey} value={skill.integrationKey}>
                    {skill.displayName}
                  </option>
                ))}
              </Select>

              {integrationKey && (
                <Select
                  label={t.actionLabel}
                  value={actionName}
                  onChange={(e) => {
                    setActionName(e.target.value);
                    setArgValues({});
                    setArgsJson('');
                  }}
                >
                  <option value="">{t.actionPlaceholder}</option>
                  {actions.map((action) => (
                    <option key={action.actionName} value={action.actionName}>
                      {action.actionName}
                    </option>
                  ))}
                </Select>
              )}

              {selectedAction && actionWrites && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                  data-testid="schedule-action-write-warning"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                  <div className="min-w-0">
                    <Badge tone="warning">{t.writeBadge}</Badge>
                    <p className="mt-1 text-xs text-amber-800">{t.writeNeedsApproval}</p>
                  </div>
                </div>
              )}

              {selectedAction && argFields && argFields.length > 0 && (
                <div className="space-y-2">
                  <p className={labelClasses}>{t.argsTitle}</p>
                  {argFields.map((field) => (
                    <Input
                      key={field.name}
                      label={field.required ? `${field.name} *` : field.name}
                      hint={field.description}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={argValues[field.name] ?? ''}
                      onChange={(e) => setArgValues((current) => ({ ...current, [field.name]: e.target.value }))}
                    />
                  ))}
                </div>
              )}

              {selectedAction && !argFields && (
                <Textarea
                  label={t.argsJsonLabel}
                  hint={t.argsJsonHint}
                  rows={4}
                  className="font-mono text-xs"
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                />
              )}
            </div>
          )}
        </section>

        {/* -- When ------------------------------------------------------------------ */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-neutral-900">{t.sectionWhen}</h3>
          <Tabs
            variant="pills"
            value={specKind}
            onChange={(key) => setSpecKind(key as ScheduleSpec['kind'])}
            items={[
              { key: 'once', label: t.tabOnce, testId: 'schedule-spec-once' },
              { key: 'recurring', label: t.tabRecurring, testId: 'schedule-spec-recurring' },
            ]}
          />

          {specKind === 'once' ? (
            <Input
              label={t.onceLabel}
              type="datetime-local"
              min={nowMin}
              value={onceAt}
              onChange={(e) => setOnceAt(e.target.value)}
            />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label={t.everyLabel} value={every} onChange={(e) => setEvery(e.target.value as Every)}>
                  {EVERY_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {t.units[unit]}
                    </option>
                  ))}
                </Select>
                <Input
                  label={t.intervalLabel}
                  type="number"
                  min={1}
                  max={999}
                  value={interval}
                  onChange={(e) => setInterval(Number.parseInt(e.target.value, 10) || 1)}
                />
              </div>

              {TIMED_UNITS.includes(every) && (
                <Input
                  label={t.timeLabel}
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                  wrapperClassName="sm:max-w-[12rem]"
                />
              )}

              {every === 'week' && (
                <div>
                  <p className={labelClasses}>{t.weekdaysLabel}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((chip) => {
                      const selected = weekdays.includes(chip.value);
                      return (
                        <button
                          key={chip.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleWeekday(chip.value)}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors focus-ring ${
                            selected
                              ? 'border-teal-500 bg-teal-50 text-teal-700'
                              : 'border-line bg-surface text-neutral-600 hover:border-line-strong'
                          }`}
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {every === 'month' && (
                <Input
                  label={t.monthDayLabel}
                  type="number"
                  min={1}
                  max={31}
                  value={monthDay}
                  onChange={(e) => setMonthDay(Number.parseInt(e.target.value, 10) || 1)}
                  wrapperClassName="sm:max-w-[12rem]"
                />
              )}

              <div className="space-y-2">
                <SearchInput
                  value={zoneQuery}
                  onValueChange={setZoneQuery}
                  placeholder={t.timezoneSearchPlaceholder}
                  aria-label={t.timezoneSearchPlaceholder}
                />
                <Select label={t.timezoneLabel} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {filteredZones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </section>

        {/* -- Preview --------------------------------------------------------------- */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-neutral-900">{t.sectionPreview}</h3>
          <div className="rounded-xl border border-line bg-neutral-50 px-4 py-3" data-testid="schedule-preview">
            {previewError ? (
              <p className="text-xs text-red-600">{previewError}</p>
            ) : !spec ? (
              <p className="text-xs text-neutral-500">{t.previewEmpty}</p>
            ) : previewing ? (
              <p className="text-xs text-neutral-500">{t.previewLoading}</p>
            ) : occurrences.length === 0 ? (
              <p className="text-xs text-neutral-500">{t.previewEmpty}</p>
            ) : (
              <>
                <p className="text-xs font-medium text-neutral-600">{t.previewTitle}</p>
                <ul className="mt-1.5 space-y-1">
                  {occurrences.map((occurrence) => (
                    <li key={occurrence} className="text-xs text-neutral-700">
                      {formatOccurrence(occurrence, language, {
                        timeZone: specKind === 'recurring' ? timezone : undefined,
                      })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}

export default ScheduleForm;
