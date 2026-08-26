"use client";

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAutomationsStore } from '@/stores/automations';
import LiveCanvasView from '@/components/streaming/live-canvas-view';
import type { CanvasStatus } from '@/lib/api';
import type { StreamingConnectionStatus, StreamingSession } from '@/types/automation';

interface Props {
  session: StreamingSession;
  onStatusChange?: (status: StreamingConnectionStatus) => void;
}

/** Map the media-channel status to the store's connection status vocabulary. */
function canvasStatusToConnection(status: CanvasStatus): StreamingConnectionStatus {
  switch (status) {
    case 'connecting':
      return 'connecting';
    case 'open':
      return 'connected';
    case 'closed':
    default:
      return 'disconnected';
  }
}

/**
 * The automation-run pause canvas: a thin wrapper around the shared `LiveCanvasView` that wires the
 * media channel's status into the automations store. The paint + input logic lives in the shared view
 * (one place, one wire); this only translates status and picks the mobile height.
 */
export default function PauseForUserCanvas({ session, onStatusChange }: Props) {
  const isMobile = useIsMobile();
  const setStreamingStatus = useAutomationsStore((s) => s.setStreamingStatus);

  const updateStatus = (status: StreamingConnectionStatus) => {
    setStreamingStatus(status);
    onStatusChange?.(status);
  };

  return (
    <LiveCanvasView
      session={{ wsUrl: session.wsUrl, token: session.token, viewport: session.viewport }}
      maxHeightClass={isMobile ? 'max-h-[50vh]' : 'max-h-[70vh]'}
      onStatusChange={(status) => updateStatus(canvasStatusToConnection(status))}
      onClose={(_code, resumed) => updateStatus(resumed ? 'idle' : 'failed')}
    />
  );
}
