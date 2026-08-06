'use client';

import { useEffect, useRef, useState } from 'react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/stores/toast';
import { useIntegrationsStore } from '@/stores/integrations';
import { api, tryCall } from '@/lib/api';

/**
 * The customer-facing way to connect Zoho Sign: a popup OAuth consent against the PLATFORM's Zoho
 * client, instead of asking someone to create a Self Client, paste a client id and secret, and
 * then race a grant code that expires in minutes.
 *
 * That old form is why this exists. Chrome saw a text input followed by a password input, decided
 * it was a login form, and autofilled the user's Ekoa credentials into the Zoho client fields; the
 * resulting bundle then silently shadowed the platform client. The recovery fields are still on
 * the card below this button, labelled as recovery-only.
 *
 * Completion arrives by `postMessage` from the callback page, with a popup-closed poll as the
 * abandonment fallback (a user who closes the window must not leave the button spinning forever).
 */
export function ZohoOAuthConnect() {
  const [isConnecting, setIsConnecting] = useState(false);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const fetchAll = useIntegrationsStore((s) => s.fetchAll);

  useEffect(() => {
    return () => {
      if (listenerRef.current) window.removeEventListener('message', listenerRef.current);
    };
  }, []);

  async function handleConnect(e: React.MouseEvent) {
    e.stopPropagation();
    setIsConnecting(true);
    try {
      const call = await tryCall(() => api.integrations.zohoOAuthConnect());
      if (!call.ok) {
        // The server's refusal names which env vars an operator must set; showing a generic
        // failure instead is what left a customer staring at "Falha na ligação" for weeks.
        toast.error(call.error.message || 'Falha ao ligar o Zoho Sign.');
        setIsConnecting(false);
        return;
      }
      const popup = window.open(call.data.authUrl, 'zoho-oauth', 'width=520,height=720,left=200,top=100');
      if (!popup) {
        toast.error('O navegador bloqueou a janela de ligação. Permita popups para este site e tente novamente.');
        setIsConnecting(false);
        return;
      }

      const handler = (event: MessageEvent) => {
        const data = event.data as { type?: string; provider?: string; success?: boolean; error?: string } | null;
        if (data?.type !== 'oauth-callback' || data?.provider !== 'zoho') return;
        window.removeEventListener('message', handler);
        listenerRef.current = null;
        if (data.success) {
          toast.success('Zoho Sign ligado.');
          // The callback wrote the credentials server-side; the card's state comes from that row.
          void fetchAll();
        } else {
          toast.error(data.error || 'Falha ao ligar o Zoho Sign.');
        }
        setIsConnecting(false);
      };
      if (listenerRef.current) window.removeEventListener('message', listenerRef.current);
      listenerRef.current = handler;
      window.addEventListener('message', handler);

      // Abandonment fallback, with a short grace so a late postMessage still wins the race.
      const poll = setInterval(() => {
        if (!popup.closed) return;
        clearInterval(poll);
        setTimeout(() => {
          if (listenerRef.current !== handler) return;
          window.removeEventListener('message', handler);
          listenerRef.current = null;
          setIsConnecting(false);
        }, 500);
      }, 500);
    } catch (err) {
      // The server's refusal names which env vars an operator must set; swallowing it is what
      // leaves a customer staring at a generic failure.
      toast.error(err instanceof Error ? err.message : 'Falha ao ligar o Zoho Sign.');
      setIsConnecting(false);
    }
  }

  return (
    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
      <Button type="button" variant="secondary" size="sm" onClick={handleConnect} disabled={isConnecting}>
        {isConnecting ? <Spinner className="mr-2 h-4 w-4" /> : <LogIn className="mr-2 h-4 w-4" />}
        Ligar com OAuth
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">
        Abre o consentimento do Zoho numa janela. Os campos abaixo servem apenas para recuperação.
      </p>
    </div>
  );
}
