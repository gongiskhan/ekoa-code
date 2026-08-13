/**
 * REGRESSION for finding `run-error-text-leak` (2026-08-11), the recovery half.
 *
 * The 2026-08-10 incident was not only that a user saw an internal credential diagnostic; it was
 * that the turn then went nowhere. A failed run persists no assistant message, and the Retry
 * affordance was gated on `lastAssistantIdx` - the index of the last ASSISTANT turn - so on the
 * failure path there was nothing to hang it off and the user was left at a dead end.
 *
 * These tests pin the two halves of the new rule:
 *   - an error bubble offers Retry when the shared `RUN_ERROR_RETRYABLE` table says retrying can
 *     help (`retryable: true` on the message metadata);
 *   - and does NOT when it cannot - AUTH_ERROR (only an operator re-arming the platform
 *     credential clears it) and BILLING_BLOCKED. A button that re-fails every time reads as the
 *     product being broken, which is worse than no button.
 *
 * Rendering is the assertion on purpose: the retryability TABLE is unit-tested in
 * `shared/src/run-errors.test.ts`, but nothing else proves the bubble actually wires it up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/voice/use-voice-session", () => ({
  useVoiceSession: () => ({
    support: { ok: false, reason: "no-capture-api" },
    mode: null,
    status: "idle",
    interim: "",
    level: 0,
    suspended: false,
    error: null,
    tapMic: vi.fn(),
    startTalking: vi.fn(),
    sendNow: vi.fn(),
    dismissError: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-bridge-presence", () => ({
  useBridgePresence: () => ({ status: "not-installed" as const, connected: false }),
}));

import ChatPanel from "@/components/builder/chat-panel";
import { useOrchestrationStore } from "@/stores/orchestration";
import { RUN_ERROR_TEXT } from "@ekoa/shared";

const SID = "session-error-retry";

/** Seed the transcript with a user turn followed by a terminal error bubble. */
function seedFailedTurn(opts: { errorCode: string; retryable: boolean; content: string }) {
  useOrchestrationStore.setState({
    messages: {
      [SID]: [
        {
          id: "m-user",
          role: "user",
          content: "faz um site a falar das apps juridicas do ekoa",
          timestamp: "2026-08-11T10:58:23.000Z",
          metadata: { isEssential: true },
        },
        {
          id: "m-err",
          role: "system",
          content: opts.content,
          timestamp: "2026-08-11T10:58:43.000Z",
          metadata: {
            isEssential: true,
            type: "error",
            errorCode: opts.errorCode,
            retryable: opts.retryable,
          },
        },
      ],
    },
    sessionJobs: {},
    pendingAttachments: [],
    queuedMessages: {},
    composerDraft: {},
    replySummaries: {},
    editTargets: {},
    sheetLinks: {},
    activityMessages: {},
    sessionLatestSheet: {},
  } as never);
}

function renderPanel(onResend = vi.fn()) {
  render(
    <ChatPanel
      sessionId={SID}
      isExecuting={false}
      isBuildSession={false}
      onSendMessage={vi.fn()}
      onCancel={vi.fn()}
      onFirstMessage={vi.fn()}
      onResend={onResend}
    />,
  );
  return onResend;
}

beforeEach(() => {
  useOrchestrationStore.setState({ messages: { [SID]: [] } } as never);
});

describe("terminal error bubble - recovery affordance", () => {
  it("a RETRYABLE failure offers Retry, and clicking it re-sends", async () => {
    seedFailedTurn({ errorCode: "ADAPTER_ERROR", retryable: true, content: RUN_ERROR_TEXT.pt.ADAPTER_ERROR });
    const onResend = renderPanel();

    const retry = screen.getByRole("button", { name: /Tentar novamente|Try again/i });
    expect(retry).toBeTruthy();

    retry.click();
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("AUTH_ERROR does NOT offer Retry - only an operator can clear it", () => {
    // The exact 2026-08-10 case, post-fix: branded text, no dead-end retry loop.
    seedFailedTurn({ errorCode: "AUTH_ERROR", retryable: false, content: RUN_ERROR_TEXT.pt.AUTH_ERROR });
    renderPanel();

    expect(screen.queryByRole("button", { name: /Tentar novamente|Try again/i })).toBeNull();
    // ...and the bubble says the vocabulary's sentence, with nothing internal in it.
    expect(screen.getByText(RUN_ERROR_TEXT.pt.AUTH_ERROR)).toBeTruthy();
  });

  it("BILLING_BLOCKED does NOT offer Retry", () => {
    seedFailedTurn({ errorCode: "BILLING_BLOCKED", retryable: false, content: "Não há saldo disponível para continuar." });
    renderPanel();
    expect(screen.queryByRole("button", { name: /Tentar novamente|Try again/i })).toBeNull();
  });

  it("the rendered error carries no internal vocabulary, whatever the server said", () => {
    // Content is always built from the code client-side; this guards the bubble itself.
    seedFailedTurn({ errorCode: "AUTH_ERROR", retryable: false, content: RUN_ERROR_TEXT.pt.AUTH_ERROR });
    renderPanel();
    const body = document.body.textContent ?? "";
    for (const needle of ["LLM_OAUTH_REFRESH_URL", "credential", "OAuth", "refresh token"]) {
      expect(body.includes(needle), `transcript must not contain "${needle}"`).toBe(false);
    }
  });
});
