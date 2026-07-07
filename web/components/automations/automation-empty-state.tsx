"use client";

import { useRouter } from 'next/navigation';
import { Play, Plus } from 'lucide-react';
import { useTranslation } from '@/stores/i18n';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

export default function AutomationEmptyState() {
  const router = useRouter();
  const { automations } = useTranslation();
  const t = automations.emptyState;
  return (
    <EmptyState
      icon={Play}
      title={t.title}
      description={t.description}
      action={
        <Button variant="primary" icon={Plus} onClick={() => router.push('/automations/new')}>
          {t.create}
        </Button>
      }
    />
  );
}
