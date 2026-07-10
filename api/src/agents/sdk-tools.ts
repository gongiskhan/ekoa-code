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
import { KNOWLEDGE_TOOLS, CONTEXT_LOADING_TOOL, DELEGATION_TOOL } from './tools.js';
import { knowledgeToolSearch, knowledgeToolRead, loadContextContent, delegateToLocalTool, type DelegationToolResult } from './seams.js';

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
        'Pesquisa a base de conhecimento da organização. Devolve resultados citados ' +
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
        'Lê um documento completo da base de conhecimento da organização, identificado por ' +
        'coleção + id (tal como citado por knowledge_search).',
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

/** Egress budget when the model omits one; the daemon still caps per session (§18.2.1, S3). */
const DELEGATION_DEFAULT_EGRESS_BYTES = 262_144;
const DELEGATION_MAX_EGRESS_BYTES = 10_000_000;

/**
 * The §5.4.8 `delegate_to_local` tool (ch18 §18.2), chat + build classes. The delegating
 * identity (userId + hosted sessionId) binds from the run's actor at spec-build time — a
 * prompt-injected argument can never delegate as another user or into another session (the
 * same rule the knowledge tools apply to orgId). Cortex passes `task` and `grantRefs` through
 * opaquely (§18.2.1, S1); org + pairing resolve from the live registry inside the bridge.
 */
export function delegateToolSpec(actor: ToolActor, sessionId: string): SdkToolSpec {
  return {
    name: DELEGATION_TOOL,
    description:
      'Delega uma tarefa de ficheiros locais na ponte emparelhada do utilizador (ekoa-bridge). ' +
      'A ponte executa a tarefa dentro das pastas autorizadas e devolve apenas resultado derivado ' +
      '(resposta, citações, propostas de alteração); o conteúdo bruto dos ficheiros nunca entra ' +
      'nesta conversa. Use quando o utilizador pedir para ler, procurar ou alterar ficheiros no ' +
      'computador dele, com um grantRef que ele tenha fornecido na conversa. O campo task é um ' +
      'TaskProgram em JSON (contrato da ponte, ch18): {"v":1,"steps":[...],"answer"?:"texto final",' +
      '"compose"?:{"provider":true,"instructions":"..."}}. Passos: {"tool":"read"|"list"|"glob"|' +
      '"grep"|"stat"|"extract_text"|"write","grantRef":"g-...","relPath":"caminho/relativo",...}; ' +
      'read/extract_text aceitam "as":"nome" e "cite":true para citar; grep usa "pattern"; write ' +
      'exige "confirmed":true e "expectedSha256":null para criar um ficheiro novo (reescrever um ' +
      'existente exige o sha256 atual dos bytes). Com compose.provider:true a ponte compõe a ' +
      'resposta a partir do conteúdo lido segundo as instruções; sem compose, defina answer. Se a ' +
      'ponte estiver offline o resultado é unreachable; nunca há upload de ficheiros.',
    inputSchema: {
      task: z.string().min(2).describe('O TaskProgram em JSON (ver o formato na descrição da ferramenta)'),
      grantRefs: z
        .array(z.string().min(1))
        .min(1)
        .describe('Referências de autorização (grantRef) que o utilizador forneceu na conversa'),
      egressBytes: z
        .number()
        .int()
        .positive()
        .max(DELEGATION_MAX_EGRESS_BYTES)
        .optional()
        .describe('Orçamento de bytes de saída (por omissão 262144)'),
    },
    handler: async (args) => {
      const task = String(args.task ?? '');
      const grantRefs = Array.isArray(args.grantRefs) ? args.grantRefs.map((g) => String(g)) : [];
      const egressBytes = typeof args.egressBytes === 'number' ? args.egressBytes : DELEGATION_DEFAULT_EGRESS_BYTES;
      const result = await delegateToLocalTool(
        { userId: actor.userId, sessionId },
        { task, grantRefs, budget: { egressBytes, modelSpend: { userId: actor.userId } } },
      );
      return formatDelegationResult(result);
    },
  };
}

/** Render the derived-only result for the model: honest terminal states, then answer +
 *  citations + patch proposals + ledger refs (§18.2.2). */
function formatDelegationResult(r: DelegationToolResult): string {
  if (r.status === 'unreachable') {
    return 'A ponte local não está ligada (status: unreachable). Nada foi carregado; peça ao utilizador para iniciar a ponte (ekoa-bridge serve) e tentar de novo.';
  }
  if (r.status === 'denied') {
    return 'A ponte local recusou a tarefa (status: denied). Verifique o grantRef e se os caminhos pedidos estão dentro da pasta autorizada.';
  }
  if (r.status === 'cap_reached') {
    return `O orçamento de bytes de saída esgotou (status: cap_reached, egressBytes: ${r.telemetry.egressBytes}). Pode repetir com um orçamento maior se o utilizador consentir.`;
  }
  const lines = [`Resultado da ponte local (status: ok, bytes de saída: ${r.telemetry.egressBytes}).`];
  if (r.answer) lines.push(`Resposta derivada:\n${r.answer}`);
  if (r.citations.length) lines.push(`Citações:\n${r.citations.map((c) => `- ${c.path} (${c.range})`).join('\n')}`);
  if (r.patches?.length) lines.push(`Alterações:\n${r.patches.map((p) => `- ${p.path}: ${p.diff}`).join('\n')}`);
  if (r.ledgerRefs.length) lines.push(`Registos no ledger local: ${r.ledgerRefs.join(', ')}`);
  return lines.join('\n\n');
}

/** The build-run `load_context` tool (§5.4.4 build row): pull a named on-demand content
 *  package from the user's composed agent context at runtime (ch08 on-demand files). */
export function loadContextToolSpec(actor: ToolActor, agentKind: 'coding' | 'chat' | 'automation' = 'coding'): SdkToolSpec {
  return {
    name: CONTEXT_LOADING_TOOL,
    description:
      'Carrega um conteúdo de contexto on-demand pelo nome (listado nas secções de contexto ' +
      'do agente). Devolve o conteúdo completo desse pacote.',
    inputSchema: {
      name: z.string().min(1).describe('Nome do conteúdo on-demand'),
    },
    handler: async (args) => {
      const content = await loadContextContent({ userId: actor.userId, agentKind, name: String(args.name ?? '') });
      return content ?? 'Conteúdo não encontrado.';
    },
  };
}
