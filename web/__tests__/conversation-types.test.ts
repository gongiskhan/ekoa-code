/**
 * Initial-message intent routing for the unified chat. The system decides
 * the mode (chat / build / integrate / branding) from the first user
 * message — the user no longer picks a mode from a UI control. This file
 * pins the local fallback classifier to its expected behaviour for the
 * canonical input shapes.
 */
import { describe, it, expect } from 'vitest';
import { classifyLocalFallback, type ChatMessageInput } from '@/lib/conversation-types';

function msg(content: string): ChatMessageInput[] {
  return [{ role: 'user', content }];
}

describe('classifyLocalFallback — build intent', () => {
  it('routes a specific build request (CRM application) to build mode with build side panel', () => {
    const out = classifyLocalFallback(msg('quero construir uma aplicação CRM para a minha equipa'));
    expect(out.intent).toBe('build');
    expect(out.routingContext.sidePanel).toBe('build');
    expect(out.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('routes "preciso de uma aplicação para gerir tarefas" to build', () => {
    const out = classifyLocalFallback(msg('preciso de uma aplicação para gerir tarefas'));
    expect(out.intent).toBe('build');
    expect(out.routingContext.sidePanel).toBe('build');
  });

  it('routes "I want to build a dashboard" to build', () => {
    const out = classifyLocalFallback(msg('I want to build a dashboard for sales reports'));
    expect(out.intent).toBe('build');
  });

  it('does NOT mis-classify a bare info-seeking message as build', () => {
    const out = classifyLocalFallback(msg('quero saber o que é um chatbot'));
    expect(out.intent).toBe('chat');
    expect(out.routingContext.sidePanel).toBe('none');
  });

  it('does NOT mis-classify "what is a CRM" as build', () => {
    const out = classifyLocalFallback(msg('what is a CRM?'));
    expect(out.intent).toBe('chat');
  });
});

describe('classifyLocalFallback — chat intent (default)', () => {
  it('routes a generic question about Ekoa to chat with no side panel', () => {
    const out = classifyLocalFallback(msg('o que é que o Ekoa pode fazer por mim?'));
    expect(out.intent).toBe('chat');
    expect(out.routingContext.sidePanel).toBe('none');
  });

  it('routes a greeting to chat', () => {
    const out = classifyLocalFallback(msg('olá, como estás?'));
    expect(out.intent).toBe('chat');
  });

  it('routes "explain how Ekoa works" to chat (negative pattern blocks build)', () => {
    const out = classifyLocalFallback(msg('explain how Ekoa works'));
    expect(out.intent).toBe('chat');
  });
});

describe('classifyLocalFallback — integrate intent', () => {
  it('routes "ligar ao Slack" to integrate', () => {
    const out = classifyLocalFallback(msg('quero ligar ao Slack para receber notificações'));
    expect(out.intent).toBe('integrate');
    expect(out.routingContext.sidePanel).toBe('integrate');
  });

  it('routes "integrar com o Gmail" to integrate', () => {
    const out = classifyLocalFallback(msg('quero integrar com o Gmail'));
    expect(out.intent).toBe('integrate');
    expect(out.routingContext.sidePanel).toBe('integrate');
  });

  it('routes "connect to Stripe" to integrate', () => {
    const out = classifyLocalFallback(msg('I want to connect to Stripe for payments'));
    expect(out.intent).toBe('integrate');
  });
});

describe('classifyLocalFallback — branding intent', () => {
  it('routes "muda a cor do logo" to branding', () => {
    const out = classifyLocalFallback(msg('muda a cor do logótipo da minha marca'));
    expect(out.intent).toBe('branding');
    expect(out.routingContext.sidePanel).toBe('branding');
  });

  it('routes "extrair identidade da marca" to branding', () => {
    const out = classifyLocalFallback(msg('quero extrair a identidade da minha marca'));
    expect(out.intent).toBe('branding');
  });
});

describe('classifyLocalFallback — response contract', () => {
  it('always returns an InterviewQuestion[] (possibly empty)', () => {
    const out = classifyLocalFallback(msg('qualquer coisa'));
    expect(Array.isArray(out.questions)).toBe(true);
  });

  it('always returns a routingContext with sidePanel and summary', () => {
    const out = classifyLocalFallback(msg('qualquer coisa'));
    expect(out.routingContext).toBeDefined();
    expect(typeof out.routingContext.summary).toBe('string');
    expect(out.routingContext.summary.length).toBeGreaterThan(0);
    expect(['build', 'integrate', 'branding', 'none']).toContain(out.routingContext.sidePanel);
  });

  it('confidence is bounded to [0, 1]', () => {
    const inputs = [
      'olá',
      'quero construir um CRM',
      'integrar com Slack',
      'muda a cor da marca',
      '',
    ];
    for (const text of inputs) {
      const out = classifyLocalFallback(msg(text));
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('does not expose the legacy "template" mode in the ConversationMode union', () => {
    const inputs = [
      'criar template',
      'novo template',
      'template para landing page',
    ];
    for (const text of inputs) {
      const out = classifyLocalFallback(msg(text));
      expect(out.intent).not.toBe('template' as any);
    }
  });
});
