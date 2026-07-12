import { describe, it, expect } from 'vitest';
import type { AppAction, AppActionManifest } from '@ekoa/shared';
import type { SearchHit } from '../../src/knowledge/index.js';
import type { OneShotOptions, LlmAttribution, RouterDecision } from '../../src/llm/index.js';
import { assistantToolsFromManifest } from '../../src/apps/assistant-tools.js';
import {
  runAppAssistant,
  inferMode,
  extractActions,
  type AppAssistantDeps,
} from '../../src/apps/app-assistant.js';

/**
 * operator-run D1 — the served-app assistant pure logic, over an INJECTED one-shot (no real model),
 * an injected grounding builder, and an injected routing decision. Asserts: mode inference; grounding
 * hits become citations; the ```ekoa-actions``` block is parsed, validated against the manifest, and
 * stripped from the reply; unknown tool names are dropped; and the grounding org comes from the
 * resolved OWNER, never a caller-supplied value.
 */

const manifest: AppActionManifest = {
  version: 1,
  actions: [
    { id: 'ir-clientes', kind: 'navigate', labelPt: 'Ver clientes', description: 'Abre a lista de clientes', route: '/clientes', params: [], destructive: false },
    {
      id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um novo cliente',
      params: [{ name: 'nome', type: 'string', required: true }], destructive: false,
    },
  ],
};

const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };
const OWNER = { userId: 'owner-1', orgId: 'org-owner' };

/** The server-resolved manifest AppAction D1 attaches to each proposed action. */
const actionById = (id: string): AppAction => manifest.actions.find((a) => a.id === id)!;
/** toolName -> manifest AppAction, as runAppAssistant / extractActions consume it. */
const toolMap = new Map(assistantToolsFromManifest(manifest).map((t) => [t.name, t.action] as const));

interface Captured {
  opts?: OneShotOptions;
  attribution?: LlmAttribution;
  groundInput?: { orgId: string; query: string; kind: string };
}

/** Deps whose one-shot returns `oneShotText` verbatim and whose grounding returns `hits`. */
function makeDeps(oneShotText: string, hits: SearchHit[] = [], captured: Captured = {}): AppAssistantDeps {
  return {
    oneShot: async (opts, attribution) => {
      captured.opts = opts;
      captured.attribution = attribution;
      return { text: oneShotText, usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    },
    ground: (input) => {
      captured.groundInput = input;
      return { block: hits.length ? 'CONHECIMENTO (excertos):\n[1] col / titulo (doc d1)' : '', hits };
    },
    decide: () => DECISION,
  };
}

function hit(over: Partial<SearchHit> = {}): SearchHit {
  return { docId: 'd1', collection: 'faq', title: 'Como criar cliente', snippet: 'passo 1...', score: 1, scope: 'org', ...over };
}

describe('inferMode (D1 deterministic PT-PT classifier)', () => {
  it('teach cues -> teach', () => {
    expect(inferMode('Faz um tutorial da aplicação')).toBe('teach');
    expect(inferMode('Explica como funciona o registo')).toBe('teach');
    expect(inferMode('Ensina-me a usar isto passo a passo')).toBe('teach');
  });
  it('show cues -> show (accent-insensitive)', () => {
    expect(inferMode('Mostra-me o painel')).toBe('show');
    expect(inferMode('Dá-me uma visão geral')).toBe('show');
    expect(inferMode('Faz um resumo geral')).toBe('show');
  });
  it('teach wins over show ("mostra-me como criar")', () => {
    expect(inferMode('Mostra-me como criar um cliente')).toBe('teach');
  });
  it('imperative task verbs and anything else default to do', () => {
    expect(inferMode('Cria um cliente chamado Ana')).toBe('do');
    expect(inferMode('Adiciona uma nota ao processo')).toBe('do');
    expect(inferMode('Olá')).toBe('do');
  });
});

describe('extractActions (D1 fenced-block parser)', () => {
  it('parses an actions block, attaches the resolved AppAction, and strips it from the prose', () => {
    const reply = [
      'Vou criar o cliente para si.',
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}}]',
      '```',
      'Feito.',
    ].join('\n');
    const { text, actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([
      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
    ]);
    expect(text).toContain('Vou criar o cliente');
    expect(text).toContain('Feito.');
    expect(text).not.toContain('ekoa-actions');
    expect(text).not.toContain('app_action__');
  });

  it('drops unknown tool names but keeps + resolves known ones', () => {
    const reply = [
      '```ekoa-actions',
      '[{"toolName":"app_action__inexistente","input":{}},{"toolName":"app_action__ir_clientes","input":{}}]',
      '```',
    ].join('\n');
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
  });

  it('drops UNDECLARED param keys from the model input (fenced path honours the tool schema)', () => {
    // codex-d2 #1: `custom` action params reach app code verbatim, so the fenced path
    // must enforce the same additionalProperties:false contract the SDK tool schema does.
    const reply = [
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana","__proto__x":"pwn","cmd":"rm -rf"}}]',
      '```',
    ].join('\n');
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.input).toEqual({ nome: 'Ana' }); // declared param kept, undeclared dropped
  });

  it('a malformed block yields no actions and is still stripped', () => {
    const reply = 'Olá\n```ekoa-actions\nnão é json\n```\ntchau';
    const { text, actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([]);
    expect(text).not.toContain('ekoa-actions');
    expect(text).toContain('Olá');
    expect(text).toContain('tchau');
  });

  it('non-object input defaults to {}', () => {
    const reply = '```ekoa-actions\n[{"toolName":"app_action__ir_clientes","input":"oops"}]\n```';
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
  });
});

describe('runAppAssistant (D1)', () => {
  it('infers the mode when not pinned and echoes it back', async () => {
    const deps = makeDeps('Aqui está uma visão geral.');
    const res = await runAppAssistant(
      { message: 'Mostra-me a aplicação', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.mode).toBe('show');
  });

  it('honours a client-pinned mode over inference', async () => {
    const deps = makeDeps('ok');
    const res = await runAppAssistant(
      { message: 'Mostra-me a aplicação', mode: 'do', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.mode).toBe('do');
  });

  it('turns grounding hits into citations (collection/docId/title)', async () => {
    const hits = [hit(), hit({ docId: 'd2', collection: 'guias', title: 'Guia', scope: 'shared' })];
    const deps = makeDeps('Resposta com fonte.', hits);
    const res = await runAppAssistant(
      { message: 'Como crio um cliente?', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.citations).toEqual([
      { collection: 'faq', docId: 'd1', title: 'Como criar cliente' },
      { collection: 'guias', docId: 'd2', title: 'Guia' },
    ]);
  });

  it('parses + validates the actions block and strips it from the reply', async () => {
    const oneShotText = [
      'Vou tratar disso.',
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}},{"toolName":"app_action__desconhecida","input":{}}]',
      '```',
    ].join('\n');
    const deps = makeDeps(oneShotText);
    const res = await runAppAssistant(
      { message: 'Cria a cliente Ana', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.actions).toEqual([
      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
    ]); // unknown dropped, resolved AppAction attached
    expect(res.reply).toBe('Vou tratar disso.');
    expect(res.reply).not.toContain('ekoa-actions');
  });

  it('an app with no manifest has no operate surface (all requested actions dropped)', async () => {
    const oneShotText = '```ekoa-actions\n[{"toolName":"app_action__criar_cliente","input":{}}]\n```texto';
    const deps = makeDeps(oneShotText);
    const res = await runAppAssistant(
      { message: 'Cria algo', owner: OWNER, artifactId: 'art-1', actionManifest: null },
      deps,
    );
    expect(res.actions).toEqual([]);
    expect(res.reply).toBe('texto');
  });

  it('grounds under the OWNER org and bills the OWNER — never a caller-supplied value', async () => {
    const captured: Captured = {};
    const deps = makeDeps('ok', [], captured);
    await runAppAssistant(
      {
        message: 'Olá',
        // A caller trying to steer the org via context must be ignored — the org comes from owner.
        context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
        owner: OWNER,
        artifactId: 'art-99',
        actionManifest: manifest,
      },
      deps,
    );
    expect(captured.groundInput).toEqual({ orgId: 'org-owner', query: 'Olá', kind: 'chat' });
    expect(captured.attribution).toEqual({
      kind: 'user_work',
      agentType: 'assistant-chat',
      billeeUserId: 'owner-1',
      artifactId: 'art-99',
    });
  });
});
