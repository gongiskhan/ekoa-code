/**
 * knowledge/ public entry (ch02 §2.6, ch04 §4.4.1). The org-partitioned knowledge vault + lexical
 * index. Consumers reach the module ONLY through this file:
 *  - routes/knowledge.ts uses the service (vault CRUD, uploads, org-admin heal ops).
 *  - agents/ uses the grounding builder + legal-context detector (slot-5, ch08 §8.4).
 *  - server.ts calls backfillKnowledgeIndex() at boot (index is derived data, rebuilt if missing).
 *
 * knowledge/ has NO import path to llm/ (CLAUDE.md, FIXED-3).
 */
export * as knowledgeService from './service.js';
export {
  backfillKnowledgeIndex,
  KnowledgeError,
  type CreateDocumentInput,
} from './service.js';
export { buildGroundingBlock, isLegalContext, type GroundingInput, type GroundingResult } from './grounding.js';
export { closeIndex } from './index-store.js';
// The §5.4.4 in-process knowledge tools' backing functions (org-partitioned by signature; the
// composition root binds them to the agents/ tool seams — agents/ never imports knowledge/).
export { search as searchKnowledgeIndex, type SearchHit } from './index-store.js';
export { readDoc as readKnowledgeDoc } from './vault.js';
