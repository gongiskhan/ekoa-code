"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Plus, Plug, Trash2 } from 'lucide-react';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';
import AutomationEmptyState from '@/components/automations/automation-empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/ui/spinner';

export default function AutomationsListPage() {
  const automations = useAutomationsStore((s) => s.automations);
  const loading = useAutomationsStore((s) => s.loading);
  const fetchAutomations = useAutomationsStore((s) => s.fetchAutomations);
  const remove = useAutomationsStore((s) => s.remove);
  const router = useRouter();
  const confirm = useConfirm();
  const { automations: tr } = useTranslation();
  const t = tr.list;

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  if (loading && automations.length === 0) {
    return (
      <PageShell testId="automations-page">
        <LoadingState label={t.loading} />
      </PageShell>
    );
  }

  if (automations.length === 0) {
    return (
      <PageShell testId="automations-page">
        <PageHeader icon={Play} title={t.title} />
        <AutomationEmptyState />
      </PageShell>
    );
  }

  return (
    <PageShell testId="automations-page">
      <PageHeader
        icon={Play}
        title={t.title}
        description={t.total(automations.length)}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => router.push('/automations/new')}>
            {t.newAutomation}
          </Button>
        }
      />

      <div className="space-y-2">
        {automations.map((a) => (
          <Card
            key={a.id}
            padding="none"
            hover
            className="flex cursor-pointer items-center gap-4 px-5 py-4"
            onClick={() => router.push(`/automations/${a.id}`)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-neutral-900">{a.name}</div>
              <div className="mt-0.5 truncate text-xs text-neutral-500">
                {a.description || t.noDescription}
              </div>
            </div>
            {a.source && (
              <Badge tone="neutral" className="hidden sm:inline-flex" data-testid="automation-managed-chip">
                <Plug size={10} className="text-neutral-400" />
                {t.managedBy(a.source.integrationKey)}
              </Badge>
            )}
            <Badge tone="neutral">{t.stepCount(a.steps.length)}</Badge>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                icon={Play}
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/automations/${a.id}`);
                }}
              >
                {t.open}
              </Button>
              <IconButton
                icon={Trash2}
                label={t.deleteAria}
                size="sm"
                variant="danger-ghost"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (await confirm({ title: t.deleteConfirm(a.name), tone: 'danger' })) remove(a.id);
                }}
              />
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
