/**
 * In-process MCP tool DECLARATIONS per run class (ch05 §5.4.4). tools.ts names the vocabulary
 * (policy); this file binds each name to a description, an input schema, and an actor-scoped
 * handler — the org/user identity comes from the run's actor at bind time, NEVER from tool
 * arguments, so a prompt-injected argument cannot address another org's vault or another
 * user's content (ch09; ch04 §4.4.1 org partitioning).
 *
 * The chokepoint instantiates these specs on the SDK spawn (llm/sdk-tools.ts, FIXED-13); the
 * handlers call the injected seams (seams.ts), so this module stays collaborator-free and the
 * run pipeline is testable without the knowledge/content stacks booted.
 *
 * Schemas are zod/v4 (the SDK's in-process MCP server requires the v4 `_zod` marker; the
 * shared/ contract stays on v3 — see llm/sdk-tools.ts).
 */
import { z } from 'zod/v4';
import type { SdkToolSpec } from '../llm/index.js';
import { KNOWLEDGE_TOOLS, CONTEXT_LOADING_TOOL } from './tools.js';
import { knowledgeToolSearch, knowledgeToolRead, loadContextContent } from './seams.js';

/** The actor identity a tool run is bound to (a subset of the route Actor). */
export interface ToolActor {
  userId: string;
  orgId: string;
}

/** The two §5.4.4 knowledge tools (`knowledge_search`, `knowledge_read`), org-bound. */
export function knowledgeToolSpecs(actor: ToolActor): SdkToolSpec[] {
  const [searchName, readName] = KNOWLEDGE_TOOLS;
  return [
    {
      name: searchName,
      description:
        'Pesquisa a base de conhecimento da organização E o acervo jurídico partilhado ' +
        '(legislação e jurisprudência portuguesas). Devolve resultados citados ' +
        '(coleção/documento + excerto); usa knowledge_read para ler um documento completo.',
      inputSchema: {
        query: z.string().min(1).describe('Termos de pesquisa'),
        limit: z.number().int().min(1).max(20).optional().describe('Máximo de resultados (por omissão 5)'),
      },
      handler: async (args) => {
        const query = String(args.query ?? '');
        const limit = typeof args.limit === 'number' ? args.limit : undefined;
        const hits = await knowledgeToolSearch({ orgId: actor.orgId, query, ...(limit !== undefined ? { limit } : {}) });
        if (!hits.length) return 'Sem resultados na base de conhecimento.';
        return hits
          .map((h) => `- [${h.collection}/${h.docId}] ${h.title}${h.sourceUrl ? ` (${h.sourceUrl})` : ''}\n  ${h.snip}`)
          .join('\n');
      },
    },
    {
      name: readName,
      description:
        'Lê um documento completo da base de conhecimento (da organização ou do acervo ' +
        'jurídico partilhado), identificado por coleção + id (tal como citado por knowledge_search).',
      inputSchema: {
        collection: z.string().min(1).describe('Coleção do documento'),
        docId: z.string().min(1).describe('Id do documento'),
      },
      handler: async (args) => {
        const doc = await knowledgeToolRead({
          orgId: actor.orgId,
          collection: String(args.collection ?? ''),
          docId: String(args.docId ?? ''),
        });
        if (!doc) return 'Documento não encontrado.';
        const source = doc.sourceUrl ? `\nFonte: ${doc.sourceUrl}` : '';
        return `# ${doc.title}${source}\n\n${doc.body}`;
      },
    },
  ];
}

/** The build-run `load_context` tool (§5.4.4 build row): pull a named on-demand content
 *  package from the user's composed agent context at runtime (ch08 on-demand files). */
export function loadContextToolSpec(actor: ToolActor, agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder' = 'coding'): SdkToolSpec {
  return {
    name: CONTEXT_LOADING_TOOL,
    description:
      'Carrega um conteúdo de contexto on-demand pelo nome (listado nas secções de contexto ' +
      'do agente). Devolve o conteúdo completo desse pacote. Também carrega o conhecimento de ' +
      'uma integração configurada com o nome `integration-<chave>` (ex.: `integration-slack`).',
    inputSchema: {
      name: z.string().min(1).describe('Nome do conteúdo on-demand'),
    },
    handler: async (args) => {
      const content = await loadContextContent({ userId: actor.userId, agentKind, name: String(args.name ?? '') });
      return content ?? 'Conteúdo não encontrado.';
    },
  };
}
