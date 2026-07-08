"use client";

/**
 * Side-panel Integration Builder.
 *
 * Mounts inside the chat-driven builder's side panel when sidePanelState === 'integrate'.
 * Drives a minimal conversation with the integration agent (ekoa.integration-builder
 * chat intent) and exposes a Save action that fires `integration_ready` SSE.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Plug, Loader2, Send, Save, X } from "lucide-react";
import { useOrchestrationStore } from "@/stores/orchestration";
import { api, tryCall } from "@/lib/api";
import type { IntegrationBuilderOutput } from "@/types/integration";

interface IntegrationBuildPanelProps {
  sessionId: string | null;
}

interface BuilderMsg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export default function IntegrationBuildPanel({ sessionId }: IntegrationBuildPanelProps) {
  const activeBuild = useOrchestrationStore((s) =>
    sessionId ? s.activeIntegrationBuilds[sessionId] : null,
  );
  const setActiveIntegrationBuild = useOrchestrationStore((s) => s.setActiveIntegrationBuild);
  const setSidePanelState = useOrchestrationStore((s) => s.setSidePanelState);
  const setSidePanelTab = useOrchestrationStore((s) => s.setSidePanelTab);

  const [messages, setMessages] = useState<BuilderMsg[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generatedPackage, setGeneratedPackage] = useState<IntegrationBuilderOutput | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const builderSessionIdRef = useRef<string | null>(activeBuild?.builderSessionId || null);
  const initRef = useRef(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Seed the conversation with the integration request when first mounting
  // for a fresh build. The seed message is sent to the agent automatically.
  const sendBuilderMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !sessionId || !activeBuild) return;
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text }]);
      setIsSending(true);
      try {
        // FC-035: request-response chat (language auto-injected by the transport).
        const res = await tryCall(() => api.integrationBuilder.chat({
          message: text,
          builderSessionId: builderSessionIdRef.current || undefined,
        }));
        if (res.ok) {
          const { builderSessionId: bsid, generatedPackage, validationErrors: errs } = res.data;
          const pkg = generatedPackage as unknown as IntegrationBuilderOutput | null;
          builderSessionIdRef.current = bsid;
          // Persist builder session id so the panel can resume on remount.
          setActiveIntegrationBuild(sessionId, {
            ...activeBuild,
            builderSessionId: bsid,
          });
          setGeneratedPackage(pkg);
          setValidationErrors((errs ?? []).map((e) => e.message));
          // The chat is synchronous with no streamed prose. Surface the assistant's
          // natural text from the package summary if present; otherwise a generic ack.
          const assistantText =
            pkg?.skillMd?.split("\n").slice(0, 4).join(" ").trim() ||
            "Working on the integration...";
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", content: assistantText },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `s-${Date.now()}`,
              role: "system",
              content: res.error.message || "Builder agent did not respond.",
            },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            role: "system",
            content: err instanceof Error ? err.message : "Network error",
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, activeBuild, setActiveIntegrationBuild],
  );

  // Auto-seed the conversation when the panel first opens for a new integration.
  useEffect(() => {
    if (initRef.current) return;
    if (!activeBuild || !sessionId) return;
    initRef.current = true;
    const seed = `Build an integration for ${activeBuild.label || activeBuild.key}. Key: ${activeBuild.key}.`;
    void sendBuilderMessage(seed);
  }, [activeBuild, sessionId, sendBuilderMessage]);

  function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;
    setInput("");
    void sendBuilderMessage(text);
  }

  async function handleSave() {
    const bsid = builderSessionIdRef.current;
    if (!bsid || !generatedPackage) return;
    setIsSaving(true);
    try {
      const res = await tryCall(() => api.integrationBuilder.save({
        builderSessionId: bsid,
        generatedPackage,
      }));
      if (res.ok) {
        // The backend emits an `integration_ready` SSE event on save; the chat
        // page picks it up and prompts the user to wire it in. We just mark
        // local state as saved.
        setMessages((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            role: "system",
            content: "Integration saved. Returning to the build chat...",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            role: "system",
            content: res.error.message || "Save failed",
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `s-${Date.now()}`,
          role: "system",
          content: err instanceof Error ? err.message : "Network error",
        },
      ]);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    if (!sessionId) return;
    setActiveIntegrationBuild(sessionId, null);
    setSidePanelState("build");
    setSidePanelTab("preview");
  }

  if (!activeBuild) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        No active integration build.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Header */}
      <div className="h-12 border-b border-neutral-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Plug size={16} className="text-teal-600" />
          <span className="text-sm font-medium text-neutral-800">
            Integration Builder: {activeBuild.label || activeBuild.key}
          </span>
        </div>
        <button
          onClick={handleCancel}
          className="text-neutral-500 hover:text-neutral-800 p-1 rounded"
          title="Cancel and return to build"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-light">
        {messages.length === 0 && !isSending && (
          <div className="text-xs text-neutral-500 italic">
            Starting integration build for {activeBuild.label || activeBuild.key}...
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.role === "user"
                ? "flex justify-end"
                : msg.role === "system"
                  ? "flex justify-center"
                  : "flex"
            }
          >
            <div
              className={
                msg.role === "user"
                  ? "bg-neutral-800 text-white text-xs px-3 py-2 rounded-lg max-w-[80%]"
                  : msg.role === "system"
                    ? "text-[11px] text-neutral-500 italic"
                    : "bg-neutral-100 text-neutral-800 text-xs px-3 py-2 rounded-lg max-w-[80%] whitespace-pre-wrap"
              }
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={12} className="animate-spin" /> Working...
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Save bar */}
      {generatedPackage && (
        <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-2 flex items-center justify-between">
          <div className="text-xs text-neutral-600">
            {validationErrors.length > 0
              ? `${validationErrors.length} validation issue(s) to resolve`
              : "Integration package ready to save"}
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving || validationErrors.length > 0}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded inline-flex items-center gap-1.5"
          >
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save & continue
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-neutral-200 px-4 py-2 flex items-end gap-2 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Describe the integration (auth, endpoints, actions)..."
          className="flex-1 resize-none border border-neutral-200 rounded text-xs px-2 py-1.5 outline-none focus:border-teal-500 max-h-32"
          rows={1}
          disabled={isSending}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isSending}
          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white p-1.5 rounded"
          title="Send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
