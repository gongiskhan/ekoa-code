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
 *
 * The three docx tools (2C-S5) live here for the same reason: ekoa-dev shipped them as their own
 * Agent SDK MCP server, which no module outside `llm/` may import (FIXED-3/13), so they are
 * declared as plain specs over the `DocxToolSeams` seam and the chokepoint mounts them.
 */
import { basename, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod/v4';
import type { SdkToolSpec } from '../llm/index.js';
import { isCloudProvider } from '../integrations/app-cloud-files.js';
import type { RedlineOp, RedlineOpFailure } from '../services/docx-redline.js';
import { KNOWLEDGE_TOOLS, CONTEXT_LOADING_TOOL, DELEGATION_TOOL, DOCX_TOOLS, CATALOG_TOOLS } from './tools.js';
import {
  knowledgeToolSearch,
  knowledgeToolRead,
  loadContextContent,
  delegateToLocalTool,
  getDocxToolSeams,
  catalogToolList,
  callIntegrationActionTool,
  callEkoaActionTool,
  startAutomationTool,
  type CatalogToolActor,
  type DelegationToolResult,
} from './seams.js';

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

// --- The six cross-agent catalog tools (K5, D-CORNERSTONE-DOORS) ---------------------------

/** Rows per listing. The layer-4 prompt already describes the top 25 of each kind; the tools exist
 *  for the tail, so they list wider than the prompt does and still stay a bounded tool result. */
const CATALOG_LIST_LIMIT = 40;

/** Cap on a call result's JSON body. A capability can return a whole collection; the model needs
 *  the shape and the head of it, not a megabyte. */
const CALL_RESULT_MAX_CHARS = 4000;

/** Accent- and case-insensitive haystack: `pagamento` must match `Pagamentos` and `Pagaménto`. */
function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Optional substring filter over each row's searchable fields, then the listing cap. */
function narrowRows<T>(rows: T[], rawQuery: unknown, fields: (row: T) => string[]): { shown: T[]; total: number } {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  const matched = query
    ? rows.filter((row) => fields(row).some((f) => foldForSearch(f).includes(foldForSearch(query))))
    : rows;
  return { shown: matched.slice(0, CATALOG_LIST_LIMIT), total: matched.length };
}

/** The honest empty: "nothing matched your query" and "you have none at all" are different facts. */
function emptyListing(rawQuery: unknown, kind: string): string {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  return query ? `Nada em ${kind} corresponde a "${query}".` : `Não há ${kind} disponíveis para este utilizador.`;
}

function listingText(header: string, lines: string[], total: number): string {
  const out = [`${header} (${total}${total > lines.length ? `, a mostrar ${lines.length}` : ''}):`, ...lines];
  if (total > lines.length) out.push(`… e mais ${total - lines.length}. Restringe com o argumento query.`);
  return out.join('\n');
}

/** Compact JSON for a tool result, truncated honestly (the model must not read a cut body as whole). */
function compactResultJson(data: unknown): string {
  if (data === undefined) return '(sem dados)';
  let text: string;
  try {
    text = JSON.stringify(data) ?? String(data);
  } catch {
    text = String(data);
  }
  return text.length > CALL_RESULT_MAX_CHARS ? `${text.slice(0, CALL_RESULT_MAX_CHARS)}… (resultado truncado)` : text;
}

/**
 * The six tools the layer-4 catalog prompt (automation/catalog.ts) has always named: three that
 * SEARCH the actor's catalog and three that INVOKE an entry from it.
 *
 * Every handler runs under the bound `actor` and passes it to the seam itself: an argument naming
 * another user or org is not read, so a prompt-injected message cannot run another tenant's
 * automation (the same construction the knowledge tools use for `orgId`).
 *
 * The invoking three own NO policy. `call_integration_action` goes through the ONE integration
 * executor, so the write-consent gate and the credential halt answer for a chat turn exactly as
 * they do for a schedule; `call_automation` goes through the owner-scoped `startRun`;
 * `call_ekoa_action` through the org-scoped recipe interpreter. What the tools add is the
 * TRANSLATION of those coded outcomes into something a model can act on — above all that
 * `awaiting_consent` and `needs_credentials` are waiting on a human, not failures to retry.
 */
export function catalogToolSpecs(actor: ToolActor): SdkToolSpec[] {
  const bound: CatalogToolActor = { userId: actor.userId, orgId: actor.orgId };
  const [listAutomations, listIntegrationActions, listEkoaActions, callAutomation, callIntegrationAction, callEkoaAction] =
    CATALOG_TOOLS;
  const queryArg = z.string().optional().describe('Termos de pesquisa (opcional) — filtra por nome, chave ou descrição');
  const argsArg = z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Argumentos da chamada, tal como descritos no catálogo');

  return [
    {
      name: listAutomations,
      description:
        'Lista as sequências (automations) do utilizador, opcionalmente filtradas por termos de ' +
        'pesquisa. Devolve nome, id, descrição e entradas de cada uma. As que têm gatilho correm ' +
        'sozinhas — não as invoques sem o utilizador o pedir explicitamente.',
      inputSchema: { query: queryArg },
      handler: async (args) => {
        const rows = (await catalogToolList(bound)).automations;
        const { shown, total } = narrowRows(rows, args.query, (a) => [a.name, a.id, a.description]);
        if (!total) return emptyListing(args.query, 'sequências');
        const lines = shown.map((a) => {
          const inputs = a.inputs.length
            ? ` [entradas: ${a.inputs.map((i) => `${i.name}${i.required ? '*' : ''}`).join(', ')}]`
            : '';
          const trigger = a.trigger
            ? ` [gatilho ${a.trigger.kind}: ${a.trigger.integrationKey}/${a.trigger.eventName} — corre sozinha]`
            : '';
          return `- ${a.name} (id: ${a.id}): ${a.description}${inputs}${trigger}`;
        });
        return listingText('Sequências', lines, total);
      },
    },
    {
      name: listIntegrationActions,
      description:
        'Lista as ações de integração disponíveis para o utilizador, opcionalmente filtradas por ' +
        'termos de pesquisa. Devolve a chave da integração, o nome da ação, o que faz e os ' +
        'argumentos. As ações marcadas [escrita] precisam da aprovação do dono antes de correr.',
      inputSchema: { query: queryArg },
      handler: async (args) => {
        const rows = (await catalogToolList(bound)).integrationActions;
        const { shown, total } = narrowRows(rows, args.query, (a) => [a.integrationKey, a.actionName, a.description]);
        if (!total) return emptyListing(args.query, 'ações de integração');
        const lines = shown.map(
          (a) =>
            `- ${a.integrationKey}.${a.actionName}(${a.argsSummary}): ${a.description}${a.mutates ? ' [escrita]' : ''}`,
        );
        return listingText('Ações de integração', lines, total);
      },
    },
    {
      name: listEkoaActions,
      description:
        'Lista as capacidades das aplicações Ekoa do utilizador (ações Ekoa), opcionalmente ' +
        'filtradas por termos de pesquisa. Devolve o slug da aplicação, o nome da capacidade, o ' +
        'que faz e os argumentos.',
      inputSchema: { query: queryArg },
      handler: async (args) => {
        const rows = (await catalogToolList(bound)).ekoaActions;
        const { shown, total } = narrowRows(rows, args.query, (e) => [
          e.artifactSlug,
          e.artifactName,
          e.capabilityName,
          e.description,
        ]);
        if (!total) return emptyListing(args.query, 'ações Ekoa');
        const lines = shown.map(
          (e) =>
            `- ${e.artifactSlug}.${e.capabilityName}(${e.argsSummary}): ${e.description} [app: ${e.artifactName}]${e.mutates ? ' [escrita]' : ''}`,
        );
        return listingText('Ações Ekoa', lines, total);
      },
    },
    {
      name: callAutomation,
      description:
        'Inicia uma sequência (automation) do utilizador pelo seu id, com as entradas que ela ' +
        'declara. NÃO espera pelo fim: devolve o id da execução e a execução continua em segundo ' +
        'plano. Não invoques sequências com gatilho (correm sozinhas) sem o utilizador o pedir.',
      inputSchema: {
        automationId: z.string().min(1).describe('Id da sequência (tal como listado por list_automations)'),
        inputs: z.record(z.string(), z.unknown()).optional().describe('Entradas declaradas pela sequência'),
      },
      handler: async (args) => {
        const automationId = String(args.automationId ?? '');
        const inputs = isPlainRecord(args.inputs) ? args.inputs : {};
        const result = await startAutomationTool(bound, { automationId, inputs });
        if (!result.success || !result.runId) {
          return `Não foi possível iniciar a sequência ${automationId} (${result.code ?? 'desconhecido'}): ${result.error ?? 'sem detalhe'}.`;
        }
        return (
          `Sequência ${automationId} iniciada (execução ${result.runId}). Está a correr em segundo plano — ` +
          'não esperes por ela nesta resposta; o progresso e o resultado aparecem na página da automação.'
        );
      },
    },
    {
      name: callIntegrationAction,
      description:
        'Executa uma ação de integração do utilizador (tal como listada por ' +
        'list_integration_actions). Uma ação de escrita só corre depois de o dono a aprovar; se ' +
        'faltarem credenciais, a execução fica em espera da cerimónia de credenciais.',
      inputSchema: {
        integrationKey: z.string().min(1).describe('Chave da integração (ex.: slack)'),
        actionName: z.string().min(1).describe('Nome da ação'),
        args: argsArg,
      },
      handler: async (args) => {
        const integrationKey = String(args.integrationKey ?? '');
        const actionName = String(args.actionName ?? '');
        const callArgs = isPlainRecord(args.args) ? args.args : {};
        const result = await callIntegrationActionTool(bound, { integrationKey, actionName, args: callArgs });
        const what = `${integrationKey}.${actionName}`;
        if (result.success) return `Ação ${what} executada.\n${compactResultJson(result.data)}`;
        if (result.code === 'awaiting_consent') {
          return (
            `A ação ${what} escreve e precisa da aprovação do dono antes de correr. NÃO foi executada e ` +
            'não deve ser repetida já: diz ao utilizador para a aprovar na página da integração ' +
            `(Integrações → ${integrationKey}) e volta a tentar depois de ele confirmar.`
          );
        }
        if (result.code === 'needs_credentials') {
          return (
            `A execução de ${what} ficou EM ESPERA: faltam credenciais e a execução parou para a ` +
            'cerimónia de credenciais. Nada falhou — diz ao utilizador para completar a ligação ' +
            `(Integrações → ${integrationKey}); a execução retoma a partir daí.`
          );
        }
        return `A ação ${what} falhou (${result.code ?? 'desconhecido'}): ${result.error ?? 'sem detalhe'}.`;
      },
    },
    {
      name: callEkoaAction,
      description:
        'Executa uma capacidade de uma aplicação Ekoa do utilizador (tal como listada por ' +
        'list_ekoa_actions), identificada pelo slug da aplicação e pelo nome da capacidade.',
      inputSchema: {
        artifactSlug: z.string().min(1).describe('Slug da aplicação Ekoa'),
        capabilityName: z.string().min(1).describe('Nome da capacidade'),
        args: argsArg,
      },
      handler: async (args) => {
        const artifactSlug = String(args.artifactSlug ?? '');
        const capabilityName = String(args.capabilityName ?? '');
        const callArgs = isPlainRecord(args.args) ? args.args : {};
        const result = await callEkoaActionTool(bound, { artifactSlug, capabilityName, args: callArgs });
        const what = `${artifactSlug}.${capabilityName}`;
        if (result.success) return `Ação Ekoa ${what} executada.\n${compactResultJson(result.data)}`;
        return `A ação Ekoa ${what} falhou (${result.code ?? 'desconhecido'}): ${result.error ?? 'sem detalhe'}.`;
      },
    },
  ];
}

/** A tool argument is whatever the model sent: only a plain object is usable as an args bag. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
export function delegateToolSpec(
  actor: ToolActor,
  sessionId: string,
  /** Run-scoped collector (FC-402, run s5): the chat pipeline joins the turn's delegation
   *  results (citations + ledgerRefs) with the buffered ledger rows into `local_activity`. */
  onResult?: (result: DelegationToolResult) => void,
): SdkToolSpec {
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
      'exige "expectedSha256":null para criar um ficheiro novo (reescrever um existente exige o ' +
      'sha256 atual dos bytes) e SÓ é permitida depois de o utilizador a confirmar — o campo ' +
      '"confirmed" é dado pelo Cortex a partir dessa confirmação e NUNCA deve ser escrito por si: ' +
      'uma tarefa que o traga é recusada por inteiro. Com compose.provider:true a ponte compõe a ' +
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
        { userId: actor.userId, orgId: actor.orgId, sessionId },
        { task, grantRefs, budget: { egressBytes, modelSpend: { userId: actor.userId } } },
      );
      onResult?.(result);
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

// --- The three ekoa-docx tools (2C-S5; ch07 document base v2) -----------------------------

/**
 * Ported from ekoa-dev cortex/src/adapters/docx-mcp.ts, which built its own SDK MCP server.
 * It does NOT port as-is: only `api/src/llm/` may import the provider SDK (FIXED-3/13), so the
 * three tools are re-expressed as ordinary `SdkToolSpec`s and the chokepoint mounts them on the
 * one `ekoa` in-process MCP server like every other tool. Nothing else changes for the model:
 * edits still land as NATIVE Word Track Changes (w:ins/w:del, attributed author + date) and
 * NATIVE Word comments, preserving the original formatting - the lawyer opens the result in
 * Word's review pane.
 *
 * CONTEXT-BOUND, like dev: the specs are built per run with the artifact appId (build.ts binds
 * appId = artifactId), the acting user's name (revision attribution) and the directories a
 * `path` argument may resolve into. The collaborators (document lifecycle, redline engine,
 * link/cloud ingest) arrive through the `DocxToolSeams` seam wired at the composition root, so
 * this module stays collaborator-free and the tools are testable without booting the stack.
 */
export interface DocxToolContext {
  /** Artifact/app id whose linked document the no-path tools operate on. */
  appId?: string;
  /** Acting user's display name - revisions are attributed "<name> (Ekoa)". */
  userName?: string;
  /** Directories `path` arguments may resolve into (the run's projectDir; attachments once the
   *  DESCOPED chat-attachment path lands). */
  allowedDirs: string[];
}

/** VERBATIM from dev (prompt-engineering artifact: the model reads CriticMarkup through it). */
const PROJECTION_LEGEND = [
  'Legend: {++text++} = tracked insertion, {--text--} = tracked deletion (native Word Track Changes).',
  '{>>[Chg:N] author<<} = pending tracked change N - accept/reject ops take N as target_id.',
  '{>>[Com:N] author: text<<} = comment thread N - reply/resolve/unresolve ops take N as target_id.',
  'A "(RESOLVED)" suffix after the date means that comment thread is already marked done in Word.',
].join('\n');

/** VERBATIM from dev (prompt-engineering artifact: it teaches the model how to insert paragraphs
 *  without breaking the document's real numbering). */
const MODIFY_GUIDANCE =
  "modify: replacement text. '' = tracked delete. Equal to target_text (plus comment) = comment-only. " +
  "To insert new paragraphs, keep target_text unchanged at the start of new_text and append '\\n' lines: " +
  "plain lines continue the anchor paragraph's style INCLUDING clause numbering, a '# ' prefix makes a Heading 1. " +
  "NEVER start an inserted line with a '1.' style marker - it breaks the document's real numbering.";

/** Dev's `textResult`: the SDK tool-result contract is TEXT, so structured payloads ship as the
 *  same pretty JSON string dev's MCP bridge produced (the model parses it identically). */
function jsonResult(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve a caller-supplied path strictly INSIDE one of the allowed dirs (dev's rule verbatim -
 * the same containment check the SDK applies to additionalDirectories): traversal (`..`,
 * absolute escapes) lands outside every allowed root and is rejected. Note it is a PATH
 * containment check, not a filesystem-realpath one, exactly as the SDK's own rule is; for a
 * build run that is not a privilege boundary anyway (the coding preset already carries
 * Bash/Read over the machine), it keeps the model honest about which document it is reading.
 */
function resolveInAllowedDirs(ctx: DocxToolContext, rawPath: string): string {
  const resolved = resolve(rawPath);
  for (const dir of ctx.allowedDirs) {
    const root = resolve(dir);
    if (resolved === root || resolved.startsWith(root + sep)) return resolved;
  }
  throw new Error(`path is outside the allowed directories: ${rawPath}`);
}

const opSchema = z.object({
  type: z.enum(['modify', 'accept', 'reject', 'reply', 'resolve', 'unresolve']).describe(
    'modify = tracked text change/comment; accept/reject = settle a pending [Chg:N]; reply = answer a [Com:N] thread; ' +
      "resolve/unresolve = mark a [Com:N] thread done or reopen it (Word's Resolve, whole thread).",
  ),
  target_text: z.string().optional().describe(
    'modify: the EXACT text to change, copied verbatim from the projection - accents, spacing and punctuation included.',
  ),
  new_text: z.string().optional().describe(MODIFY_GUIDANCE),
  comment: z.string().optional().describe('Optional Word comment attached to this change.'),
  match_mode: z.enum(['strict', 'first', 'all']).optional().describe(
    "modify: 'strict' (default) fails with an occurrence list when target_text is ambiguous; 'first'/'all' override deliberately.",
  ),
  target_id: z.string().optional().describe(
    'accept/reject/reply/resolve/unresolve: the Chg/Com id (N) from the projection.',
  ),
  text: z.string().optional().describe('reply: the reply text for the comment thread.'),
});

/**
 * A rejected redline batch, or null for any other error. Detected by the error's own name +
 * shape (app-docx.ts's property-based precedent) so this module needs no runtime import of the
 * engine - the real `RedlineBatchError` (services/docx-redline.ts) satisfies it by construction.
 */
function redlineFailures(err: unknown): RedlineOpFailure[] | null {
  const e = err as { name?: unknown; failures?: unknown } | null;
  if (e && e.name === 'RedlineBatchError' && Array.isArray(e.failures)) return e.failures as RedlineOpFailure[];
  return null;
}

/**
 * The three docx tools, context-bound (dev's `buildDocxTools`). Mounted on BUILD runs only
 * (tools.ts `DOCX_TOOLS`), where `appId` is the artifact being built.
 */
export function docxToolSpecs(ctx: DocxToolContext): SdkToolSpec[] {
  const [readName, sourceSetName, applyName] = DOCX_TOOLS;
  return [
    {
      name: readName,
      description:
        'Read a Word document as a CriticMarkup markdown projection showing existing tracked changes and comments. ' +
        "With `path`, reads that .docx file (e.g. a chat attachment); without arguments, reads the artifact's linked document. " +
        'ALWAYS read the projection before editing and copy target_text values EXACTLY from it (accents included).',
      inputSchema: {
        path: z.string().optional().describe('Absolute path to a .docx file inside the allowed directories. Omit to read the linked document.'),
      },
      handler: async (args) => {
        const docx = getDocxToolSeams();
        try {
          if (typeof args.path === 'string' && args.path.trim()) {
            const filePath = resolveInAllowedDirs(ctx, args.path.trim());
            const markdown = await docx.projectBuffer(await readFile(filePath));
            return `${PROJECTION_LEGEND}\n\nFile: ${basename(filePath)}\n\n${markdown}`;
          }
          if (!ctx.appId) {
            return jsonResult({ error: 'No document is linked to this session. Pass `path` to read a specific .docx file.' });
          }
          const { markdown, fileName } = await docx.getProjection(ctx.appId);
          return `${PROJECTION_LEGEND}\n\nFile: ${fileName}\n\n${markdown}`;
        } catch (err) {
          return jsonResult({ error: errText(err) });
        }
      },
    },
    {
      name: sourceSetName,
      description:
        'Link a source Word document (.docx) to this artifact - edits then apply to it with native Word Track Changes. ' +
        'Provide EXACTLY ONE source: `path` (local file), `url` (direct link, OneDrive/SharePoint or Google Drive share link), ' +
        'or `provider` + `fileId`/`query` (workspace cloud storage; `query` searches and picks the best match). ' +
        'Returns the file name and the full projection.',
      inputSchema: {
        path: z.string().optional().describe('Absolute path to a .docx inside the allowed directories.'),
        url: z.string().optional().describe('https link to the document (direct .docx, OneDrive/SharePoint or Google Drive).'),
        provider: z.string().optional().describe("Cloud provider: 'google' or 'microsoft'. Use with fileId or query."),
        fileId: z.string().optional().describe('Cloud file id from a previous listing.'),
        query: z.string().optional().describe('Cloud search terms - the first .docx match is used.'),
      },
      handler: async (args) => {
        const docx = getDocxToolSeams();
        try {
          if (!ctx.appId) {
            return jsonResult({ error: 'No artifact app is bound to this session - the linked document lives on the artifact being built.' });
          }
          const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined;
          const url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : undefined;
          const provider = typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim() : undefined;
          const sourceCount = [path, url, provider].filter(Boolean).length;
          if (sourceCount !== 1) {
            return jsonResult({ error: 'Provide exactly one source: `path`, `url`, or `provider` with `fileId`/`query`.' });
          }

          let buffer: Buffer;
          let fileName: string;
          let origin: string;
          let chosenNote = '';

          if (path) {
            const filePath = resolveInAllowedDirs(ctx, path);
            buffer = await readFile(filePath);
            fileName = basename(filePath);
            origin = 'path';
          } else if (url) {
            const fetched = await docx.fetchFromUrl(url);
            buffer = fetched.buffer;
            fileName = fetched.fileName;
            origin = fetched.source;
          } else {
            if (!provider || !isCloudProvider(provider)) {
              return jsonResult({ error: "provider must be 'google' or 'microsoft'" });
            }
            const fileId = typeof args.fileId === 'string' && args.fileId.trim() ? args.fileId.trim() : undefined;
            const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
            if (!fileId && !query) {
              return jsonResult({ error: 'With `provider`, pass `fileId` or `query`.' });
            }
            const fetched = await docx.fetchFromCloud(provider, { fileId, query });
            buffer = fetched.buffer;
            fileName = fetched.fileName;
            origin = fetched.source;
            if (fetched.chosenFrom) {
              chosenNote = `Chosen from ${fetched.chosenFrom.matches} match(es): "${fetched.chosenFrom.name}".`;
            }
          }

          const status = await docx.setSource(ctx.appId, { buffer, fileName, origin });
          const { markdown } = await docx.getProjection(ctx.appId);
          const header = [`Linked document: ${status.fileName}`, chosenNote].filter(Boolean).join('\n');
          return `${header}\n\n${PROJECTION_LEGEND}\n\n${markdown}`;
        } catch (err) {
          return jsonResult({ error: errText(err) });
        }
      },
    },
    {
      name: applyName,
      description:
        "Apply a batch of edits to the artifact's linked Word document as NATIVE tracked changes/comments. " +
        'The batch is ATOMIC: everything applies or nothing does. Copy each target_text EXACTLY from the projection ' +
        '(accents included), batch related edits together, and use dry_run first for risky batches. ' +
        'On failure the per-op errors (with occurrence lists) are returned so you can fix the targets and retry.',
      inputSchema: {
        ops: z.array(opSchema).min(1).describe('The edit operations, applied as one atomic batch.'),
        dry_run: z.boolean().optional().describe('Validate the whole batch without saving anything.'),
      },
      handler: async (args) => {
        const docx = getDocxToolSeams();
        if (!ctx.appId) {
          return jsonResult({ error: 'No artifact app is bound to this session - link a document with docx_source_set first.' });
        }
        const author = ctx.userName ? `${ctx.userName} (Ekoa)` : 'Ekoa';
        const dryRun = args.dry_run === true;
        try {
          const { report, projection, fileName } = await docx.applyEdits(
            ctx.appId,
            args.ops as RedlineOp[],
            { author, dryRun },
          );
          return jsonResult({
            status: dryRun ? 'dry_run_ok' : 'applied',
            fileName,
            edits_applied: report.edits_applied,
            actions_applied: report.actions_applied,
            occurrences_modified: report.occurrences_modified,
            resolutions_applied: report.resolutions_applied ?? 0,
            projection: `${PROJECTION_LEGEND}\n\n${projection}`,
          });
        } catch (err) {
          const failures = redlineFailures(err);
          if (failures) {
            // Failures come back as TOOL OUTPUT, not a thrown error, so the
            // agent can read adeu's occurrence guidance and self-correct.
            return jsonResult({
              status: 'rejected',
              applied: false,
              failures: failures.map((f) => ({ index: f.index, error: f.error })),
            });
          }
          return jsonResult({ error: errText(err) });
        }
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
