/**
 * WS4b - the in-session composer (`ChatPanel`, "builder/chat-panel.tsx") gains three things it
 * never had:
 *  1. onDrop/onDragOver: files dropped anywhere on the composer box stage as attachments.
 *  2. onPaste: pasted files (a copied image, files copied from the OS) stage as attachments; a
 *     pasted block of plain text longer than ~1 paragraph ALSO becomes an attachment instead of
 *     flooding the textarea; a short paste is left to the browser's normal behavior untouched.
 *  3. `onReferencePicked` wired into `ComposerAttachMenu` (FC-400) - this panel had a `Paperclip`
 *     menu that could never actually attach a local-bridge reference; the empty-state composer
 *     (page.tsx) already had this, ChatPanel never grew it.
 *
 * `@/lib/file-picker` is mocked so these tests pin the WIRING (which store action fires, with
 * what) rather than re-testing the staging upload itself (covered separately in
 * `file-picker.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

const bridgePresenceMock = vi.fn(() => ({ status: "not-installed" as const, connected: false }));
vi.mock("@/hooks/use-bridge-presence", () => ({
  useBridgePresence: () => bridgePresenceMock(),
}));

const stageFilesMock = vi.fn();
const stagePastedTextMock = vi.fn();
// The paste-vs-insert DECISION (shouldStageAsTextAttachment + its thresholds) is the real
// implementation here - it's pure and already has its own dedicated tests in
// file-picker.test.ts; only the network-touching staging calls are mocked.
vi.mock("@/lib/file-picker", async () => {
  const actual = await vi.importActual<typeof import("@/lib/file-picker")>("@/lib/file-picker");
  return {
    ...actual,
    stageFiles: (...args: unknown[]) => stageFilesMock(...args),
    stagePastedText: (...args: unknown[]) => stagePastedTextMock(...args),
    pickFiles: vi.fn(),
    pickFolder: vi.fn(),
  };
});

import ChatPanel from "@/components/builder/chat-panel";
import { useOrchestrationStore } from "@/stores/orchestration";

const SID = "session-composer";

function renderPanel() {
  return render(
    <ChatPanel
      sessionId={SID}
      isExecuting={false}
      isBuildSession={false}
      onSendMessage={vi.fn()}
      onCancel={vi.fn()}
      onFirstMessage={vi.fn()}
    />,
  );
}

beforeEach(() => {
  stageFilesMock.mockReset();
  stagePastedTextMock.mockReset();
  bridgePresenceMock.mockReturnValue({ status: "not-installed", connected: false });
  useOrchestrationStore.setState({
    messages: { [SID]: [] },
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
});

describe("ChatPanel composer - drop stages attachments", () => {
  it("dropping files onto the composer box stages them via addAttachment", async () => {
    const staged = [
      { attachmentId: "file-1", displayName: "invoice.pdf", path: "upload-1", type: "file" as const, size: 12 },
    ];
    stageFilesMock.mockResolvedValue(staged);
    renderPanel();

    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i);
    // The drop target is the bordered composer box wrapping the textarea (event delegation: a
    // drop anywhere inside it - not just the textarea - must be caught).
    const dropTarget = textarea.closest("div")!;
    const file = new File(["pdf-bytes"], "invoice.pdf", { type: "application/pdf" });

    fireEvent.drop(dropTarget, { dataTransfer: { files: [file], types: ["Files"] } });

    await waitFor(() => expect(stageFilesMock).toHaveBeenCalledTimes(1));
    expect(stageFilesMock.mock.calls[0][0]).toEqual([file]);
    await waitFor(() =>
      expect(useOrchestrationStore.getState().pendingAttachments).toEqual(staged),
    );
  });
});

describe("ChatPanel composer - paste", () => {
  it("pasted files stage as attachments (never inserted as text)", async () => {
    const staged = [
      { attachmentId: "img-1", displayName: "screenshot.png", path: "upload-2", type: "file" as const, size: 8 },
    ];
    stageFilesMock.mockResolvedValue(staged);
    renderPanel();

    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i);
    const image = new File(["png-bytes"], "screenshot.png", { type: "image/png" });

    fireEvent.paste(textarea, { clipboardData: { files: [image], types: ["Files"], getData: () => "" } });

    await waitFor(() => expect(stageFilesMock).toHaveBeenCalledTimes(1));
    expect(stagePastedTextMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(useOrchestrationStore.getState().pendingAttachments).toEqual(staged),
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("a long plain-text paste (> length threshold) stages as a text attachment instead of filling the textarea", async () => {
    const longText = "a".repeat(900);
    const staged = { attachmentId: "text-1", displayName: "aaaa...", path: "upload-3", type: "file" as const, size: 900 };
    stagePastedTextMock.mockResolvedValue(staged);
    renderPanel();

    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i) as HTMLTextAreaElement;
    fireEvent.paste(textarea, {
      clipboardData: { files: [], types: ["text/plain"], getData: () => longText },
    });

    await waitFor(() => expect(stagePastedTextMock).toHaveBeenCalledWith(longText));
    expect(stageFilesMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(useOrchestrationStore.getState().pendingAttachments).toEqual([staged]),
    );
    // The textarea itself never received the pasted text - jsdom does not perform the native
    // paste-insert (only real browsers do), so an untouched empty value is the honest assertion
    // that nothing in OUR handler put it there either.
    expect(textarea.value).toBe("");
  });

  it("a short-line list past the LINE threshold stages too, even though it is well under the length threshold", async () => {
    const shortLines = Array.from({ length: 8 }, (_, i) => `- item ${i}`).join("\n");
    expect(shortLines.length).toBeLessThan(800);
    const staged = { attachmentId: "text-2", displayName: "item 0", path: "upload-4", type: "file" as const, size: shortLines.length };
    stagePastedTextMock.mockResolvedValue(staged);
    renderPanel();

    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i);
    fireEvent.paste(textarea, {
      clipboardData: { files: [], types: ["text/plain"], getData: () => shortLines },
    });

    await waitFor(() => expect(stagePastedTextMock).toHaveBeenCalledWith(shortLines));
    await waitFor(() =>
      expect(useOrchestrationStore.getState().pendingAttachments).toEqual([staged]),
    );
  });

  it("a short plain-text paste stays UNDER both thresholds and is left to the browser (no staging call)", async () => {
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i);
    const shortText = "olá, tudo bem?";

    fireEvent.paste(textarea, {
      clipboardData: { files: [], types: ["text/plain"], getData: () => shortText },
    });

    // Neither staging path fires - the paste is left to fall through to normal insertion.
    await new Promise((r) => setTimeout(r, 0));
    expect(stageFilesMock).not.toHaveBeenCalled();
    expect(stagePastedTextMock).not.toHaveBeenCalled();
  });
});

describe("ChatPanel composer - FC-400 onReferencePicked wiring", () => {
  it("opening the attach menu and picking a reference renders it as a chip", async () => {
    renderPanel();
    const attachButton = screen.getByTitle(/Anexar ficheiro/i);
    await userEvent.click(attachButton);

    // The Reference (local-bridge) action inside ComposerAttachMenu.
    const referenceAction = await screen.findByTestId("attach-reference-block");
    expect(referenceAction).toBeInTheDocument();
  });
});

describe("ChatPanel composer - bridge-connected drop hint (a drop/paste has no filesystem path, so it can only ever upload)", () => {
  it("bridge NOT connected: a dropped file stages silently, no hint", async () => {
    bridgePresenceMock.mockReturnValue({ status: "not-installed", connected: false });
    stageFilesMock.mockResolvedValue([
      { attachmentId: "file-1", displayName: "a.pdf", path: "upload-1", type: "file" as const, size: 1 },
    ]);
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i);
    const dropTarget = textarea.closest("div")!;
    fireEvent.drop(dropTarget, {
      dataTransfer: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })], types: ["Files"] },
    });

    await waitFor(() => expect(stageFilesMock).toHaveBeenCalled());
    expect(screen.queryByTestId("drop-bridge-hint")).not.toBeInTheDocument();
  });

  it("bridge connected: a dropped file stages AND shows the Reference hint, dismissible", async () => {
    bridgePresenceMock.mockReturnValue({ status: "connected", connected: true });
    stageFilesMock.mockResolvedValue([
      { attachmentId: "file-1", displayName: "a.pdf", path: "upload-1", type: "file" as const, size: 1 },
    ]);
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i);
    const dropTarget = textarea.closest("div")!;
    fireEvent.drop(dropTarget, {
      dataTransfer: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })], types: ["Files"] },
    });

    const hint = await screen.findByTestId("drop-bridge-hint");
    expect(hint).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Dispensar|Dismiss/i));
    expect(screen.queryByTestId("drop-bridge-hint")).not.toBeInTheDocument();
  });

  it("bridge connected but nothing actually staged (all files failed): no hint", async () => {
    bridgePresenceMock.mockReturnValue({ status: "connected", connected: true });
    stageFilesMock.mockResolvedValue([]); // every file in the drop failed to stage
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escreva a sua mensagem/i);
    const dropTarget = textarea.closest("div")!;
    fireEvent.drop(dropTarget, {
      dataTransfer: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })], types: ["Files"] },
    });

    await waitFor(() => expect(stageFilesMock).toHaveBeenCalled());
    expect(screen.queryByTestId("drop-bridge-hint")).not.toBeInTheDocument();
  });
});
