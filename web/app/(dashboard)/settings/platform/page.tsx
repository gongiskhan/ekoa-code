"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Globe, AlertTriangle, Check, Trash2 } from "lucide-react";
import { useSettingsStore, type PlatformSettings } from "@/stores/settings";
import { useI18nStore, useTranslation } from "@/stores/i18n";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { UserPreferencesSection } from "@/components/settings/user-preferences-section";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
type SettingsPatch = DeepPartial<PlatformSettings>;

const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/Lisbon", label: "Europe/Lisbon (WET)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET)" },
  { value: "America/New_York", label: "America/New York (ET)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/Denver", label: "America/Denver (MT)" },
  { value: "America/Los_Angeles", label: "America/Los Angeles (PT)" },
  { value: "America/Sao_Paulo", label: "America/Sao Paulo (BRT)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (CST)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
];

/* ==========================================================================
   Reusable rows
   ========================================================================== */

function LanguageToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { pages_platform } = useTranslation();
  const options: { key: string; label: string }[] = [
    { key: "en", label: pages_platform.english },
    { key: "pt", label: pages_platform.portuguesePt },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={`px-4 py-2 text-sm font-medium transition-colors focus-ring ${
            value === opt.key
              ? "bg-teal-600 text-white"
              : "bg-surface text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0 border-b border-line last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900">{label}</div>
        <p className="mt-0.5 text-sm text-neutral-500 leading-relaxed">{description}</p>
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  showSaved,
}: {
  title: string;
  description: string;
  showSaved: boolean;
}) {
  const { pages_platform } = useTranslation();
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
      </div>
      {showSaved && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {pages_platform.saved}
        </span>
      )}
    </div>
  );
}

/* ==========================================================================
   Sections
   ========================================================================== */

function GeneralSection({
  settings,
  onUpdate,
  showSaved,
}: {
  settings: PlatformSettings;
  onUpdate: (patch: SettingsPatch) => void;
  showSaved: boolean;
}) {
  const { pages_platform } = useTranslation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localName, setLocalName] = useState(settings.general.platformName);

  useEffect(() => {
    setLocalName(settings.general.platformName);
  }, [settings.general.platformName]);

  const debouncedNameUpdate = useCallback(
    (v: string) => {
      setLocalName(v);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onUpdate({ general: { platformName: v } });
      }, 500);
    },
    [onUpdate],
  );

  return (
    <section>
      <SectionHeader
        title={pages_platform.sectionGeneral}
        description={pages_platform.sectionGeneralDesc}
        showSaved={showSaved}
      />
      <Card>
        <SettingRow label={pages_platform.platformName} description={pages_platform.platformNameDesc}>
          <Input
            value={localName}
            onChange={(e) => debouncedNameUpdate(e.target.value)}
            placeholder="Ekoa"
            wrapperClassName="w-full max-w-xs"
          />
        </SettingRow>

        <SettingRow label={pages_platform.timezone} description={pages_platform.timezoneDesc}>
          <Select
            value={settings.general.timezone}
            onChange={(e) => onUpdate({ general: { timezone: e.target.value } })}
            wrapperClassName="w-full max-w-xs"
          >
            {TIMEZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow label={pages_platform.language} description={pages_platform.languageDesc}>
          <LanguageToggle
            value={settings.general.language}
            onChange={(v) => onUpdate({ general: { language: v } })}
          />
        </SettingRow>
      </Card>
    </section>
  );
}

function ChatSection({
  settings,
  onUpdate,
  showSaved,
}: {
  settings: PlatformSettings;
  onUpdate: (patch: SettingsPatch) => void;
  showSaved: boolean;
}) {
  const { pages_platform } = useTranslation();
  return (
    <section>
      <SectionHeader
        title={pages_platform.sectionChat}
        description={pages_platform.sectionChatDesc}
        showSaved={showSaved}
      />

      <Card>
        <SettingRow label={pages_platform.guidedMode} description={pages_platform.guidedModeDesc}>
          <Switch
            checked={settings.chat.guidedMode ?? true}
            onChange={(v) => onUpdate({ chat: { guidedMode: v } })}
          />
        </SettingRow>

        <SettingRow
          label={pages_platform.showExampleCards}
          description={pages_platform.showExampleCardsDesc}
        >
          <Switch
            checked={settings.chat.showExampleCards}
            onChange={(v) => onUpdate({ chat: { showExampleCards: v } })}
          />
        </SettingRow>
      </Card>

      {/* Guidance level dial */}
      <div className="mt-6">
        <h3 className="mb-1 text-sm font-semibold text-neutral-900">Nível de orientação</h3>
        <p className="mb-4 text-xs text-neutral-500">
          Como o orquestrador conversa consigo durante a construção.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="guidance-selector">
          {([
            {
              key: "guide-me",
              title: "Orientar-me",
              body: "Faço perguntas extra, explico cada passo, sugiro melhorias.",
            },
            {
              key: "standard",
              title: "Normal",
              body: "Equilíbrio entre rapidez e clareza.",
            },
            {
              key: "just-build-it",
              title: "Mãos à obra",
              body: "Sem perguntas opcionais, sem explicações, transições rápidas.",
            },
          ] as const).map((opt) => {
            const current = (settings.chat.guidance ?? "guide-me") as
              | "guide-me"
              | "standard"
              | "just-build-it";
            const selected = current === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onUpdate({ chat: { guidance: opt.key } })}
                data-testid={`guidance-${opt.key}`}
                aria-pressed={selected}
                className={`rounded-xl border p-4 text-left transition-colors focus-ring ${
                  selected
                    ? "border-teal-500 bg-teal-50 ring-1 ring-teal-200"
                    : "border-line bg-surface hover:border-line-strong"
                }`}
              >
                <div
                  className={`mb-1 text-sm font-semibold ${
                    selected ? "text-teal-800" : "text-neutral-900"
                  }`}
                >
                  {opt.title}
                </div>
                <div className="text-xs leading-relaxed text-neutral-600">{opt.body}</div>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs italic text-neutral-500">
          Perguntas críticas (integrações em falta, intenção ambígua) aparecem sempre, qualquer que
          seja a sua escolha.
        </p>
      </div>
    </section>
  );
}

function AdvancedSection({ showSaved }: { showSaved: boolean }) {
  const { pages_platform } = useTranslation();
  const confirm = useConfirm();
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  async function handleResetAll() {
    const ok = await confirm({
      title: pages_platform.resetAll,
      description: pages_platform.resetAllDesc,
      confirmLabel: pages_platform.confirmReset,
      tone: "danger",
    });
    if (!ok) return;
    // FC-044: settings writes funnel through the settings store's single update action.
    updateSettings({
      general: { platformName: "", language: "en", timezone: "UTC" },
      chat: {
        showExampleCards: true,
        guidedMode: true,
      },
      build: { showFileTreeByDefault: false },
    });
  }

  return (
    <section>
      <SectionHeader
        title={pages_platform.sectionAdvanced}
        description={pages_platform.sectionAdvancedDesc}
        showSaved={showSaved}
      />

      <Card>
        <SettingRow label={pages_platform.dataDirectory} description={pages_platform.dataDirectoryDesc}>
          <Input value="~/.ekoa/data/" readOnly disabled wrapperClassName="w-full max-w-xs" />
        </SettingRow>

        <div className="flex items-center justify-between gap-6 pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-900">{pages_platform.resetAll}</div>
            <p className="mt-0.5 text-sm text-neutral-500">{pages_platform.resetAllDesc}</p>
          </div>
          <Button variant="danger" size="sm" icon={Trash2} onClick={handleResetAll}>
            {pages_platform.reset}
          </Button>
        </div>
      </Card>
    </section>
  );
}

/* ==========================================================================
   Main Page
   ========================================================================== */

export default function PlatformSettingsPage() {
  const { pages_platform } = useTranslation();
  const { settings, isLoaded, isLoading, error, fetchSettings, updateSettings } = useSettingsStore();

  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  function handleUpdate(patch: Parameters<typeof updateSettings>[0]) {
    updateSettings(patch);
    if (patch.general?.language) {
      useI18nStore.getState().setLanguage(patch.general.language as "en" | "pt");
    }
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 1500);
    return () => clearTimeout(timer);
  }

  if (isLoading && !isLoaded) {
    return (
      <PageShell testId="settings-platform-page">
        <LoadingState label={pages_platform.loadingSettings} />
      </PageShell>
    );
  }

  if (error && !isLoaded) {
    return (
      <PageShell testId="settings-platform-page">
        <EmptyState
          icon={AlertTriangle}
          title={pages_platform.title}
          description={error}
          action={
            <Button variant="secondary" onClick={() => fetchSettings()}>
              {pages_platform.tryAgain}
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell testId="settings-platform-page">
      <PageHeader
        icon={Globe}
        title={pages_platform.title}
        description={pages_platform.headerSubtitle}
      />
      <GeneralSection settings={settings} onUpdate={handleUpdate} showSaved={showSaved} />
      <ChatSection settings={settings} onUpdate={handleUpdate} showSaved={showSaved} />
      <UserPreferencesSection />
      <AdvancedSection showSaved={showSaved} />
    </PageShell>
  );
}
