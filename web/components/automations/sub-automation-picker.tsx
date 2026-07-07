"use client";

import { useEffect } from 'react';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';

interface SubAutomationPickerProps {
  automationId?: string;
  /** ID of the *current* automation, so we don't offer it as a sub. */
  excludeId?: string;
  onChange: (id: string) => void;
}

export default function SubAutomationPicker({
  automationId,
  excludeId,
  onChange,
}: SubAutomationPickerProps) {
  const catalog = useAutomationsStore((s) => s.catalog);
  const fetchCatalog = useAutomationsStore((s) => s.fetchCatalog);
  const { automations: tr } = useTranslation();
  const t = tr.subAutomationPicker;

  useEffect(() => {
    if (catalog.automations.length === 0) {
      fetchCatalog();
    }
  }, [catalog.automations.length, fetchCatalog]);

  const options = catalog.automations.filter((a) => a.id !== excludeId);

  if (options.length === 0) {
    return (
      <div className="text-xs text-neutral-500 italic px-2 py-1.5">
        {t.none}
      </div>
    );
  }

  return (
    <select
      value={automationId ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-sm rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
    >
      <option value="">{t.placeholder}</option>
      {options.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} — {a.description.slice(0, 60)}
        </option>
      ))}
    </select>
  );
}
