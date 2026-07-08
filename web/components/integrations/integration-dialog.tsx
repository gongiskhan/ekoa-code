"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Settings2,
  FileText,
  Zap,
  FlaskConical,
  Plug,
  Copy,
  Check,
  AlertTriangle,
  Key,
  Eye,
  EyeOff,
  Play,
  CheckCircle2,
  XCircle,
  Download,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "@/stores/i18n";
import { useIntegrationsStore } from "@/stores/integrations";
import { copyToClipboard } from "@/lib/clipboard";
import { api, tryCall } from "@/lib/api";
import { toast } from "@/stores/toast";
import { Button, IconButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type {
  IntegrationBuilderOutput,
  IntegrationBuilderConfig,
  IntegrationConfigField,
  IntegrationAction,
  IntegrationActionHttpConfig,
  IntegrationTestResult,
} from "@/types/integration";

/* ============================================
   TYPES
   ============================================ */

export type IntegrationDialogMode = "create" | "edit";

interface IntegrationDialogProps {
  mode: IntegrationDialogMode;
  integrationKey?: string;
  importedData?: IntegrationBuilderOutput;
  onClose: () => void;
  onSaved?: () => void;
}

interface ConfigFieldDraft {
  id: string;
  key: string;
  label: string;
  type: IntegrationConfigField["type"];
  required: boolean;
  secret: boolean;
  helpText: string;
}

interface ActionDraft {
  id: string;
  actionName: string;
  description: string;
  mutates: boolean;
  argsSchema: string;
  returnSchema: string;
  httpConfig: {
    method: IntegrationActionHttpConfig["method"];
    baseUrl: string;
    path: string;
    headers: Array<{ key: string; value: string }>;
    queryParams: Array<{ key: string; value: string }>;
    bodyTemplate: string;
  };
}

const AUTH_TYPES = ["api_key", "oauth2", "service_account", "none"] as const;
const FIELD_TYPES: IntegrationConfigField["type"][] = [
  "string", "number", "boolean", "url", "select", "password", "textarea",
];
const HTTP_METHODS: IntegrationActionHttpConfig["method"][] = [
  "GET", "POST", "PUT", "DELETE", "PATCH",
];

/* ============================================
   ANIMATIONS
   ============================================ */

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const panelVariants = {
  hidden: { opacity: 0, x: 40, scale: 0.98 },
  visible: {
    opacity: 1, x: 0, scale: 1,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
  exit: {
    opacity: 0, x: 40, scale: 0.98,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: 0.08 + i * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  }),
};

/* ============================================
   HELPERS
   ============================================ */

let nextId = 0;
function uid() { return `_${++nextId}_${Date.now()}`; }

function makeSkillSkeleton(name: string, desc: string, authType: string) {
  return `# ${name || "Integration Name"}

${desc || "Describe what this integration does."}

## Authentication
Requires ${authType === "api_key" ? "API key" : authType === "oauth2" ? "OAuth 2.0" : authType === "service_account" ? "service account" : "no"} authentication.

## Actions
<!-- List actions and their usage here -->
`;
}

function configFieldsToSchema(fields: ConfigFieldDraft[]): IntegrationConfigField[] {
  return fields.map(({ key, label, type, required, secret, helpText }) => ({
    key, label, type, required, secret,
    ...(helpText ? { helpText } : {}),
  }));
}

function actionDraftsToActions(drafts: ActionDraft[]): IntegrationAction[] {
  return drafts.map((d) => {
    let argsSchema: Record<string, unknown> = {};
    let returnSchema: Record<string, unknown> = {};
    try { argsSchema = JSON.parse(d.argsSchema || "{}"); } catch { /* keep empty */ }
    try { returnSchema = JSON.parse(d.returnSchema || "{}"); } catch { /* keep empty */ }

    const headers: Record<string, string> = {};
    d.httpConfig.headers.forEach((h) => { if (h.key) headers[h.key] = h.value; });
    const queryParams: Record<string, string> = {};
    d.httpConfig.queryParams.forEach((p) => { if (p.key) queryParams[p.key] = p.value; });

    let bodyTemplate: Record<string, unknown> | undefined;
    if (d.httpConfig.bodyTemplate.trim()) {
      try { bodyTemplate = JSON.parse(d.httpConfig.bodyTemplate); } catch { /* skip */ }
    }

    const httpConfig: IntegrationActionHttpConfig = {
      method: d.httpConfig.method,
      baseUrl: d.httpConfig.baseUrl,
      path: d.httpConfig.path,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(queryParams).length > 0 ? { queryParams } : {}),
      ...(bodyTemplate ? { bodyTemplate } : {}),
    };

    return {
      actionName: d.actionName,
      description: d.description,
      mutates: d.mutates,
      argsSchema,
      returnSchema,
      httpConfig,
    };
  });
}

function actionToActionDraft(a: IntegrationAction): ActionDraft {
  return {
    id: uid(),
    actionName: a.actionName,
    description: a.description,
    mutates: a.mutates,
    argsSchema: JSON.stringify(a.argsSchema || {}, null, 2),
    returnSchema: JSON.stringify(a.returnSchema || {}, null, 2),
    httpConfig: {
      method: a.httpConfig?.method || "GET",
      baseUrl: a.httpConfig?.baseUrl || "",
      path: a.httpConfig?.path || "",
      headers: Object.entries(a.httpConfig?.headers || {}).map(([key, value]) => ({ key, value })),
      queryParams: Object.entries(a.httpConfig?.queryParams || {}).map(([key, value]) => ({ key, value })),
      bodyTemplate: a.httpConfig?.bodyTemplate ? JSON.stringify(a.httpConfig.bodyTemplate, null, 2) : "",
    },
  };
}

function configFieldToDraft(f: IntegrationConfigField): ConfigFieldDraft {
  return { id: uid(), key: f.key, label: f.label, type: f.type, required: f.required, secret: f.secret, helpText: f.helpText || "" };
}

function humanizeActionName(name: string): string {
  return name.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeArgKey(key: string): string {
  return key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ============================================
   SUB-COMPONENTS
   ============================================ */

function SectionHeader({
  icon: Icon, title, subtitle, count, action,
}: {
  icon: LucideIcon; title: string; subtitle?: string; count?: number; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 mb-3">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-50 to-teal-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={15} className="text-teal-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
          {count !== undefined && (
            <span className="text-[10px] font-medium text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded-full">{count}</span>
          )}
          {action && <div className="ml-auto">{action}</div>}
        </div>
        {subtitle && <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
    </div>
  );
}

/* ---------- Config Field Row ---------- */

function ConfigFieldRow({ field, index, onChange, onDelete, t }: {
  field: ConfigFieldDraft; index: number; onChange: (f: ConfigFieldDraft) => void; onDelete: () => void;
  t: ReturnType<typeof useTranslation>["pages"]["integrations"];
}) {
  return (
    <motion.div custom={index} variants={itemVariants} initial="hidden" animate="visible"
      exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
      className="group relative bg-white border border-neutral-200 rounded-lg p-3 hover:border-neutral-300 transition-colors"
    >
      <div className="grid grid-cols-[1fr_1fr] gap-2 mb-2">
        <input type="text" value={field.key} onChange={(e) => onChange({ ...field, key: e.target.value })}
          placeholder={t.fieldKey}
          className="bg-transparent border-0 border-b border-transparent hover:border-neutral-200 focus:border-teal-400 text-xs font-mono text-neutral-800 py-1 px-0 focus:outline-none transition-colors placeholder:text-neutral-300" />
        <input type="text" value={field.label} onChange={(e) => onChange({ ...field, label: e.target.value })}
          placeholder={t.fieldLabel}
          className="bg-transparent border-0 border-b border-transparent hover:border-neutral-200 focus:border-teal-400 text-xs text-neutral-800 py-1 px-0 focus:outline-none transition-colors placeholder:text-neutral-300" />
      </div>
      <div className="flex items-center gap-3">
        <select value={field.type} onChange={(e) => onChange({ ...field, type: e.target.value as IntegrationConfigField["type"] })}
          className="bg-neutral-50 border border-neutral-200 rounded-md text-xs text-neutral-600 py-1 px-2 focus:outline-none focus:border-teal-400 cursor-pointer appearance-none">
          {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-neutral-500 cursor-pointer">
          <input type="checkbox" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} className="accent-teal-600 w-3 h-3" />
          {t.requiredField}
        </label>
        <label className="flex items-center gap-1 text-[11px] text-neutral-500 cursor-pointer">
          <input type="checkbox" checked={field.secret} onChange={(e) => onChange({ ...field, secret: e.target.checked })} className="accent-amber-500 w-3 h-3" />
          {t.secret}
        </label>
        <input type="text" value={field.helpText} onChange={(e) => onChange({ ...field, helpText: e.target.value })}
          placeholder={t.helpText}
          className="flex-1 bg-transparent border-0 border-b border-transparent hover:border-neutral-200 focus:border-teal-400 text-[11px] text-neutral-500 py-1 px-0 focus:outline-none transition-colors placeholder:text-neutral-300" />
        <button onClick={onDelete} className="p-1 text-neutral-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer" title={t.removeField}>
          <Trash2 size={13} />
        </button>
      </div>
    </motion.div>
  );
}

/* ---------- Key-Value Editor ---------- */

function KeyValueEditor({ pairs, onChange, keyPlaceholder, valuePlaceholder }: {
  pairs: Array<{ key: string; value: string }>; onChange: (p: Array<{ key: string; value: string }>) => void;
  keyPlaceholder?: string; valuePlaceholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1.5 group">
          <input type="text" value={pair.key} onChange={(e) => { const next = [...pairs]; next[i] = { ...pair, key: e.target.value }; onChange(next); }}
            placeholder={keyPlaceholder || "Key"} className="flex-1 bg-neutral-50 border border-neutral-200 rounded-md py-1 px-2 text-xs font-mono text-neutral-700 focus:outline-none focus:border-teal-400 placeholder:text-neutral-300" />
          <input type="text" value={pair.value} onChange={(e) => { const next = [...pairs]; next[i] = { ...pair, value: e.target.value }; onChange(next); }}
            placeholder={valuePlaceholder || "Value"} className="flex-1 bg-neutral-50 border border-neutral-200 rounded-md py-1 px-2 text-xs font-mono text-neutral-700 focus:outline-none focus:border-teal-400 placeholder:text-neutral-300" />
          <button onClick={() => onChange(pairs.filter((_, j) => j !== i))} className="p-0.5 text-neutral-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer">
            <X size={12} />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...pairs, { key: "", value: "" }])} className="text-[11px] text-teal-600 hover:text-teal-700 font-medium cursor-pointer">
        + Add
      </button>
    </div>
  );
}

/* ---------- HTTP Config Editor ---------- */

function HttpConfigEditor({ config, onChange, t }: {
  config: ActionDraft["httpConfig"]; onChange: (c: ActionDraft["httpConfig"]) => void;
  t: ReturnType<typeof useTranslation>["pages"]["integrations"];
}) {
  return (
    <div className="space-y-3 bg-neutral-50 border border-neutral-200 rounded-lg p-3 mt-2">
      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">{t.httpConfig}</p>

      <div className="grid grid-cols-[100px_1fr] gap-2">
        <select value={config.method} onChange={(e) => onChange({ ...config, method: e.target.value as IntegrationActionHttpConfig["method"] })}
          className="bg-white border border-neutral-200 rounded-md py-1.5 px-2 text-xs font-mono text-neutral-700 focus:outline-none focus:border-teal-400 cursor-pointer appearance-none">
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input type="text" value={config.baseUrl} onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
          placeholder="https://api.example.com" className="bg-white border border-neutral-200 rounded-md py-1.5 px-2 text-xs font-mono text-neutral-700 focus:outline-none focus:border-teal-400 placeholder:text-neutral-300" />
      </div>

      <div>
        <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.urlPath}</label>
        <input type="text" value={config.path} onChange={(e) => onChange({ ...config, path: e.target.value })}
          placeholder="/v1/resource/{{id}}" className="w-full bg-white border border-neutral-200 rounded-md py-1.5 px-2 text-xs font-mono text-neutral-700 focus:outline-none focus:border-teal-400 placeholder:text-neutral-300" />
      </div>

      <div>
        <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.headers}</label>
        <KeyValueEditor pairs={config.headers} onChange={(h) => onChange({ ...config, headers: h })} keyPlaceholder="Header name" valuePlaceholder="{{api_key}}" />
      </div>

      <div>
        <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.queryParams}</label>
        <KeyValueEditor pairs={config.queryParams} onChange={(q) => onChange({ ...config, queryParams: q })} keyPlaceholder="Param name" valuePlaceholder="{{value}}" />
      </div>

      {["POST", "PUT", "PATCH"].includes(config.method) && (
        <div>
          <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.bodyTemplate}</label>
          <textarea value={config.bodyTemplate} onChange={(e) => onChange({ ...config, bodyTemplate: e.target.value })}
            placeholder='{"key": "{{value}}"}'
            rows={4} spellCheck={false}
            className="w-full bg-white border border-neutral-200 rounded-md py-1.5 px-2 text-[11px] font-mono text-neutral-700 focus:outline-none focus:border-teal-400 resize-none placeholder:text-neutral-300"
            style={{ tabSize: 2 }} />
        </div>
      )}
    </div>
  );
}

/* ---------- Action Row ---------- */

function ActionRow({ action, index, onChange, onDelete, t }: {
  action: ActionDraft; index: number; onChange: (a: ActionDraft) => void; onDelete: () => void;
  t: ReturnType<typeof useTranslation>["pages"]["integrations"];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div custom={index} variants={itemVariants} initial="hidden" animate="visible"
      exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
      className="bg-white border border-neutral-200 rounded-lg overflow-hidden hover:border-neutral-300 transition-colors group"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 flex-1 text-left cursor-pointer min-w-0">
          <Zap size={14} className="text-teal-600 flex-shrink-0" />
          <span className="text-xs font-medium text-neutral-900 truncate">{action.actionName || "Unnamed Action"}</span>
          {action.mutates && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">{t.mutates}</span>}
          <span className="text-[11px] text-neutral-400 truncate ml-1">{action.description}</span>
        </button>
        <button onClick={onDelete} className="p-1 text-neutral-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer flex-shrink-0">
          <Trash2 size={13} />
        </button>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <button onClick={() => setExpanded(!expanded)} className="p-0.5 text-neutral-400 hover:text-neutral-600 cursor-pointer">
            <ChevronDown size={14} />
          </button>
        </motion.div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1, transition: { duration: 0.25 } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }} className="overflow-hidden">
            <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.actionName}</label>
                  <input type="text" value={action.actionName} onChange={(e) => onChange({ ...action, actionName: e.target.value })}
                    placeholder="list_items" className="w-full bg-neutral-50 border border-neutral-200 rounded-md py-1.5 px-2 text-xs font-mono text-neutral-700 focus:outline-none focus:border-teal-400 placeholder:text-neutral-300" />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 cursor-pointer pb-1.5">
                    <input type="checkbox" checked={action.mutates} onChange={(e) => onChange({ ...action, mutates: e.target.checked })} className="accent-amber-500 w-3 h-3" />
                    {t.mutates}
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.actionDescription}</label>
                <textarea value={action.description} onChange={(e) => onChange({ ...action, description: e.target.value })}
                  placeholder="Describe what this action does..." rows={2}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-md py-1.5 px-2 text-xs text-neutral-700 focus:outline-none focus:border-teal-400 resize-none placeholder:text-neutral-300" />
              </div>

              <div>
                <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">Args Schema (JSON)</label>
                <textarea value={action.argsSchema} onChange={(e) => onChange({ ...action, argsSchema: e.target.value })}
                  placeholder='{"type":"object","properties":{},"required":[]}' rows={3} spellCheck={false}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-md py-1.5 px-2 text-[11px] font-mono text-neutral-700 focus:outline-none focus:border-teal-400 resize-none placeholder:text-neutral-300"
                  style={{ tabSize: 2 }} />
              </div>

              <HttpConfigEditor config={action.httpConfig} onChange={(hc) => onChange({ ...action, httpConfig: hc })} t={t} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ---------- Test Section ---------- */

function TestSection({ configFields, actions, integrationKey, t }: {
  configFields: ConfigFieldDraft[];
  actions: ActionDraft[];
  integrationKey: string;
  t: ReturnType<typeof useTranslation>["pages"]["integrations"];
}) {
  const [testCredentials, setTestCredentials] = useState<Record<string, string>>({});
  const [selectedAction, setSelectedAction] = useState("");
  const [testArgs, setTestArgs] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<IntegrationTestResult[]>([]);
  const [showRawResult, setShowRawResult] = useState<Record<number, boolean>>({});

  const selectedActionDraft = useMemo(() => actions.find((a) => a.actionName === selectedAction), [actions, selectedAction]);

  const argProperties = useMemo(() => {
    if (!selectedActionDraft?.argsSchema) return {};
    try {
      const schema = JSON.parse(selectedActionDraft.argsSchema) as { properties?: Record<string, { type?: string; description?: string }> };
      return schema.properties || {};
    } catch { return {}; }
  }, [selectedActionDraft]);

  const requiredArgs = useMemo(() => {
    if (!selectedActionDraft?.argsSchema) return [] as string[];
    try {
      const schema = JSON.parse(selectedActionDraft.argsSchema) as { required?: string[] };
      return schema.required || [];
    } catch { return [] as string[]; }
  }, [selectedActionDraft]);

  const { saveIntegrationPackage, loadIntegrationPackage } = useIntegrationsStore();

  const handleRunTest = useCallback(async () => {
    if (!selectedAction || !integrationKey) return;
    setIsTesting(true);

    try {
      // Load to get a session ID for testing
      const loadResult = await loadIntegrationPackage(integrationKey);
      const builderSessionId = loadResult.sessionId;
      if (!loadResult.success || !builderSessionId) {
        setTestResults((prev) => [{ actionKey: selectedAction, success: false, error: "Failed to load integration for testing. Save first.", timestamp: new Date().toISOString() }, ...prev]);
        setIsTesting(false);
        return;
      }

      const parsedArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(testArgs)) {
        if (!value) continue;
        try { parsedArgs[key] = JSON.parse(value); } catch { parsedArgs[key] = value; }
      }

      const res = await tryCall(() => api.integrationBuilder.test({
        builderSessionId,
        actionKey: selectedAction,
        testCredentials,
        testInput: parsedArgs,
      }));
      if (res.ok) {
        setTestResults((prev) => [{ ...res.data, timestamp: new Date().toISOString() }, ...prev]);
      } else {
        setTestResults((prev) => [{ actionKey: selectedAction, success: false, error: res.error.message || "Test failed", timestamp: new Date().toISOString() }, ...prev]);
      }
    } catch (err) {
      setTestResults((prev) => [{ actionKey: selectedAction, success: false, error: err instanceof Error ? err.message : "Test failed", timestamp: new Date().toISOString() }, ...prev]);
    } finally {
      setIsTesting(false);
    }
  }, [selectedAction, integrationKey, testCredentials, testArgs, loadIntegrationPackage]);

  if (configFields.length === 0 && actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-8">
        <p className="text-sm text-neutral-500 font-medium">{t.testing}</p>
        <p className="text-xs text-neutral-400 mt-1">Add config fields and actions first to enable testing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Credentials */}
      <div>
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">{t.yourCredentials}</p>
        <p className="text-xs text-neutral-400 mb-3">{t.credentialsHint}</p>
        <div className="space-y-3">
          {configFields.map((field) => (
            <div key={field.id}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 mb-1">
                {field.label || field.key}
                {field.required && <span className="text-red-500">*</span>}
              </label>
              {field.helpText && <p className="text-[11px] text-neutral-400 mb-1.5">{field.helpText}</p>}
              <div className="relative">
                <input
                  type={field.secret && !showSecrets[field.key] ? "password" : "text"}
                  value={testCredentials[field.key] || ""}
                  onChange={(e) => setTestCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={`Enter ${(field.label || field.key).toLowerCase()}...`}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 pr-8" />
                {field.secret && (
                  <button onClick={() => setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-neutral-600 cursor-pointer">
                    {showSecrets[field.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <hr className="border-neutral-200" />

      {/* Try an Action */}
      <div>
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">{t.tryAnAction}</p>
        {!integrationKey && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg mb-3">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{t.autoSaveHint}</p>
          </div>
        )}
        <select value={selectedAction} onChange={(e) => { setSelectedAction(e.target.value); setTestArgs({}); }}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 mb-2 cursor-pointer">
          <option value="">{t.chooseAction}</option>
          {actions.map((a) => <option key={a.id} value={a.actionName}>{humanizeActionName(a.actionName)}</option>)}
        </select>

        {selectedActionDraft && <p className="text-xs text-neutral-500 mb-3">{selectedActionDraft.description}</p>}

        {selectedAction && Object.keys(argProperties).length > 0 && (
          <div className="space-y-3 mb-4">
            <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 space-y-3">
              {Object.entries(argProperties).map(([key, schema]) => {
                const isRequired = requiredArgs.includes(key);
                return (
                  <div key={key}>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 mb-1">
                      {humanizeArgKey(key)}
                      {isRequired ? <span className="text-red-500">*</span> : <span className="text-neutral-400 font-normal">(optional)</span>}
                    </label>
                    {schema.description && <p className="text-[11px] text-neutral-400 mb-1.5">{schema.description}</p>}
                    <input type="text" value={testArgs[key] || ""} onChange={(e) => setTestArgs((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={schema.type === "number" ? "e.g. 10" : schema.type === "boolean" ? "true or false" : `Enter ${humanizeArgKey(key).toLowerCase()}...`}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Button
          variant="primary"
          className="w-full justify-center"
          icon={isTesting ? undefined : Play}
          loading={isTesting}
          disabled={!selectedAction}
          onClick={handleRunTest}
        >
          {isTesting ? t.testingAction : t.runTest}
        </Button>
      </div>

      {/* Results */}
      {testResults.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">{t.testResults}</p>
          <div className="space-y-2">
            {testResults.map((result, i) => (
              <div key={i} className={`border rounded-lg overflow-hidden ${result.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                <div className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    {result.success ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium text-neutral-800">{humanizeActionName(result.actionKey)}</span>
                        <span className="text-[10px] text-neutral-400 shrink-0 ml-2">{new Date(result.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className={`text-xs leading-relaxed ${result.success ? "text-green-700" : "text-red-700"}`}>
                        {result.success ? t.testSuccess : result.error || t.testFailed}
                      </p>
                    </div>
                  </div>
                  {(result.response != null || result.error) && (
                    <div className="mt-2 ml-6">
                      <button onClick={() => setShowRawResult((prev) => ({ ...prev, [i]: !prev[i] }))}
                        className={`text-[11px] font-medium cursor-pointer ${result.success ? "text-green-600 hover:text-green-700" : "text-red-500 hover:text-red-600"}`}>
                        {showRawResult[i] ? t.hideDetails : t.showDetails}
                      </button>
                      <AnimatePresence>
                        {showRawResult[i] && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <pre className="mt-1.5 bg-white/70 rounded p-2 text-[11px] font-mono text-neutral-600 overflow-x-auto max-h-48 border border-neutral-200/60">
                              {result.error && !result.response ? result.error : JSON.stringify(result.response, null, 2)}
                            </pre>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================
   MAIN DIALOG
   ============================================ */

export function IntegrationDialog({ mode, integrationKey: editKey, importedData, onClose, onSaved }: IntegrationDialogProps) {
  const { pages, common } = useTranslation();
  const t = pages.integrations;
  const { saveIntegrationPackage, loadIntegrationPackage, deleteSkill } = useIntegrationsStore();

  // Form state
  const [integrationKey, setIntegrationKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("");
  const [category, setCategory] = useState("");
  const [authType, setAuthType] = useState<(typeof AUTH_TYPES)[number]>("api_key");
  const [skillMd, setSkillMd] = useState("");
  const [configFields, setConfigFields] = useState<ConfigFieldDraft[]>([]);
  const [actions, setActions] = useState<ActionDraft[]>([]);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [skillCopied, setSkillCopied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  // Load existing integration in edit mode
  useEffect(() => {
    if (mode === "edit" && editKey) {
      setIsLoading(true);
      loadIntegrationPackage(editKey).then((result) => {
        if (result.success && result.data) {
          const pkg = result.data;
          const cfg = pkg.config;
          setIntegrationKey(cfg.integrationKey || editKey);
          setDisplayName(cfg.displayName || "");
          setDescription(cfg.description || "");
          setProvider(cfg.provider || "");
          setCategory(cfg.category || "");
          setAuthType(cfg.authType || "api_key");
          setSkillMd(pkg.skillMd || "");
          setConfigFields((cfg.configSchema || []).map(configFieldToDraft));
          setActions((cfg.actions || []).map(actionToActionDraft));
        }
        setIsLoading(false);
      });
    } else if (mode === "create" && importedData) {
      // Pre-populate from imported data
      const cfg = importedData.config;
      setIntegrationKey(cfg.integrationKey || "");
      setDisplayName(cfg.displayName || "");
      setDescription(cfg.description || "");
      setProvider(cfg.provider || "");
      setCategory(cfg.category || "");
      setAuthType(cfg.authType || "api_key");
      setSkillMd(importedData.skillMd || "");
      setConfigFields((cfg.configSchema || []).map(configFieldToDraft));
      setActions((cfg.actions || []).map(actionToActionDraft));
    } else if (mode === "create") {
      setSkillMd(makeSkillSkeleton("", "", "api_key"));
    }
  }, [mode, editKey, importedData, loadIntegrationPackage]);

  // Update skill skeleton when identity changes (only in create mode with untouched skeleton)
  const initialSkillRef = useRef(true);
  useEffect(() => {
    if (mode === "create" && initialSkillRef.current && !importedData) {
      setSkillMd(makeSkillSkeleton(displayName, description, authType));
    }
  }, [displayName, description, authType, mode, importedData]);

  const handleSave = useCallback(async () => {
    if (!integrationKey.trim() || !displayName.trim()) return;
    initialSkillRef.current = false;
    setIsSaving(true);

    const pkg: IntegrationBuilderOutput = {
      skillMd,
      config: {
        version: "2.0",
        skillType: "integration",
        integrationKey: integrationKey.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        authType,
        provider: provider.trim(),
        category: category.trim(),
        configSchema: configFieldsToSchema(configFields),
        actions: actionDraftsToActions(actions),
        proxyContract: {
          executeEndpoint: "/api/v1/integration/execute",
          requiredInputs: ["integrationKey"],
        },
      },
    };

    const result = await saveIntegrationPackage(pkg);
    setIsSaving(false);
    if (result.success) {
      toast.success(t.saved);
      onSaved?.();
    } else {
      toast.error(result.error || t.saveFailed);
    }
  }, [integrationKey, displayName, description, authType, provider, category, skillMd, configFields, actions, saveIntegrationPackage, onSaved, t.saveFailed, t.saved]);

  const handleDelete = useCallback(async () => {
    if (!editKey) return;
    const ok = await confirm({
      title: t.deleteIntegration,
      description: `${t.deleteConfirmation(displayName || editKey)} ${t.cannotBeUndone}`,
      confirmLabel: common.delete,
      tone: "danger",
    });
    if (!ok) return;
    setIsDeleting(true);
    const result = await deleteSkill(editKey);
    setIsDeleting(false);
    if (result.success) {
      onSaved?.();
      onClose();
    } else {
      toast.error(t.saveFailed);
    }
  }, [editKey, deleteSkill, onSaved, onClose, confirm, t, common, displayName]);

  const handleExport = useCallback(() => {
    const pkg: IntegrationBuilderOutput = {
      skillMd,
      config: {
        version: "2.0",
        skillType: "integration",
        integrationKey: integrationKey.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        authType,
        provider: provider.trim(),
        category: category.trim(),
        configSchema: configFieldsToSchema(configFields),
        actions: actionDraftsToActions(actions),
      } as IntegrationBuilderConfig,
    };
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${integrationKey || "integration"}.integration.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [integrationKey, displayName, description, authType, provider, category, skillMd, configFields, actions]);

  const handleCopySkill = useCallback(() => {
    void copyToClipboard(skillMd);
    setSkillCopied(true);
    setTimeout(() => setSkillCopied(false), 2000);
  }, [skillMd]);

  const addConfigField = useCallback(() => {
    setConfigFields((prev) => [...prev, { id: uid(), key: "", label: "", type: "string", required: false, secret: false, helpText: "" }]);
  }, []);

  const addAction = useCallback(() => {
    setActions((prev) => [...prev, {
      id: uid(), actionName: "", description: "", mutates: false,
      argsSchema: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
      returnSchema: "{}",
      httpConfig: { method: "GET", baseUrl: "", path: "", headers: [], queryParams: [], bodyTemplate: "" },
    }]);
  }, []);

  const canSave = integrationKey.trim().length > 0 && displayName.trim().length > 0;

  if (isLoading) {
    return (
      <motion.div variants={overlayVariants} initial="hidden" animate="visible" exit="exit"
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center">
        <Spinner size="md" className="text-teal-600" />
      </motion.div>
    );
  }

  return (
    <motion.div variants={overlayVariants} initial="hidden" animate="visible" exit="exit"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex justify-end">
      <motion.div variants={panelVariants} initial="hidden" animate="visible" exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex-shrink-0">
          <div className="h-[2px] bg-gradient-to-r from-teal-400 via-teal-500 to-emerald-400" />
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-50 to-teal-100 flex items-center justify-center">
                <Plug size={18} className="text-teal-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-neutral-900">
                  {mode === "create" ? t.newIntegration : t.editIntegration}
                </h2>
                {mode === "edit" && editKey && (
                  <p className="text-xs text-neutral-400 font-mono">{editKey}</p>
                )}
              </div>
            </div>
            <IconButton icon={X} label={common.close} variant="ghost" onClick={onClose} />
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-light px-6 py-5 space-y-8">

          {/* Identity Section */}
          <div>
            <SectionHeader icon={Plug} title={t.identity} subtitle={t.identityHint} />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.integrationKey}</label>
                  <input type="text" value={integrationKey} onChange={(e) => setIntegrationKey(e.target.value)}
                    disabled={mode === "edit"} placeholder="google-analytics"
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-2 px-3 text-sm font-mono text-neutral-800 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500/20 transition-colors placeholder:text-neutral-300 disabled:opacity-60 disabled:cursor-not-allowed" />
                  <p className="text-[10px] text-neutral-400 mt-0.5">{t.integrationKeyHint}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.displayName}</label>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Google Analytics"
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-2 px-3 text-sm text-neutral-800 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500/20 transition-colors placeholder:text-neutral-300" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.description}</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Connects to Google Analytics to retrieve website traffic data..."
                  rows={2} className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-2 px-3 text-sm text-neutral-800 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500/20 transition-colors resize-none placeholder:text-neutral-300" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.provider}</label>
                  <input type="text" value={provider} onChange={(e) => setProvider(e.target.value)}
                    placeholder="Google"
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-2 px-3 text-sm text-neutral-800 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500/20 transition-colors placeholder:text-neutral-300" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.category}</label>
                  <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                    placeholder="Analytics"
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-2 px-3 text-sm text-neutral-800 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500/20 transition-colors placeholder:text-neutral-300" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">{t.authType}</label>
                  <select value={authType} onChange={(e) => setAuthType(e.target.value as (typeof AUTH_TYPES)[number])}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-2 px-3 text-sm text-neutral-800 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500/20 transition-colors cursor-pointer appearance-none">
                    {AUTH_TYPES.map((at) => (
                      <option key={at} value={at}>
                        {at === "api_key" ? t.authTypeApiKey : at === "oauth2" ? t.authTypeOAuth : at === "service_account" ? t.authTypeServiceAccount : t.authTypeNoAuth}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Config Fields Section */}
          <div>
            <SectionHeader icon={Key} title={t.configFields} subtitle={t.configFieldsHint} count={configFields.length}
              action={<button onClick={addConfigField} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors cursor-pointer"><Plus size={12} />{t.addField}</button>} />
            {configFields.length === 0 ? (
              <p className="text-xs text-neutral-400 ml-11">{t.noConfigFields}</p>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {configFields.map((f, i) => (
                    <ConfigFieldRow key={f.id} field={f} index={i} t={t}
                      onChange={(updated) => setConfigFields((prev) => prev.map((p) => p.id === f.id ? updated : p))}
                      onDelete={() => setConfigFields((prev) => prev.filter((p) => p.id !== f.id))} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Skill File Section */}
          <div>
            <SectionHeader icon={FileText} title={t.skillFile} subtitle={t.skillFileHint}
              action={<button onClick={handleCopySkill} className="flex items-center gap-1 px-2 py-1 text-[11px] text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors cursor-pointer">
                {skillCopied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                {skillCopied ? common.copied : common.copy}
              </button>} />
            <textarea value={skillMd} onChange={(e) => { initialSkillRef.current = false; setSkillMd(e.target.value); }}
              spellCheck={false} rows={12}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-lg py-3 px-4 text-xs font-mono text-neutral-700 leading-relaxed focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500/20 transition-colors resize-y min-h-[200px]"
              style={{ tabSize: 2 }} />
          </div>

          {/* Actions Section */}
          <div>
            <SectionHeader icon={Zap} title={t.actions} subtitle={t.actionsHint} count={actions.length}
              action={<button onClick={addAction} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors cursor-pointer"><Plus size={12} />{t.addAction}</button>} />
            {actions.length === 0 ? (
              <p className="text-xs text-neutral-400 ml-11">{t.noActions}</p>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {actions.map((a, i) => (
                    <ActionRow key={a.id} action={a} index={i} t={t}
                      onChange={(updated) => setActions((prev) => prev.map((p) => p.id === a.id ? updated : p))}
                      onDelete={() => setActions((prev) => prev.filter((p) => p.id !== a.id))} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Test Section */}
          <div>
            <SectionHeader icon={FlaskConical} title={t.testing} subtitle={t.testingHint} />
            <TestSection configFields={configFields} actions={actions} integrationKey={integrationKey} t={t} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-neutral-100 bg-neutral-50/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {mode === "edit" && (
                <>
                  <Button variant="secondary" size="sm" icon={Download} onClick={handleExport}>
                    {t.exportIntegration}
                  </Button>
                  <Button variant="danger-ghost" size="sm" icon={Trash2} loading={isDeleting} onClick={handleDelete}>
                    {common.delete}
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={isSaving} onClick={onClose}>
                {common.cancel}
              </Button>
              <Button variant="primary" loading={isSaving} disabled={!canSave} onClick={handleSave}>
                {isSaving ? t.saving : common.save}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
