import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { readTours, SHELL_LANDMARKS } from '../../src/apps/tour-writer.js';
import { demoSpecSchema, parseStoredTours } from '../../src/services/demo-registry.js';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts } from '../../src/data/stores.js';
import { createBuildMechanics } from '../../src/apps/build-mechanics.js';
import type { ArtifactDoc } from '../../src/apps/artifacts-service.js';

/**
 * operator-run E1 — the build-time tour writer + the extended demo-spec schema.
 * Tours are DECLARED by the build agent (frontmatter or sibling files), captured
 * DETERMINISTICALLY here (no model call), stamped with the artifact id, validated
 * against the demo schema extended with optional tourId/kind, and stored WITH the
 * artifact. Covers: schema round-trip + 28-legacy backward-compat, both authoring
 * channels, unknown-target WARN, the kebab/dup/kind fail-loud rules, and the
 * capture-at-activation path onto artifact.data.tours.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ekoa-tours-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---- fixtures --------------------------------------------------------------

/** A valid authored OVERVIEW tour (no appId — the writer stamps it). Targets are
 *  shell landmarks so it cross-validates clean by default. */
function overviewTour(): Record<string, unknown> {
  return {
    tourId: 'visao-geral',
    kind: 'overview',
    card: { titlePt: 'Conheça a aplicação', descriptionPt: 'Uma volta rápida pelas funções principais.', durationSec: 60 },
    steps: [
      { id: 'abrir', type: 'navigate', to: '/', copy: { titlePt: 'Início', bodyPt: 'Esta é a página inicial da aplicação.' } },
      { id: 'destacar-menu', type: 'spotlight', target: 'app-nav', copy: { titlePt: 'Navegação', bodyPt: 'Use o menu para percorrer as secções.' } },
    ],
  };
}

/** A valid authored JOURNEY tour whose targets are app-specific (not shell
 *  landmarks): unknown unless the caller passes them as known targets. */
function journeyTour(): Record<string, unknown> {
  return {
    tourId: 'criar-cliente',
    kind: 'journey',
    card: { titlePt: 'Criar um cliente', descriptionPt: 'Registe o primeiro cliente.', durationSec: 45 },
    steps: [
      { id: 'ir-clientes', type: 'navigate', to: '/clientes' },
      {
        id: 'gravar',
        type: 'await-action',
        target: 'cliente-guardar',
        event: 'click',
        simulate: {
          actions: [
            { kind: 'fill', target: 'cliente-nome', value: 'Maria Santos' },
            { kind: 'click', target: 'cliente-guardar' },
          ],
        },
      },
    ],
  };
}

async function tmpProject(): Promise<string> {
  return mkdtemp(join(root, 'p-'));
}

async function writeManifestTours(dir: string, tours: unknown[]): Promise<void> {
  const fm = yaml.dump({ name: 'App de Teste', purpose: 'testar', tours });
  await writeFile(join(dir, 'MANIFEST.md'), `---\n${fm}---\n\n# App de Teste\n`, 'utf-8');
}

async function writeTourFile(dir: string, name: string, tour: unknown): Promise<void> {
  await mkdir(join(dir, 'tours'), { recursive: true });
  await writeFile(join(dir, 'tours', `${name}.json`), JSON.stringify(tour, null, 2), 'utf-8');
}

// ---- extended schema: round-trip + backward-compat -------------------------

describe('demoSpecSchema — E1 tourId/kind extension', () => {
  it('accepts a generated spec carrying tourId + kind and round-trips it', () => {
    const spec = { version: 1, appId: 'art-1', ...overviewTour() };
    const r = demoSpecSchema.safeParse(spec);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tourId).toBe('visao-geral');
      expect(r.data.kind).toBe('overview');
      // JSON round-trip is stable (the served shape equals the stored shape).
      expect(demoSpecSchema.safeParse(JSON.parse(JSON.stringify(r.data))).success).toBe(true);
    }
  });

  it('rejects a non-kebab tourId and an unknown kind (strictObject + regex)', () => {
    expect(demoSpecSchema.safeParse({ version: 1, appId: 'a', ...overviewTour(), tourId: 'Bad Id' }).success).toBe(false);
    expect(demoSpecSchema.safeParse({ version: 1, appId: 'a', ...overviewTour(), kind: 'walkthrough' }).success).toBe(false);
  });

  it('every shipped platform spec (the 28 legal-*.json) still validates — additive, non-breaking', async () => {
    const demosDir = fileURLToPath(new URL('../../assets/demos', import.meta.url));
    const files = (await readdir(demosDir)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    expect(files.length).toBeGreaterThanOrEqual(28);
    for (const file of files) {
      const raw = JSON.parse(await readFile(join(demosDir, file), 'utf-8'));
      const r = demoSpecSchema.safeParse(raw);
      expect(r.success, `${file} must still validate under the extended schema`).toBe(true);
      // Legacy specs carry neither field — proves the extension is optional.
      if (r.success) {
        expect(r.data.tourId).toBeUndefined();
        expect(r.data.kind).toBeUndefined();
      }
    }
  });
});

// ---- parseStoredTours ------------------------------------------------------

describe('parseStoredTours — the stored-tour resolver (serving + panel share it)', () => {
  it('drops invalid entries, keeps valid ones, and never throws on a non-array', () => {
    const valid = { version: 1, appId: 'art-9', ...overviewTour() };
    const invalid = { version: 1, appId: 'art-9', tourId: 'quebrado', kind: 'journey', card: overviewTour().card, steps: [] };
    expect(parseStoredTours([valid, invalid]).map((t) => t.tourId)).toEqual(['visao-geral']);
    expect(parseStoredTours(undefined)).toEqual([]);
    expect(parseStoredTours('nope')).toEqual([]);
  });
});

// ---- readTours: authoring channels -----------------------------------------

describe('readTours — authoring channels + stamping', () => {
  it('no MANIFEST.md and no tours/ dir -> absent', async () => {
    const dir = await tmpProject();
    expect((await readTours(dir, { appId: 'art-x' })).status).toBe('absent');
  });

  it('MANIFEST.md with no tours: section -> absent', async () => {
    const dir = await tmpProject();
    await writeFile(join(dir, 'MANIFEST.md'), `---\nname: X\npurpose: y\n---\n\n# X\n`, 'utf-8');
    expect((await readTours(dir, { appId: 'art-x' })).status).toBe('absent');
  });

  it('captures tours from MANIFEST.md frontmatter and stamps appId', async () => {
    const dir = await tmpProject();
    await writeManifestTours(dir, [overviewTour(), journeyTour()]);
    const res = await readTours(dir, { appId: 'art-42', knownTargets: ['cliente-guardar', 'cliente-nome'] });
    expect(res.status).toBe('valid');
    if (res.status === 'valid') {
      expect(res.tours.map((t) => t.tourId)).toEqual(['visao-geral', 'criar-cliente']);
      expect(res.tours.every((t) => t.appId === 'art-42')).toBe(true);
      expect(res.tours.every((t) => t.version === 1)).toBe(true);
      expect(res.warnings).toEqual([]); // all targets known, exactly one overview
    }
  });

  it('captures tours from sibling tours/*.json files', async () => {
    const dir = await tmpProject();
    await writeTourFile(dir, 'a-visao', overviewTour());
    const res = await readTours(dir, { appId: 'art-7' });
    expect(res.status).toBe('valid');
    if (res.status === 'valid') {
      expect(res.tours).toHaveLength(1);
      expect(res.tours[0]?.appId).toBe('art-7');
    }
  });

  it('merges both channels and dedups tourId across them (fail-loud)', async () => {
    const dir = await tmpProject();
    await writeManifestTours(dir, [overviewTour()]);
    await writeTourFile(dir, 'dup', overviewTour()); // same tourId as the frontmatter one
    const res = await readTours(dir, { appId: 'art-d' });
    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') expect(res.error).toMatch(/duplicate tourId "visao-geral"/);
  });
});

// ---- readTours: cross-validation (warn) + fail-loud rules -------------------

describe('readTours — target cross-validation warns, never fails', () => {
  it('warns on a target that is neither a shell landmark nor a declared ui_action', async () => {
    const dir = await tmpProject();
    await writeManifestTours(dir, [journeyTour()]); // targets cliente-guardar/-nome, no known targets passed
    const res = await readTours(dir, { appId: 'art-w' }); // knownTargets omitted
    expect(res.status).toBe('valid'); // WARN, not fail
    if (res.status === 'valid') {
      expect(res.warnings.some((w) => w.includes('cliente-guardar'))).toBe(true);
      expect(res.warnings.some((w) => w.includes('cliente-nome'))).toBe(true);
    }
  });

  it('does not warn when targets are shell landmarks', async () => {
    const dir = await tmpProject();
    await writeManifestTours(dir, [overviewTour()]); // targets app-nav (landmark) only
    const res = await readTours(dir, { appId: 'art-k' });
    expect(res.status).toBe('valid');
    if (res.status === 'valid') {
      expect(SHELL_LANDMARKS).toContain('app-nav');
      expect(res.warnings.some((w) => w.includes('app-nav'))).toBe(false);
    }
  });

  it('warns on home-empty - the replaceable HomePage placeholder is NOT a landmark (E2 live-gate finding)', async () => {
    const dir = await tmpProject();
    const tour = overviewTour();
    (tour.steps as Array<Record<string, unknown>>)[1] = {
      id: 'destacar-vazio', type: 'spotlight', target: 'home-empty',
      copy: { titlePt: 'Início', bodyPt: 'O estado vazio da página inicial.' },
    };
    await writeManifestTours(dir, [tour]);
    const res = await readTours(dir, { appId: 'art-he' });
    expect(res.status).toBe('valid'); // WARN, not fail
    if (res.status === 'valid') {
      expect(SHELL_LANDMARKS).not.toContain('home-empty');
      expect(res.warnings.some((w) => w.includes('home-empty'))).toBe(true);
    }
  });
});

describe('readTours — kebab/dup/kind fail-loud rules', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['non-kebab tourId', { ...overviewTour(), tourId: 'Visao Geral' }, /kebab-case "tourId"/],
    ['missing tourId', (() => { const t = overviewTour(); delete t.tourId; return t; })(), /kebab-case "tourId"/],
    ['bad kind', { ...overviewTour(), kind: 'walkthrough' }, /kind "overview" or "journey"/],
    ['missing steps', { tourId: 'vazio', kind: 'journey', card: overviewTour().card, steps: [] }, /failed validation/],
  ];
  for (const [label, tour, rx] of cases) {
    it(`${label} -> invalid`, async () => {
      const dir = await tmpProject();
      await writeManifestTours(dir, [tour]);
      const res = await readTours(dir, { appId: 'art-b' });
      expect(res.status).toBe('invalid');
      if (res.status === 'invalid') expect(res.error).toMatch(rx);
    });
  }

  it('invalid YAML frontmatter -> invalid (fail-loud)', async () => {
    const dir = await tmpProject();
    await writeFile(join(dir, 'MANIFEST.md'), `---\nname: X\ntours: [unterminated\n---\n`, 'utf-8');
    const res = await readTours(dir, { appId: 'art-y' });
    expect(res.status).toBe('invalid');
  });
});

// ---- capture-at-activation (the seam persists onto artifact.data.tours) -----

describe('activateArtifact — captures tours onto artifact.data.tours (E1 persistence)', () => {
  let mem: MongoMemoryServer;
  let ids = 0;
  const mech = createBuildMechanics({ now: () => Date.now(), genId: () => `art-${++ids}` });

  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_tour_writer');
  }, 60_000);
  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  async function draft(id: string, projectDir: string): Promise<void> {
    await artifacts.insert({
      _id: id, name: id, slug: id, userId: 'u1', orgId: 'o1', visibility: 'private', status: 'draft',
      data: { projectDir, appUrl: `/apps/${id}/`, artifactType: 'app' },
    } as never);
  }

  it('valid tours are stamped with the artifact id and stored; status active', async () => {
    const projectDir = await tmpProject();
    await writeManifestTours(projectDir, [overviewTour(), journeyTour()]);
    await draft('art-act-1', projectDir);
    await mech.activateArtifact({ artifactId: 'art-act-1', slug: 'art-act-1', appUrl: '/apps/art-act-1/', projectDir });

    const art = (await artifacts.get('art-act-1')) as ArtifactDoc | null;
    const data = art?.data as Record<string, unknown>;
    expect(art?.status).toBe('active');
    const tours = parseStoredTours(data.tours);
    expect(tours.map((t) => t.tourId)).toEqual(['visao-geral', 'criar-cliente']);
    expect(tours.every((t) => t.appId === 'art-act-1')).toBe(true);
    expect(data.toursError).toBeUndefined();
  });

  it('a present-but-invalid tour set records toursError (fail-loud), no tours', async () => {
    const projectDir = await tmpProject();
    await writeManifestTours(projectDir, [{ ...overviewTour(), tourId: 'Bad Id' }]);
    await draft('art-act-2', projectDir);
    await mech.activateArtifact({ artifactId: 'art-act-2', slug: 'art-act-2', appUrl: '/apps/art-act-2/', projectDir });

    const data = ((await artifacts.get('art-act-2')) as ArtifactDoc | null)?.data as Record<string, unknown>;
    expect(data.tours).toBeUndefined();
    expect(typeof data.toursError).toBe('string');
    expect(data.toursError as string).toMatch(/tourId/);
  });

  it('an app with no tours stores neither key', async () => {
    const projectDir = await tmpProject();
    await writeFile(join(projectDir, 'MANIFEST.md'), `---\nname: X\npurpose: y\n---\n`, 'utf-8');
    await draft('art-act-3', projectDir);
    await mech.activateArtifact({ artifactId: 'art-act-3', slug: 'art-act-3', appUrl: '/apps/art-act-3/', projectDir });

    const data = ((await artifacts.get('art-act-3')) as ArtifactDoc | null)?.data as Record<string, unknown>;
    expect(data.tours).toBeUndefined();
    expect(data.toursError).toBeUndefined();
  });
});

// ---- sibling tours/ channel: bounded + confined (codex-e1 #2) ---------------

describe('readTours — tours/ channel bounds + symlink confinement', () => {
  it('rejects a tours/ dir with more than the file cap', async () => {
    const dir = await tmpProject();
    await mkdir(join(dir, 'tours'), { recursive: true });
    for (let i = 0; i < 51; i++) {
      await writeFile(join(dir, 'tours', `t${i}.json`), JSON.stringify({ version: 1, ...overviewTour(), tourId: `t-${i}` }), 'utf-8');
    }
    const res = await readTours(dir, { appId: 'art-cap' });
    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') expect(res.error).toMatch(/limit is 50/);
  });

  it('rejects an oversized tour file (> per-file byte cap)', async () => {
    const dir = await tmpProject();
    await mkdir(join(dir, 'tours'), { recursive: true });
    const bloated = { version: 1, ...overviewTour(), pad: 'x'.repeat(300 * 1024) };
    await writeFile(join(dir, 'tours', 'big.json'), JSON.stringify(bloated), 'utf-8');
    const res = await readTours(dir, { appId: 'art-big' });
    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') expect(res.error).toMatch(/bytes; the limit is/);
  });

  it('rejects a tours/*.json that is a symlink escaping the tours directory', async () => {
    const { symlink, writeFile: wf } = await import('node:fs/promises');
    const dir = await tmpProject();
    await mkdir(join(dir, 'tours'), { recursive: true });
    const outside = join(dir, 'secret.json');
    await wf(outside, JSON.stringify({ version: 1, ...overviewTour() }), 'utf-8');
    await symlink(outside, join(dir, 'tours', 'link.json'));
    const res = await readTours(dir, { appId: 'art-link' });
    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') expect(res.error).toMatch(/outside the tours directory|not a regular file/);
  });
});
