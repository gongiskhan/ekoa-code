"use client";

import { useState } from 'react';
import LiveCanvasView from '@/components/streaming/live-canvas-view';
import type { CanvasStatus } from '@/lib/api';

/**
 * The live view of an attended-ceremony login (D-CEREMONY-STREAM). The window runs on the user's
 * bridge machine; this streams it here so they can log in from whatever device they are on. It wraps
 * the shared `LiveCanvasView` (frames down, mouse/keyboard up) with a small connection indicator and
 * the one caveat a live login needs.
 *
 * PRIVACY, stated for the person: they type their real password into this view. The keystrokes cross
 * to their own machine in RAM only and are never stored or logged (the same rule the Cofre keeps for
 * every credential); the frames show the login page with the password field masked by the site.
 */
export interface CeremonyStreaming {
  token: string;
  wsUrl: string;
  viewport: { width: number; height: number };
}

export default function CeremonyLoginCanvas({ streaming }: { streaming: CeremonyStreaming }) {
  const [status, setStatus] = useState<CanvasStatus>('connecting');

  const label =
    status === 'open'
      ? 'Ligado - inicie sessão no visor abaixo'
      : status === 'connecting'
        ? 'A ligar ao navegador da sua máquina...'
        : 'Ligação terminada';

  return (
    <div className="space-y-2" data-testid="cofre-ceremony-canvas">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status === 'open' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-neutral-400'
          }`}
          aria-hidden
        />
        <span>{label}</span>
      </div>
      <LiveCanvasView
        session={{ wsUrl: streaming.wsUrl, token: streaming.token, viewport: streaming.viewport }}
        onStatusChange={setStatus}
        maxHeightClass="max-h-[60vh]"
      />
      <p className="text-xs text-muted-foreground">
        Escreve a palavra-passe diretamente aqui - as teclas vão para a sua máquina e nunca são guardadas nem
        registadas. Quando terminar, clique em &quot;Concluir e capturar&quot;.
      </p>
    </div>
  );
}
