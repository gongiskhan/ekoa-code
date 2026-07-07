"use client";

import { useEffect } from 'react';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';

interface IntegrationActionPickerProps {
  integrationKey?: string;
  actionName?: string;
  onChange: (key: string, action: string) => void;
}

export default function IntegrationActionPicker({
  integrationKey,
  actionName,
  onChange,
}: IntegrationActionPickerProps) {
  const catalog = useAutomationsStore((s) => s.catalog);
  const fetchCatalog = useAutomationsStore((s) => s.fetchCatalog);
  const { automations } = useTranslation();
  const t = automations.integrationPicker;

  useEffect(() => {
    if (catalog.integrationActions.length === 0) {
      fetchCatalog();
    }
  }, [catalog.integrationActions.length, fetchCatalog]);

  const value = integrationKey && actionName ? `${integrationKey}.${actionName}` : '';

  if (catalog.integrationActions.length === 0) {
    return (
      <div className="text-xs text-neutral-500 italic px-2 py-1.5">
        {t.none}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        const idx = v.indexOf('.');
        if (idx < 0) return;
        onChange(v.slice(0, idx), v.slice(idx + 1));
      }}
      className="w-full text-sm rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
    >
      <option value="">{t.placeholder}</option>
      {catalog.integrationActions.map((e) => (
        <option key={`${e.integrationKey}.${e.actionName}`} value={`${e.integrationKey}.${e.actionName}`}>
          {e.integrationKey}.{e.actionName}
          {e.argsSummary ? ` (${e.argsSummary})` : ''} — {e.description}
        </option>
      ))}
    </select>
  );
}
