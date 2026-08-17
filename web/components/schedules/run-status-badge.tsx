"use client";

/**
 * The one rendering of a run status, shared by the list rows and the detail history.
 * Status text derives from the CODE the contract defines, never from server prose.
 */

import type { ScheduleRunStatus } from '@ekoa/shared';
import { Badge } from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import { useTranslation } from '@/stores/i18n';

const TONES: Record<ScheduleRunStatus, BadgeTone> = {
  running: 'info',
  ok: 'success',
  failed: 'danger',
  blocked: 'warning',
  pending: 'info',
  done: 'neutral',
  dismissed: 'neutral',
};

export function RunStatusBadge({ status }: { status: ScheduleRunStatus }) {
  const { schedules } = useTranslation();
  return (
    <Badge tone={TONES[status] ?? 'neutral'} data-testid={`schedule-run-status-${status}`}>
      {schedules.runStatus[status] ?? status}
    </Badge>
  );
}
