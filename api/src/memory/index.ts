/**
 * memory/ public entry (ch02 §2.6, ch05 §5.8). Organizational memory: the CRUD + resolver
 * (consumed by the memory router and by `agents/` for prompt injection), the deterministic
 * term-overlap injection resolver, the post-run extraction pipeline (P-12, ON by default), and
 * the deterministic integration-affinity writer (`integrations/` calls it). This module makes no
 * model calls except the single FAST post-run extraction call, which goes through `llm/`.
 */
export {
  type MemoryDoc,
  type MemoryDeps,
  memoryView,
  listVisibleMemories,
  getVisibleMemory,
  memoryWriteGuard,
  resolveMemoryBlock,
  resolveMemoryInjection,
  createMemory,
  updateMemory,
  deleteMemory,
} from './resolver.js';

export { runPostRunExtraction, type ExtractionInput } from './extraction.js';
export { writeIntegrationAffinity, type AffinityInput } from './integration-affinity.js';
