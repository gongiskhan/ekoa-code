'use client';

/**
 * PipedreamSection — the "Ligar a milhares de aplicações" card (kept as
 * PipedreamSection for import stability). It renders as ONE modest card among
 * the platform integrations grid:
 *
 *   - COLLAPSED (default): a compact card with a teaser naming a few famous
 *     apps + a few monogram chips + an "Explorar" button. It sits in a single
 *     grid cell alongside the Google/Microsoft OAuth cards and the versioned
 *     skill cards.
 *   - EXPANDED: the card grows to span the full grid width and reveals the
 *     searchable app catalog (the popular-apps tiles) AND the Pipedream network
 *     config (master toggle → project-key form → connected accounts). There is
 *     no separate "Definições da rede" gear anymore; expanding the card is the
 *     single disclosure.
 *
 * Config states (all testids preserved for e2e):
 *   - OFF          → short explainer
 *   - ON + pending → inline project-key form (client_id / client_secret / project_id / environment)
 *   - ON + ready   → project summary (Alterar / Remover) + connected-account list
 *
 * Secrets are write-only: the status intent never returns them, and "Alterar"
 * re-opens an EMPTY form rather than echoing stored values.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Network,
  Plug2,
  ExternalLink,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  Settings2,
  AlertCircle,
  Search,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { usePipedreamStore, type PipedreamConfigInput } from '@/stores/pipedream';
import { useTranslation } from '@/stores/i18n';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/stores/toast';

const INPUT_CLASS =
  'w-full bg-neutral-50 border border-neutral-200 rounded-md py-1.5 px-2.5 text-xs text-neutral-800 placeholder-neutral-400 focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-1 focus-visible:ring-teal-500/20 transition-colors';

const EMPTY_FORM: PipedreamConfigInput = {
  clientId: '',
  clientSecret: '',
  projectId: '',
  environment: 'production',
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

/**
 * A curated set of the most-requested apps, representative of the thousands
 * reachable through the network. Search filters this set today; once the
 * network is configured, "Ligar" opens the live connect flow for any of them.
 * Monogram tiles (no external logos) keep the surface asset-free and on-brand.
 */
const POPULAR_APPS: Array<{ slug: string; name: string; category: string }> = [
  { slug: 'notion', name: 'Notion', category: 'Produtividade' },
  { slug: 'slack', name: 'Slack', category: 'Comunicação' },
  { slug: 'airtable', name: 'Airtable', category: 'Bases de dados' },
  { slug: 'google_sheets', name: 'Google Sheets', category: 'Folhas de cálculo' },
  { slug: 'hubspot', name: 'HubSpot', category: 'CRM' },
  { slug: 'salesforce', name: 'Salesforce', category: 'CRM' },
  { slug: 'trello', name: 'Trello', category: 'Gestão de tarefas' },
  { slug: 'github', name: 'GitHub', category: 'Programação' },
  { slug: 'gmail', name: 'Gmail', category: 'Email' },
  { slug: 'google_calendar', name: 'Google Calendar', category: 'Calendário' },
  { slug: 'discord', name: 'Discord', category: 'Comunicação' },
  { slug: 'zoom', name: 'Zoom', category: 'Videochamada' },
  { slug: 'asana', name: 'Asana', category: 'Gestão de tarefas' },
  { slug: 'jira', name: 'Jira', category: 'Programação' },
  { slug: 'mailchimp', name: 'Mailchimp', category: 'Marketing' },
  { slug: 'shopify', name: 'Shopify', category: 'Comércio' },
  { slug: 'typeform', name: 'Typeform', category: 'Formulários' },
  { slug: 'calendly', name: 'Calendly', category: 'Marcações' },
  { slug: 'dropbox', name: 'Dropbox', category: 'Ficheiros' },
  { slug: 'zendesk', name: 'Zendesk', category: 'Apoio ao cliente' },
  { slug: 'intercom', name: 'Intercom', category: 'Apoio ao cliente' },
  { slug: 'twilio', name: 'Twilio', category: 'SMS e voz' },
  { slug: 'clickup', name: 'ClickUp', category: 'Gestão de tarefas' },
  { slug: 'monday', name: 'monday.com', category: 'Gestão de tarefas' },
  { slug: 'linear', name: 'Linear', category: 'Programação' },
  { slug: 'quickbooks', name: 'QuickBooks', category: 'Contabilidade' },
  { slug: 'xero', name: 'Xero', category: 'Contabilidade' },
  { slug: 'docusign', name: 'DocuSign', category: 'Assinaturas' },
  { slug: 'sendgrid', name: 'SendGrid', category: 'Email' },
  { slug: 'pipedrive', name: 'Pipedrive', category: 'CRM' },
];

const TILE_COLORS = [
  'bg-rose-50 text-rose-600',
  'bg-amber-50 text-amber-600',
  'bg-emerald-50 text-emerald-600',
  'bg-sky-50 text-sky-600',
  'bg-violet-50 text-violet-600',
  'bg-teal-50 text-teal-600',
  'bg-indigo-50 text-indigo-600',
  'bg-orange-50 text-orange-600',
];
function tileColor(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i += 1) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}
function monogram(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// The handful of famous apps teased on the collapsed card.
const TEASER_APPS = POPULAR_APPS.slice(0, 6);

export function PipedreamSection() {
  const { pages } = useTranslation();
  const t = pages.pipedream;
  const confirm = useConfirm();

  const status = usePipedreamStore((s) => s.status);
  const accounts = usePipedreamStore((s) => s.accounts);
  const isSaving = usePipedreamStore((s) => s.isSaving);
  const fetchStatus = usePipedreamStore((s) => s.fetchStatus);
  const fetchAccounts = usePipedreamStore((s) => s.fetchAccounts);
  const setEnabled = usePipedreamStore((s) => s.setEnabled);
  const configure = usePipedreamStore((s) => s.configure);
  const removeConfig = usePipedreamStore((s) => s.removeConfig);
  const getConnectToken = usePipedreamStore((s) => s.getConnectToken);
  const disconnectAccount = usePipedreamStore((s) => s.disconnectAccount);

  const [expanded, setExpanded] = useState(false);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [form, setForm] = useState<PipedreamConfigInput>(EMPTY_FORM);
  const [secretVisible, setSecretVisible] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const configured = status?.configured ?? false;
  const enabled = status?.enabled ?? false;
  const live = configured && enabled;

  useEffect(() => {
    if (live) fetchAccounts();
  }, [live, fetchAccounts]);

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return POPULAR_APPS;
    return POPULAR_APPS.filter(
      (a) => a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q),
    );
  }, [query]);

  async function handleToggle(next: boolean) {
    const res = await setEnabled(next);
    if (!res.success) toast.error(res.error || 'Falha ao guardar a definição');
  }

  function openConfigForm() {
    setForm(EMPTY_FORM);
    setSecretVisible(false);
    setConfigError(null);
    setShowConfigForm(true);
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setConfigError(null);
    if (!form.clientId.trim() || !form.clientSecret.trim() || !form.projectId.trim()) {
      setConfigError(t.configRequired);
      return;
    }
    const res = await configure(form);
    if (res.success) {
      setShowConfigForm(false);
      setForm(EMPTY_FORM);
      toast.success(t.configSaved);
    } else {
      setConfigError(res.error || t.configSaveFailed);
    }
  }

  async function handleRemoveConfig() {
    const ok = await confirm({
      title: t.removeConfigTitle,
      description: t.removeConfigConfirm,
      confirmLabel: t.removeConfig,
      tone: 'danger',
    });
    if (!ok) return;
    const res = await removeConfig();
    if (res.success) toast.success(t.configRemoved);
    else toast.error(res.error || t.configSaveFailed);
  }

  async function connectApp(appName: string) {
    if (!live) {
      toast.error(t.configureFirst);
      return;
    }
    const res = await getConnectToken();
    if (res.success && res.connectLinkUrl) {
      window.open(res.connectLinkUrl, '_blank', 'noopener,noreferrer');
    } else {
      toast.error(res.error || `${t.connectApp} ${appName}: falhou`);
    }
  }

  async function handleDisconnect(accountId: string, label: string) {
    const ok = await confirm({
      title: t.disconnectConfirmTitle,
      description: `${t.disconnectConfirmBody} ${label}?`,
      confirmLabel: t.disconnect,
      tone: 'danger',
    });
    if (!ok) return;
    const res = await disconnectAccount(accountId);
    if (!res.success) toast.error(res.error || 'Falha ao desligar');
  }

  function renderConfigForm() {
    return (
      <form onSubmit={handleSaveConfig} className="mt-3 space-y-3" data-testid="pipedream-config-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-neutral-600">{t.clientIdLabel}</span>
            <input
              className={INPUT_CLASS}
              value={form.clientId}
              onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              placeholder="oauth_client_id"
              data-testid="pipedream-client-id"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="text-xs text-neutral-600">{t.clientSecretLabel}</span>
            <div className="relative">
              <input
                className={INPUT_CLASS + ' pr-8'}
                type={secretVisible ? 'text' : 'password'}
                value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                placeholder="••••••••"
                data-testid="pipedream-client-secret"
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                onClick={() => setSecretVisible((v) => !v)}
                aria-label={secretVisible ? t.hideSecret : t.showSecret}
              >
                {secretVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-neutral-600">{t.projectIdLabel}</span>
            <input
              className={INPUT_CLASS}
              value={form.projectId}
              onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
              placeholder="proj_xxxxxxxx"
              data-testid="pipedream-project-id"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="text-xs text-neutral-600">{t.environmentLabel}</span>
            <select
              className={INPUT_CLASS}
              value={form.environment}
              onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value as 'development' | 'production' }))}
              data-testid="pipedream-environment"
            >
              <option value="production">production</option>
              <option value="development">development</option>
            </select>
          </label>
        </div>
        {configError && (
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{configError}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm" loading={isSaving} data-testid="pipedream-config-save">
            {t.saveConfig}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowConfigForm(false)}>
            {t.cancel}
          </Button>
        </div>
      </form>
    );
  }

  /* ===== Collapsed: one modest card in the platform grid ===== */
  if (!expanded) {
    return (
      <motion.div
        variants={cardVariants}
        data-testid="pipedream-section"
        className="w-full bg-white border border-neutral-200 rounded-xl overflow-hidden hover:border-neutral-300 hover:shadow-sm transition-all flex flex-col"
      >
        <div className="h-[2px] bg-gradient-to-r from-violet-400 via-teal-400 to-emerald-400" />
        <div className="p-4 flex flex-col flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex-shrink-0">
              <Network size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-neutral-800 truncate">{t.cardTitle}</h3>
              <p className="text-[11px] text-neutral-400 mt-0.5 truncate">{t.cardBadge}</p>
            </div>
          </div>

          <p className="text-xs text-neutral-500 leading-relaxed mb-3 line-clamp-3">{t.cardTeaser}</p>

          {/* Monogram chips of a few famous apps */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {TEASER_APPS.map((app) => (
              <span
                key={app.slug}
                className={`flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold ${tileColor(app.slug)}`}
                title={app.name}
              >
                {monogram(app.name)}
              </span>
            ))}
            <span className="flex h-6 items-center rounded-md bg-neutral-100 px-1.5 text-[10px] font-medium text-neutral-500">
              +1000
            </span>
          </div>

          <div className="flex-1" />

          <div className="pt-3 mt-2 border-t border-neutral-100 flex items-center justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded(true)}
              data-testid="pipedream-expand"
            >
              {t.explore}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  /* ===== Expanded: full-width panel with catalog + network config ===== */
  return (
    <motion.div
      variants={cardVariants}
      data-testid="pipedream-section"
      className="col-span-full bg-white border border-neutral-200 rounded-xl overflow-hidden"
    >
      <div className="h-[2px] bg-gradient-to-r from-violet-400 via-teal-400 to-emerald-400" />
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex-shrink-0">
              <Network size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-neutral-900" data-testid="app-network-title">
                {t.catalogTitle}
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">{t.catalogSubtitle}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronUp}
            onClick={() => setExpanded(false)}
            data-testid="pipedream-collapse"
          >
            {t.collapse}
          </Button>
        </div>

        {/* Search over the app catalog */}
        <div className="relative mt-4 max-w-md">
          <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            className="w-full bg-white border border-neutral-200 rounded-lg py-2 pl-9 pr-3 text-sm text-neutral-800 placeholder-neutral-400 focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/15"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            data-testid="app-network-search"
            aria-label={t.searchPlaceholder}
          />
        </div>

        {/* App tiles */}
        {filteredApps.length === 0 ? (
          <p className="text-xs text-neutral-500 mt-4" data-testid="app-network-empty">
            {t.searchEmpty}
          </p>
        ) : (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mt-4"
            data-testid="app-network-grid"
          >
            {filteredApps.map((app) => (
              <button
                key={app.slug}
                type="button"
                onClick={() => connectApp(app.name)}
                className="group flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-left hover:border-teal-300 hover:shadow-sm transition-all"
                data-testid="app-network-tile"
                data-app={app.slug}
                title={`${t.connectApp} ${app.name}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${tileColor(app.slug)}`}>
                  {monogram(app.name)}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-neutral-800 truncate">{app.name}</span>
                  <span className="block text-[10px] text-neutral-400 truncate">{app.category}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="text-[11px] text-neutral-400 mt-4">{t.poweredBy}</p>

        {/* ===== Network config (Pipedream Connect plumbing) ===== */}
        <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4" data-testid="pipedream-settings-panel">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="rounded-md bg-neutral-100 p-1.5 shrink-0">
                <Network className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-neutral-700">{t.enableLabel}</div>
                <div className="text-[11px] text-neutral-500 mt-0.5">{t.nativeFirstNote}</div>
              </div>
            </div>
            <Switch
              checked={enabled}
              onChange={handleToggle}
              disabled={isSaving}
              data-testid="pipedream-toggle"
              aria-label={t.enableLabel}
            />
          </div>

          {!enabled ? (
            <p
              className="text-[11px] text-neutral-500 leading-relaxed mt-3 border-t border-neutral-200/70 pt-3"
              data-testid="pipedream-disabled-explainer"
            >
              {t.disabledExplainer}
            </p>
          ) : !configured ? (
            <div data-testid="pipedream-pending" className="mt-3 border-t border-neutral-200/70 pt-3">
              {showConfigForm ? (
                renderConfigForm()
              ) : (
                <div>
                  <Badge tone="warning">{t.pendingConfig}</Badge>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mt-2 mb-3">{t.configHint}</p>
                  <Button variant="primary" size="sm" icon={Settings2} onClick={openConfigForm} data-testid="pipedream-config-open">
                    {t.configureProject}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 border-t border-neutral-200/70 pt-3" data-testid="pipedream-connected">
              {showConfigForm ? (
                renderConfigForm()
              ) : (
                <>
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 mb-3"
                    data-testid="pipedream-config-summary"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ShieldCheck className="h-4 w-4 text-teal-500 shrink-0" aria-hidden />
                      <span className="text-xs text-neutral-700">{t.configuredSummary}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={openConfigForm} data-testid="pipedream-config-change">
                        {t.changeConfig}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={handleRemoveConfig}
                        data-testid="pipedream-config-remove"
                      >
                        {t.removeConfig}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t.connectedTitle}</div>
                    <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => connectApp('')} data-testid="pipedream-connect">
                      {t.connectService}
                    </Button>
                  </div>
                  {accounts.length === 0 ? (
                    <p className="text-[11px] text-neutral-500">{t.noAccounts}</p>
                  ) : (
                    <ul className="space-y-2">
                      {accounts.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Plug2 className="h-4 w-4 text-neutral-400 shrink-0" aria-hidden />
                            <span className="text-sm text-neutral-800 truncate">{a.name || a.app}</span>
                            {a.app && a.name && <span className="text-xs text-neutral-400 truncate">{a.app}</span>}
                          </div>
                          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDisconnect(a.id, a.name || a.app)}>
                            {t.disconnect}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
