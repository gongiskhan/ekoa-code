"use client";

/**
 * The one rendering of a run status, shared by the list rows and the detail history.
 * Status text derives from the CODE the contract defines, never from server prose.
 *
 * P4.1 MADE THAT DOCLINE TRUE. It was a claim, not a behaviour: the component read
 * `schedules.runStatus[status]` and ignored `code` entirely, which was survivable only while
 * `blocked` had exactly ONE cause (`awaiting_consent`, the integration write gate) and its single
 * string could name it. P4.1 gave `blocked` two more - `awaiting_daemon` (a machine of yours is not
 * connected) and `needs_credentials` (a credential only you can establish) - and the untouched
 * string told a user whose laptop was shut to go and approve something. There is no approval. They
 * would look for one.
 *
 * So the code picks the words when there is a code for it, and the bare status is the fallback for
 * an outcome nobody has written copy for yet. The fallback is deliberately vague ("waiting on you")
 * rather than a guess: a wrong specific instruction is worse than an honest general one.
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

export function RunStatusBadge({ status, code }: { status: ScheduleRunStatus; code?: string }) {
  const { schedules } = useTranslation();
  const blockedText = status === 'blocked' && code
    ? schedules.runBlocked[code as keyof typeof schedules.runBlocked]
    : undefined;
  return (
    <Badge tone={TONES[status] ?? 'neutral'} data-testid={`schedule-run-status-${status}`}>
      {blockedText ?? schedules.runStatus[status] ?? status}
    </Badge>
  );
}
