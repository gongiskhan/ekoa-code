"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { useIntegrationsStore } from "@/stores/integrations";
import { useTranslation } from "@/stores/i18n";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";

/* ---------- SVG Icons ---------- */

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.44 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="none">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

/* ---------- Card Variants ---------- */

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

/* ---------- Types ---------- */

interface PlatformIntegrationCardProps {
  provider: "google" | "microsoft";
  name: string;
  description: string;
}

/* ---------- Platform Integration Card ---------- */

export function PlatformIntegrationCard({
  provider,
  name,
  description,
}: PlatformIntegrationCardProps) {
  const { pages } = useTranslation();
  const t = pages.platformIntegrations;
  const confirm = useConfirm();

  const {
    platformStatuses,
    connectPlatform,
    disconnectPlatform,
    fetchPlatformStatus,
  } = useIntegrationsStore();

  const status = platformStatuses[provider];
  const isConnected = status?.connected ?? false;
  const connectedEmail = status?.email;

  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Ref to track the message listener cleanup
  const messageListenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  // Clean up event listener on unmount
  useEffect(() => {
    return () => {
      if (messageListenerRef.current) {
        window.removeEventListener("message", messageListenerRef.current);
        messageListenerRef.current = null;
      }
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);

    try {
      const { authUrl } = await connectPlatform(provider);

      // Open OAuth popup
      const popup = window.open(
        authUrl,
        "oauth-popup",
        "width=500,height=700,left=200,top=100"
      );

      // Listen for the OAuth callback message from the popup
      const handler = (event: MessageEvent) => {
        if (
          event.data?.type === "oauth-callback" &&
          event.data?.provider === provider
        ) {
          window.removeEventListener("message", handler);
          messageListenerRef.current = null;

          if (event.data.success) {
            fetchPlatformStatus(provider);
          } else {
            toast.error(t.connectionFailed);
          }

          setIsConnecting(false);
        }
      };

      // Clean up any previous listener before adding a new one
      if (messageListenerRef.current) {
        window.removeEventListener("message", messageListenerRef.current);
      }
      messageListenerRef.current = handler;
      window.addEventListener("message", handler);

      // Handle popup closed without completing
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          // Give a short delay for the message event to fire
          setTimeout(() => {
            if (messageListenerRef.current === handler) {
              window.removeEventListener("message", handler);
              messageListenerRef.current = null;
              setIsConnecting(false);
            }
          }, 500);
        }
      }, 500);
    } catch {
      toast.error(t.connectionFailed);
      setIsConnecting(false);
    }
  }, [provider, connectPlatform, fetchPlatformStatus, t.connectionFailed]);

  const handleDisconnect = useCallback(async () => {
    const ok = await confirm({
      title: t.disconnectConfirm(name),
      description: t.disconnectWarning(name),
      confirmLabel: t.disconnect,
      tone: "danger",
    });
    if (!ok) return;

    setIsDisconnecting(true);
    try {
      await disconnectPlatform(provider);
    } catch {
      toast.error(t.connectionFailed);
    } finally {
      setIsDisconnecting(false);
    }
  }, [provider, name, disconnectPlatform, confirm, t]);

  const icon =
    provider === "google" ? (
      <GoogleIcon />
    ) : (
      <MicrosoftIcon />
    );

  return (
      <motion.div
        variants={cardVariants}
        className="w-full bg-white border border-neutral-200 rounded-xl overflow-hidden hover:border-neutral-300 hover:shadow-sm transition-all flex flex-col"
        whileHover={{ y: -2 }}
        transition={{ duration: 0.15 }}
      >
        {/* Top accent line */}
        <div
          className={`h-[2px] transition-all duration-300 ${
            isConnected
              ? "bg-gradient-to-r from-teal-400 via-teal-500 to-emerald-400"
              : "bg-neutral-200"
          }`}
        />

        <div className="p-4 flex flex-col flex-1">
          {/* Header row */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors duration-200 ${
                  isConnected
                    ? "bg-teal-50"
                    : "bg-neutral-100"
                }`}
              >
                {icon}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-neutral-800 truncate">
                  {name}
                </h3>
                {isConnected && connectedEmail && (
                  <p className="text-[11px] text-teal-600 mt-0.5 truncate">
                    {connectedEmail}
                  </p>
                )}
              </div>
            </div>

            {/* Status dot */}
            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  isConnected ? "bg-teal-500" : "bg-neutral-300"
                }`}
              />
            </div>
          </div>

          {/* Description */}
          <p className="text-xs text-neutral-500 leading-relaxed mb-3 line-clamp-2">
            {description}
          </p>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Footer */}
          <div className="pt-3 mt-2 border-t border-neutral-100">
            <div className="flex items-center justify-between">
              <Badge tone={isConnected ? "success" : "neutral"} dot>
                {isConnected ? t.connected : t.notConnected}
              </Badge>

              {isConnected ? (
                <Button variant="danger-ghost" size="sm" loading={isDisconnecting} onClick={handleDisconnect}>
                  {t.disconnect}
                </Button>
              ) : (
                <Button variant="primary" size="sm" loading={isConnecting} onClick={handleConnect}>
                  {isConnecting ? t.connecting : t.connect}
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
  );
}
