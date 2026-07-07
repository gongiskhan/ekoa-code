"use client";

import { useEffect } from 'react';
import { getConnection } from '@/lib/cortex/connection';
import { useAutomationsStore } from '@/stores/automations';
import type { AutomationLiveEvent } from '@/types/automation';

/**
 * Subscribe to automation_run_* SSE events for the active run and pipe
 * them into the store. Subscription auto-clears on unmount.
 */
export function useAutomationRun(): void {
  const applyLiveEvent = useAutomationsStore((s) => s.applyLiveEvent);

  useEffect(() => {
    const conn = getConnection();
    if (!conn) return;

    const eventTypes: AutomationLiveEvent['type'][] = [
      'automation_run_step',
      'automation_run_complete',
      'automation_run_error',
      'automation_run_paused',
      'automation_run_patch',
      'automation_run_pause_for_user',
      'automation_run_resumed',
      'automation_run_streaming_available',
      'automation_run_awaiting_consent',
      'automation_run_awaiting_daemon',
      'automation_step_output_chunk',
    ];

    const unsubscribers = eventTypes.map((type) =>
      conn.on(type, (event: unknown) => applyLiveEvent(event as AutomationLiveEvent)),
    );

    return () => {
      for (const off of unsubscribers) off();
    };
  }, [applyLiveEvent]);
}
