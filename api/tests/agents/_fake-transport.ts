/**
 * Fake chokepoint transport for the agents suite (the pattern G7 tests use): the injected seam
 * at `llm/client.ts` lets us exercise the whole run pipeline — metering, anonymisation, marker
 * machinery, streaming — with NO live model. A script of `AgentStreamMsg`s drives the stream;
 * `messages`/`oneShot` return canned bodies; every call's params are captured for assertions.
 */
import type { ChokepointTransport, AgentStreamMsg, SdkCallParams, RestCallParams, TransportResult, RawRestResponse, RawUsage } from '../../src/llm/client.js';

const USAGE: RawUsage = { input: 10, output: 5, cacheCreate: 0, cacheRead: 0 };

export interface FakeTransportScript {
  /** Stream messages (excluding the trailing `final`, which is appended automatically). */
  stream?: AgentStreamMsg[];
  /** Final text for the stream's `final` message + the one-shot text. */
  finalText?: string;
  aborted?: boolean;
  usage?: RawUsage;
  /** oneShot return text (for classifiers + memory extract). */
  oneShotText?: string;
  /** messages REST body (JSON string) + status. */
  messagesBody?: string;
  messagesStatus?: number;
  /** Make `messages` throw — 'abort' surfaces as LlmAbortedError at completeFast (§5.3.2). */
  messagesThrow?: 'abort' | 'error';
  /** Delay the stream before finishing, so a timeout timer can fire mid-run (§5.3.6 tests). */
  streamDelayMs?: number;
}

export interface FakeTransport extends ChokepointTransport {
  readonly streamCalls: SdkCallParams[];
  readonly oneShotCalls: SdkCallParams[];
  readonly messagesCalls: RestCallParams[];
}

export function makeFakeTransport(script: FakeTransportScript = {}): FakeTransport {
  const streamCalls: SdkCallParams[] = [];
  const oneShotCalls: SdkCallParams[] = [];
  const messagesCalls: RestCallParams[] = [];
  const usage = script.usage ?? USAGE;

  return {
    streamCalls,
    oneShotCalls,
    messagesCalls,
    async *streamAgent(params: SdkCallParams): AsyncIterable<AgentStreamMsg> {
      streamCalls.push(params);
      if (params.signal?.aborted) {
        yield { kind: 'final', text: script.finalText ?? '', usage, aborted: true };
        return;
      }
      for (const msg of script.stream ?? []) yield msg;
      if (script.streamDelayMs) {
        await new Promise((r) => setTimeout(r, script.streamDelayMs));
        if (params.signal?.aborted) { yield { kind: 'final', text: script.finalText ?? '', usage, aborted: true }; return; }
      }
      yield { kind: 'final', text: script.finalText ?? '', usage, aborted: !!script.aborted };
    },
    async oneShot(params: SdkCallParams): Promise<TransportResult> {
      oneShotCalls.push(params);
      if (params.signal?.aborted) return { text: '', usage, aborted: true };
      return { text: script.oneShotText ?? '', usage, aborted: false };
    },
    async messages(params: RestCallParams): Promise<RawRestResponse> {
      messagesCalls.push(params);
      if (script.messagesThrow === 'abort') {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (script.messagesThrow === 'error') throw new Error('transport failure');
      const body = script.messagesBody ?? JSON.stringify({ content: [{ type: 'text', text: script.oneShotText ?? '' }], usage: { input_tokens: 10, output_tokens: 5 } });
      return { status: script.messagesStatus ?? 200, headers: {}, body };
    },
  };
}
