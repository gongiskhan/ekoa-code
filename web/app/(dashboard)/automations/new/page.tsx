"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Play, Plug2 } from 'lucide-react';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';
import type { Translations } from '@/locales/types';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

export default function AutomationsNewPage() {
  const planFromGoal = useAutomationsStore((s) => s.planFromGoal);
  const router = useRouter();
  const { automations } = useTranslation();
  const t = automations.newPage;
  const [goal, setGoal] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [awaiting, setAwaiting] = useState<{ service: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loading) {
      setElapsedMs(0);
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = Date.now();
    const id = setInterval(() => {
      if (startedAtRef.current != null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
    }, 250);
    return () => clearInterval(id);
  }, [loading]);

  const submit = async () => {
    setLoading(true);
    setAwaiting(null);
    setError(null);
    const res = await planFromGoal(goal.trim(), name.trim() || undefined);
    setLoading(false);
    if (res.ok && res.automation) {
      // Backend already kicked off the rehearsal; the editor's live-run
      // hook will pick up the SSE events as it mounts.
      router.push(`/automations/${res.automation.id}`);
    } else if (res.awaiting) {
      setAwaiting(res.awaiting);
    } else {
      setError(res.error ?? t.somethingWrong);
    }
  };

  const elapsedLabel = formatElapsed(elapsedMs);
  const hint = pickHint(elapsedMs, t);

  return (
    <PageShell testId="automations-new-page">
      <PageHeader icon={Play} title={t.title} description={t.subtitle} />

      <div className="max-w-2xl space-y-5">
        <Textarea
          label={t.goalLabel}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={t.goalPlaceholder}
          className="min-h-[120px]"
        />

        <Input
          label={t.nameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.namePlaceholder}
        />

        {loading && (
          <Card className="bg-teal-50/60 border-teal-200">
            <div className="flex items-center gap-2 text-sm text-teal-900">
              <Spinner size="sm" className="text-teal-700" />
              <span className="font-medium">{t.drafting}</span>
              <span className="ml-auto font-mono text-xs text-teal-700">{elapsedLabel}</span>
            </div>
            <p className="mt-2 text-xs text-teal-800">{hint}</p>
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-teal-100">
              <div className="h-full w-full animate-pulse rounded-full bg-teal-400" />
            </div>
          </Card>
        )}

        {awaiting && (
          <Card className="bg-amber-50/60 border-amber-200">
            <p className="text-sm font-semibold text-amber-900">{t.connectFirst(awaiting.service)}</p>
            <p className="mt-1 text-xs text-amber-800">{awaiting.reason}</p>
            <Button
              variant="secondary"
              size="sm"
              icon={Plug2}
              className="mt-3"
              onClick={() => router.push('/integrations')}
            >
              {t.openIntegrations}
            </Button>
          </Card>
        )}

        {error && (
          <Card className="bg-red-50/60 border-red-200">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.push('/automations')}>
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            icon={loading ? undefined : ArrowRight}
            loading={loading}
            onClick={submit}
            disabled={loading || goal.trim().length < 5}
          >
            {loading ? t.draftingBtn : t.draftSteps}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pickHint(ms: number, t: Translations['automations']['newPage']): string {
  if (ms < 8_000) return t.hint1;
  if (ms < 25_000) return t.hint2;
  if (ms < 60_000) return t.hint3;
  return t.hint4;
}
