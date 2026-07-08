'use client';

import { useState, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Key, Pencil, Lock, ShieldCheck, AlertCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/stores/i18n';
import type { IntegrationSkill, IntegrationConfigField } from '@/types/integration';

interface InlineCredentialFormProps {
  skill: IntegrationSkill;
  isConfigured: boolean;
  onSave: (values: Record<string, string>) => Promise<{ success: boolean; error?: string }>;
  isSaving: boolean;
}

const MASKED_VALUE = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

const formVariants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: 'auto' as const,
    opacity: 1,
    transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.42, 0, 1, 1] as const },
  },
};

const INPUT_CLASS =
  'w-full bg-neutral-50 border border-neutral-200 rounded-md py-1.5 px-2.5 text-xs text-neutral-800 placeholder-neutral-400 focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-1 focus-visible:ring-teal-500/20 transition-colors';

export function InlineCredentialForm({
  skill,
  isConfigured,
  onSave,
  isSaving,
}: InlineCredentialFormProps) {
  const { common, pages } = useTranslation();
  const t = pages.integrations;
  const formId = useId();

  const [isEditing, setIsEditing] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  const fields = skill.configSchema;

  if (fields.length === 0) return null;

  // Collapsed by default (both configured and unconfigured) so every card in
  // the grid has the same footprint; the form only expands on explicit click.
  const showForm = isEditing;

  function handleChange(key: string, value: string) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleVisibility(key: string) {
    setVisibleFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSaveError(null);
    const result = await onSave(formValues);
    if (result.success) {
      setIsEditing(false);
      setFormValues({});
      setVisibleFields(new Set());
    } else {
      setSaveError(result.error || t.saveFailed);
    }
  }

  function handleCancel(e: React.MouseEvent) {
    e.stopPropagation();
    setIsEditing(false);
    setFormValues({});
    setVisibleFields(new Set());
    setSaveError(null);
  }

  function handleEditClick(e: React.MouseEvent) {
    e.stopPropagation();
    setIsEditing(true);
    setSaveError(null);
  }

  function renderField(field: IntegrationConfigField, fieldId: string) {
    const value = formValues[field.key] || '';

    if (field.type === 'boolean') {
      return (
        <Checkbox
          checked={value === 'true'}
          onChange={(checked) => handleChange(field.key, String(checked))}
          label={field.helpText || field.label}
        />
      );
    }

    if (field.type === 'select' && field.options) {
      return (
        <select
          id={fieldId}
          value={value}
          onChange={(e) => handleChange(field.key, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={`${INPUT_CLASS} appearance-none cursor-pointer`}
        >
          <option value="" disabled>{common.select}...</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }

    if (field.type === 'textarea') {
      return (
        <textarea
          id={fieldId}
          value={value}
          onChange={(e) => handleChange(field.key, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder={field.helpText || ''}
          required={field.required}
          rows={3}
          className={`${INPUT_CLASS} resize-none`}
        />
      );
    }

    const isPassword = field.secret || field.type === 'password';
    const isVisible = visibleFields.has(field.key);

    const inputType = isPassword && !isVisible
      ? 'password'
      : field.type === 'number'
        ? 'number'
        : field.type === 'url'
          ? 'url'
          : 'text';

    return (
      <div className="relative">
        <input
          id={fieldId}
          type={inputType}
          value={value}
          onChange={(e) => handleChange(field.key, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder={field.helpText || ''}
          required={field.required}
          className={`${INPUT_CLASS} ${isPassword ? 'pr-8' : ''}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleVisibility(field.key);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-neutral-600 rounded transition-colors cursor-pointer"
            aria-label={isVisible ? t.hidePassword : t.showPassword}
          >
            {isVisible ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="mb-2"
      onClick={(e) => e.stopPropagation()}
    >
      <AnimatePresence mode="wait" initial={false}>
        {/* Configured state: show masked values */}
        {isConfigured && !showForm && (
          <motion.div
            key="configured"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                  {t.credentialsConfigured}
                </span>
                <button
                  type="button"
                  onClick={handleEditClick}
                  className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-teal-600 transition-colors cursor-pointer rounded-md px-1.5 py-0.5 hover:bg-teal-50"
                >
                  <Pencil size={10} />
                  <span>{t.editCredentials}</span>
                </button>
              </div>
              <div className="space-y-0.5">
                {fields.map((field) => (
                  <div key={field.key} className="flex items-center justify-between py-0.5">
                    <span className="text-[11px] text-neutral-500">{field.label}</span>
                    <span className="text-neutral-300 font-mono text-[10px] tracking-tight select-none" aria-label={t.maskedValue}>
                      {MASKED_VALUE}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Unconfigured state: compact call-to-action, collapsed by default */}
        {!isConfigured && !showForm && (
          <motion.div
            key="unconfigured"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <button
              type="button"
              onClick={handleEditClick}
              className="w-full flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-700 hover:bg-amber-100/70 transition-colors cursor-pointer"
            >
              <Key size={12} className="flex-shrink-0 text-amber-500" />
              <span className="font-medium">{t.setupCredentialsBanner}</span>
            </button>
          </motion.div>
        )}

        {/* Form state: show inputs */}
        {showForm && (
          <motion.div
            key="form"
            variants={formVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="overflow-hidden"
          >
            <form
              onSubmit={handleSubmit}
              className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2.5"
            >
              {fields.map((field) => {
                const fieldId = `${formId}-${field.key}`;
                return (
                  <div key={field.key}>
                    <label
                      htmlFor={field.type !== 'boolean' ? fieldId : undefined}
                      className="flex items-center gap-1 text-[11px] font-medium text-neutral-600 mb-1"
                    >
                      {field.label}
                      {field.required && <span className="text-red-400">*</span>}
                      {field.secret && <Lock size={9} className="text-amber-500/70 ml-0.5" />}
                    </label>
                    {renderField(field, fieldId)}
                  </div>
                );
              })}

              {/* Security notice */}
              <div className="flex items-start gap-1.5 pt-0.5">
                <ShieldCheck size={11} className="text-neutral-300 mt-0.5 flex-shrink-0" />
                <p className="text-[10px] text-neutral-400 leading-relaxed">
                  {t.securityNotice}
                </p>
              </div>

              {/* Error display */}
              {saveError && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-md">
                  <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
                  <p className="text-[11px] text-red-600">{saveError}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-0.5">
                <Button type="submit" variant="primary" size="sm" loading={isSaving}>
                  {t.saveCredentials}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                  {t.cancelEdit}
                </Button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
