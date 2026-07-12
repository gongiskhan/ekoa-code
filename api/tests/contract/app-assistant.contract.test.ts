import { describe, it, expect } from 'vitest';
import {
  AssistantChatRequest,
  AssistantChatResponse,
  appAssistantEndpoints,
  ErrorEnvelope,
  ALL_ENDPOINTS,
  ERROR_STATUS,
} from '@ekoa/shared';

/**
 * operator-run D1 — contract suite for the served-app assistant endpoint (`POST /api/app-assistant`).
 * The descriptor pre-existed; D1 EVOLVES its request/response additively (mode + context on the
 * request; citations + actions + mode on the response). This validates a representative
 * AssistantChatResponse against the shared schema, proves back-compat (the base `{ message }` /
 * `{ reply }` shapes still validate), and checks the CONV-2 error envelope the route emits — the
 * QA-layer-3 "new endpoint ⇒ contract test in the same slice" obligation.
 */

describe('AssistantChatResponse contract (D1)', () => {
  it('validates a full response (reply + citations + actions + mode)', () => {
    const sample = {
      reply: 'Vou criar o cliente para si. Feito.',
      mode: 'do' as const,
      citations: [{ collection: 'faq', docId: 'd1', title: 'Como criar cliente' }],
      actions: [{ toolName: 'app_action__criar_cliente', input: { nome: 'Ana', ativo: true } }],
    };
    const r = AssistantChatResponse.safeParse(sample);
    expect(r.success).toBe(true);
  });

  it('back-compat: the base { reply } response still validates (all new fields optional)', () => {
    expect(AssistantChatResponse.safeParse({ reply: 'Olá' }).success).toBe(true);
  });

  it('rejects a bad mode and a missing reply', () => {
    expect(AssistantChatResponse.safeParse({ reply: 'x', mode: 'sideways' }).success).toBe(false);
    expect(AssistantChatResponse.safeParse({ mode: 'do' }).success).toBe(false);
  });

  it('an action input must be an object (record), never a scalar', () => {
    expect(AssistantChatResponse.safeParse({ reply: 'x', actions: [{ toolName: 't', input: {} }] }).success).toBe(true);
    expect(AssistantChatResponse.safeParse({ reply: 'x', actions: [{ toolName: 't', input: 'oops' }] }).success).toBe(false);
  });
});

describe('AssistantChatRequest contract (D1)', () => {
  it('back-compat: the base { message } request still validates', () => {
    expect(AssistantChatRequest.safeParse({ message: 'olá' }).success).toBe(true);
  });

  it('validates the evolved request (history + context + mode)', () => {
    const req = {
      message: 'Mostra-me a aplicação',
      history: [{ role: 'user' as const, content: 'olá' }, { role: 'assistant' as const, content: 'viva' }],
      context: { route: '/clientes', actionResults: [{ ok: true }] },
      mode: 'show' as const,
    };
    expect(AssistantChatRequest.safeParse(req).success).toBe(true);
  });

  it('rejects an invalid mode', () => {
    expect(AssistantChatRequest.safeParse({ message: 'x', mode: 'nope' }).success).toBe(false);
  });
});

describe('appAssistant endpoint descriptor (D1)', () => {
  it('the descriptor is intact and points at the evolved schemas', () => {
    const d = appAssistantEndpoints.assistantChat;
    expect(d.method).toBe('POST');
    expect(d.path).toBe('/api/app-assistant');
    expect(d.auth).toBe('header-scoped');
    // The descriptor's request/response ARE the evolved schemas.
    expect(d.request.safeParse({ message: 'x', mode: 'teach' }).success).toBe(true);
    expect(d.response.safeParse({ reply: 'x', citations: [{ collection: 'c', docId: 'd', title: 't' }] }).success).toBe(true);
  });

  it('stays accounted for in the shared descriptor census (schema-coverage input)', () => {
    expect(ALL_ENDPOINTS.appAssistant?.assistantChat).toBeTruthy();
  });
});

describe('app-assistant error envelope (D1, CONV-2)', () => {
  it('the route error codes validate as CONV-2 envelopes with the right status', () => {
    for (const code of ['VALIDATION_FAILED', 'NOT_FOUND', 'ACCOUNT_DISABLED', 'BILLING_LOCKED', 'BILLING_BLOCKED', 'INTERNAL'] as const) {
      const body = { error: { code, message: 'msg' } };
      expect(ErrorEnvelope.safeParse(body).success, code).toBe(true);
      expect(typeof ERROR_STATUS[code]).toBe('number');
    }
  });
});
