/**
 * The three ekoa-docx agent tools (2C-S5 port of cortex/tests/docx/docx-mcp.test.ts).
 *
 * Dev exercised its MCP server's tool handlers directly (`buildDocxTools`); ekoa-code cannot
 * ship that server outside `api/src/llm/` (FIXED-3/13), so the same three tools are
 * `SdkToolSpec`s (agents/sdk-tools.ts `docxToolSpecs`) whose handlers return STRINGS and whose
 * collaborators arrive through the `DocxToolSeams` seam. Every dev assertion is preserved:
 * source_set by path, projection read, apply_edits producing REAL w:ins in the stored current
 * blob, path-traversal rejection, and a rejected batch surfacing as tool CONTENT (never a throw)
 * so the agent can self-correct. The seam is bound to the REAL document-source + redline engine
 * over a temp EKOA_DATA_DIR + the contrato fixture, so these are end-to-end over real .docx
 * bytes; only the cloud/url ingest (its own orchestration is covered in docx-fetch.test.ts) is a
 * stub, replacing dev's `vi.mock` of the fetch module.
 *
 * Added on top of the port (this repo's rules): the tool names must be the DOCX_TOOLS policy
 * names and must translate to the one `ekoa` in-process MCP server (the chokepoint mount proof),
 * a deterministic generative sweep over the path jail (fast-check is not a repo dep - the
 * document-source suite set the precedent), the RedlineBatchError->content mapping pinned
 * independently of the engine's own message, and the honest not-wired default.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import JSZip from 'jszip';

import { makeContratoFixture } from '../services/docx/contrato-fixture.js';
import { docxToolSpecs, type DocxToolContext } from '../../src/agents/sdk-tools.js';
import { DOCX_TOOLS, toolPolicyFor } from '../../src/agents/tools.js';
import { setDocxToolSeams, __resetAgentSeamsForTests } from '../../src/agents/seams.js';
import { mcpToolName, translateAllowedTools } from '../../src/llm/sdk-tools.js';
import { RedlineBatchError, projectDocx } from '../../src/services/docx-redline.js';

const APP_ID = 'dev-revisao-contratos';
const USER_NAME = 'Dra. Ana Marques';

let prevDataDir: string | undefined;
let dataDir: string;
let attachDir: string;
let fixturePath: string;
let documentSource: typeof import('../../src/apps/document-source.js');

/** The cloud/url ingest branches (dev mocked the module; here they are seam stubs). */
const fetchFromCloud = vi.fn();
const fetchFromUrl = vi.fn();

type Spec = { name: string; handler: (args: Record<string, unknown>) => Promise<string> };

function tools(ctx: DocxToolContext): { read: Spec; sourceSet: Spec; apply: Spec } {
  const [read, sourceSet, apply] = docxToolSpecs(ctx) as Spec[];
  return { read: read!, sourceSet: sourceSet!, apply: apply! };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(result: string): any {
  return JSON.parse(result);
}

/** Bind the seam to the real document pipeline (what server.ts wires at the root). */
function wireSeams(): void {
  setDocxToolSeams({
    projectBuffer: (buffer) => projectDocx(buffer),
    getProjection: (appId) => documentSource.getProjection(appId),
    setSource: async (appId, opts) => {
      const status = await documentSource.setSource(appId, opts);
      return { fileName: status.fileName ?? opts.fileName };
    },
    applyEdits: (appId, ops, opts) => documentSource.applyEdits(appId, ops, opts),
    fetchFromUrl: (url) => fetchFromUrl(url),
    fetchFromCloud: (provider, opts) => fetchFromCloud(provider, opts),
  });
}

async function currentDocumentXml(): Promise<string> {
  const blob = await readFile(join(dataDir, 'app-data', APP_ID, 'docx', 'document-current.docx'));
  const zip = await JSZip.loadAsync(blob);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml missing');
  return file.async('string');
}

beforeAll(async () => {
  prevDataDir = process.env.EKOA_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'ekoa-docx-tools-'));
  process.env.EKOA_DATA_DIR = dataDir;
  attachDir = join(dataDir, 'attachments');
  mkdirSync(attachDir, { recursive: true });
  fixturePath = join(attachDir, 'contrato.docx');
  writeFileSync(fixturePath, await makeContratoFixture());
  documentSource = await import('../../src/apps/document-source.js');
  wireSeams();
});

afterAll(() => {
  __resetAgentSeamsForTests();
  if (prevDataDir === undefined) delete process.env.EKOA_DATA_DIR;
  else process.env.EKOA_DATA_DIR = prevDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('ekoa-docx agent tools', () => {
  const ctx: DocxToolContext = { appId: APP_ID, userName: USER_NAME, allowedDirs: [] };
  // allowedDirs is set in beforeAll (attachDir does not exist at module load)
  beforeAll(() => {
    ctx.allowedDirs = [attachDir];
  });

  it('declares the three DOCX_TOOLS, mounted on build runs through the ONE ekoa MCP server', () => {
    expect([...DOCX_TOOLS]).toEqual(['docx_read', 'docx_source_set', 'docx_apply_edits']);
    const specs = docxToolSpecs(ctx);
    expect(specs.map((s) => s.name)).toEqual([...DOCX_TOOLS]);
    // Build policy carries them; chat/text runs must NOT (they are artifact-bound).
    const build = toolPolicyFor('build');
    for (const t of DOCX_TOOLS) expect(build.allowedTools).toContain(t);
    for (const runClass of ['chat', 'text-attachments'] as const) {
      for (const t of DOCX_TOOLS) expect(toolPolicyFor(runClass).allowedTools ?? []).not.toContain(t);
    }
    // The chokepoint (llm/sdk-tools.ts) is what mounts them: the policy names translate to the
    // single in-process server's wire names - dev's `mcp__ekoa-docx__*` server is gone.
    expect(translateAllowedTools([...DOCX_TOOLS], specs)).toEqual([
      mcpToolName('docx_read'),
      mcpToolName('docx_source_set'),
      mcpToolName('docx_apply_edits'),
    ]);
    expect(mcpToolName('docx_read')).toBe('mcp__ekoa__docx_read');
  });

  it('docx_source_set by path links the document and returns the projection', async () => {
    const { sourceSet } = tools(ctx);
    const out = await sourceSet.handler({ path: fixturePath });
    expect(out).toContain('Linked document: contrato.docx');
    expect(out).toContain('{++'); // legend present
    expect(out).toContain('CONTRATO DE PRESTA'); // projected body
  });

  it('docx_source_set validates exactly-one-source and rejects traversal', async () => {
    const { sourceSet } = tools(ctx);
    const none = parse(await sourceSet.handler({}));
    expect(none.error).toContain('exactly one source');
    const both = parse(await sourceSet.handler({ path: fixturePath, url: 'https://x.example/a.docx' }));
    expect(both.error).toContain('exactly one source');
    const escape = parse(await sourceSet.handler({ path: join(attachDir, '..', 'users.json') }));
    expect(escape.error).toContain('outside the allowed directories');
  });

  it('docx_read without path returns the linked projection with the 4-line legend', async () => {
    const { read } = tools(ctx);
    const out = await read.handler({});
    expect(out).toContain('{++text++}');
    expect(out).toContain('[Chg:N]');
    expect(out).toContain('[Com:N]');
    expect(out).toContain('(RESOLVED)'); // the 4th legend line - resolution state
    expect(out).toContain('File: contrato.docx');
    expect(out).toContain('aviso pr'); // PT accents survive projection
  });

  it('docx_read with a path reads that file; traversal is rejected', async () => {
    const { read } = tools(ctx);
    const out = await read.handler({ path: fixturePath });
    expect(out).toContain('CONTRATO DE PRESTA');
    const escape = parse(await read.handler({ path: '/etc/hosts' }));
    expect(escape.error).toContain('outside the allowed directories');
  });

  it('the path jail admits only paths that resolve INSIDE an allowed dir (generative sweep)', async () => {
    const { read } = tools(ctx);
    // Deterministic generative sweep (fast-check is not a repo dep - same approach as the
    // document-source suite). Every candidate that does not resolve under attachDir must be
    // refused with the containment message, never read.
    const segments = ['..', '../..', 'a/../..', './..', '.', 'sub', 'contrato.docx', '%2e%2e', '..%2f..', 'a\\..\\..'];
    const prefixes = ['', attachDir + sep, attachDir + sep + 'x' + sep, '/etc/', dataDir + sep, `${attachDir}/`];
    const suffixes = ['', '/users.json', '/etc/passwd', '/contrato.docx', `${sep}..${sep}secret`];
    let checked = 0;
    for (const p of prefixes) {
      for (const s of segments) {
        for (const suf of suffixes) {
          const candidate = `${p}${s}${suf}`;
          if (!candidate.trim()) continue;
          const resolved = resolve(candidate);
          const inside = resolved === resolve(attachDir) || resolved.startsWith(resolve(attachDir) + sep);
          const out = await read.handler({ path: candidate });
          checked++;
          if (inside) {
            // Inside the jail: either the file projects, or it fails for a NON-containment
            // reason (missing file / not a .docx) - never the containment refusal.
            expect(out).not.toContain('outside the allowed directories');
          } else {
            expect(parse(out).error).toBe(`path is outside the allowed directories: ${candidate}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(250);
  });

  it('docx_apply_edits (dry_run) validates without touching the stored blob', async () => {
    const before = await currentDocumentXml();
    const { apply } = tools(ctx);
    const out = parse(await apply.handler({
      ops: [{ type: 'modify', target_text: 'aviso prévio de 30 dias', new_text: 'aviso prévio de 60 dias' }],
      dry_run: true,
    }));
    expect(out.status).toBe('dry_run_ok');
    expect(out.edits_applied).toBe(1);
    expect(await currentDocumentXml()).toBe(before);
  });

  it('docx_apply_edits commits native w:ins attributed to "<user> (Ekoa)"', async () => {
    const { apply } = tools(ctx);
    const out = parse(await apply.handler({
      ops: [{
        type: 'modify',
        target_text: 'aviso prévio de 30 dias',
        new_text: 'aviso prévio de 60 dias',
        comment: 'Prazo alargado por acordo.',
      }],
    }));
    expect(out.status).toBe('applied');
    expect(out.projection).toContain('{++');

    const xml = await currentDocumentXml();
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain(`w:author="${USER_NAME} (Ekoa)"`);
  });

  it('ambiguous strict target returns per-op failures as CONTENT, not a throw', async () => {
    const { apply } = tools(ctx);
    // 'Prestadora' occurs many times - strict mode must reject with guidance.
    const out = parse(await apply.handler({
      ops: [{ type: 'modify', target_text: 'Prestadora', new_text: 'Prestadora de Serviços' }],
    }));
    expect(out.status).toBe('rejected');
    expect(out.applied).toBe(false);
    expect(out.failures.length).toBeGreaterThan(0);
    expect(out.failures[0].index).toBe(0);
    expect(out.failures[0].error.toLowerCase()).toContain('occurrence');
  });

  it('a RedlineBatchError from the seam maps to rejected CONTENT (agent self-correction), never a throw', async () => {
    // Pins the load-bearing mapping independently of the engine's own message: a rejected batch
    // must reach the MODEL as a tool result it can act on. A throw here would surface as an
    // is_error tool result (llm/sdk-tools.ts wrapHandler) and the agent would learn nothing.
    setDocxToolSeams({
      projectBuffer: (buffer) => projectDocx(buffer),
      getProjection: (appId) => documentSource.getProjection(appId),
      setSource: async () => ({ fileName: 'x.docx' }),
      applyEdits: async () => {
        throw new RedlineBatchError([
          { index: 0, error: "Ambiguous target 'Prestadora': 7 occurrences. Use match_mode." },
          { index: 2, error: 'Target text not found.' },
        ]);
      },
      fetchFromUrl: (url) => fetchFromUrl(url),
      fetchFromCloud: (provider, opts) => fetchFromCloud(provider, opts),
    });
    const { apply } = tools(ctx);
    const raw = await apply.handler({ ops: [{ type: 'modify', target_text: 'a', new_text: 'b' }] });
    const out = parse(raw);
    expect(out).toEqual({
      status: 'rejected',
      applied: false,
      failures: [
        { index: 0, error: "Ambiguous target 'Prestadora': 7 occurrences. Use match_mode." },
        { index: 2, error: 'Target text not found.' },
      ],
    });

    // Any OTHER failure is an honest single error (still content, never a crash).
    setDocxToolSeams({
      projectBuffer: (buffer) => projectDocx(buffer),
      getProjection: (appId) => documentSource.getProjection(appId),
      setSource: async () => ({ fileName: 'x.docx' }),
      applyEdits: async () => {
        throw new Error('disco cheio');
      },
      fetchFromUrl: (url) => fetchFromUrl(url),
      fetchFromCloud: (provider, opts) => fetchFromCloud(provider, opts),
    });
    expect(parse(await tools(ctx).apply.handler({ ops: [{ type: 'accept', target_id: '1' }] }))).toEqual({ error: 'disco cheio' });
    wireSeams();
  });

  it('artifact-bound tools refuse when the ctx has no appId (the DESCOPED chat-readonly shape)', async () => {
    const chatCtx: DocxToolContext = { allowedDirs: [attachDir] };
    const { read, sourceSet, apply } = tools(chatCtx);
    // read WITH a path still works (that is the chat-attachment use case)
    expect(await read.handler({ path: fixturePath })).toContain('CONTRATO');
    expect(parse(await read.handler({})).error).toContain('No document is linked');
    expect(parse(await sourceSet.handler({ path: fixturePath })).error).toContain('No artifact app');
    expect(parse(await apply.handler({ ops: [{ type: 'accept', target_id: '1' }] })).error).toContain('No artifact app');
  });

  it('docx_source_set provider branch validates inputs and surfaces service errors as content', async () => {
    const { sourceSet } = tools(ctx);
    const bad = parse(await sourceSet.handler({ provider: 'dropbox', query: 'contrato' }));
    expect(bad.error).toContain("provider must be 'google' or 'microsoft'");
    const noRef = parse(await sourceSet.handler({ provider: 'google' }));
    expect(noRef.error).toContain('pass `fileId` or `query`');
    expect(fetchFromCloud).not.toHaveBeenCalled();

    fetchFromCloud.mockRejectedValueOnce(new Error('No Word document matched "inexistente" in google.'));
    const miss = parse(await sourceSet.handler({ provider: 'google', query: 'inexistente' }));
    expect(miss.error).toBe('No Word document matched "inexistente" in google.');
  });

  it('docx_source_set by provider+query links via the ingest seam and reports the chosen file', async () => {
    fetchFromCloud.mockResolvedValueOnce({
      buffer: await makeContratoFixture(),
      fileName: 'Contrato Cloud.docx',
      source: 'cloud:google',
      chosenFrom: { matches: 3, name: 'Contrato Cloud.docx' },
    });
    const { sourceSet } = tools(ctx);
    const out = await sourceSet.handler({ provider: 'google', query: 'contrato' });
    expect(fetchFromCloud).toHaveBeenCalledWith('google', { fileId: undefined, query: 'contrato' });
    expect(out).toContain('Linked document: Contrato Cloud.docx');
    expect(out).toContain('Chosen from 3 match(es): "Contrato Cloud.docx".');
    expect(out).toContain('CONTRATO DE PRESTA');
  });

  it('an unwired root degrades honestly: every tool answers "not wired" as content', async () => {
    __resetAgentSeamsForTests();
    const { read, sourceSet, apply } = tools(ctx);
    expect(parse(await read.handler({})).error).toContain('not wired');
    expect(parse(await read.handler({ path: fixturePath })).error).toContain('not wired');
    expect(parse(await sourceSet.handler({ path: fixturePath })).error).toContain('not wired');
    expect(parse(await apply.handler({ ops: [{ type: 'accept', target_id: '1' }] })).error).toContain('not wired');
    wireSeams();
  });
});
