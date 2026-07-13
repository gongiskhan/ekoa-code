import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, jobs, credentials, billingAccounts, tokenEvents } from '../../src/data/stores.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { __setTransportForTests, __resetTransportForTests } from '../../src/llm/client.js';
import { makeFakeTransport } from '../agents/_fake-transport.js';
import {
  __setBrandingPipelineForTests,
  __resetBrandingPipelineForTests,
  type SiteContext,
  type DesignSystem,
  type VisualVibe,
  type RenderedCandidates,
} from '../../src/services/branding/index.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { BrandingResearchResponse, BrandResearchResult, OrgConfig, ErrorEnvelope, Job } from '@ekoa/shared';

/**
 * F4 (batch-1 S6): the branding surface must live at its CONTRACT paths.
 *  - `PUT /api/v1/branding` — the contract path. Only `PUT /api/v1/org/branding` was mounted, so
 *    the declared path 404'd (HTML) and the branding save journey failed.
 *  - `POST /api/v1/branding/research` — never mounted at all, so the brand-research journey failed
 *    at step one, despite `agents/brand-research.ts` existing and working.
 *
 * Research enqueues the EXISTING agent job (no new LLM egress path) and answers the contract's
 * `BrandingResearchResponse { jobId }` — not a job envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

/** An unreachable-site fixture: the pipeline degrades honestly to knowledge-only research. */
function unreachableSite(url: string): SiteContext {
  return {
    url, finalUrl: url, status: 0, ok: false, title: null, description: null, ogSiteName: null,
    ogImage: null, themeColor: null, favicon: null, generator: null, colorCandidates: [], fontCandidates: [], textSample: '',
    error: 'blocked (test)',
  };
}
const okRendered: RenderedCandidates = { ok: true, candidates: [], paintedHexes: [], topFonts: [], chromeColors: [], chromeFonts: [] };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

/** The job is persisted asynchronously after the 202 (the agent fires off the response path),
 *  so poll briefly rather than assume the write already landed. */
async function awaitJob(jobId: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 50; i++) {
    const job = await jobs.get(jobId);
    if (job) return job as unknown as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

/** Poll until the job reaches a terminal state (the research runs async after the 202). */
async function awaitJobDone(jobId: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 200; i++) {
    const job = (await jobs.get(jobId)) as unknown as Record<string, unknown> | null;
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: 'orgA', active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_branding_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  __resetTransportForTests(); __resetCredentialsForTests();
  // Default: the brand-research pipeline reports the site UNREACHABLE, so tests exercise the
  // knowledge fallback deterministically (no network, browser, dembrandt, or vibe model call).
  // The grounded test overrides this with a full reachable pipeline + fixture data.
  __resetBrandingPipelineForTests();
  __setBrandingPipelineForTests({ fetchSiteContext: async (url) => unreachableSite(url) });
  for (const s of [users, orgs, jobs, credentials, billingAccounts, tokenEvents]) await s.deleteMany({});
  await orgs.insert({ _id: 'orgA', name: 'Org A', displayName: 'Org A', createdAt: 'x' } as never);
});
afterEach(() => { __resetBrandingPipelineForTests(); });

describe('PUT /api/v1/branding (the contract path)', () => {
  it('org-admin saves branding at the contract path and gets an OrgConfig back', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding', t, {
      method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#123456' }, displayName: 'Nova Marca' }),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(OrgConfig.safeParse(body).success).toBe(true);
    expect((body.branding as Record<string, unknown>).primaryColor).toBe('#123456');
    expect(body.displayName).toBe('Nova Marca');
  });

  it('a builder gets a 403 envelope; nothing is saved', async () => {
    await mkUser('bob', 'user');
    const t = await tokenFor('bob');
    const res = await authed('/api/v1/branding', t, { method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#000000' } }) });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('the legacy /api/v1/org/branding path keeps working (alias, not a move — no duplicated logic)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/org/branding', t, { method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#abcdef' } }) });
    expect(res.status).toBe(200);
    expect(OrgConfig.safeParse(await readJson(res)).success).toBe(true);
  });

  it('a schema-invalid body gets a 400 envelope', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding', t, { method: 'PUT', body: JSON.stringify({ nope: 1 }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('every org patch stamps a fresh updatedAt on the wire - the web branding page re-syncs only when this fingerprint changes (live 2026-07-12: page stayed stale until reload because the field was read client-side but never written)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const first = await readJson(await authed('/api/v1/branding', t, { method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#2a3547' } }) }));
    expect(OrgConfig.safeParse(first).success).toBe(true);
    expect(typeof first.updatedAt).toBe('string');
    await new Promise((r) => setTimeout(r, 5)); // updatedAt has ms precision
    const second = await readJson(await authed('/api/v1/branding', t, { method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#374559' } }) }));
    expect(typeof second.updatedAt).toBe('string');
    expect(second.updatedAt).not.toBe(first.updatedAt);
    // GET /org (what fetchCompany renders) carries the same fingerprint.
    const org = await readJson(await authed('/api/v1/org', t));
    expect(org.updatedAt).toBe(second.updatedAt);
  });

  it('MERGES onto existing branding - a dashboard Save never wipes research outputs (pre-fix: updateOrg replaced branding wholesale)', async () => {
    await mkUser('admin', 'org-admin');
    await orgs.update('orgA', (o) => ({
      ...o,
      branding: {
        primaryColor: '#2a3547',
        toneOfVoice: 'sóbrio e profissional',
        designSystem: { palette: [{ hex: '#2a3547', count: 10, confidence: 'high', sources: ['header'] }] },
        visualVibe: { mood: 'clássico', bullets: [], shape: 'angular', density: 'balanced', texture: 'photo', hero: 'overlay escuro' },
      },
    }));
    const t = await tokenFor('admin');
    // The dashboard sends only its editable fields - here, just a font change.
    const res = await authed('/api/v1/branding', t, { method: 'PUT', body: JSON.stringify({ branding: { fontFamily: 'Lora' } }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(OrgConfig.safeParse(body).success).toBe(true);
    const b = body.branding as Record<string, unknown>;
    expect(b.fontFamily).toBe('Lora');
    expect(b.primaryColor).toBe('#2a3547'); // untouched
    expect(b.toneOfVoice).toBe('sóbrio e profissional'); // untouched
    expect((b.designSystem as { palette?: unknown[] }).palette).toHaveLength(1); // survived the save
    expect((b.visualVibe as { mood?: string }).mood).toBe('clássico'); // survived the save
  });
});

describe('POST /api/v1/branding/research', () => {
  it('org-admin enqueues the brand-research job and gets BrandingResearchResponse { jobId }', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://exemplo.pt' }) });
    expect(res.status).toBe(202);
    const body = await readJson(res);
    // the contract answers { jobId } — NOT a job envelope
    expect(BrandingResearchResponse.safeParse(body).success).toBe(true);
    expect(typeof body.jobId).toBe('string');

    // the job really exists and is a brand-research job owned by the caller
    const job = (await awaitJob(body.jobId as string)) as unknown as { kind: string; userId: string } | null;
    expect(job?.kind).toBe('brand-research');
    expect(job?.userId).toBe('admin');
    // Drain the fire-and-forget job so it settles inside THIS test (no credential set -> it fails
    // at synthesis) rather than running on into the next test and mutating the shared transport/
    // pipeline singletons mid-run.
    await awaitJobDone(body.jobId as string);
  });

  it('the requested websiteUrl reaches the agent prompt (contract field -> prompt mapping)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://marca-unica.example' }) });
    const body = await readJson(res);
    const job = (await awaitJob(body.jobId as string)) as unknown as { request?: Record<string, unknown> } | null;
    expect(JSON.stringify(job?.request ?? {})).toContain('marca-unica.example');
    await awaitJobDone(body.jobId as string); // drain the fire-and-forget job (see note above)
  });

  it('a structured research result is MERGE-written onto org branding (pre-fix: success stored nothing)', async () => {
    await mkUser('admin', 'org-admin');
    // Pre-existing branding: the logo must SURVIVE the merge; primaryColor gets updated.
    await orgs.update('orgA', (o) => ({ ...o, branding: { logo: 'https://old.example/logo.png', primaryColor: '#000000' } }));
    await setCredential({ mode: 'oauth', secret: 'tok' });
    // The synthesis is a tool-less runOneShot, so the fake transport answers via `oneShotText`.
    __setTransportForTests(makeFakeTransport({
      oneShotText: JSON.stringify({
        websiteUrl: 'https://exemplo.pt',
        primaryColor: '#123ABC',
        accentColor: '#FF8800',
        toneOfVoice: 'próximo e profissional',
        summary: 'Empresa exemplo com identidade sóbria.',
        confidence: 'medium',
      }),
    }));

    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://exemplo.pt' }) });
    expect(res.status).toBe(202);
    const { jobId } = (await readJson(res)) as { jobId: string };

    const job = await awaitJobDone(jobId);
    expect(job?.status, JSON.stringify(job)).toBe('completed');
    const jobResult = job?.result as { branding?: unknown; brandingApplied?: boolean };
    expect(jobResult.brandingApplied).toBe(true);
    expect(BrandResearchResult.safeParse(jobResult.branding).success).toBe(true);

    // The org read (what the branding page renders after refetch) shows the MERGED branding.
    const orgBody = await readJson(await authed('/api/v1/org', t));
    const branding = orgBody.branding as Record<string, unknown>;
    expect(branding.primaryColor).toBe('#123ABC');
    expect(branding.accentColor).toBe('#FF8800');
    expect(branding.toneOfVoice).toBe('próximo e profissional');
    expect(branding.logo).toBe('https://old.example/logo.png'); // merge, never a wipe
    // Research metadata stays on the job, never on branding.
    expect(branding.summary).toBeUndefined();
    expect(branding.confidence).toBeUndefined();
  });

  it('a REACHABLE site: merges colours + fonts + tone + designSystem + visualVibe + a stored logo onto org branding', async () => {
    await mkUser('admin', 'org-admin');
    await setCredential({ mode: 'oauth', secret: 'tok' });

    // The deterministic pipeline seams are injected with fixture data - no network, browser,
    // dembrandt, or vibe model call. Only the tool-less synthesis rides the fake transport.
    const designSystem: DesignSystem = {
      url: 'https://marca.pt/',
      extractedAt: 'x',
      colors: {
        // Every hex the fake model returns must exist in the snapshot evidence: the apply-step
        // now enforces the literal-candidates rule server-side and drops out-of-snapshot colors.
        palette: [
          { color: '#0d9488', normalized: '#0d9488', count: 200, confidence: 'high', sources: ['button'] },
          { color: '#1032cf', normalized: '#1032cf', count: 60, confidence: 'medium', sources: ['link'] },
          { color: '#f0b11a', normalized: '#f0b11a', count: 30, confidence: 'medium', sources: ['icon'] },
        ],
        cssVariables: { '--primary': { value: '#0d9488' } },
      },
      // dembrandt 0.23 typography spellings, to prove the normalization survives persistence.
      typography: { styles: [{ context: 'body', family: 'Inter', size: '16px', weight: 400 } as never] },
      frameworks: [{ name: 'Next.js', confidence: 'high' }],
    };
    const visualVibe: VisualVibe = { mood: 'moderno minimalista', bullets: ['tipografia grande'], shape: 'rounded', density: 'minimal', texture: 'flat', hero: 'bloco sólido' };

    __setBrandingPipelineForTests({
      fetchSiteContext: async (url) => ({ ...unreachableSite(url), ok: true, status: 200, finalUrl: url, fontCandidates: ['Inter'], textSample: 'Somos a Marca.', ogImage: 'https://marca.pt/og.png' }),
      fetchRenderedCandidates: async () => okRendered,
      fetchDesignSystem: async () => designSystem,
      fetchVisualVibe: async () => visualVibe,
      resolveBrandLogo: async () => '/brand-assets/deadbeef.png',
    });
    __setTransportForTests(makeFakeTransport({
      oneShotText: JSON.stringify({
        websiteUrl: 'https://marca.pt/',
        primaryColor: '#0d9488',
        secondaryColor: '#1032cf',
        accentColor: '#f0b11a',
        fonts: ['Inter'],
        toneOfVoice: 'claro e direto',
        instructions: 'Formas arredondadas, tipografia grande, botão sólido.',
        summary: 'Marca de exemplo.',
        confidence: 'high',
      }),
    }));

    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://marca.pt' }) });
    expect(res.status).toBe(202);
    const { jobId } = (await readJson(res)) as { jobId: string };

    const job = await awaitJobDone(jobId);
    expect(job?.status, JSON.stringify(job)).toBe('completed');
    const jr = job?.result as { brandingApplied?: boolean; siteReachable?: boolean };
    expect(jr.brandingApplied).toBe(true);
    expect(jr.siteReachable).toBe(true);

    const orgBody = await readJson(await authed('/api/v1/org', t));
    expect(OrgConfig.safeParse(orgBody).success).toBe(true); // designSystem + visualVibe still validate
    const b = orgBody.branding as Record<string, unknown>;
    expect(b.primaryColor).toBe('#0d9488');
    expect(b.secondaryColor).toBe('#1032cf');
    expect(b.accentColor).toBe('#f0b11a');
    expect(b.fonts).toEqual(['Inter']);
    expect(b.toneOfVoice).toBe('claro e direto');
    expect(b.instructions).toContain('arredondadas');
    expect(b.logo).toBe('/brand-assets/deadbeef.png'); // a stored file, never a raw external URL

    const ds = b.designSystem as { palette?: Array<{ hex: string }>; typography?: { families?: string[] } };
    expect(ds.palette?.[0]?.hex).toBe('#0d9488');
    expect(ds.typography?.families).toContain('Inter');
    const vv = b.visualVibe as { mood?: string };
    expect(vv.mood).toBe('moderno minimalista');
    // Research metadata never rides branding.
    expect(b.summary).toBeUndefined();
    expect(b.confidence).toBeUndefined();
  });

  it('a grounded site with only NEUTRAL evidence completes fail-loud: colorsApplied false + NO_PRIMARY_COLOR, org stays colorless (live 2026-07-12: silent success read as a teal research result)', async () => {
    await mkUser('admin', 'org-admin');
    await setCredential({ mode: 'oauth', secret: 'tok' });
    __setBrandingPipelineForTests({
      fetchSiteContext: async (url) => ({ ...unreachableSite(url), ok: true, status: 200, textSample: 'Advogada.' }),
      fetchRenderedCandidates: async () => okRendered, // render ran; nothing non-neutral painted
      fetchDesignSystem: async () => null,
      fetchVisualVibe: async () => null,
      resolveBrandLogo: async () => '/brand-assets/mono.webp',
    });
    // A compliant model on an all-neutral snapshot can only return neutrals.
    __setTransportForTests(makeFakeTransport({
      oneShotText: JSON.stringify({ websiteUrl: 'https://mono.pt/', primaryColor: '#ffffff', secondaryColor: '#000000', accentColor: '#9d9d9d', confidence: 'medium' }),
    }));

    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://mono.pt' }) });
    const { jobId } = (await readJson(res)) as { jobId: string };

    const job = await awaitJobDone(jobId);
    expect(job?.status, JSON.stringify(job)).toBe('completed');
    const jr = job?.result as { brandingApplied?: boolean; colorsApplied?: boolean; warnings?: string[] };
    expect(jr.brandingApplied).toBe(true); // the logo still landed - partial apply
    expect(jr.colorsApplied).toBe(false); // fail-loud: the user must set colors manually
    expect(jr.warnings).toContain('NO_PRIMARY_COLOR');

    const orgBody = await readJson(await authed('/api/v1/org', t));
    const b = orgBody.branding as Record<string, unknown>;
    expect(b.primaryColor).toBeUndefined();
    expect(b.secondaryColor).toBeUndefined();
    expect(b.accentColor).toBeUndefined(); // the gray accent is dropped too now
    expect(b.logo).toBe('/brand-assets/mono.webp');
    // The exact defect: the old platform default teal must appear NOWHERE in the org record.
    expect(JSON.stringify(orgBody)).not.toContain('0d9488');

    // GET /jobs/:id carries the fail-loud outcome for clients that missed the stream event,
    // and still validates the shared Job schema.
    const jobBody = await readJson(await authed(`/api/v1/jobs/${jobId}`, t));
    expect(Job.safeParse(jobBody).success).toBe(true);
    expect(jobBody.colorsApplied).toBe(false);
    expect(jobBody.warnings).toContain('NO_PRIMARY_COLOR');
  });

  it('a returned color ABSENT from the snapshot evidence is dropped, never merged (server-side literal-candidates enforcement)', async () => {
    await mkUser('admin', 'org-admin');
    await setCredential({ mode: 'oauth', secret: 'tok' });
    __setBrandingPipelineForTests({
      fetchSiteContext: async (url) => ({ ...unreachableSite(url), ok: true, status: 200 }),
      // The only non-neutral evidence is the pixel-sampled navy.
      fetchRenderedCandidates: async () => ({
        ...okRendered,
        screenshotCandidates: [{ hex: '#2a3547', count: 9_000, bucket: 'blue' as const, saturation: 0.26, lightness: 0.22, brandFit: 0.26, source: 'screenshot' as const }],
      }),
      fetchDesignSystem: async () => null,
      fetchVisualVibe: async () => null,
      resolveBrandLogo: async () => null,
    });
    // The model hallucinates the old platform teal instead of picking from the snapshot.
    __setTransportForTests(makeFakeTransport({
      oneShotText: JSON.stringify({ websiteUrl: 'https://firma.pt/', primaryColor: '#0d9488', confidence: 'high' }),
    }));

    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://firma.pt' }) });
    const { jobId } = (await readJson(res)) as { jobId: string };

    const job = await awaitJobDone(jobId);
    expect(job?.status, JSON.stringify(job)).toBe('completed');
    expect((job?.result as { colorsApplied?: boolean }).colorsApplied).toBe(false);
    expect((job?.result as { warnings?: string[] }).warnings).toContain('NO_PRIMARY_COLOR');

    const orgBody = await readJson(await authed('/api/v1/org', t));
    expect((orgBody.branding as Record<string, unknown> | undefined)?.primaryColor).toBeUndefined();
    expect(JSON.stringify(orgBody)).not.toContain('0d9488');
  });

  it('an imagery-branded site: the pixel-sampled navy is legitimate evidence and merges as primary (screenshot fallback)', async () => {
    await mkUser('admin', 'org-admin');
    await setCredential({ mode: 'oauth', secret: 'tok' });
    __setBrandingPipelineForTests({
      fetchSiteContext: async (url) => ({ ...unreachableSite(url), ok: true, status: 200 }),
      fetchRenderedCandidates: async () => ({
        ...okRendered,
        screenshotCandidates: [{ hex: '#2a3547', count: 9_000, bucket: 'blue' as const, saturation: 0.26, lightness: 0.22, brandFit: 0.26, source: 'screenshot' as const }],
      }),
      fetchDesignSystem: async () => null,
      fetchVisualVibe: async () => null,
      resolveBrandLogo: async () => null,
    });
    __setTransportForTests(makeFakeTransport({
      oneShotText: JSON.stringify({ websiteUrl: 'https://firma.pt/', primaryColor: '#2a3547', confidence: 'medium' }),
    }));

    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://firma.pt' }) });
    const { jobId } = (await readJson(res)) as { jobId: string };

    const job = await awaitJobDone(jobId);
    expect(job?.status, JSON.stringify(job)).toBe('completed');
    const jr = job?.result as { colorsApplied?: boolean; warnings?: string[] };
    expect(jr.colorsApplied).toBe(true);
    expect(jr.warnings ?? []).not.toContain('NO_PRIMARY_COLOR');

    const orgBody = await readJson(await authed('/api/v1/org', t));
    expect((orgBody.branding as Record<string, unknown>).primaryColor).toBe('#2a3547');
  });

  it('a researched companyName updates org.displayName (the seeded bootstrap name is replaceable) and never rides branding', async () => {
    await mkUser('admin', 'org-admin');
    await setCredential({ mode: 'oauth', secret: 'tok' });
    // Knowledge path (default unreachable pipeline): proposals are unconstrained by evidence.
    __setTransportForTests(makeFakeTransport({
      oneShotText: JSON.stringify({
        websiteUrl: 'https://mariliasantoscabral.webnode.pt/',
        companyName: 'Marília Santos Cabral Advogada R.L.',
        primaryColor: '#2a3547',
        confidence: 'medium',
      }),
    }));

    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://mariliasantoscabral.webnode.pt' }) });
    const { jobId } = (await readJson(res)) as { jobId: string };
    const job = await awaitJobDone(jobId);
    expect(job?.status, JSON.stringify(job)).toBe('completed');

    const orgBody = await readJson(await authed('/api/v1/org', t));
    expect(orgBody.displayName).toBe('Marília Santos Cabral Advogada R.L.');
    expect((orgBody.branding as Record<string, unknown>).companyName).toBeUndefined(); // metadata, not branding
    expect((orgBody.branding as Record<string, unknown>).primaryColor).toBe('#2a3547');
  });

  it('prose-only research output completes WITHOUT touching org branding (brandingApplied false)', async () => {
    await mkUser('admin', 'org-admin');
    await orgs.update('orgA', (o) => ({ ...o, branding: { primaryColor: '#000000' } }));
    await setCredential({ mode: 'oauth', secret: 'tok' });
    __setTransportForTests(makeFakeTransport({
      oneShotText: 'A marca parece moderna e usa tons azuis, mas não consigo estruturar mais do que isto.',
    }));

    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://exemplo.pt' }) });
    const { jobId } = (await readJson(res)) as { jobId: string };

    const job = await awaitJobDone(jobId);
    expect(job?.status, JSON.stringify(job)).toBe('completed'); // prose is not an error
    expect((job?.result as { brandingApplied?: boolean }).brandingApplied).toBe(false);

    const orgBody = await readJson(await authed('/api/v1/org', t));
    expect((orgBody.branding as Record<string, unknown>).primaryColor).toBe('#000000'); // untouched
  });

  it('an SSRF websiteUrl (link-local metadata) is rejected with a 400 envelope, no job created (url-safety.ts names brand-research a guarded target)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'http://169.254.169.254/latest/meta-data/' }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect(await jobs.find({})).toHaveLength(0);
  });

  it('a builder gets a 403 envelope and NO job is created', async () => {
    await mkUser('bob', 'user');
    const t = await tokenFor('bob');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://exemplo.pt' }) });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect(await jobs.find({})).toHaveLength(0);
  });

  it('a missing websiteUrl gets a 400 envelope', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('unauthenticated gets a 401 envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/branding/research`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ websiteUrl: 'https://x.pt' }),
    });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});
