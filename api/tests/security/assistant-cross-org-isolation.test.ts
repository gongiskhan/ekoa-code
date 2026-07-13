/**
 * H5 cross-org knowledge isolation - extended to ASSISTANT RETRIEVAL (BRIEF Phase 10 deliverable 3).
 *
 * The served-app assistant (`POST /api/app-assistant`, app-assistant-route.ts) is header-scoped and
 * visitor-blind: it grounds ONLY under `input.owner.orgId`, the org resolved SERVER-SIDE from the
 * artifact owner (never anything the anonymous visitor supplies). This proves the ISOLATION property
 * of that grounding DETERMINISTICALLY, over the REAL knowledge grounding seam (buildGroundingBlock)
 * with a REAL FTS partition - no LLM turn:
 *
 *   - Seed org A's partition with a distinctive fact and org B's partition with a DIFFERENT
 *     distinctive fact (each token unique + nonsense so an FTS match can only come from that org's
 *     own row; nothing is seeded into the `_shared` corpus, so there is no shared leak either).
 *   - Drive the assistant (runAppAssistant, the pure logic app-assistant-route.ts binds) for an app
 *     OWNED BY ORG A: it can retrieve + cite org A's fact and CANNOT retrieve/cite org B's - the
 *     org-B token never even enters the systemPrompt the model would see. And symmetrically for B.
 *   - A visitor cannot steer the org: a foreign orgId planted in the panel context is ignored;
 *     grounding stays pinned to the owner org.
 *
 * The live end-to-end evidence (a served app's assistant citing a doc that entered its owner org) is
 * folded into the operator-run journey drivers + fees-knowledge.e2e.mjs (owner-org CITED). This is
 * the committed GATE: retrieval isolation, deterministic, over the real index.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexDoc, closeIndex } from '../../src/knowledge/index-store.js';
import { buildGroundingBlock } from '../../src/knowledge/grounding.js';
import { runAppAssistant, type AppAssistantDeps } from '../../src/apps/app-assistant.js';
import type { RouterDecision } from '../../src/llm/index.js';

// Two orgs, two distinctive nonsense tokens. Each fact lives ONLY in its own org's partition, so an
// FTS hit on a token proves the retrieval reached exactly that partition. The tokens carry no digits
// (a clean single FTS token) and never collide.
const ORG_A = 'org-alfa';
const ORG_B = 'org-beta';
const TOKEN_A = 'zephyrquartz';
const TOKEN_B = 'vermilliononyx';
// Bodies deliberately share NO content word with the query below ("codigo interno organizacao"):
// the ONLY FTS-matchable token in each is its distinctive per-org token, so a hit proves the search
// reached exactly that org's partition (a shared common word would let each org match its OWN doc,
// which is correct grounding but muddies the "reached NOTHING" isolation assertions).
const DOC_A = { docId: 'kb-a', collection: 'circulares', title: 'Segredo Alfa', body: `a palavra de acesso alfa e ${TOKEN_A}` };
const DOC_B = { docId: 'kb-b', collection: 'circulares', title: 'Segredo Beta', body: `a palavra de acesso beta e ${TOKEN_B}` };

const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };

interface Captured { systemPrompt?: string }

/** Deps that ground with the REAL org-partitioned builder and capture the systemPrompt the model
 *  would see (so we can assert the FOREIGN org's fact never entered the prompt at all). The one-shot
 *  is canned - this gate never issues a model call. */
function realGroundingDeps(captured: Captured): AppAssistantDeps {
  return {
    oneShot: async (opts) => {
      captured.systemPrompt = opts.systemPrompt ?? '';
      return { text: 'ok', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    },
    ground: buildGroundingBlock, // the REAL org-partitioned grounding seam
    decide: () => DECISION,
  };
}

/** Run the assistant for an app owned by `orgId`, asking about `token`. Returns the citation docIds
 *  and the captured systemPrompt. */
async function ask(orgId: string, token: string) {
  const captured: Captured = {};
  const res = await runAppAssistant(
    {
      message: `Qual e o codigo interno ${token} da organizacao?`,
      // A visitor trying to steer the org via panel context MUST be ignored (org comes from owner).
      context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
      owner: { userId: `owner-${orgId}`, orgId },
      artifactId: `app-${orgId}`,
      actionManifest: null,
    },
    realGroundingDeps(captured),
  );
  return { docIds: res.citations.map((c) => c.docId), systemPrompt: captured.systemPrompt ?? '' };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-xorg-'));
  process.env.EKOA_DATA_DIR = dir;
  indexDoc({ orgId: ORG_A, ...DOC_A, createdAt: '2026-01-01T00:00:00.000Z' });
  indexDoc({ orgId: ORG_B, ...DOC_B, createdAt: '2026-01-01T00:00:00.000Z' });
});
afterEach(async () => {
  closeIndex();
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('served-app assistant retrieval is org-partitioned to the OWNER org (H5 cross-org isolation)', () => {
  it("an org-A app's assistant retrieves + cites org A's fact and NEVER org B's", async () => {
    const a = await ask(ORG_A, TOKEN_A);
    expect(a.docIds).toContain('kb-a'); // org A's own fact is retrievable
    expect(a.docIds).not.toContain('kb-b'); // org B's fact is not
    expect(a.systemPrompt).toContain(TOKEN_A); // org A's fact reached the assistant prompt
    expect(a.systemPrompt).not.toContain(TOKEN_B); // org B's token never entered the prompt
  });

  it("an org-B app's assistant asking for org A's fact retrieves NOTHING (isolation, not just non-citation)", async () => {
    const b = await ask(ORG_B, TOKEN_A); // org-B-owned app, org-A's distinctive token
    expect(b.docIds).not.toContain('kb-a'); // org A's fact is structurally unreachable from org B
    expect(b.docIds).not.toContain('kb-b'); // and org B has no doc matching org A's token
    expect(b.systemPrompt).not.toContain(TOKEN_A);
  });

  it('is symmetric - an org-B app cites org B, an org-A app asking org B\'s token gets nothing', async () => {
    const b = await ask(ORG_B, TOKEN_B);
    expect(b.docIds).toContain('kb-b');
    expect(b.docIds).not.toContain('kb-a');
    expect(b.systemPrompt).toContain(TOKEN_B);

    const a = await ask(ORG_A, TOKEN_B);
    expect(a.docIds).not.toContain('kb-b');
    expect(a.systemPrompt).not.toContain(TOKEN_B);
  });

  it('the owner org, not the visitor context, decides the partition (steering is ignored)', async () => {
    // The context above plants orgId:'attacker-org'; if grounding honoured it, an org-B app asking
    // for org A's token could never even try org A - but more importantly, seeding an attacker org
    // with org A's token must NOT leak. Seed attacker-org with org A's token and confirm the org-A
    // app still only sees its OWN row, and the org-B app sees neither.
    indexDoc({ orgId: 'attacker-org', docId: 'kb-x', collection: 'circulares', title: 'X', body: `codigo ${TOKEN_A}`, createdAt: '2026-01-01T00:00:00.000Z' });
    const a = await ask(ORG_A, TOKEN_A);
    expect(a.docIds).toContain('kb-a');
    expect(a.docIds).not.toContain('kb-x'); // the steered attacker-org partition is never consulted
    const b = await ask(ORG_B, TOKEN_A);
    expect(b.docIds).not.toContain('kb-x');
    expect(b.docIds).not.toContain('kb-a');
  });
});
