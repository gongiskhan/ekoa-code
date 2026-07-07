/**
 * agents/ public entry (ch02 §2.6, ch05). Agent SDK execution of user work: the job lifecycle,
 * context assembly, and the typed streaming pipeline. `routes/` calls the run-class entry points;
 * `server.ts` wires the injected seams (content loader, knowledge grounding, integration
 * pre-fetch, catalog, verification runner, build mechanics) and calls the boot orphan sweep.
 */

// Run classes.
export { createChatRun, executeChatRun, type StartChatRunInput } from './chat.js';
export { handleBuildCreate, executeBuildJob, type BuildCreateInput, type BuildCreateResult } from './build.js';
export { runBrandResearch, type BrandResearchInput } from './brand-research.js';

// Registry (cancel + introspection consumed by routes/).
export { cancelRun, getRun, liveRunCount } from './registry.js';

// Persistent job registry + boot orphan sweep (server.ts calls sweepOrphans at boot).
export { getJob, jobView, sweepOrphans, type JobRecord } from './jobs.js';

// Injected seams (wired at the composition root).
export {
  setAssembleAgentContext,
  setKnowledgeGrounding,
  setKnowledgeToolSearch,
  setKnowledgeToolRead,
  setLoadContextContent,
  setIntegrationPrefetch,
  setCatalog,
  setVerifyRunner,
  setBuildMechanics,
  type AssembleAgentContext,
  type KnowledgeGroundingFn,
  type KnowledgeToolSearchFn,
  type KnowledgeToolReadFn,
  type KnowledgeToolHit,
  type LoadContextContentFn,
  type VerifyRunnerFn,
  type BuildMechanics,
} from './seams.js';
